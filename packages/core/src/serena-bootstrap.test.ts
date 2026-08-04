import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  SERENA_MCP_ARGS,
  SERENA_UV_INSTALLER_URL,
  bootstrapSerena,
  createDefaultSerenaBootstrapEffects,
  createSerenaReadinessRevalidator,
  redactSerenaDiagnostic,
  resolveSerenaOwnedRoot,
  type SerenaBootstrapEffects,
  type SerenaBootstrapRequest,
  type SerenaFetchRequest,
  type SerenaPathInspection,
  type SerenaProbeResult,
  type SerenaProcessHandle,
  type SerenaProcessResult,
  type SerenaProcessSpec,
} from "./serena-bootstrap";

const ROOT = "/fixtures/deck-data";
const SERENA_ROOT = `${ROOT}/tools/serena`;
const UV_PATH = `${SERENA_ROOT}/uv/uv`;
const SERENA_PATH = `${SERENA_ROOT}/bin/serena`;

function installerFetchRequest(): SerenaFetchRequest {
  return {
    url: SERENA_UV_INSTALLER_URL,
    method: "GET",
    redirect: "manual",
    credentials: "omit",
    headers: {},
    maxBytes: 1_048_576,
    timeoutMs: 1_000,
    signal: new AbortController().signal,
  };
}

const authorization = {
  kind: "interactive-tui-explicit-selection" as const,
  runner: "opencode" as const,
  operationId: "operation-1",
};

type FakeState = {
  calls: {
    canonicalize: string[];
    directories: string[];
    fetches: unknown[];
    processes: SerenaProcessSpec[];
    probes: unknown[];
  };
  inspections: Map<string, SerenaPathInspection[]>;
  probes: SerenaProbeResult[];
  processResults: SerenaProcessResult[];
  abortDuringSpawn?: AbortController;
};

function readyInspection(path: string, fingerprint = `fp:${path}`): SerenaPathInspection {
  return { state: "ready", resolvedPath: path, fingerprint };
}

function makeEffects(overrides: Partial<SerenaBootstrapEffects> = {}): {
  effects: SerenaBootstrapEffects;
  state: FakeState;
} {
  const state: FakeState = {
    calls: {
      canonicalize: [],
      directories: [],
      fetches: [],
      processes: [],
      probes: [],
    },
    inspections: new Map(),
    probes: [],
    processResults: [],
  };

  const defaultInspection = (path: string): SerenaPathInspection => {
    const queue = state.inspections.get(path);
    if (queue && queue.length > 0) return queue.shift()!;
    if (path === SERENA_PATH || path === UV_PATH) return { state: "missing" };
    return { state: "missing" };
  };

  const defaultProbe = async (): Promise<SerenaProbeResult> =>
    state.probes.shift() ?? { state: "ready", fingerprint: "fp:default" };

  const defaultProcessResult = (): SerenaProcessResult =>
    state.processResults.shift() ?? { state: "exited", exitCode: 0, termination: "known" };

  const effects: SerenaBootstrapEffects = {
    resolveDeckDataRoot: () => ROOT,
    canonicalizePath: async (path) => {
      state.calls.canonicalize.push(path);
      return path;
    },
    isUserOwnedPath: async () => true,
    ensureDirectory: async (path) => {
      state.calls.directories.push(path);
    },
    inspectPath: async (path) => defaultInspection(path),
    fetchInstaller: async (request) => {
      state.calls.fetches.push(request);
      return {
        status: 200,
        redirected: false,
        body: new Uint8Array([35, 32, 117, 118]),
      };
    },
    spawn: async (spec) => {
      state.calls.processes.push(spec);
      state.abortDuringSpawn?.abort();
      const result = defaultProcessResult();
      const handle: SerenaProcessHandle = {
        terminate: () => undefined,
        wait: async () => result,
      };
      return handle;
    },
    probeExecutable: async (request) => {
      state.calls.probes.push(request);
      return defaultProbe();
    },
    ...overrides,
  };

  return { effects, state };
}

function request(
  effects: SerenaBootstrapEffects,
  extra: Partial<SerenaBootstrapRequest> = {},
): SerenaBootstrapRequest & { effects: SerenaBootstrapEffects } {
  return {
    authorization,
    effects,
    ...extra,
  };
}

