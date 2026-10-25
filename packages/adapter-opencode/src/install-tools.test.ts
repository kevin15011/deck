import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { installOpenCodeTools, type InstallCommandResult } from "./install-tools";
import type { InstallableOpenCodeTool } from "./installation-plan";
import type { OpenCodeEvidenceContext, OpenCodeInstalledEvidence } from "./required-tools";
import {
  SERENA_HELP_ARGS,
  SERENA_INSTALL_ARGS,
  SERENA_UV_INSTALLER_URL,
  bootstrapSerena,
  type SerenaBootstrapEffects,
  type SerenaPathInspection,
  type SerenaProbeResult,
  type SerenaProcessHandle,
  type SerenaProcessResult,
  type SerenaProcessSpec,
} from "@deck/core";

let installerHome: string;
beforeEach(() => { installerHome = mkdtempSync(join(tmpdir(), "deck-installer-contract-")); });
afterEach(() => rmSync(installerHome, { recursive: true, force: true }));

function evidenceContext(): OpenCodeEvidenceContext {
  return {
    projectRoot: "/project",
    workspaceRoot: "/project",
    homeDirectory: installerHome,
    currentDirectory: "/cwd",
    platform: "linux",
    env: { PATH: "" },
    readFile: () => { throw new Error("not used"); },
    stat: () => { throw new Error("not used"); },
    realpath: (path) => path,
    access: () => {},
  };
}

function state(toolId: InstallableOpenCodeTool["id"], status: OpenCodeInstalledEvidence["state"]): OpenCodeInstalledEvidence {
  return {
    toolId,
    state: status,
    source: status === "usable" ? "PATH" : "absent",
    reasonCodes: status === "usable" ? ["PATH-usable"] : ["no-evidence"],
  };
}

const successfulCommand = async (): Promise<InstallCommandResult> => ({ exitCode: 0, stdout: "", stderr: "" });

