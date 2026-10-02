import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import {
  createCodexRunnerAdapter,
  createDeckSerenaProxyProbe,
  SERENA_PROXY_PROBE_TIMEOUT_MS,
} from "./runner-adapter";
import { createNodeCodexFileEffects } from "./node-effects";
import { freshLayout, layout, readyTestTools, testTools } from "./test-tools";
import { CURRENT_CODEX_MODELS_FIXTURE } from "./__fixtures__/codex/models";
import { parseCodexModels } from "./codex-model-discovery";
import { DEVELOPER_TEAM_AGENTS } from "@deck/core/developer-team-catalog";
import { TAVILY_PROVIDER_DESCRIPTOR } from "@deck/provider-tavily";
import { buildCapabilityInstructionBundle, getDefaultDeckConfig, validateDeckConfig } from "@deck/core";
import type { CodexPreflightEffects, CodexProjectSnapshot } from "./preflight";

setDefaultTimeout(30_000);

const TEST_SERENA_EXECUTABLE = "/fixtures/deck-data/tools/serena/bin/serena";
const OFFLINE_CODEX_PROBE = {
  found: true,
  version: "0.146.1",
  help: "Usage: codex [OPTIONS]\nexec\nresume",
  execHelp: "Usage: codex exec [OPTIONS]",
  resumeHelp: "Usage: codex resume [SESSION_ID] --last",
} as const satisfies Awaited<ReturnType<CodexPreflightEffects["probe"]>>;
const CODEX_HERMETIC_READINESS_TEST_PATTERN = "separates selected instructions from MCP|reuses validated Deck-owned Serena evidence and blocks a missing launcher";

function readySerenaReadiness(): Extract<import("@deck/core").SerenaExistingReadinessResult, { state: "ready" }> {
  const evidence: import("@deck/core").SerenaReadinessEvidence = {
    capabilityId: "serena" as const,
    state: "ready" as const,
    resolvedExecutablePath: TEST_SERENA_EXECUTABLE,
    source: "existing-deck-tool" as const,
    probe: "serena-help" as const,
    fingerprint: "serena-fixture",
  };
  return {
    state: "ready" as const,
    evidence,
    revalidate: async (value) => ({ valid: true as const, evidence: value }),
  };
}


function readySerenaProxy() {
  return Promise.resolve({ state: "ready" as const });
}

function supermemoryDeckConfig() {
  return validateDeckConfig({
    adaptiveMemory: {
      activeProvider: "supermemory",
      supermemory: { mcpServerName: "supermemory" },
    },
  });
}

function supermemoryProvider(): import("@deck/core").AdaptiveMemoryProvider {
  return {
    id: "supermemory",
    displayName: "Supermemory",
    buildInjection: (context) => ({
      instructions: [{ surface: "agent", teamId: "developer-team", markdown: `provider scope ${context.supermemoryProjectScope}` }],
      toolBindings: [],
    }),
  };
}

async function writeGitOrigin(projectRoot: string): Promise<void> {
  await mkdir(join(projectRoot, ".git", "objects", "info"), { recursive: true });
  await mkdir(join(projectRoot, ".git", "objects", "pack"), { recursive: true });
  await mkdir(join(projectRoot, ".git", "refs", "heads"), { recursive: true });
  await writeFile(join(projectRoot, ".git", "HEAD"), "ref: refs/heads/main\n", "utf8");
  await writeFile(join(projectRoot, ".git", "config"), [
    "[core]",
    "\trepositoryformatversion = 0",
    "\tfilemode = true",
    "\tbare = false",
    "\tlogallrefupdates = true",
    "[remote \"origin\"]",
    "\turl = git@github.com:kevin15011/deck.git",
    "\tfetch = +refs/heads/*:refs/remotes/origin/*",
    "",
  ].join("\n"), "utf8");
}