describe("serena bootstrap Core service", () => {
  it("uses the production default seam for a valid selected request", async () => {
    const controller = new AbortController();
    // Abort before the first effect: the default composition is selected, but
    // this regression guard cannot reach home, network, or child-process I/O.
    controller.abort();

    const result = await bootstrapSerena({
      authorization,
      currentOperation: {
        runner: "opencode",
        operationId: "operation-1",
        explicitlySelected: true,
      },
      signal: controller.signal,
    });

    expect(result).toEqual({ outcome: "cancelled", stage: "preparing-uv", mutationStarted: false });
  });

  it("follows bounded secure redirects without coupling to the current release CDN", async () => {
    const calls: Array<{ url: string; redirect: RequestRedirect | undefined }> = [];
    const releaseUrl = "https://current-release-cdn.example.test/uv-installer.sh";
    const effects = createDefaultSerenaBootstrapEffects({
      fetch: async (input, init) => {
        const url = String(input);
        calls.push({ url, redirect: init?.redirect });
        if (url === SERENA_UV_INSTALLER_URL) {
          return new Response(null, { status: 302, headers: { location: releaseUrl } });
        }
        return new Response(new Uint8Array([35, 32, 117, 118]), { status: 200 });
      },
    });

    const accepted = await effects.fetchInstaller(installerFetchRequest());

    expect(calls).toEqual([
      { url: SERENA_UV_INSTALLER_URL, redirect: "manual" },
      { url: releaseUrl, redirect: "manual" },
    ]);
    expect(accepted).toMatchObject({ status: 200, redirected: false });
    expect(accepted.body).toEqual(new Uint8Array([35, 32, 117, 118]));

    const rejectedEffects = createDefaultSerenaBootstrapEffects({
      fetch: async () => new Response(null, {
        status: 302,
        headers: { location: "http://example.test/insecure-installer.sh" },
      }),
    });
    const rejected = await rejectedEffects.fetchInstaller(installerFetchRequest());

    expect(rejected).toMatchObject({ status: 302, redirected: true });
    expect(rejected.body).toEqual(new Uint8Array());

    let redirectCalls = 0;
    const exhaustedEffects = createDefaultSerenaBootstrapEffects({
      fetch: async () => {
        redirectCalls += 1;
        return new Response(null, {
          status: 302,
          headers: { location: `https://hop-${redirectCalls}.example.test/uv-installer.sh` },
        });
      },
    });
    const exhausted = await exhaustedEffects.fetchInstaller(installerFetchRequest());

    expect(redirectCalls).toBe(6);
    expect(exhausted).toMatchObject({ status: 302, redirected: true });
  });

  it("accepts only symlinked executables whose canonical target remains inside the owned root", async () => {
    const fixtureRoot = await mkdtemp(join(tmpdir(), "deck-serena-symlink-"));
    try {
      const ownedRoot = join(fixtureRoot, "owned");
      const binDir = join(ownedRoot, "bin");
      const toolBinDir = join(ownedRoot, "uv-tools", "serena-agent", "bin");
      const outsideDir = join(fixtureRoot, "outside");
      await Promise.all([
        mkdir(binDir, { recursive: true }),
        mkdir(toolBinDir, { recursive: true }),
        mkdir(outsideDir, { recursive: true }),
      ]);
      const target = join(toolBinDir, "serena");
      const outsideTarget = join(outsideDir, "serena");
      await Promise.all([
        writeFile(target, "#!/bin/sh\nexit 0\n", { mode: 0o755 }),
        writeFile(outsideTarget, "#!/bin/sh\nexit 0\n", { mode: 0o755 }),
      ]);
      const ownedLink = join(binDir, "serena");
      const escapingLink = join(binDir, "serena-escaping");
      await Promise.all([
        symlink(target, ownedLink),
        symlink(outsideTarget, escapingLink),
      ]);
      const effects = createDefaultSerenaBootstrapEffects();
      const signal = new AbortController().signal;

      const accepted = await effects.inspectPath(ownedLink, signal, ownedRoot);
      const rejected = await effects.inspectPath(escapingLink, signal, ownedRoot);

      expect(accepted).toMatchObject({ state: "ready", resolvedPath: ownedLink });
      expect(accepted.fingerprint).toMatch(/^[A-Za-z0-9][A-Za-z0-9._:-]+$/);
      expect(rejected).toMatchObject({ state: "unusable" });
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("rejects missing, default-only, and runner-mismatched authorization before any effect", async () => {
    const cases: SerenaBootstrapRequest[] = [
      {},
      { authorization: { kind: "default-selection" } as never },
      {
        authorization: {
          kind: "interactive-tui-explicit-selection",
          runner: "pi",
          operationId: "operation-1",
        },
        runner: "opencode",
        operationId: "operation-1",
      },
    ];

    for (const input of cases) {
      const { effects, state } = makeEffects();
      const result = await bootstrapSerena({ ...input, effects });

      expect(result.outcome).toBe("failed");
      expect(state.calls.canonicalize).toEqual([]);
      expect(state.calls.directories).toEqual([]);
      expect(state.calls.fetches).toEqual([]);
      expect(state.calls.processes).toEqual([]);
      expect(state.calls.probes).toEqual([]);
    }
  });

  it("requires a matching current operation when one is supplied", async () => {
    const { effects, state } = makeEffects();
    const result = await bootstrapSerena(
      request(effects, {
        currentOperation: {
          runner: "opencode",
          operationId: "different-operation",
          explicitlySelected: true,
        },
      }),
    );

    expect(result.outcome).toBe("failed");
    expect(state.calls.fetches).toHaveLength(0);
    expect(state.calls.processes).toHaveLength(0);
  });

  it("reuses fresh ready Serena evidence without bootstrap or reinstall", async () => {
    const { effects, state } = makeEffects();
    state.inspections.set(SERENA_PATH, [readyInspection(SERENA_PATH, "serena-fp")]);
    state.probes.push({ state: "ready", fingerprint: "serena-fp" });

    const result = await bootstrapSerena(request(effects));

    expect(result).toEqual({
      outcome: "reused",
      evidence: {
        capabilityId: "serena",
        state: "ready",
        resolvedExecutablePath: SERENA_PATH,
        source: "existing-deck-tool",
        probe: "serena-help",
        fingerprint: "serena-fp",
      },
    });
    expect(state.calls.fetches).toHaveLength(0);
    expect(state.calls.processes).toHaveLength(0);
    expect(state.calls.directories).toHaveLength(0);
  });

  it("resolves the shared owned root and revalidates the exact executable identity", async () => {
    const { effects, state } = makeEffects();
    state.inspections.set(SERENA_PATH, [
      readyInspection(SERENA_PATH, "serena-fp"),
      readyInspection(SERENA_PATH, "serena-fp"),
      readyInspection(SERENA_PATH, "changed-fp"),
    ]);
    state.probes.push({ state: "ready", resolvedPath: SERENA_PATH, fingerprint: "serena-fp" });

    const ownedRoot = await resolveSerenaOwnedRoot(effects);
    expect(ownedRoot).toBe(SERENA_ROOT);
    const revalidate = createSerenaReadinessRevalidator(ownedRoot!, effects);
    const evidence = {
      capabilityId: "serena" as const,
      state: "ready" as const,
      resolvedExecutablePath: SERENA_PATH,
      source: "installed-deck-tool" as const,
      probe: "serena-help" as const,
      fingerprint: "serena-fp",
    };

    expect(await revalidate(evidence)).toEqual({ valid: true, evidence });
    expect(await revalidate(evidence)).toMatchObject({
      valid: false,
      code: "stale-readiness-evidence",
    });
    expect(state.calls.directories).toHaveLength(0);
    expect(state.calls.fetches).toHaveLength(0);
    expect(state.calls.processes).toHaveLength(0);
  });

  it("fails closed for an outside-root candidate and never replaces an unusable Serena", async () => {
    const outside = "/other-user/bin/serena";
    const outsideCase = makeEffects();
    const outsideResult = await bootstrapSerena(
      request(outsideCase.effects, { existingSerenaExecutablePath: outside }),
    );
    expect(outsideResult.outcome).toBe("failed");
    expect(outsideCase.state.calls.fetches).toHaveLength(0);
    expect(outsideCase.state.calls.processes).toHaveLength(0);

    const unusableCase = makeEffects();
    unusableCase.state.inspections.set(SERENA_PATH, [{ state: "unusable" }]);
    const unusableResult = await bootstrapSerena(request(unusableCase.effects));
    expect(unusableResult.outcome).toBe("failed");
    expect(unusableCase.state.calls.fetches).toHaveLength(0);
    expect(unusableCase.state.calls.processes).toHaveLength(0);
  });

  it("performs the controlled official bootstrap and exact Serena command", async () => {
    const { effects, state } = makeEffects();
    state.inspections.set(SERENA_PATH, [
      { state: "missing" },
      readyInspection(SERENA_PATH, "installed-serena-fp"),
    ]);
    state.inspections.set(UV_PATH, [
      { state: "missing" },
      readyInspection(UV_PATH, "installed-uv-fp"),
    ]);
    state.probes.push(
      { state: "ready", fingerprint: "installed-uv-fp" },
      { state: "ready", fingerprint: "installed-serena-fp" },
    );

    const result = await bootstrapSerena(request(effects));

    expect(result.outcome).toBe("installed");
    expect(state.calls.fetches).toHaveLength(1);
    expect(state.calls.fetches[0]).toMatchObject({
      url: SERENA_UV_INSTALLER_URL,
      method: "GET",
      redirect: "manual",
      maxBytes: expect.any(Number),
      timeoutMs: expect.any(Number),
    });
    expect(state.calls.fetches[0]).not.toHaveProperty("headers.Authorization");

    expect(state.calls.processes).toHaveLength(2);
    expect(state.calls.processes[0]).toMatchObject({
      executable: "/bin/sh",
      args: [],
      shell: false,
      stdin: new Uint8Array([35, 32, 117, 118]),
      env: {
        PATH: "/usr/bin:/bin",
        LC_ALL: "C",
        UV_UNMANAGED_INSTALL: `${SERENA_ROOT}/uv`,
        UV_NO_MODIFY_PATH: "1",
      },
    });
    expect(state.calls.processes[0]).not.toHaveProperty("command");
    expect(state.calls.processes[1]).toMatchObject({
      executable: UV_PATH,
      args: ["tool", "install", "-p", "3.13", "serena-agent"],
      shell: false,
      env: {
        PATH: "/usr/bin:/bin",
        LC_ALL: "C",
        UV_TOOL_DIR: `${SERENA_ROOT}/uv-tools`,
        UV_TOOL_BIN_DIR: `${SERENA_ROOT}/bin`,
        UV_PYTHON_INSTALL_DIR: `${SERENA_ROOT}/python`,
        UV_PYTHON_BIN_DIR: `${SERENA_ROOT}/python-bin`,
        UV_CACHE_DIR: `${SERENA_ROOT}/cache`,
      },
    });
    expect(state.calls.processes[1].env).toEqual({
      PATH: "/usr/bin:/bin",
      LC_ALL: "C",
      UV_TOOL_DIR: `${SERENA_ROOT}/uv-tools`,
      UV_TOOL_BIN_DIR: `${SERENA_ROOT}/bin`,
      UV_PYTHON_INSTALL_DIR: `${SERENA_ROOT}/python`,
      UV_PYTHON_BIN_DIR: `${SERENA_ROOT}/python-bin`,
      UV_CACHE_DIR: `${SERENA_ROOT}/cache`,
    });
    expect(state.calls.processes[1].env).not.toHaveProperty("HOME");
    expect(state.calls.processes[1].env).not.toHaveProperty("PATH_EXTRA");
    expect(result).toMatchObject({
      outcome: "installed",
      evidence: {
        resolvedExecutablePath: SERENA_PATH,
        fingerprint: "installed-serena-fp",
      },
    });
  });

  it("rejects unresolved redirects, oversized responses, installer failures, and forbidden fallback", async () => {
    const responseCases = [
      { redirected: true, status: 200, body: new Uint8Array([1]) },
      { redirected: false, status: 200, body: new Uint8Array(2_000_000) },
      { redirected: false, status: 503, body: new Uint8Array([1]) },
    ];

    for (const response of responseCases) {
      const { effects, state } = makeEffects({
        fetchInstaller: async (input) => {
          state.calls.fetches.push(input);
          return response;
        },
      });
      state.inspections.set(SERENA_PATH, [{ state: "missing" }]);
      state.inspections.set(UV_PATH, [{ state: "missing" }]);

      const result = await bootstrapSerena(request(effects));
      expect(result.outcome).toBe("failed");
      expect(state.calls.fetches).toHaveLength(1);
      expect(state.calls.processes).toHaveLength(0);
    }
  });

  it("stops after an unusable resolved uv and never starts Serena installation", async () => {
    const { effects, state } = makeEffects();
    state.inspections.set(SERENA_PATH, [{ state: "missing" }]);
    state.inspections.set(UV_PATH, [{ state: "missing" }, { state: "unusable" }]);

    const result = await bootstrapSerena(request(effects));

    expect(result.outcome).toBe("failed");
    expect(state.calls.processes).toHaveLength(1);
    expect(state.calls.processes[0].executable).toBe("/bin/sh");
  });

  it("requires fresh Serena readiness and rejects path or fingerprint drift", async () => {
    const { effects, state } = makeEffects();
    state.inspections.set(SERENA_PATH, [
      { state: "missing" },
      readyInspection(SERENA_PATH, "inspection-fp"),
    ]);
    state.inspections.set(UV_PATH, [readyInspection(UV_PATH, "uv-fp")]);
    state.probes.push(
      { state: "ready", fingerprint: "uv-fp" },
      { state: "ready", fingerprint: "different-fp" },
    );

    const result = await bootstrapSerena(request(effects));

    expect(result.outcome).toBe("failed");
    expect(state.calls.processes).toHaveLength(1);
    expect(result).not.toHaveProperty("evidence");
  });

  it("reports cancellation before effects and known versus unknown child termination", async () => {
    const before = new AbortController();
    before.abort();
    const beforeCase = makeEffects();
    const beforeResult = await bootstrapSerena(
      request(beforeCase.effects, { signal: before.signal }),
    );
    expect(beforeResult).toMatchObject({ outcome: "cancelled", mutationStarted: false });
    expect(beforeCase.state.calls.canonicalize).toHaveLength(0);

    for (const termination of ["known", "unknown"] as const) {
      const controller = new AbortController();
      const current = makeEffects();
      current.state.inspections.set(SERENA_PATH, [{ state: "missing" }]);
      current.state.inspections.set(UV_PATH, [{ state: "ready", resolvedPath: UV_PATH, fingerprint: "uv" }]);
      current.state.probes.push({ state: "ready", fingerprint: "uv" });
      current.state.abortDuringSpawn = controller;
      current.effects = {
        ...current.effects,
        spawn: async (spec) => {
          current.state.calls.processes.push(spec);
          controller.abort();
          return {
            terminate: () => undefined,
            wait: async () => ({ state: "exited", exitCode: 143, termination }),
          };
        },
      };

      const result = await bootstrapSerena(
        request(current.effects, { signal: controller.signal }),
      );
      expect(result.outcome).toBe(termination === "known" ? "cancelled" : "partial");
      expect(current.state.calls.processes).toHaveLength(1);
      expect(current.state.calls.fetches).toHaveLength(0);
    }
  });

  it("bounds and redacts diagnostics without exposing private roots or control data", () => {
    const diagnostic = redactSerenaDiagnostic(
      `${ROOT}/private\n\u001b[31m token=secret-token ${"x".repeat(10_000)}`,
      { privateRoots: [ROOT], maxBytes: 120, maxLines: 2 },
    );

    expect(diagnostic).not.toContain(ROOT);
    expect(diagnostic).not.toContain("secret-token");
    expect(diagnostic).not.toContain("\u001b");
    expect(diagnostic.length).toBeLessThanOrEqual(120);
  });

  it("never claims independent verification and never reaches real external effects", async () => {
    const { effects, state } = makeEffects();
    state.inspections.set(SERENA_PATH, [{ state: "missing" }]);
    state.inspections.set(UV_PATH, [{ state: "missing" }]);
    const result = await bootstrapSerena(request(effects));
    const serialized = JSON.stringify(result);

    expect(serialized.toLowerCase()).not.toContain("independently verified");
    expect(serialized.toLowerCase()).not.toContain("checksum-verified");
    expect(serialized.toLowerCase()).not.toContain("attested");
    expect(state.calls.fetches).toHaveLength(1);
    expect(state.calls.processes).toHaveLength(1);
  });

  it("exposes the exact MCP arguments for later evidence-gated writers", () => {
    expect(SERENA_MCP_ARGS).toEqual([
      "start-mcp-server",
      "--context",
      "ide",
      "--project-from-cwd",
    ]);
  });
});