describe("installOpenCodeTools", () => {
  test("routes the pinned Supermemory package through the Deck-owned installer", async () => {
    let calls = 0;
    const [result] = await installOpenCodeTools(
      "opencode",
      [{
        id: "opencode-supermemory",
        name: "Official Supermemory plugin",
        module: "opencode-supermemory@2.0.15",
        required: true,
        installKind: "deck-owned-opencode-plugin",
      }],
      () => {},
      successfulCommand,
      {
        projectRoot: "/project",
        supermemoryInstaller: async () => {
          calls += 1;
          return {
            ok: true,
            outcome: "installed",
            diagnostic: "verified",
            paths: {
              installRoot: "/data/deck/opencode/supermemory/2.0.15",
              packageDirectory: "/data/deck/opencode/supermemory/2.0.15/node_modules/opencode-supermemory",
              loaderPath: "/data/deck/opencode/supermemory/2.0.15/opencode-supermemory-loader.mjs",
              loaderLocator: "file:///data/deck/opencode/supermemory/2.0.15/opencode-supermemory-loader.mjs",
            },
          };
        },
      },
    );

    expect(calls).toBe(1);
    expect(result).toMatchObject({
      toolId: "opencode-supermemory",
      outcome: "executed",
      success: true,
      installerInvoked: true,
    });
  });

  test("executes npm install -g for npm-package-plus-mcp and does NOT write to plugin array", async () => {
    const plan: InstallableOpenCodeTool[] = [
      { id: "context7", name: "context7", module: "context7", required: false, installKind: "npm-package-plus-mcp" },
    ];
    let installed = false;
    const results = await installOpenCodeTools("opencode", plan, () => {}, async () => {
      installed = true;
      return successfulCommand();
    }, {
      evidenceContext: evidenceContext(),
      resolveEvidence: () => state("context7", installed ? "usable" : "absent"),
    });

    expect(results[0]?.success).toBe(true);
    expect(results[0]?.outcome).toBe("executed");
    expect(results[0]?.message).toContain("context7");
  });

  test("returns failure for external tools", async () => {
    const [result] = await installOpenCodeTools(
      "opencode",
      [{ id: "rtk", name: "RTK", module: "rtk-ai/rtk", required: false, installKind: "external" }],
      () => {},
      async () => ({ exitCode: 0, stdout: "", stderr: "" }),
    );

    expect(result.success).toBe(false);
    expect(result.message).toBe("Manual install required from rtk-ai/rtk.");
  });

  test("skips mcp-server tools with informational message", async () => {
    const [result] = await installOpenCodeTools(
      "opencode",
      [{ id: "context7", name: "Context7", module: "@upstash/context7-mcp", required: false, installKind: "mcp-server" }],
      () => {},
      async () => ({ exitCode: 0, stdout: "", stderr: "" }),
    );

    expect(result.success).toBe(false);
    expect(result.message).toContain("MCP server configured via write-mcp-config action");
  });

  describe("serena-agent Core projection", () => {
    const ROOT = "/fixtures/deck-data";
    const SERENA_ROOT = `${ROOT}/tools/serena`;
    const UV_PATH = `${SERENA_ROOT}/uv/uv`;
    const SERENA_PATH = `${SERENA_ROOT}/bin/serena`;
    const authorization = {
      kind: "interactive-tui-explicit-selection" as const,
      runner: "opencode" as const,
      operationId: "operation-1",
    };
    const operation = {
      runner: "opencode" as const,
      operationId: "operation-1",
      explicitlySelected: true,
    };

    function readyInspection(path: string, fingerprint: string): SerenaPathInspection {
      return { state: "ready", resolvedPath: path, fingerprint };
    }

    function makeCoreEffects(): { effects: SerenaBootstrapEffects; calls: { fetches: unknown[]; processes: SerenaProcessSpec[]; probes: unknown[] } } {
      const calls = { fetches: [] as unknown[], processes: [] as SerenaProcessSpec[], probes: [] as unknown[] };
      const inspections = new Map<string, SerenaPathInspection[]>();
      const probes: SerenaProbeResult[] = [];
      const processResults: SerenaProcessResult[] = [];
      const effects: SerenaBootstrapEffects = {
        resolveDeckDataRoot: () => ROOT,
        canonicalizePath: (path) => path,
        isUserOwnedPath: () => true,
        ensureDirectory: () => undefined,
        inspectPath: (path) => inspections.get(path)?.shift() ?? { state: "missing" },
        fetchInstaller: (request) => {
          calls.fetches.push(request);
          return { status: 200, body: new Uint8Array([35, 32, 117, 118]) };
        },
        spawn: (spec) => {
          calls.processes.push(spec);
          const result = processResults.shift() ?? { state: "exited", exitCode: 0, termination: "known" };
          const handle: SerenaProcessHandle = { wait: async () => result, terminate: () => undefined };
          return handle;
        },
        probeExecutable: (request) => {
          calls.probes.push(request);
          return probes.shift() ?? { state: "ready", fingerprint: "default" };
        },
      };
      inspections.set(SERENA_PATH, [
        { state: "missing" },
        readyInspection(SERENA_PATH, "serena-fingerprint"),
      ]);
      inspections.set(UV_PATH, [
        { state: "missing" },
        readyInspection(UV_PATH, "uv-fingerprint"),
      ]);
      probes.push(
        { state: "ready", fingerprint: "uv-fingerprint" },
        { state: "ready", fingerprint: "serena-fingerprint" },
      );
      return { effects, calls };
    }

    function serenaTool(): InstallableOpenCodeTool {
      return {
        id: "serena",
        name: "Serena",
        module: "serena-agent",
        required: false,
        installKind: "serena-agent",
      } as InstallableOpenCodeTool;
    }

    test("retired Serena rejects authorized installation before any Core effect", async () => {
 const { effects, calls } = makeCoreEffects(); let legacyEffects=0;
 const [result] = await installOpenCodeTools('opencode',[serenaTool()],()=>{},async()=>{legacyEffects++;throw new Error('retired effect');}, {serenaEffects:effects,serenaAuthorization:authorization,serenaOperation:operation,serenaBootstrap:bootstrapSerena});
 expect(result?.success).toBe(false);expect(result?.installerInvoked).toBe(false);expect(result?.serenaReadiness).toBeUndefined();
 expect(calls.fetches).toEqual([]);expect(calls.processes).toEqual([]);expect(calls.probes).toEqual([]);expect(legacyEffects).toBe(0);
});

    test("retired Serena never reuses legacy readiness or probes PATH", async () => {
 const { effects, calls } = makeCoreEffects(); let legacyEffects=0;
 const [result] = await installOpenCodeTools('opencode',[serenaTool()],()=>{},async()=>{legacyEffects++;throw new Error('retired effect');}, {serenaEffects:effects,commandExists:()=>true,serenaAuthorization:authorization,serenaOperation:operation,serenaBootstrap:async()=>{throw new Error('must not re-probe retired package');}});
 expect(result?.success).toBe(false);expect(result?.installerInvoked).toBe(false);expect(result?.serenaReadiness).toBeUndefined();
 expect(calls.fetches).toEqual([]);expect(calls.processes).toEqual([]);expect(calls.probes).toEqual([]);expect(legacyEffects).toBe(0);
});

    test("fails closed before any Core effect without current-operation authorization", async () => {
 const { effects, calls } = makeCoreEffects(); let legacyEffects=0;
 const [result] = await installOpenCodeTools('opencode',[serenaTool()],()=>{},async()=>{legacyEffects++;throw new Error('retired effect');}, {serenaEffects:effects,serenaBootstrap:bootstrapSerena});
 expect(result?.success).toBe(false);expect(result?.installerInvoked).toBe(false);expect(result?.serenaReadiness).toBeUndefined();
 expect(calls.fetches).toEqual([]);expect(calls.processes).toEqual([]);expect(calls.probes).toEqual([]);expect(legacyEffects).toBe(0);
});

    test("retired Serena cannot request Core outcomes or publish readiness", async () => {
 const { effects, calls } = makeCoreEffects(); let legacyEffects=0;
 const [result] = await installOpenCodeTools('opencode',[serenaTool()],()=>{},async()=>{legacyEffects++;throw new Error('retired effect');}, {serenaEffects:effects,serenaAuthorization:authorization,serenaOperation:operation,serenaBootstrap:async()=>{throw new Error('must not invoke retired bootstrap');}});
 expect(result?.success).toBe(false);expect(result?.installerInvoked).toBe(false);expect(result?.serenaReadiness).toBeUndefined();
 expect(calls.fetches).toEqual([]);expect(calls.processes).toEqual([]);expect(calls.probes).toEqual([]);expect(legacyEffects).toBe(0);
});
  });

  test("returns already-present with no external effect for usable evidence", async () => {
    let effects = 0;
    const [result] = await installOpenCodeTools(
      "opencode",
      [{ id: "rtk", name: "rtk", module: "rtk-ai/rtk", required: false, installKind: "shell-script", shellInstallUrl: "https://example.test/install.sh" }],
      () => {},
      async () => { effects++; return successfulCommand(); },
      {
        evidenceContext: evidenceContext(),
        resolveEvidence: () => state("rtk", "usable"),
        downloadScript: async () => { effects++; return "#!/bin/sh\n"; },
        runShellScript: async () => { effects++; return successfulCommand(); },
      },
    );

    expect(result?.outcome).toBe("already-present");
    expect(result?.success).toBe(true);
    expect(result?.installerInvoked).toBe(false);
    expect(effects).toBe(0);
  });

  test("rechecks after download and discards a stale shell script", async () => {
    let checks = 0;
    let downloads = 0;
    let shellRuns = 0;
    const [result] = await installOpenCodeTools(
      "opencode",
      [{ id: "rtk", name: "rtk", module: "rtk-ai/rtk", required: false, installKind: "shell-script", shellInstallUrl: "https://example.test/install.sh" }],
      () => {},
      successfulCommand,
      {
        evidenceContext: evidenceContext(),
        resolveEvidence: () => state("rtk", ++checks < 2 ? "absent" : "usable"),
        downloadScript: async () => { downloads++; return "#!/bin/sh\n"; },
        runShellScript: async () => { shellRuns++; return successfulCommand(); },
      },
    );

    expect(result?.outcome).toBe("already-present");
    expect(downloads).toBe(1);
    expect(shellRuns).toBe(0);
  });

  test("keeps a genuine v0.9.0-style failure failed with bounded sanitized diagnostics", async () => {
    const rawStderr = "pgrep: pattern that searches for process name longer than 15 characters will result in zero matches\nerror: failed to copy binary to /home/tester/.local/bin/codebase-memory-mcp (ETXTBSY) token=super-secret\n";
    const [result] = await installOpenCodeTools(
      "opencode",
      [{ id: "rtk", name: "rtk", module: "rtk-ai/rtk", required: false, installKind: "shell-script", shellInstallUrl: "https://example.test/install.sh" }],
      () => {},
      successfulCommand,
      {
        evidenceContext: evidenceContext(),
        resolveEvidence: () => state("rtk", "absent"),
        downloadScript: async () => "#!/bin/sh\n",
        runShellScript: async () => ({ exitCode: 1, stdout: "", stderr: rawStderr }),
      },
    );

    expect(result?.outcome).toBe("failed");
    expect(result?.success).toBe(false);
    expect(result?.installerInvoked).toBe(true);
    expect(result?.cause).toContain("ETXTBSY");
    expect(result?.cause).toContain("failed to copy binary");
    expect(result?.cause).not.toContain("super-secret");
    expect(result?.cause).not.toContain("/home/tester");
    expect(Object.keys(result ?? {})).not.toContain("raw");
    expect(JSON.stringify(result)).not.toContain("super-secret");
    expect((result as { raw?: unknown } | undefined)?.raw).toBeDefined();
  });

  test("scopes concurrent installs by project, home, and exact tool ID", async () => {
    let release: (() => void) | undefined;
    let effects = 0;
    let installed = false;
    const waitForRelease = new Promise<void>((resolve) => { release = resolve; });
    const options = {
      evidenceContext: evidenceContext(),
      resolveEvidence: () => state("context7", installed ? "usable" : "absent"),
    };
    const runner = async (): Promise<InstallCommandResult> => {
      effects++;
      await waitForRelease;
      installed = true;
      return successfulCommand();
    };
    const plan = [{ id: "context7", name: "context7", module: "context7", required: false, installKind: "npm-package-plus-mcp" }] satisfies InstallableOpenCodeTool[];
    const first = installOpenCodeTools("opencode", plan, () => {}, runner, options);
    const second = installOpenCodeTools("opencode", plan, () => {}, runner, options);
    await Promise.resolve();
    release?.();
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(effects).toBe(1);
    expect(firstResult[0]?.outcome).toBe("executed");
    expect(secondResult[0]?.outcome).toBe("already-present");
  });

  test("cancels before effects and isolates duplicate or failing package IDs", async () => {
    const controller = new AbortController();
    controller.abort();
    let effects = 0;
    const results = await installOpenCodeTools(
      "opencode",
      [
        { id: "context7", name: "context7", module: "context7", required: false, installKind: "npm-package-plus-mcp" },
        { id: "context7", name: "context7", module: "context7", required: false, installKind: "npm-package-plus-mcp" },
        { id: "rtk", name: "rtk", module: "rtk-ai/rtk", required: false, installKind: "shell-script", shellInstallUrl: "https://example.test/install.sh" },
      ],
      () => {},
      async () => { effects++; return { exitCode: 1, stdout: "", stderr: "failed" }; },
      { evidenceContext: evidenceContext(), resolveEvidence: () => state("context7", "absent"), signal: controller.signal },
    );

    expect(results).toHaveLength(3);
    expect(results[0]?.outcome).toBe("skipped");
    expect(results[1]?.outcome).toBe("skipped");
    expect(results[2]?.outcome).toBe("skipped");
    expect(effects).toBe(0);
  });

  test("marks a later duplicate ID as an integrity failure without a second effect", async () => {
    let effects = 0;
    const results = await installOpenCodeTools(
      "opencode",
      [
        { id: "context7", name: "context7", module: "context7", required: false, installKind: "npm-package-plus-mcp" },
        { id: "context7", name: "context7", module: "context7", required: false, installKind: "npm-package-plus-mcp" },
      ],
      () => {},
      async () => { effects++; return { exitCode: 1, stdout: "", stderr: "first failure" }; },
      { evidenceContext: evidenceContext(), resolveEvidence: (toolId) => state(toolId, toolId === "serena" ? "usable" : "absent") },
    );

    expect(results.map((result) => result.outcome)).toEqual(["failed", "failed"]);
    expect(results[1]?.cause).toContain("Duplicate tool ID");
    expect(results[1]?.installerInvoked).toBe(false);
    expect(effects).toBe(1);
  });

  test("continues with unrelated packages after one package fails", async () => {
    const calls: string[] = [];
    let context7Checks = 0;
    const results = await installOpenCodeTools(
      "opencode",
      [
        { id: "rtk", name: "RTK", module: "fixture:rtk", required: false, installKind: "npm-package-plus-mcp" },
        { id: "context7", name: "Context7", module: "@upstash/context7-mcp", required: false, installKind: "npm-package" },
      ],
      () => {},
      async (command) => {
        calls.push(command);
        return command === "npm" && calls.length === 1
          ? { exitCode: 1, stdout: "", stderr: "first package failed" }
          : successfulCommand();
      },
      { evidenceContext: evidenceContext(), resolveEvidence: (toolId) => state(toolId, toolId === "context7" && ++context7Checks > 1 ? "usable" : "absent") },
    );

    expect(results.map((result) => result.outcome)).toEqual(["failed", "executed"]);
    expect(calls).toEqual(["npm", "npm"]);
  });

  test("bounds raw captures and adversarial sanitized diagnostics", async () => {
    const ansi = "\u001b[2K\u001b[31m";
    const stderr = `${"progress ".repeat(10_000)}\n${ansi}ERROR token=secret-value /home/tester/private.txt https://example.test/?token=url-secret\n`;
    const [result] = await installOpenCodeTools(
      "opencode",
      [{ id: "rtk", name: "rtk", module: "rtk-ai/rtk", required: false, installKind: "shell-script", shellInstallUrl: "https://example.test/install.sh" }],
      () => {},
      successfulCommand,
      {
        evidenceContext: evidenceContext(),
        resolveEvidence: () => state("rtk", "absent"),
        downloadScript: async () => "#!/bin/sh\n",
        runShellScript: async () => ({ exitCode: 1, stdout: "", stderr }),
      },
    );

    const raw = (result as { raw?: { stdout: string; stderr: string; stderrTruncated: boolean } }).raw;
    expect(raw?.stderrTruncated).toBe(true);
    expect(Buffer.byteLength(raw?.stderr ?? "", "utf8")).toBeLessThanOrEqual(65_536);
    expect(result?.diagnostic?.lines.length).toBeLessThanOrEqual(6);
    expect(result?.diagnostic?.lines.every((line) => [...line].length <= 240)).toBe(true);
    expect(Buffer.byteLength(result?.cause ?? "", "utf8")).toBeLessThanOrEqual(320);
    expect(result?.cause).not.toContain("secret-value");
    expect(result?.cause).not.toContain("url-secret");
    expect(result?.cause).not.toContain("/home/tester");
    expect(result?.cause).not.toContain("\u001b");
  });

  test("rejects an oversized downloaded script before shell execution", async () => {
    let shellRuns = 0;
    const [result] = await installOpenCodeTools(
      "opencode",
      [{ id: "rtk", name: "rtk", module: "rtk-ai/rtk", required: false, installKind: "shell-script", shellInstallUrl: "https://example.test/install.sh" }],
      () => {},
      successfulCommand,
      {
        evidenceContext: evidenceContext(),
        resolveEvidence: () => state("rtk", "absent"),
        downloadScript: async () => "x".repeat(1024 * 1024 + 1),
        runShellScript: async () => { shellRuns++; return successfulCommand(); },
      },
    );

    expect(result?.outcome).toBe("failed");
    expect(result?.diagnostic?.stage).toBe("download");
    expect(result?.installerInvoked).toBe(false);
    expect(shellRuns).toBe(0);
  });

  test("cooperatively cancels during download without starting the shell", async () => {
    const controller = new AbortController();
    let finishDownload!: (script: string) => void;
    let shellRuns = 0;
    const download = new Promise<string>((resolve) => { finishDownload = resolve; });
    const pending = installOpenCodeTools(
      "opencode",
      [{ id: "rtk", name: "rtk", module: "rtk-ai/rtk", required: false, installKind: "shell-script", shellInstallUrl: "https://example.test/install.sh" }],
      () => {},
      successfulCommand,
      {
        signal: controller.signal,
        evidenceContext: evidenceContext(),
        resolveEvidence: () => state("rtk", "absent"),
        downloadScript: async () => download,
        runShellScript: async () => { shellRuns++; return successfulCommand(); },
      },
    );
    controller.abort();
    finishDownload("#!/bin/sh\n");
    const [result] = await pending;

    expect(result?.outcome).toBe("skipped");
    expect(result?.installerInvoked).toBe(false);
    expect(shellRuns).toBe(0);
  });
});