async function readFileOrNull(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function listProjectEntries(path: string): Promise<string[]> {
  try {
    return (await readdir(path, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() || entry.isFile())
      .map((entry) => entry.name);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function readRealCodexProject(projectRoot: string): Promise<CodexProjectSnapshot> {
  return {
    config: await readFileOrNull(join(projectRoot, ".codex", "config.toml")),
    roles: await listProjectEntries(join(projectRoot, ".codex", "agents")),
    skills: await listProjectEntries(join(projectRoot, ".agents", "skills")),
    agentsInstructions: await Bun.file(join(projectRoot, "AGENTS.md")).exists(),
  };
}

function hermeticCodexPreflight(): CodexPreflightEffects {
  return {
    probe: async () => ({ ...OFFLINE_CODEX_PROBE }),
    inspectTrust: async () => "trusted",
    readProject: readRealCodexProject,
  };
}

async function isolatedNoCodexEnvRoot(): Promise<{ root: string; env: NodeJS.ProcessEnv }> {
  const root = await mkdtemp(join(tmpdir(), "deck-codex-no-cli-child-"));
  const directories = {
    PATH: join(root, "empty-bin"),
    HOME: join(root, "home"),
    XDG_DATA_HOME: join(root, "data"),
    XDG_CONFIG_HOME: join(root, "config"),
    XDG_CACHE_HOME: join(root, "cache"),
    TMPDIR: join(root, "tmp"),
  };
  await Promise.all(Object.values(directories).map((path) => mkdir(path, { recursive: true })));
  return {
    root,
    env: {
      ...process.env,
      ...directories,
      CI: "true",
      NO_COLOR: "1",
      LANG: process.env.LANG ?? "C.UTF-8",
      DECK_CODEX_HERMETIC_CHILD: "1",
    },
  };
}


describe("Deck Serena proxy probe", () => {
  test("accepts probe success and reports bounded timeouts through its injectable process boundary", async () => {
    const timedOut = Object.assign(new Error("fixture timeout"), { code: "ETIMEDOUT" });
    const requests: import("./runner-adapter").DeckSerenaProxyProbeRequest[] = [];
    const outcomes: import("./runner-adapter").DeckSerenaProxyProbeResult[] = [
      { status: 0, stdout: "deck-serena-mcp-proxy-v1\n" },
      { error: timedOut, signal: "SIGTERM", stdout: "" },
    ];
    const probe = createDeckSerenaProxyProbe({
      timeoutMs: 100.8,
      run: (request) => {
        requests.push(request);
        return outcomes.shift() ?? { status: 1, stdout: "" };
      },
    });

    expect(await probe()).toEqual({ state: "ready" });
    expect(await probe()).toMatchObject({ state: "indeterminate", message: expect.stringContaining("bounded check") });
    expect(SERENA_PROXY_PROBE_TIMEOUT_MS).toBeGreaterThanOrEqual(1_000);
    expect(requests).toEqual([
      { command: "deck", args: ["internal", "serena-mcp", "--probe"], timeoutMs: 100, maxOutputBytes: 4 * 1024 },
      { command: "deck", args: ["internal", "serena-mcp", "--probe"], timeoutMs: 100, maxOutputBytes: 4 * 1024 },
    ]);
  });


  test("uses fixed probe argv and bounded output through its injectable process boundary", async () => {
    let request: import("./runner-adapter").DeckSerenaProxyProbeRequest | undefined;
    const result = await createDeckSerenaProxyProbe({
      run: (next) => {
        request = next;
        return { status: 0, stdout: "deck-serena-mcp-proxy-v1\n" };
      },
    })();

    expect(result).toEqual({ state: "ready" });
    expect(request).toEqual({
      command: "deck",
      args: ["internal", "serena-mcp", "--probe"],
      timeoutMs: SERENA_PROXY_PROBE_TIMEOUT_MS,
      maxOutputBytes: 4 * 1024,
    });
  });
});

describe("Codex RunnerAdapter production composition", () => {
  test("keeps package instructions separate from capability selection and installation", () => {
    const adapter = createCodexRunnerAdapter({ tools: testTools() });
    expect(adapter.packageInstructionIds).toEqual(["codebase-memory", "code-economy", "context-mode", "rtk", "adaptive-memory", "serena"]);
    const state = {
      runnerId: "codex",
      environmentId: "codex-development",
      selectedCapabilities: {},
      packageInstructions: {
        "codebase-memory": true,
        "code-economy": true,
        "context-mode": false,
        rtk: false,
        "adaptive-memory": true,
        serena: false,
        "pi-hud": true,
      },
      adaptiveMemory: { provider: "none" },
    } as any;
    const inventory = { runnerId: "codex", environmentId: "codex-development", capabilities: [] } as any;

    const review = adapter.buildReviewPlan(state, inventory);
    expect(review.groups.configWrites).toEqual([
      expect.objectContaining({ id: "package-instructions.codex.deck-config", kind: "write-deck-config" }),
    ]);
    expect(review.groups.configWrites[0]?.diagnostics?.join(" ")).toContain("codebase-memory, adaptive-memory");
    expect(review.groups.configWrites[0]?.diagnostics?.join(" ")).not.toContain("code-economy");
    expect(review.groups.configWrites[0]?.diagnostics?.join(" ")).not.toContain("pi-hud");

    const installation = adapter.buildInstallationPlan(state);
    expect(installation.steps.map((step) => step.capabilityId)).toEqual(["developer-team", "codex-runtime"]);
  });

  test("projects contributed protected gaps and package/provider dispositions through adapter APIs and doctor", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "deck-codex-parity-project-"));
    const journalRoot = await mkdtemp(join(tmpdir(), "deck-codex-parity-journal-"));
    try {
      const adapter = createCodexRunnerAdapter({ tools: testTools(), ...layout(projectRoot),
        journalRoot,
        preflight: {
          probe: async () => ({ found: true, version: "0.145.0", help: "Usage: codex\nexec\nresume", execHelp: "Usage: codex exec", resumeHelp: "Usage: codex resume [SESSION_ID]" }),
          inspectTrust: async () => "trusted",
        },
        codebaseIndexReadiness: () => true,
      });
      const protectedIds = ["trusted-runner-host-bridge", "invocation-authorization", "execution-dossier", "controlled-effects", "registry-coordination", "bound-verification"];
      expect(adapter.getLaunchPolicyDiagnostics?.()).toContainEqual(expect.objectContaining({
        code: "codex-dangerous-bypass",
        severity: "warning",
        message: expect.stringContaining("sandboxing and command approvals are disabled"),
      }));
      expect(adapter.getCapabilityIds()).toEqual(expect.arrayContaining([...protectedIds, "pi-hud", "opencode-mermaid-renderer", "deck-model-variants"]));
      for (const capabilityId of protectedIds) expect(adapter.getCapability(capabilityId)).toMatchObject({ capabilityId, status: "gap", requirementLevel: "required" });
      expect(adapter.getCapability("pi-hud")).toMatchObject({ supportStatus: "not-applicable" });
      expect(adapter.getCapability("opencode-mermaid-renderer")).toMatchObject({ supportStatus: "not-applicable" });

      const inventory = await adapter.getCapabilityInventory({ projectRoot, environmentId: "codex-development", runnerId: "codex", deckConfig: getDefaultDeckConfig() });
      for (const capabilityId of protectedIds) expect(inventory.capabilities).toContainEqual(expect.objectContaining({ capabilityId, isBlocked: true, requirementLevel: "required" }));
      expect(inventory.capabilities).toContainEqual(expect.objectContaining({ capabilityId: "pi-hud", supportStatus: "not-applicable", isInstalled: false, isBlocked: false }));
      expect(inventory.capabilities).toContainEqual(expect.objectContaining({ capabilityId: "opencode-mermaid-renderer", supportStatus: "not-applicable", isInstalled: false, isBlocked: false }));

       const review = adapter.buildReviewPlan({ runnerId: "codex", environmentId: "codex-development", selectedCapabilities: {}, packageInstructions: {}, adaptiveMemory: { provider: "none" } }, inventory);
       expect(review.ready).toBe(true);
       for (const capabilityId of protectedIds) {
         expect(review.groups.manualSteps).not.toContainEqual(expect.objectContaining({ capabilityId }));
         expect(review.diagnostics).toContainEqual(expect.objectContaining({
           code: `static-compatible-gap:${capabilityId}`,
           severity: "warning",
           message: expect.stringContaining("static-compatible"),
         }));
       }
      const staleSelectionReview = adapter.buildReviewPlan({ runnerId: "codex", environmentId: "codex-development", selectedCapabilities: { "pi-hud": true, "opencode-mermaid-renderer": true }, packageInstructions: {}, adaptiveMemory: { provider: "none" } }, inventory);
      expect(staleSelectionReview.groups.configWrites).not.toContainEqual(expect.objectContaining({ capabilityId: "pi-hud" }));
      expect(staleSelectionReview.groups.configWrites).not.toContainEqual(expect.objectContaining({ capabilityId: "opencode-mermaid-renderer" }));

      const doctor = await adapter.diagnoseProject?.(projectRoot, getDefaultDeckConfig());
      for (const capabilityId of protectedIds) {
        const label = capabilityId.split("-").map((part) => `${part[0]!.toUpperCase()}${part.slice(1)}`).join(" ");
        expect(doctor).toContainEqual(expect.objectContaining({ category: `Capability: ${label}`, status: "error" }));
      }
      expect(doctor).toContainEqual(expect.objectContaining({ category: "Capability: Pi HUD", status: "warning", message: "Not applicable to codex." }));
      expect(doctor).toContainEqual(expect.objectContaining({
        category: "Execution safety",
        status: "warning",
        message: expect.stringContaining("sandboxing and command approvals are disabled"),
      }));
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
      await rm(journalRoot, { recursive: true, force: true });
    }
  });

  test("normalizes none and Supermemory review flows", () => {
    const adapter = createCodexRunnerAdapter({ tools: testTools() });
    const inventory = { runnerId: "codex", environmentId: "codex-development", capabilities: [{ capabilityId: "supermemory-tool-bindings", label: "Supermemory", description: "memory", section: "memory", requirementLevel: "optional", installKind: "runner-native", isInstalled: false, isBlocked: false }] } as const;
    const state = (provider: "none" | "supermemory") => ({ runnerId: "codex", environmentId: "codex-development", selectedCapabilities: {}, packageInstructions: {}, adaptiveMemory: { provider } }) as const;
    expect(adapter.buildReviewPlan(state("none"), inventory)).toMatchObject({ ready: true });
    const supermemoryReview = adapter.buildReviewPlan(state("supermemory"), inventory);
    expect(supermemoryReview.groups.configWrites).toContainEqual(expect.objectContaining({ capabilityId: "supermemory-tool-bindings" }));
    expect(supermemoryReview.groups.manualSteps).not.toContainEqual(expect.objectContaining({
      capabilityId: "supermemory-tool-bindings",
    }));
    expect(supermemoryReview.diagnostics).not.toContainEqual(expect.objectContaining({
      code: "codex-supermemory-user-authorization",
    }));
  });
  test("gates launch modes from inspected installed Codex help evidence", async () => {
    const adapter = createCodexRunnerAdapter({ tools: testTools(), ...freshLayout(),
      preflight: {
        probe: async () => ({ found: true, version: "0.145.0", help: "Usage: codex [OPTIONS]\nexec\nresume", execHelp: "Usage: codex exec [OPTIONS]", resumeHelp: "Usage: codex resume [SESSION_ID]" }),
        inspectTrust: async () => "trusted",
      },
    });
    await adapter.inspectProject?.("/tmp/codex-feature-gate");
    expect(await adapter.buildLaunchPlan?.({ projectRoot: "/tmp/codex-feature-gate", teamId: "developer-team", mode: "resume-latest", deckConfig: getDefaultDeckConfig() })).toMatchObject({
      status: "unsupported",
      code: "codex-resume-latest-unsupported",
    });
  });

  test("materializes and verifies the reviewed plan inside injected temp roots", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "deck-codex-project-"));
    const journalRoot = await mkdtemp(join(tmpdir(), "deck-codex-journal-"));
    try {
      const adapter = createCodexRunnerAdapter({ tools: testTools(), ...layout(projectRoot), journalRoot });
      const plan = adapter.buildDeveloperTeamInstallPlan({ projectRoot, environmentId: "codex-development", deckConfig: getDefaultDeckConfig() });
      expect(plan.files.length).toBeGreaterThan(40);
      expect(plan.diagnostics).toContainEqual(expect.stringContaining("renameat2/openat"));
      const result = await adapter.applyDeveloperTeamInstall({ projectRoot, environmentId: "codex-development", plan });
      expect(result.changedCount).toBe(plan.files.length);
      expect((await adapter.verifyDeveloperTeamInstall(plan)).valid).toBe(true);
      expect(await readFile(join(projectRoot, ".codex", "agents", "deck-lead.toml"), "utf8")).toContain("deck-codex-v1");
       expect(await Bun.file(join(projectRoot, "AGENTS.md")).exists()).toBe(false);
      await chmod(join(projectRoot, ".codex", "agents", "deck-lead.toml"), 0o600);
      expect(await adapter.verifyDeveloperTeamInstall(plan)).toMatchObject({ valid: false, diagnostics: [expect.stringContaining("Mode drifted")] });
      await chmod(join(projectRoot, ".codex", "agents", "deck-lead.toml"), 0o644);

      const unchangedPlan = adapter.buildDeveloperTeamInstallPlan({ projectRoot, environmentId: "codex-development", deckConfig: getDefaultDeckConfig() });
      expect(unchangedPlan.files).toHaveLength(0);
      await Bun.write(join(projectRoot, ".agents", "skills", "idea-refine", "examples.md"), "tampered");
      expect((await adapter.verifyDeveloperTeamInstall(unchangedPlan)).valid).toBe(false);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
      await rm(journalRoot, { recursive: true, force: true });
    }
  });

  test("plans, applies, and re-inspects an ordinary missing Web Search MCP entry without treating it as a collision", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "deck-codex-web-search-project-"));
    const journalRoot = await mkdtemp(join(tmpdir(), "deck-codex-web-search-journal-"));
    const executableRoot = await mkdtemp(join(tmpdir(), "deck-codex-web-search-bin-"));
    const previousCredential = process.env.TAVILY_API_KEY;
    const previousPath = process.env.PATH;
    process.env.TAVILY_API_KEY = "codex-web-search-test-secret";
    // An nvm-style shim: the visible `npx` is a symlink, which a plain lstat file check misjudged as unavailable.
    await writeFile(join(executableRoot, "npx-real.sh"), "#!/bin/sh\nexit 0\n", "utf8");
    await chmod(join(executableRoot, "npx-real.sh"), 0o755);
    await symlink(join(executableRoot, "npx-real.sh"), join(executableRoot, "npx"));
    process.env.PATH = `${executableRoot}${previousPath ? `:${previousPath}` : ""}`;
    try {
      const deckConfig = validateDeckConfig({ webSearch: { enabled: true, provider: "tavily" } });
      const adapter = createCodexRunnerAdapter({ tools: testTools({ resolveCommand: (name) => name === "npx" ? join(executableRoot, "npx") : undefined }), ...layout(projectRoot),
        journalRoot,
        webSearchProvider: TAVILY_PROVIDER_DESCRIPTOR,
        preflight: {
          probe: async () => ({ found: true, version: "0.146.0", help: "Usage: codex\nexec\nresume", execHelp: "Usage: codex exec", resumeHelp: "Usage: codex resume [SESSION_ID]" }),
          inspectTrust: async () => "trusted",
          readProject: async (root) => ({
            config: await readFile(join(root, ".codex", "config.toml"), "utf8").catch(() => null),
            roles: [],
            skills: [],
            agentsInstructions: false,
          }),
        },
        serenaReadinessResolver: async () => ({ state: "missing", diagnostic: { code: "missing", message: "Serena is not selected for this test." } }),
      });

      const before = await adapter.getCapabilityInventory({ projectRoot, environmentId: "codex-development", runnerId: "codex", deckConfig });
      expect(before.capabilities).toContainEqual(expect.objectContaining({
        capabilityId: "web-search",
        isInstalled: false,
        isBlocked: false,
        webSearchReadiness: expect.objectContaining({ code: "mcp-not-materialized" }),
      }));

      const review = adapter.buildReviewPlan({
        runnerId: "codex",
        environmentId: "codex-development",
        selectedCapabilities: { "web-search": true },
        webSearchProviderDescriptor: TAVILY_PROVIDER_DESCRIPTOR,
        packageInstructions: {},
        adaptiveMemory: { provider: "none" },
      }, before);
      expect(review.groups.configWrites).toContainEqual(expect.objectContaining({ capabilityId: "web-search", id: "codex-config:web-search" }));
      expect(review.groups.manualSteps).not.toContainEqual(expect.objectContaining({ capabilityId: "web-search", status: "blocked" }));

      const plan = adapter.buildDeveloperTeamInstallPlan({
        projectRoot,
        environmentId: "codex-development",
        deckConfig,
        capabilityIds: ["web-search"],
      });
      expect(plan.blocked).toBe(false);
      expect(plan.files).toContainEqual(expect.objectContaining({ path: ".codex/config.toml" }));

      await adapter.applyDeveloperTeamInstall({ projectRoot, environmentId: "codex-development", plan });
      expect(await adapter.verifyDeveloperTeamInstall(plan)).toMatchObject({ valid: true });

      const after = await adapter.getCapabilityInventory({ projectRoot, environmentId: "codex-development", runnerId: "codex", deckConfig });
      expect(after.capabilities).toContainEqual(expect.objectContaining({
        capabilityId: "web-search",
        isInstalled: true,
        isBlocked: false,
        webSearchReadiness: expect.objectContaining({ state: "ready", code: "ready" }),
      }));

      const config = await readFile(join(projectRoot, ".codex", "config.toml"), "utf8");
      expect(config).toContain(`command = ${JSON.stringify(join(executableRoot, "npx"))}`);
      expect(config).toContain('env_vars = ["TAVILY_API_KEY"]');
      expect(config).not.toContain("codex-web-search-test-secret");

      // The credential reaches the Codex child process only, through a narrowly authorized sensitive overlay.
      const launch = await adapter.buildLaunchPlan!({ projectRoot, teamId: "developer-team", mode: "interactive", deckConfig });
      expect(launch.status).toBe("ready");
      if (launch.status === "ready") {
        expect(launch.plan.envOverlay?.TAVILY_API_KEY).toEqual({ value: "codex-web-search-test-secret", sensitive: true });
        expect(launch.plan.sensitiveEnvAuthorization).toEqual({ binding: "deck-codex-launch-v1", keys: ["TAVILY_API_KEY"] });
        expect(launch.plan.args.join(" ")).not.toContain("codex-web-search-test-secret");
      }
      const disabled = await adapter.buildLaunchPlan!({ projectRoot, teamId: "developer-team", mode: "interactive", deckConfig: validateDeckConfig({ webSearch: { enabled: false } }) });
      if (disabled.status === "ready") expect(disabled.plan.envOverlay?.TAVILY_API_KEY).toBeUndefined();
    } finally {
      if (previousCredential === undefined) delete process.env.TAVILY_API_KEY;
      else process.env.TAVILY_API_KEY = previousCredential;
      await rm(projectRoot, { recursive: true, force: true });
      await rm(journalRoot, { recursive: true, force: true });
      await rm(executableRoot, { recursive: true, force: true });
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
    }
  });

  test("does not follow ownership-manifest paths through project symlinks", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "deck-codex-manifest-project-"));
    const externalRoot = await mkdtemp(join(tmpdir(), "deck-codex-manifest-external-"));
    try {
      const secret = "outside-project";
      await writeFile(join(externalRoot, "secret.txt"), secret);
      await mkdir(join(projectRoot, ".codex", "deck"), { recursive: true });
      await mkdir(join(projectRoot, ".agents", "skills"), { recursive: true });
      await symlink(externalRoot, join(projectRoot, ".agents", "skills", "escape"), "dir");
      await writeFile(join(projectRoot, ".codex", "deck", "manifest.json"), `${JSON.stringify({
        version: 1,
        files: { ".agents/skills/escape/secret.txt": createHash("sha256").update(secret).digest("hex") },
      })}\n`);

      const adapter = createCodexRunnerAdapter({ tools: testTools(), ...layout(projectRoot) });
      const detected = await adapter.detectDeckInstall?.({ projectRoot });
      expect(detected?.managedPaths).toEqual([join(projectRoot, ".codex", "deck", "manifest.json")]);
      expect(detected?.diagnostics).toContainEqual(expect.stringContaining("unsafe managed path"));

      const plan = adapter.buildDeveloperTeamInstallPlan({ projectRoot, environmentId: "codex-development", deckConfig: getDefaultDeckConfig() });
      expect(plan.files).not.toContainEqual(expect.objectContaining({ path: ".agents/skills/escape/secret.txt" }));
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
      await rm(externalRoot, { recursive: true, force: true });
    }
  });

  test("launches after a global install without any project-trust warning because Deck writes nothing into the project", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "deck-codex-untrusted-project-"));
    const journalRoot = await mkdtemp(join(tmpdir(), "deck-codex-untrusted-journal-"));
    try {
      const adapter = createCodexRunnerAdapter({ tools: testTools(), ...layout(projectRoot),
        journalRoot,
        preflight: {
          probe: async () => ({ found: true, version: "0.145.0", help: "Usage: codex [OPTIONS]", execHelp: "Usage: codex exec [OPTIONS]", resumeHelp: "Usage: codex resume [SESSION_ID] --last" }),
          readProject: async (root) => ({
            config: await readFile(join(root, ".codex", "config.toml"), "utf8").catch(() => null),
            roles: [],
            skills: [],
            agentsInstructions: false,
          }),
        },
      });
      const plan = adapter.buildDeveloperTeamInstallPlan({ projectRoot, environmentId: "codex-development", deckConfig: getDefaultDeckConfig() });
      await adapter.applyDeveloperTeamInstall({ projectRoot, environmentId: "codex-development", plan });

      const launch = await adapter.buildLaunchPlan?.({ projectRoot, teamId: "developer-team", mode: "interactive", deckConfig: getDefaultDeckConfig() });
      expect(launch?.status).toBe("ready");
      expect(launch?.diagnostics).not.toContainEqual(expect.objectContaining({ code: "materialized-but-inactive" }));
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
      await rm(journalRoot, { recursive: true, force: true });
    }
  });

  test("materializes trusted hooks while launch-time host binding remains Deck-supervised", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "deck-codex-unbound-project-"));
    const journalRoot = await mkdtemp(join(tmpdir(), "deck-codex-unbound-journal-"));
    try {
      const adapter = createCodexRunnerAdapter({ tools: testTools(), ...layout(projectRoot),
        journalRoot,
        preflight: {
          probe: async () => ({ found: true, version: "0.146.1", help: "Usage: codex [OPTIONS]\nexec\nresume", execHelp: "Usage: codex exec [OPTIONS]", resumeHelp: "Usage: codex resume [SESSION_ID] --last" }),
          inspectTrust: async () => "trusted",
          readProject: async (root) => ({ config: await readFile(join(root, ".codex", "config.toml"), "utf8").catch(() => null), roles: [], skills: [], agentsInstructions: true }),
        },
      });
      const plan = adapter.buildDeveloperTeamInstallPlan({ projectRoot, environmentId: "codex-development", deckConfig: getDefaultDeckConfig() });
      await adapter.applyDeveloperTeamInstall({ projectRoot, environmentId: "codex-development", plan });
      expect(await Bun.file(join(projectRoot, ".codex", "deck", "hooks", "developer-team-execution.js")).exists()).toBe(true);
      expect(await readFile(join(projectRoot, ".codex", "config.toml"), "utf8")).toContain("deck-codex-hook:memory-bridge:start");
      expect(await readFile(join(projectRoot, ".codex", "config.toml"), "utf8")).not.toContain("dangerously-bypass-approvals-and-sandbox");

      const launches = await Promise.all([
        adapter.buildLaunchPlan?.({ projectRoot, teamId: "developer-team", mode: "interactive", deckConfig: getDefaultDeckConfig() }),
        adapter.buildLaunchPlan?.({ projectRoot, teamId: "developer-team", mode: "exec", prompt: [], stdin: "closed", deckConfig: getDefaultDeckConfig() }),
        adapter.buildLaunchPlan?.({ projectRoot, teamId: "developer-team", mode: "resume-by-id", sessionId: "session-1", deckConfig: getDefaultDeckConfig() }),
        adapter.buildLaunchPlan?.({ projectRoot, teamId: "developer-team", mode: "resume-latest", deckConfig: getDefaultDeckConfig() }),
      ]);
      for (const launch of launches) {
        expect(launch).toMatchObject({ status: "ready", plan: { executionClass: "static-compatible" } });
        if (launch?.status === "ready") expect(launch.plan.bridgeBinding).toBeUndefined();
      }
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
      await rm(journalRoot, { recursive: true, force: true });
    }
  });

  test("keeps conditional bridge factories internal and ignores forged public binding callbacks", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "deck-codex-bound-project-"));
    const journalRoot = await mkdtemp(join(tmpdir(), "deck-codex-bound-journal-"));
    try {
      const publicApi = await import("./index");
      expect(publicApi).not.toHaveProperty("createCodexTrustedHookHostV1");
      expect(publicApi).not.toHaveProperty("createCodexDeveloperTeamExecutionBridgeV1");
      expect(publicApi).not.toHaveProperty("mergeCodexTrustedHookConfig");
      const adapter = createCodexRunnerAdapter({ tools: testTools(), ...layout(projectRoot),
        journalRoot,
        preflight: {
          probe: async () => ({ found: true, version: "0.145.0", help: "Usage: codex [OPTIONS]", execHelp: "Usage: codex exec [OPTIONS]", resumeHelp: "Usage: codex resume [SESSION_ID] --last" }),
          inspectTrust: async () => "trusted",
          readProject: async (root) => ({ config: await readFile(join(root, ".codex", "config.toml"), "utf8").catch(() => null), roles: [], skills: [], agentsInstructions: false }),
        },
        ...({ bridgeBinding: {
          surface: "released-hooks-v1",
          modes: ["interactive", "exec", "resume-by-id", "resume-latest"],
          evidence: "sha256:bound-config-and-host",
          verify: async () => true,
          endpoint: async () => "http://127.0.0.1:43127/hook",
          token: async () => "one-use-external-token",
        } } as Record<string, unknown>),
      });
      const plan = adapter.buildDeveloperTeamInstallPlan({ projectRoot, environmentId: "codex-development", deckConfig: getDefaultDeckConfig() });
      await adapter.applyDeveloperTeamInstall({ projectRoot, environmentId: "codex-development", plan });
      expect(await Bun.file(join(projectRoot, ".codex", "deck", "hooks", "developer-team-execution.js")).exists()).toBe(true);

      const interactive = await adapter.buildLaunchPlan?.({ projectRoot, teamId: "developer-team", mode: "interactive", deckConfig: getDefaultDeckConfig() });
      expect(interactive).toMatchObject({ status: "ready", plan: { executionClass: "static-compatible" } });
      if (interactive?.status === "ready") expect(interactive.plan.bridgeBinding).toBeUndefined();
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
      await rm(journalRoot, { recursive: true, force: true });
    }
  });

  test("maps only authenticated Codex CLI models and per-model reasoning, omitting unknown values", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "deck-codex-model-project-"));
    const journalRoot = await mkdtemp(join(tmpdir(), "deck-codex-model-journal-"));
    try {
      const parsed = parseCodexModels(CURRENT_CODEX_MODELS_FIXTURE);
      if (!parsed.ok) throw new Error("expected Codex fixture to parse");
      const adapter = createCodexRunnerAdapter({ tools: testTools(), ...layout(projectRoot),
        journalRoot,
        inventoryDiscovery: async () => ({ state: "ready", source: "live", discoveredAt: 1, fingerprint: "current-codex", inventory: parsed.inventory }),
      });
      await adapter.getModelInventory?.({ projectRoot, mode: "rescan" });
      expect(adapter.getModelCatalog().models.map((model) => model.id)).toEqual([
        "openai-codex/gpt-5.6-luna",
        "openai-codex/gpt-5.6-terra",
      ]);
      const plan = adapter.buildDeveloperTeamInstallPlan({
        projectRoot,
        environmentId: "codex-development",
        deckConfig: getDefaultDeckConfig(),
        modelAssignments: { "deck-lead": "openai-codex/gpt-5.6-terra", "deck-apply-fast": "unknown/model" },
        thinkingAssignments: { "deck-lead": "ultra", "deck-apply-fast": "invented" },
      });
      const lead = plan.files.find((file) => file.path === ".codex/agents/deck-lead.toml")?.content ?? "";
      const apply = plan.files.find((file) => file.path === ".codex/agents/deck-apply-fast.toml")?.content ?? "";
      expect(lead).toContain('model = "gpt-5.6-terra"');
      expect(lead).toContain('model_reasoning_effort = "ultra"');
      expect(apply).not.toContain("unknown/model");
      expect(plan.diagnostics).toContainEqual(expect.stringContaining("omitted"));
      const perModelPlan = adapter.buildDeveloperTeamInstallPlan({
        projectRoot,
        environmentId: "codex-development",
        deckConfig: getDefaultDeckConfig(),
        modelAssignments: { "deck-apply-fast": "openai-codex/gpt-5.6-luna" },
        thinkingAssignments: { "deck-apply-fast": "ultra" },
      });
      const luna = perModelPlan.files.find((file) => file.path === ".codex/agents/deck-apply-fast.toml")?.content ?? "";
      expect(luna).toContain('model = "gpt-5.6-luna"');
      expect(luna).not.toContain("model_reasoning_effort");
      expect(perModelPlan.diagnostics).toContainEqual(expect.stringContaining("for its Codex model"));
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
      await rm(journalRoot, { recursive: true, force: true });
    }
  });

  test("round-trips all project-local Codex role assignments and preserves unknown native slugs", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "deck-codex-role-assignments-"));
    const journalRoot = await mkdtemp(join(tmpdir(), "deck-codex-role-assignments-journal-"));
    try {
      const parsed = parseCodexModels(CURRENT_CODEX_MODELS_FIXTURE);
      if (!parsed.ok) throw new Error("expected Codex fixture to parse");
      const adapter = createCodexRunnerAdapter({ tools: testTools(), ...layout(projectRoot),
        journalRoot,
        inventoryDiscovery: async () => ({ state: "ready", source: "live", discoveredAt: 1, fingerprint: "current-codex", inventory: parsed.inventory }),
      });
      await adapter.getModelInventory?.({ projectRoot, mode: "rescan" });
      const modelAssignments = Object.fromEntries(DEVELOPER_TEAM_AGENTS.map((agent) => [agent.id, "openai-codex/gpt-5.6-terra"]));
      const thinkingAssignments = Object.fromEntries(DEVELOPER_TEAM_AGENTS.map((agent) => [agent.id, "ultra"]));
      const plan = adapter.buildDeveloperTeamInstallPlan({
        projectRoot,
        environmentId: "codex-development",
        deckConfig: getDefaultDeckConfig(),
        modelAssignments,
        thinkingAssignments,
      });
      await adapter.applyDeveloperTeamInstall({ projectRoot, environmentId: "codex-development", plan });

      expect(adapter.readModelAssignments(projectRoot)).toEqual(modelAssignments);
      expect(adapter.readThinkingAssignments(projectRoot)).toEqual(thinkingAssignments);

      await writeFile(join(projectRoot, ".codex", "agents", "deck-lead.toml"), [
        'model = "gpt-5.6-sol"',
        'model_reasoning_effort = "high"',
        "",
      ].join("\n"));
      expect(adapter.readModelAssignments(projectRoot)).toMatchObject({ "deck-lead": "openai-codex/gpt-5.6-sol" });
      expect(adapter.readThinkingAssignments(projectRoot)).toMatchObject({ "deck-lead": "high" });
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
      await rm(journalRoot, { recursive: true, force: true });
    }
  });

  test("omits missing or malformed Codex role fields without reading outside the project", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "deck-codex-role-read-safety-"));
    const journalRoot = await mkdtemp(join(tmpdir(), "deck-codex-role-read-safety-journal-"));
    try {
      const agents = join(projectRoot, ".codex", "agents");
      await mkdir(agents, { recursive: true });
      await writeFile(join(agents, "deck-lead.toml"), 'model = "gpt-5.6-sol"\n');
      await writeFile(join(agents, "deck-investigate.toml"), "model = 42\nmodel_reasoning_effort = [\"high\"]\n");
      await writeFile(join(agents, "deck-architect.toml"), "model = \"unterminated\n");
      await writeFile(join(agents, "deck-apply-fast.toml"), `model = "${"x".repeat(512 * 1024)}"\n`);
      await writeFile(join(agents, "deck-unrelated.toml"), 'model = "ignored"\nmodel_reasoning_effort = "ignored"\n');
      const adapter = createCodexRunnerAdapter({ tools: testTools(), ...layout(projectRoot), journalRoot });

      expect(adapter.readModelAssignments(projectRoot)).toEqual({ "deck-lead": "openai-codex/gpt-5.6-sol" });
      expect(adapter.readThinkingAssignments(projectRoot)).toEqual({});

      const diagnostics = await adapter.diagnoseProject?.(projectRoot, getDefaultDeckConfig()) ?? [];
      expect(diagnostics).toContainEqual(expect.objectContaining({
        category: "Model assignments",
        status: "warning",
        message: expect.stringContaining("could not be read safely"),
      }));
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
      await rm(journalRoot, { recursive: true, force: true });
    }
  });

  test("rejects symlinked Codex assignment ancestors while retaining normal project-local reads", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "deck-codex-role-ancestor-"));
    const linkedCodexRoot = await mkdtemp(join(tmpdir(), "deck-codex-role-linked-codex-"));
    const linkedAgentsRoot = await mkdtemp(join(tmpdir(), "deck-codex-role-linked-agents-"));
    const journalRoot = await mkdtemp(join(tmpdir(), "deck-codex-role-ancestor-journal-"));
    try {
      const writeRole = async (root: string) => {
        const agents = join(root, ".codex", "agents");
        await mkdir(agents, { recursive: true });
        await writeFile(join(agents, "deck-lead.toml"), 'model = "gpt-5.6-sol"\nmodel_reasoning_effort = "high"\n');
      };
      const adapter = createCodexRunnerAdapter({ tools: testTools(), ...layout(projectRoot), journalRoot });

      await writeRole(projectRoot);
      expect(adapter.readModelAssignments(projectRoot)).toEqual({ "deck-lead": "openai-codex/gpt-5.6-sol" });

      await writeRole(linkedCodexRoot);
      await rm(join(projectRoot, ".codex"), { recursive: true, force: true });
      try {
        await symlink(join(linkedCodexRoot, ".codex"), join(projectRoot, ".codex"), process.platform === "win32" ? "junction" : "dir");
      } catch {
        return;
      }
      expect(adapter.readModelAssignments(projectRoot)).toEqual({});
      expect(await adapter.diagnoseProject?.(projectRoot, getDefaultDeckConfig())).toContainEqual(expect.objectContaining({
        category: "Model assignments",
        status: "warning",
        message: expect.stringContaining("could not be read safely"),
      }));

      await rm(join(projectRoot, ".codex"), { recursive: true, force: true });
      await mkdir(join(projectRoot, ".codex"), { recursive: true });
      await mkdir(join(linkedAgentsRoot, "agents"), { recursive: true });
      await writeFile(join(linkedAgentsRoot, "agents", "deck-lead.toml"), 'model = "gpt-5.6-sol"\n');
      try {
        await symlink(join(linkedAgentsRoot, "agents"), join(projectRoot, ".codex", "agents"), process.platform === "win32" ? "junction" : "dir");
      } catch {
        return;
      }
      expect(adapter.readModelAssignments(projectRoot)).toEqual({});
      expect(await adapter.diagnoseProject?.(projectRoot, getDefaultDeckConfig())).toContainEqual(expect.objectContaining({
        category: "Model assignments",
        status: "warning",
        message: expect.stringContaining("could not be read safely"),
      }));
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
      await rm(linkedCodexRoot, { recursive: true, force: true });
      await rm(linkedAgentsRoot, { recursive: true, force: true });
      await rm(journalRoot, { recursive: true, force: true });
    }
  });

  test("bootstraps new Codex roots as Deck Lead with persisted assignments while resumes preserve history", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "deck-codex-root-lead-launch-"));
    const journalRoot = await mkdtemp(join(tmpdir(), "deck-codex-root-lead-launch-journal-"));
    try {
      await mkdir(join(projectRoot, ".codex", "agents"), { recursive: true });
      await writeFile(join(projectRoot, ".codex", "config.toml"), "[features]\nmulti_agent = true\n");
      await writeFile(join(projectRoot, ".codex", "agents", "deck-lead.toml"), 'model = "gpt-5.6-sol"\nmodel_reasoning_effort = "high"\n');
      const parsed = parseCodexModels(CURRENT_CODEX_MODELS_FIXTURE);
      if (!parsed.ok) throw new Error("expected Codex fixture to parse");
      const adapter = createCodexRunnerAdapter({ tools: testTools(), ...layout(projectRoot),
        journalRoot,
        preflight: {
          probe: async () => ({ found: true, version: "0.146.1", help: "Usage: codex [OPTIONS]\nexec\nresume", execHelp: "Usage: codex exec [OPTIONS]", resumeHelp: "Usage: codex resume [SESSION_ID] --last" }),
          inspectTrust: async () => "trusted",
          readProject: async () => ({ config: "[features]\nmulti_agent = true\n", roles: ["deck-lead.toml"], skills: ["deck-lead"], agentsInstructions: true }),
        },
        inventoryDiscovery: async () => ({ state: "ready", source: "live", discoveredAt: 1, fingerprint: "current-codex", inventory: parsed.inventory }),
      });
      const interactive = await adapter.buildLaunchPlan!({ projectRoot, teamId: "developer-team", mode: "interactive", deckConfig: getDefaultDeckConfig() });
      const exec = await adapter.buildLaunchPlan!({ projectRoot, teamId: "developer-team", mode: "exec", prompt: ["--flag", "quoted\nline"], stdin: "closed", stdinPayload: { type: "utf8", content: "--flag quoted\nline" }, deckConfig: getDefaultDeckConfig() });
      const override = await adapter.buildLaunchPlan!({ projectRoot, teamId: "developer-team", mode: "interactive", modelId: "openai-codex/gpt-5.6-luna", reasoningLevel: "medium", deckConfig: getDefaultDeckConfig() });
      const invalidOverride = await adapter.buildLaunchPlan!({ projectRoot, teamId: "developer-team", mode: "interactive", modelId: "unknown/model", reasoningLevel: "invented", deckConfig: getDefaultDeckConfig() });
      const resume = await adapter.buildLaunchPlan!({ projectRoot, teamId: "developer-team", mode: "resume-by-id", sessionId: "session-1", modelId: "openai-codex/gpt-5.6-luna", reasoningLevel: "medium", deckConfig: getDefaultDeckConfig() });

      for (const result of [interactive, exec]) {
        expect(result.status).toBe("ready");
        if (result.status !== "ready") throw new Error("expected new-session launch plan");
        const instructions = result.plan.args.find((arg) => arg.startsWith("developer_instructions="));
        expect(instructions).toContain("deck_<role>_<purpose>");
        expect(instructions).toContain("deck_investigate_runner_support");
        expect(instructions).toContain("agent_type");
        expect(instructions).toContain("deck-investigate");
        expect(instructions).toContain("task name does not select the agent role");
      }

      if (interactive.status === "ready") {
        const args = [...interactive.plan.args];
        expect(args).toEqual(expect.arrayContaining(["--model", "gpt-5.6-sol", "-c", 'model_reasoning_effort="high"']));
        expect(args.join(" ")).toContain("developer_instructions=");
        expect(args.join(" ")).toContain("deck-lead/SKILL.md");
        expect(interactive.plan.args).not.toContain("--agent");
      }
      if (exec.status === "ready") {
        const args = [...exec.plan.args];
        expect(args).toEqual(expect.arrayContaining(["exec", "-"]));
        expect(exec.plan.stdinPayload).toEqual({ type: "utf8", content: "--flag quoted\nline" });
        expect(args.join(" ")).not.toContain("quoted");
        expect(args.join(" ")).not.toContain("--flag");
      }
      expect(override).toMatchObject({ status: "ready", plan: { args: expect.arrayContaining(["--model", "gpt-5.6-luna", "-c", 'model_reasoning_effort="medium"']) } });
      expect(invalidOverride).toMatchObject({ status: "ready", diagnostics: expect.arrayContaining([expect.objectContaining({ code: "codex-model-omitted" }), expect.objectContaining({ code: "codex-reasoning-omitted" })]) });
      if (invalidOverride.status === "ready") expect(invalidOverride.plan.args).not.toContain("gpt-5.6-sol");
      if (resume.status === "ready") {
        expect([...resume.plan.args]).toEqual(["--dangerously-bypass-approvals-and-sandbox", "-c", 'features.multi_agent_v2.multi_agent_mode_hint_text=""', "resume", "session-1"]);
        expect(resume.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: "codex-resume-existing-history" })]));
        expect(resume.plan.args.join(" ")).not.toContain("developer_instructions");
        expect(resume.plan.args.join(" ")).not.toContain("model_reasoning_effort");
      }
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
      await rm(journalRoot, { recursive: true, force: true });
    }
  });

  test("blocks option-shaped persisted root assignments before they can become argv values", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "deck-codex-unsafe-root-assignment-"));
    const journalRoot = await mkdtemp(join(tmpdir(), "deck-codex-unsafe-root-assignment-journal-"));
    try {
      await mkdir(join(projectRoot, ".codex", "agents"), { recursive: true });
      const adapter = createCodexRunnerAdapter({ tools: testTools(), ...layout(projectRoot),
        journalRoot,
        preflight: {
          probe: async () => ({ found: true, version: "0.146.1", help: "Usage: codex [OPTIONS]\nexec\nresume", execHelp: "Usage: codex exec [OPTIONS]", resumeHelp: "Usage: codex resume [SESSION_ID] --last" }),
          inspectTrust: async () => "trusted",
          readProject: async () => ({ config: "[features]\nmulti_agent = true\n", roles: ["deck-lead.toml"], skills: ["deck-lead"], agentsInstructions: true }),
        },
      });
      for (const assignment of [
        'model = "--dangerously-bypass-approvals-and-sandbox"\n',
        'model_reasoning_effort = "--other-option"\n',
      ]) {
        await writeFile(join(projectRoot, ".codex", "agents", "deck-lead.toml"), assignment);
        await expect(adapter.buildLaunchPlan!({ projectRoot, teamId: "developer-team", mode: "interactive", deckConfig: getDefaultDeckConfig() })).resolves.toMatchObject({
          status: "blocked",
          code: "codex-invalid-launch-scalar",
        });
      }
      await writeFile(join(projectRoot, ".codex", "agents", "deck-lead.toml"), 'model = "gpt-5.6-sol"\nmodel_reasoning_effort = "high"\n');
      await expect(adapter.buildLaunchPlan!({ projectRoot, teamId: "developer-team", mode: "interactive", deckConfig: getDefaultDeckConfig() })).resolves.toMatchObject({
        status: "ready",
        plan: { args: expect.arrayContaining(["--model", "gpt-5.6-sol", "-c", 'model_reasoning_effort="high"']) },
      });
      for (const input of [
        { projectRoot, teamId: "developer-team", mode: "interactive" as const, modelId: "--dangerously-bypass-approvals-and-sandbox", deckConfig: getDefaultDeckConfig() },
        { projectRoot, teamId: "developer-team", mode: "interactive" as const, reasoningLevel: "--other-option", deckConfig: getDefaultDeckConfig() },
      ]) {
        await expect(adapter.buildLaunchPlan!(input)).resolves.toMatchObject({
          status: "blocked",
          code: "codex-invalid-launch-scalar",
        });
      }
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
      await rm(journalRoot, { recursive: true, force: true });
    }
  });

  test("exposes exact current Codex reasoning levels and the runner's default", async () => {
    const parsed = parseCodexModels(CURRENT_CODEX_MODELS_FIXTURE);
    if (!parsed.ok) throw new Error("expected Codex fixture to parse");
    const adapter = createCodexRunnerAdapter({ tools: testTools(), ...freshLayout(),
      inventoryDiscovery: async () => ({ state: "ready", source: "live", discoveredAt: 1, fingerprint: "current-codex", inventory: parsed.inventory }),
    });
    const inventory = await adapter.getModelInventory?.({ projectRoot: "/project", mode: "prefer-cache" });
    expect(inventory?.state).toBe("ready");
    if (inventory?.state === "ready") {
      expect(adapter.getThinkingLevels("openai-codex/gpt-5.6-terra")).toEqual(["low", "max", "ultra"]);
      expect(adapter.getDefaultThinking("openai-codex/gpt-5.6-terra")).toBe("ultra");
      expect(Object.values(inventory.inventory.modelsByProvider).flat().find((entry) => entry.id === "openai-codex/gpt-5.6-terra")?.variants).toContain("max");
      expect(await adapter.validateModelAssignments?.({
        projectRoot: "/project",
        modelAssignments: { changed: "openai-codex/gpt-5.6-terra" },
        thinkingAssignments: { changed: "ultra" },
        changedAgentIds: ["changed"],
      })).toEqual({ valid: true, fingerprint: "current-codex" });
      expect(await adapter.validateModelAssignments?.({
        projectRoot: "/project",
        modelAssignments: { changed: "openai-codex/gpt-5.6-luna" },
        thinkingAssignments: { changed: "ultra" },
        changedAgentIds: ["changed"],
      })).toMatchObject({ valid: false, issues: [{ code: "variant-unavailable" }] });
    }
  });

  test("separates selected instructions from MCP, shared-binary, provider, and index readiness", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "deck-codex-readiness-project-"));
    const journalRoot = await mkdtemp(join(tmpdir(), "deck-codex-readiness-journal-"));
    try {
      await writeGitOrigin(projectRoot);
      const adapter = createCodexRunnerAdapter({ tools: readyTestTools({ supermemory: true }), ...layout(projectRoot),
        journalRoot,
        preflight: hermeticCodexPreflight(),
        mcpCapabilityIds: ["context7"],
        serenaReadinessResolver: async () => readySerenaReadiness(),
        serenaProxyProbe: readySerenaProxy,
        codebaseIndexReadiness: async () => true,
      });
      const serenaInstructions = (await import("@deck/core")).buildCapabilityInstructionBundle(["context-mode", "codebase-memory", "serena", "rtk"]);
      await adapter.prepareDeveloperTeamInstall!({
        projectRoot,
        environmentId: "codex-development",
        deckConfig: getDefaultDeckConfig(),
        memoryProvider: { id: "supermemory", displayName: "Supermemory", buildInjection: () => ({ instructions: [], toolBindings: [] }) },
        capabilityInstructions: serenaInstructions,
      });
      const plan = adapter.buildDeveloperTeamInstallPlan({
        projectRoot,
        environmentId: "codex-development",
        deckConfig: getDefaultDeckConfig(),
        memoryProvider: { id: "supermemory", displayName: "Supermemory", buildInjection: () => ({ instructions: [], toolBindings: [] }) },
        capabilityInstructions: serenaInstructions,
      });
      await adapter.applyDeveloperTeamInstall({ projectRoot, environmentId: "codex-development", plan });
      const config = await readFile(join(projectRoot, ".codex", "config.toml"), "utf8");
      expect(config).toContain("[mcp_servers.context7]");
      expect(config).not.toContain("[mcp_servers.supermemory]");
      expect(config).not.toContain("bearer_token_env_var");
      expect(config).not.toContain("SUPERMEMORY_API_KEY");
        expect(await adapter.verifyDeveloperTeamInstall(plan)).toMatchObject({
          valid: true,
        });
       await writeFile(join(projectRoot, ".codex", "config.toml"), "[features]\nmulti_agent = false\n");
       const driftedVerification = await adapter.verifyDeveloperTeamInstall(plan);
       expect(driftedVerification).toMatchObject({ valid: false });
       expect(driftedVerification).not.toHaveProperty("postInstallFollowUps");
       await writeFile(join(projectRoot, ".codex", "config.toml"), config);
       const inventory = await adapter.getCapabilityInventory({ projectRoot, environmentId: "codex-development", runnerId: "codex", deckConfig: getDefaultDeckConfig() });
      for (const id of ["context-mode", "codebase-memory", "rtk", "serena", "context7"]) {
        expect(inventory.capabilities.find((capability) => capability.capabilityId === id)?.isInstalled).toBe(true);
      }
      expect(inventory.capabilities.find((capability) => capability.capabilityId === "supermemory-tool-bindings")).toMatchObject({
         isInstalled: true,
         isBlocked: false,
         diagnostics: [],
       });
      expect(config).toContain("# deck-codex-hook:supermemory:start");
      expect(config).toContain("# deck-codex-hook:rtk:start");
      expect(config).not.toContain("deck-codex-hook:memory-bridge");
       const unauthenticatedReview = adapter.buildReviewPlan({
         runnerId: "codex",
         environmentId: "codex-development",
         selectedCapabilities: {},
         packageInstructions: {},
         adaptiveMemory: { provider: "supermemory" },
       }, inventory);
        expect(unauthenticatedReview).toMatchObject({
          ready: true,
        });
        expect(unauthenticatedReview.groups.manualSteps).not.toContainEqual(expect.objectContaining({ capabilityId: "supermemory-tool-bindings" }));
        expect(adapter.buildInstallationPlan({ runnerId: "codex", environmentId: "codex-development", selectedCapabilities: { "context-mode": true }, packageInstructions: {}, adaptiveMemory: { provider: "none" } }).steps.map((step) => `${step.action}:${step.capabilityId}`)).toEqual(expect.arrayContaining(["install:context-mode", "configure:context-mode"]));
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
      await rm(journalRoot, { recursive: true, force: true });
    }
  }, 30_000);

  test("reuses validated Deck-owned Serena evidence and blocks a missing launcher before writing MCP config", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "deck-codex-serena-provisioning-"));
    const journalRoot = await mkdtemp(join(tmpdir(), "deck-codex-serena-provisioning-journal-"));
    const executable = TEST_SERENA_EXECUTABLE;
    let launcherReachable = true;
    try {
      const ready = createCodexRunnerAdapter({ tools: testTools(), ...layout(projectRoot),
        journalRoot,
        preflight: hermeticCodexPreflight(),
        serenaReadinessResolver: async () => {
          const readiness = readySerenaReadiness();
          return {
            ...readiness,
            revalidate: async (value: import("@deck/core").SerenaReadinessEvidence) => launcherReachable
              ? { valid: true as const, evidence: value }
              : { valid: false as const, code: "stale-readiness-evidence" as const, diagnostic: { code: "stale", message: "stale" } },
          };
        },
        serenaProxyProbe: readySerenaProxy,
      } as never);
      await ready.prepareDeveloperTeamInstall!({
        projectRoot,
        environmentId: "codex-development",
        deckConfig: getDefaultDeckConfig(),
        capabilityInstructions: (await import("@deck/core")).buildCapabilityInstructionBundle(["serena"]),
      });
      const readyPlan = ready.buildDeveloperTeamInstallPlan({
        projectRoot,
        environmentId: "codex-development",
        deckConfig: getDefaultDeckConfig(),
        capabilityInstructions: (await import("@deck/core")).buildCapabilityInstructionBundle(["serena"]),
      });
      const readyConfig = readyPlan.files.find((file) => file.path === ".codex/config.toml")?.content ?? "";
      expect(readyPlan.blocked).toBe(false);
      expect(readyConfig).toContain('command = "deck"');
       expect(readyConfig).toContain('args = ["internal", "serena-mcp"]');
       expect(readyConfig).toContain('env_vars = ["HOME", "PATH", "XDG_DATA_HOME"]');
       expect(readyConfig).not.toContain(executable);
      await ready.applyDeveloperTeamInstall({ projectRoot, environmentId: "codex-development", plan: readyPlan });
      expect((await ready.getCapabilityInventory({ projectRoot, environmentId: "codex-development", runnerId: "codex", deckConfig: getDefaultDeckConfig() })).capabilities.find((capability) => capability.capabilityId === "serena")).toMatchObject({
        isInstalled: true,
        diagnostics: expect.arrayContaining([expect.stringContaining("executable reused"), expect.stringContaining("MCP configured"), expect.stringContaining("MCP ready")]),
      });
      launcherReachable = false;
      await expect(ready.verifyDeveloperTeamInstall(readyPlan)).resolves.toMatchObject({
        valid: false,
        diagnostics: [expect.stringContaining("no longer reachable")],
      });

      const legacyProjectRoot = await mkdtemp(join(tmpdir(), "deck-codex-serena-legacy-"));
      try {
        await mkdir(join(legacyProjectRoot, ".codex"), { recursive: true });
        await writeFile(join(legacyProjectRoot, ".codex", "config.toml"), '# deck-codex-mcp:serena\n[mcp_servers.serena]\ncommand = "serena"\nargs = ["start-mcp-server", "--project-from-cwd"]\n');
        const legacy = createCodexRunnerAdapter({ tools: testTools(), ...layout(legacyProjectRoot),
          journalRoot,
          serenaReadinessResolver: async () => readySerenaReadiness(),
           serenaProxyProbe: readySerenaProxy,
        } as never);
        await legacy.prepareDeveloperTeamInstall!({ projectRoot: legacyProjectRoot, environmentId: "codex-development", deckConfig: getDefaultDeckConfig() });
        const legacyPlan = legacy.buildDeveloperTeamInstallPlan({ projectRoot: legacyProjectRoot, environmentId: "codex-development", deckConfig: getDefaultDeckConfig() });
        expect(legacyPlan.files.find((file) => file.path === ".codex/config.toml")?.content ?? "").toContain('command = "deck"');
      } finally {
        await rm(legacyProjectRoot, { recursive: true, force: true });
      }

      const preApplyProjectRoot = await mkdtemp(join(tmpdir(), "deck-codex-serena-preapply-"));
      try {
        const staleBeforeApply = createCodexRunnerAdapter({ tools: testTools(), ...layout(projectRoot),
          journalRoot,
          serenaReadinessResolver: async () => {
            const readiness = readySerenaReadiness();
            return {
              ...readiness,
              revalidate: async () => ({ valid: false as const, code: "stale-readiness-evidence" as const, diagnostic: { code: "stale", message: "stale" } }),
            };
          },
          serenaProxyProbe: readySerenaProxy,
        } as never);
        const instructions = (await import("@deck/core")).buildCapabilityInstructionBundle(["serena"]);
        await staleBeforeApply.prepareDeveloperTeamInstall!({ projectRoot: preApplyProjectRoot, environmentId: "codex-development", deckConfig: getDefaultDeckConfig(), capabilityInstructions: instructions });
        const stalePlan = staleBeforeApply.buildDeveloperTeamInstallPlan({ projectRoot: preApplyProjectRoot, environmentId: "codex-development", deckConfig: getDefaultDeckConfig(), capabilityInstructions: instructions });
        await expect(staleBeforeApply.applyDeveloperTeamInstall({ projectRoot: preApplyProjectRoot, environmentId: "codex-development", plan: stalePlan })).rejects.toThrow("no longer reachable");
        expect(await Bun.file(join(preApplyProjectRoot, ".codex", "config.toml")).exists()).toBe(false);
      } finally {
        await rm(preApplyProjectRoot, { recursive: true, force: true });
      }

      const missing = createCodexRunnerAdapter({ tools: testTools(), ...layout(projectRoot),
        journalRoot,
        serenaReadinessResolver: async () => ({ state: "missing" as const, diagnostic: { code: "serena-not-ready", message: "Serena is unavailable." } }),
      } as never);
      await missing.prepareDeveloperTeamInstall!({
        projectRoot,
        environmentId: "codex-development",
        deckConfig: getDefaultDeckConfig(),
        capabilityInstructions: (await import("@deck/core")).buildCapabilityInstructionBundle(["serena"]),
      });
      const missingPlan = missing.buildDeveloperTeamInstallPlan({
        projectRoot,
        environmentId: "codex-development",
        deckConfig: getDefaultDeckConfig(),
        capabilityInstructions: (await import("@deck/core")).buildCapabilityInstructionBundle(["serena"]),
      });
      expect(missingPlan.blocked).toBe(true);
      expect(missingPlan.files.find((file) => file.path === ".codex/config.toml")?.content ?? "").not.toContain('command = "serena"');
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
      await rm(journalRoot, { recursive: true, force: true });
    }
  });

  test("runs readiness install coverage in an isolated child process with no Codex executable on PATH", async () => {
    if (process.env.DECK_CODEX_HERMETIC_CHILD === "1") return;
    const { root, env } = await isolatedNoCodexEnvRoot();
    try {
      const missingCodex = spawnSync("codex", ["--version"], { env, encoding: "utf8" });
      expect((missingCodex.error as NodeJS.ErrnoException | undefined)?.code).toBe("ENOENT");

      const child = spawnSync(process.execPath, [
        "test",
        fileURLToPath(import.meta.url),
        "--test-name-pattern",
        CODEX_HERMETIC_READINESS_TEST_PATTERN,
      ], {
        cwd: process.cwd(),
        env,
        encoding: "utf8",
      });

      expect({ error: child.error?.message, signal: child.signal, status: child.status, stderr: child.stderr, stdout: child.stdout }).toMatchObject({
        error: undefined,
        signal: null,
        status: 0,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });


  test("blocks full Serena composition when the effective Deck executable lacks the proxy route", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "deck-codex-serena-proxy-"));
    try {
      const adapter = createCodexRunnerAdapter({ tools: testTools(), ...layout(projectRoot),
        journalRoot: join(projectRoot, "journals"),
        serenaReadinessResolver: async () => readySerenaReadiness(),
        serenaProxyProbe: async () => ({
          state: "unsupported" as const,
          message: "The active `deck` command does not support `deck internal serena-mcp`. Update Deck on PATH, then rerun the full Codex install.",
        }),
      });
      const input = {
        projectRoot,
        environmentId: "codex-development" as const,
        deckConfig: getDefaultDeckConfig(),
        capabilityInstructions: (await import("@deck/core")).buildCapabilityInstructionBundle(["serena"]),
      };

      const diagnostics = await adapter.prepareDeveloperTeamInstall!(input);
      const plan = adapter.buildDeveloperTeamInstallPlan(input);
      expect(diagnostics).toContainEqual(expect.objectContaining({ code: "codex-serena-proxy-not-ready" }));
      expect(plan).toMatchObject({ blocked: true });
      expect(plan.diagnostics?.join(" ")).toContain("Update Deck on PATH");
      expect(plan.files.find((file) => file.path === ".codex/config.toml")?.content ?? "").not.toContain('command = "deck"');
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  test("uses the authorized Core Serena bootstrap and reuses ready evidence without a reinstall", async () => {
    let bootstrapCalls = 0;
    const adapter = createCodexRunnerAdapter({ tools: testTools(), ...freshLayout(),
      serenaReadinessResolver: async () => readySerenaReadiness(),
      serenaProxyProbe: readySerenaProxy,
      serenaBootstrap: async (request: import("@deck/core").SerenaBootstrapRequest) => {
        bootstrapCalls += 1;
        expect(request.authorization).toMatchObject({ runner: "codex", operationId: "operation-1" });
        return { outcome: "reused", evidence: readySerenaReadiness().evidence };
      },
    } as never);
    const operation = { runner: "codex" as const, operationId: "operation-1", explicitlySelected: true };
    const result = await adapter.runAction({
      id: "codex-serena-bootstrap",
      kind: "bootstrap-shared-serena",
      title: "Reuse Serena",
      capabilityId: "serena",
      status: "ready",
    }, {
      projectRoot: "/tmp/codex-serena-action",
      runnerId: "codex",
      environmentId: "codex-development",
      operation,
      currentOperation: operation,
      serenaAuthorization: { kind: "interactive-tui-explicit-selection", runner: "codex", operationId: operation.operationId },
    });

    expect(result).toMatchObject({ status: "executed", message: expect.stringContaining("Reused") });
    expect(bootstrapCalls).toBe(1);
  });

  test("reports reused, missing, unusable, MCP-missing, and index-missing readiness by capability ID", async () => {
    const adapter = createCodexRunnerAdapter({ tools: testTools({ verifyExistingCodebase: () => false, verifyCodebaseNative: () => false }),
      preflight: {
        probe: async () => ({ found: true, version: "0.146.1", help: "Usage: codex [OPTIONS]", execHelp: "Usage: codex exec [OPTIONS]", resumeHelp: "Usage: codex resume [SESSION_ID] --last" }),
        inspectTrust: async () => "trusted",
        readProject: async () => ({
          config: '[mcp_servers.context-mode]\ncommand = "context-mode"\n\n[mcp_servers.codebase-memory]\ncommand = "codebase-memory-mcp"\n',
          roles: [],
          skills: [],
          agentsInstructions: false,
        }),
      },
      serenaReadinessResolver: async () => ({ state: "missing" as const, diagnostic: { code: "serena-not-ready", message: "Serena is unavailable." } }),
      codebaseIndexReadiness: async () => false,
    });
    const inventory = await adapter.getCapabilityInventory({ projectRoot: "/project", environmentId: "codex-development", runnerId: "codex", deckConfig: getDefaultDeckConfig() });
    const byId = new Map(inventory.capabilities.map((capability) => [capability.capabilityId, capability]));
    expect(byId.get("context-mode")).toMatchObject({ isInstalled: false, isBlocked: false, diagnostics: expect.arrayContaining([expect.stringContaining("no verified executable")]) });
    expect(byId.get("codebase-memory")).toMatchObject({ isInstalled: false, diagnostics: expect.arrayContaining([expect.stringContaining("no verified executable"), expect.stringContaining("index not ready")]) });
    expect(byId.get("rtk")).toMatchObject({ isInstalled: false, isBlocked: false, diagnostics: expect.arrayContaining([expect.stringContaining("pinned binary absent")]) });
    expect(byId.get("serena")).toMatchObject({ isInstalled: false, isBlocked: false, diagnostics: expect.arrayContaining([expect.stringContaining("executable missing"), expect.stringContaining("MCP not configured"), expect.stringContaining("MCP not ready")]) });
    expect(byId.get("context7")).toMatchObject({ isInstalled: false, diagnostics: expect.arrayContaining([expect.stringContaining("MCP configuration missing")]) });
    const review = adapter.buildReviewPlan({
      runnerId: "codex",
      environmentId: "codex-development",
      selectedCapabilities: { serena: true },
      explicitlySelectedCapabilities: { serena: true },
      packageInstructions: {},
      adaptiveMemory: { provider: "none" },
    }, inventory);
    expect(review.groups.manualSteps).toContainEqual(expect.objectContaining({
      id: "codex-serena-bootstrap",
      capabilityId: "serena",
      status: "ready",
    }));
  });

  test("doctor covers ready, degraded, blocked, drifted, unsupported, and per-route static states", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "deck-codex-doctor-project-"));
    const journalRoot = await mkdtemp(join(tmpdir(), "deck-codex-doctor-journal-"));
    const probe = async () => ({ found: true as const, version: "0.146.1", help: "Usage: codex [OPTIONS]", execHelp: "Usage: codex exec [OPTIONS]", resumeHelp: "Usage: codex resume [SESSION_ID] --last" });
    try {
      await writeGitOrigin(projectRoot);
      const ready = createCodexRunnerAdapter({ tools: readyTestTools({ supermemory: true }), ...layout(projectRoot),
        journalRoot,
        preflight: {
          probe,
          inspectTrust: async () => "trusted",
          readProject: async (root) => ({ config: await readFile(join(root, ".codex", "config.toml"), "utf8").catch(() => null), roles: [], skills: [], agentsInstructions: true }),
        },
        codebaseIndexReadiness: async () => true,
      });
      const plan = ready.buildDeveloperTeamInstallPlan({
        projectRoot,
        environmentId: "codex-development",
        deckConfig: validateDeckConfig({ adaptiveMemory: { activeProvider: "supermemory", supermemory: { mcpServerName: "supermemory" } } }),
        memoryProvider: { id: "supermemory", displayName: "Supermemory", buildInjection: () => ({ instructions: [], toolBindings: [] }) },
      });
      await ready.applyDeveloperTeamInstall({ projectRoot, environmentId: "codex-development", plan });
      const healthy = await ready.diagnoseProject?.(projectRoot, validateDeckConfig({ adaptiveMemory: { activeProvider: "supermemory", supermemory: { mcpServerName: "supermemory" } } })) ?? [];
      expect(healthy).toContainEqual(expect.objectContaining({ category: "Binary and version", status: "ok" }));
      expect(healthy).toContainEqual(expect.objectContaining({ category: "Managed content", status: "ok" }));
      expect(healthy).toContainEqual(expect.objectContaining({
        category: "Capability: Supermemory (official Codex plugin)",
        status: "ok",
      }));
      for (const mode of ["interactive", "exec", "resume-by-id", "resume-latest"]) {
        expect(healthy).toContainEqual(expect.objectContaining({ category: `Execution route: ${mode}`, status: "warning", message: expect.stringContaining("static-compatible") }));
      }

      const unauthorized = createCodexRunnerAdapter({ tools: testTools(), ...layout(projectRoot),
        journalRoot,
        preflight: {
          probe,
          inspectTrust: async () => "trusted",
          readProject: async (root) => ({ config: await readFile(join(root, ".codex", "config.toml"), "utf8"), roles: [], skills: [], agentsInstructions: true }),
        },
        codebaseIndexReadiness: async () => true,
      });
      expect(await unauthorized.diagnoseProject?.(projectRoot, validateDeckConfig({ adaptiveMemory: { activeProvider: "supermemory", supermemory: { mcpServerName: "supermemory" } } }))).toContainEqual(expect.objectContaining({
        category: "Capability: Supermemory (official Codex plugin)",
        status: "warning",
        message: expect.stringContaining("hooks are not installed"),
      }));

      const brokenSupermemory = createCodexRunnerAdapter({ tools: testTools(), ...layout(projectRoot),
        journalRoot,
        preflight: {
          probe,
          inspectTrust: async () => "trusted",
          readProject: async () => ({ config: "[features]\nmulti_agent = true\n", roles: [], skills: [], agentsInstructions: true }),
        },
        codebaseIndexReadiness: async () => true,
      });
      expect(await brokenSupermemory.diagnoseProject?.(projectRoot, validateDeckConfig({ adaptiveMemory: { activeProvider: "supermemory", supermemory: { mcpServerName: "supermemory" } } }))).toContainEqual(expect.objectContaining({
        category: "Capability: Supermemory (official Codex plugin)",
        status: "warning",
        message: expect.stringContaining("hooks are not installed"),
      }));

      const untrusted = createCodexRunnerAdapter({ tools: testTools(), ...layout(projectRoot),
        journalRoot,
        preflight: { probe, inspectTrust: async () => "untrusted", readProject: async () => ({ config: "[features]\nmulti_agent = true\n", roles: [], skills: [], agentsInstructions: true }) },
      });
      expect(await untrusted.diagnoseProject?.(projectRoot, getDefaultDeckConfig())).toContainEqual(expect.objectContaining({ category: "Trust activation", status: "warning" }));

      await writeFile(join(projectRoot, ".codex", "agents", "deck-lead.toml"), "user drift", "utf8");
      expect(await ready.diagnoseProject?.(projectRoot, validateDeckConfig({ adaptiveMemory: { activeProvider: "supermemory", supermemory: { mcpServerName: "supermemory" } } }))).toContainEqual(expect.objectContaining({ category: "Managed content", status: "error", message: expect.stringContaining("ownership evidence") }));

      const blocked = createCodexRunnerAdapter({ tools: testTools(), ...layout(projectRoot),
        journalRoot,
        preflight: { probe, inspectTrust: async () => "trusted", readProject: async () => ({ config: "[broken", roles: [], skills: [], agentsInstructions: true }) },
      });
      expect(await blocked.diagnoseProject?.(projectRoot, getDefaultDeckConfig())).toContainEqual(expect.objectContaining({ category: "Binary and version", status: "error" }));

      const unsupported = createCodexRunnerAdapter({ tools: testTools(), ...layout(projectRoot),
        journalRoot,
        preflight: { probe: async () => ({ found: true, version: "0.100.0", help: "" }) },
      });
      const unsupportedChecks = await unsupported.diagnoseProject?.(projectRoot, getDefaultDeckConfig()) ?? [];
      expect(unsupportedChecks).toContainEqual(expect.objectContaining({ category: "Binary and version", status: "error", message: expect.stringContaining("0.100.0") }));
      expect(unsupportedChecks).toContainEqual(expect.objectContaining({ category: "Execution route: interactive", status: "warning", message: expect.stringContaining("unsupported") }));
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
      await rm(journalRoot, { recursive: true, force: true });
    }
  }, 30_000);

  test("refreshes Serena evidence for each inventory inspection and once per Doctor inspection", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "deck-codex-serena-freshness-"));
    const journalRoot = await mkdtemp(join(tmpdir(), "deck-codex-serena-freshness-journal-"));
    const config = [
      "# deck-codex-mcp:serena",
      "[mcp_servers.serena]",
      'command = "deck"',
       'args = ["internal", "serena-mcp"]',
       'env_vars = ["HOME", "PATH", "XDG_DATA_HOME"]',
      "",
    ].join("\n");
    try {
      await mkdir(join(projectRoot, ".codex"), { recursive: true });
      await writeFile(join(projectRoot, ".codex", "config.toml"), config);
      const probe = async () => ({ found: true as const, version: "0.146.1", help: "Usage: codex [OPTIONS]", execHelp: "Usage: codex exec [OPTIONS]", resumeHelp: "Usage: codex resume [SESSION_ID] --last" });
      let readyThenMissingCalls = 0;
      const readyThenMissing = createCodexRunnerAdapter({ tools: testTools(), ...layout(projectRoot),
        journalRoot,
        preflight: { probe, inspectTrust: async () => "trusted", readProject: async () => ({ config, roles: [], skills: [], agentsInstructions: true }) },
        serenaReadinessResolver: async () => {
          readyThenMissingCalls += 1;
          return readyThenMissingCalls === 1
            ? readySerenaReadiness()
            : { state: "missing" as const, diagnostic: { code: "serena-not-ready", message: "Serena is unavailable." } };
        },
        serenaProxyProbe: readySerenaProxy,
      } as never);
      const first = await readyThenMissing.getCapabilityInventory({ projectRoot, environmentId: "codex-development", runnerId: "codex", deckConfig: getDefaultDeckConfig() });
      const second = await readyThenMissing.getCapabilityInventory({ projectRoot, environmentId: "codex-development", runnerId: "codex", deckConfig: getDefaultDeckConfig() });
      expect(first.capabilities.find((capability) => capability.capabilityId === "serena")).toMatchObject({ isInstalled: true });
      expect(second.capabilities.find((capability) => capability.capabilityId === "serena")).toMatchObject({ isInstalled: false, diagnostics: expect.arrayContaining([expect.stringContaining("executable missing")]) });
      expect(readyThenMissingCalls).toBe(2);

      let missingThenReadyCalls = 0;
      const missingThenReady = createCodexRunnerAdapter({ tools: testTools(), ...layout(projectRoot),
        journalRoot,
        preflight: { probe, inspectTrust: async () => "trusted", readProject: async () => ({ config, roles: [], skills: [], agentsInstructions: true }) },
        serenaReadinessResolver: async () => {
          missingThenReadyCalls += 1;
          return missingThenReadyCalls === 1
            ? { state: "missing" as const, diagnostic: { code: "serena-not-ready", message: "Serena is unavailable." } }
            : readySerenaReadiness();
        },
        serenaProxyProbe: readySerenaProxy,
      } as never);
      const missing = await missingThenReady.getCapabilityInventory({ projectRoot, environmentId: "codex-development", runnerId: "codex", deckConfig: getDefaultDeckConfig() });
      const ready = await missingThenReady.getCapabilityInventory({ projectRoot, environmentId: "codex-development", runnerId: "codex", deckConfig: getDefaultDeckConfig() });
      expect(missing.capabilities.find((capability) => capability.capabilityId === "serena")).toMatchObject({ isInstalled: false });
      expect(ready.capabilities.find((capability) => capability.capabilityId === "serena")).toMatchObject({ isInstalled: true });
      expect(missingThenReadyCalls).toBe(2);

      let doctorCalls = 0;
      let doctorProxyCalls = 0;
      const doctor = createCodexRunnerAdapter({ tools: testTools(), ...layout(projectRoot),
        journalRoot,
        preflight: { probe, inspectTrust: async () => "trusted", readProject: async () => ({ config, roles: [], skills: [], agentsInstructions: true }) },
        serenaReadinessResolver: async () => {
          doctorCalls += 1;
          return readySerenaReadiness();
        },
        serenaProxyProbe: async () => {
          doctorProxyCalls += 1;
          return { state: "ready" as const };
        },
      } as never);
      const checks = await doctor.diagnoseProject!(projectRoot, getDefaultDeckConfig());
      expect(checks).not.toContainEqual(expect.objectContaining({ category: "Managed content", status: "error" }));
      expect(checks).toContainEqual(expect.objectContaining({ category: "Capability: Serena", status: "ok", message: expect.stringContaining("Deck-owned executable reused") }));
      expect(doctorCalls).toBe(1);
      expect(doctorProxyCalls).toBe(1);

      let missingDoctorCalls = 0;
      const missingDoctor = createCodexRunnerAdapter({ tools: testTools(), ...layout(projectRoot),
        journalRoot,
        preflight: { probe, inspectTrust: async () => "trusted", readProject: async () => ({ config, roles: [], skills: [], agentsInstructions: true }) },
        serenaReadinessResolver: async () => {
          missingDoctorCalls += 1;
          return { state: "missing" as const, diagnostic: { code: "serena-not-ready", message: "Serena is unavailable." } };
        },
      } as never);
      const missingChecks = await missingDoctor.diagnoseProject!(projectRoot, getDefaultDeckConfig());
      expect(missingChecks).toContainEqual(expect.objectContaining({ category: "Managed content", status: "error", message: expect.stringContaining("no healthy Deck-owned launcher") }));
      expect(missingChecks).toContainEqual(expect.objectContaining({
        category: "Capability: Serena",
        status: "warning",
        message: expect.stringContaining("executable missing"),
        suggestion: "Explicitly select Serena in Review to reuse or provision it before configuring Codex MCP.",
      }));
      expect(missingChecks.some((check) => check.category === "Capability: Serena" && check.message.includes("reused"))).toBe(false);
      expect(missingDoctorCalls).toBe(1);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
      await rm(journalRoot, { recursive: true, force: true });
    }
  });


  test("requires a fresh effective Deck proxy probe for every ready public Serena inventory", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "deck-codex-serena-proxy-inventory-"));
    const config = [
      "# deck-codex-mcp:serena",
      "[mcp_servers.serena]",
      'command = "deck"',
      'args = ["internal", "serena-mcp"]',
      'env_vars = ["HOME", "PATH", "XDG_DATA_HOME"]',
      "",
    ].join("\n");
    let resolverCalls = 0;
    let proxyCalls = 0;
    try {
      await mkdir(join(projectRoot, ".codex"), { recursive: true });
      await writeFile(join(projectRoot, ".codex", "config.toml"), config);
      const adapter = createCodexRunnerAdapter({ tools: testTools(), ...layout(projectRoot),
        preflight: {
          probe: async () => ({ found: true, version: "0.146.1", help: "Usage: codex", execHelp: "Usage: codex exec", resumeHelp: "Usage: codex resume" }),
          inspectTrust: async () => "trusted",
          readProject: async () => ({ config, roles: [], skills: [], agentsInstructions: true }),
        },
        serenaReadinessResolver: async () => {
          resolverCalls += 1;
          return resolverCalls === 3
            ? { state: "missing" as const, diagnostic: { code: "serena-not-ready", message: "Serena is unavailable." } }
            : readySerenaReadiness();
        },
        serenaProxyProbe: async () => {
          proxyCalls += 1;
          return proxyCalls === 1
            ? { state: "ready" as const }
            : proxyCalls === 2
              ? { state: "unsupported" as const, message: "The active `deck` command does not support `deck internal serena-mcp`." }
              : { state: "indeterminate" as const, message: "The effective `deck` proxy probe timed out." };
        },
      });
      const input = { projectRoot, environmentId: "codex-development" as const, runnerId: "codex" as const, deckConfig: getDefaultDeckConfig() };
      const ready = await adapter.getCapabilityInventory(input);
      const unsupported = await adapter.getCapabilityInventory(input);
      const missing = await adapter.getCapabilityInventory(input);
      const indeterminate = await adapter.getCapabilityInventory(input);
      const serena = (inventory: Awaited<ReturnType<typeof adapter.getCapabilityInventory>>) => inventory.capabilities.find((capability) => capability.capabilityId === "serena")!;
      expect(serena(ready)).toMatchObject({ isInstalled: true, isBlocked: false });
      expect(serena(unsupported)).toMatchObject({ isInstalled: false, isBlocked: true, diagnostics: expect.arrayContaining([expect.stringContaining("does not support")]) });
      expect(serena(missing)).toMatchObject({ isInstalled: false, isBlocked: false, diagnostics: expect.arrayContaining([expect.stringContaining("executable missing")]) });
      expect(serena(indeterminate)).toMatchObject({ isInstalled: false, isBlocked: true, diagnostics: expect.arrayContaining([expect.stringContaining("timed out")]) });
      expect(resolverCalls).toBe(4);
      expect(proxyCalls).toBe(3);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  test("official Supermemory plugin owns memory: Deck-runtime adaptive-memory prose is never materialized into roles or skills", async () => {
    const root = await mkdtemp(join(tmpdir(), "deck-codex-sm-plugin-guidance-"));
    try {
      await writeGitOrigin(root);
      const adapter = createCodexRunnerAdapter({ tools: testTools() });
      const callerBundle = {
        instructions: [
          { packageId: "adaptive-memory", surface: "agent", markdown: "No manual containerTag required", teamId: "developer-team" },
          { packageId: "adaptive-memory", surface: "skill", markdown: "stale q example supermemory_search_memory({ q, containerTag: \"sm_project_default\" })", teamId: "developer-team" },
          { packageId: "code-economy", surface: "agent", markdown: "caller-unrelated-marker", teamId: "developer-team" },
        ],
      } as const;
      for (const capabilityInstructions of [callerBundle, undefined]) {
        const plan = adapter.buildDeveloperTeamInstallPlan({
          projectRoot: root,
          environmentId: "codex-development",
          deckConfig: supermemoryDeckConfig(),
          memoryProvider: supermemoryProvider(),
          materializationScope: "content-only",
          ...(capabilityInstructions ? { capabilityInstructions } : {}),
        });
        expect(plan.blocked).toBe(false);
        for (const file of plan.files.filter((entry) => entry.kind === "agent" || entry.kind === "skill")) {
          expect(file.content, file.path).not.toContain("No manual containerTag required");
          expect(file.content, file.path).not.toContain("Runtime-managed recall and capture");
          expect(file.content, file.path).not.toContain("sm_project_default");
          expect(file.content, file.path).not.toContain("supermemory_search_memory");
        }
        if (capabilityInstructions) expect(plan.files.find((file) => file.path === ".codex/agents/deck-lead.toml")?.content).toContain("caller-unrelated-marker");
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

});
