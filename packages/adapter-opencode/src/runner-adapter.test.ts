import { describe, expect, test } from "bun:test";
import { chmodSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

import { createOpenCodeRunnerAdapter } from "./runner-adapter";
import type { OpenCodeToolsReview } from "./required-tools";
import { getStandaloneSkills } from "@deck/core/skills/external";
import { discoverSkillsFromProvider } from "../../core/src/skill-discovery/discovery";
import { getDefaultDeckConfig, type SerenaBootstrapEffects, type SerenaReadinessEvidence } from "@deck/core";

const FRONTEND_SKILL_IDS = [
  "ui-skills-root",
  "frontend-design",
  "baseline-ui",
  "fixing-accessibility",
  "fixing-motion-performance",
  "fixing-metadata",
  "web-quality-audit",
  "playwright-cli",
  "design-lab",
] as const;

function toolsReviewFor(toolId: "codebase-memory", installed: boolean): OpenCodeToolsReview {
  const ids = ["rtk", "context-mode", "codebase-memory", "context7", "serena"] as const;
  return {
    installedPackages: [],
    tools: ids.map((id) => ({ name: id === "rtk" ? "RTK" : id === "context7" ? "Context7" : id === "serena" ? "Serena" : id, installed: id === toolId && installed })),
    toolStatuses: [],
    evidence: Object.fromEntries(ids.map((id) => [id, {
      toolId: id,
      state: id === toolId && installed ? "usable" : "absent",
      source: id === toolId && installed ? "PATH" : "absent",
      reasonCodes: id === toolId && installed ? ["PATH-usable"] : ["no-evidence"],
    }])) as OpenCodeToolsReview["evidence"],
  };
}

describe("OpenCode package instruction boundary", () => {
  test("supports the canonical package metadata without treating baseline or capability IDs as toggles", () => {
    const adapter = createOpenCodeRunnerAdapter();
    expect(adapter.packageInstructionIds).toEqual(["codebase-memory", "code-economy", "context-mode", "rtk", "adaptive-memory", "serena"]);
    const inventory = { runnerId: "opencode", environmentId: "opencode-development", capabilities: [] } as any;
    const base = { runnerId: "opencode", environmentId: "opencode-development", selectedCapabilities: {}, adaptiveMemory: { provider: "none" } } as const;

    const enabled = adapter.buildReviewPlan({ ...base, packageInstructions: { "context-mode": true, serena: true, "code-economy": true, context7: true } } as any, inventory);
    expect(enabled.groups.configWrites).toContainEqual(expect.objectContaining({ id: "package-instructions.opencode.deck-config", kind: "write-deck-config" }));

    const baselineOnly = adapter.buildReviewPlan({ ...base, packageInstructions: { "code-economy": true, context7: true } } as any, inventory);
    expect(baselineOnly.groups.configWrites).not.toContainEqual(expect.objectContaining({ id: "package-instructions.opencode.deck-config" }));
    const installation = adapter.buildInstallationPlan({ ...base, packageInstructions: { serena: true }, selectedCapabilities: {} } as any);
    expect(installation.steps).not.toContainEqual(expect.objectContaining({ capabilityId: "serena" }));
  });
});

describe("OpenCode RunnerAdapter Supermemory readiness mapping", () => {
  test("forwards stored runtime credential readiness from generic dashboard state", () => {
    const adapter = createOpenCodeRunnerAdapter();
    const plan = adapter.buildReviewPlan({
      runnerId: "opencode",
      environmentId: "opencode-development",
      selectedCapabilities: {},
      explicitlySelectedCapabilities: {},
      packageInstructions: {},
      adaptiveMemory: { provider: "supermemory", supermemory: { configured: true, hasToken: false, runtimeCredentialStored: true, ephemeralTokenAvailable: false, mcpOAuthReady: false } },
    } as any, { runnerId: "opencode", environmentId: "opencode-development", capabilities: [] } as any);

    expect(plan.ready).toBe(true);
    expect(plan.groups.configWrites).toContainEqual(expect.objectContaining({ id: "adaptive-memory.supermemory.deck-config", status: "ready" }));
    expect(plan.groups.validations).toContainEqual(expect.objectContaining({ id: "adaptive-memory.supermemory.validate", status: "ready" }));
    expect(JSON.stringify(plan)).toContain("Deck runtime API credential is validated and stored");
  });

  test("does not treat optional MCP OAuth as Deck runtime credential readiness", () => {
    const adapter = createOpenCodeRunnerAdapter();
    const plan = adapter.buildReviewPlan({
      runnerId: "opencode",
      environmentId: "opencode-development",
      selectedCapabilities: {},
      explicitlySelectedCapabilities: {},
      packageInstructions: {},
      adaptiveMemory: { provider: "supermemory", supermemory: { configured: true, hasToken: false, runtimeCredentialStored: false, ephemeralTokenAvailable: false, mcpOAuthReady: true } },
    } as any, { runnerId: "opencode", environmentId: "opencode-development", capabilities: [] } as any);

    expect(plan.ready).toBe(false);
    expect(plan.groups.configWrites).toContainEqual(expect.objectContaining({ id: "adaptive-memory.supermemory.deck-config", status: "pending" }));
    expect(plan.groups.validations).toContainEqual(expect.objectContaining({ id: "adaptive-memory.supermemory.validate", status: "pending" }));
    expect(JSON.stringify(plan)).toContain("does not satisfy Deck runtime readiness");
  });

  test("synthetic Supermemory MCP write without an explicit config dir does not touch a real-like OpenCode config", async () => {
    const root = await mkdtemp(join(tmpdir(), "deck-opencode-real-like-home-"));
    const previousHome = process.env.HOME;
    const configDir = join(root, ".config", "opencode");
    const configPath = join(configDir, "opencode.json");
    try {
      await mkdir(configDir, { recursive: true });
      const content = JSON.stringify({
        mcp: {
          context7: { type: "local", enabled: true, command: ["npx", "-y", "@upstash/context7-mcp"] },
        },
      }, null, 2);
      writeFileSync(configPath, content, { encoding: "utf-8", mode: 0o600 });
      chmodSync(configPath, 0o600);
      const old = new Date("2026-01-01T00:00:00.000Z");
      utimesSync(configPath, old, old);
      const before = statSync(configPath);
      process.env.HOME = root;

      const adapter = createOpenCodeRunnerAdapter();
      const result = await adapter.writeMcpConfig?.({ serverName: "supermemory", projectRoot: root });
      const after = statSync(configPath);

      expect(result).toMatchObject({ ok: true });
      expect((result?.diagnostics ?? []).join(" ")).toContain("absent-safe");
      expect(await readFile(configPath, "utf-8")).toBe(content);
      expect(after.size).toBe(before.size);
      expect(after.mtimeMs).toBe(before.mtimeMs);
      expect(after.mode & 0o777).toBe(before.mode & 0o777);
    } finally {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("OpenCode RunnerAdapter developer team install plan", () => {
  test("includes complete standalone external skills by default", () => {
    const adapter = createOpenCodeRunnerAdapter();
    const plan = adapter.buildDeveloperTeamInstallPlan({
      projectRoot: "/tmp/deck-opencode-runner-adapter-test",
      environmentId: "opencode-development",
      deckConfig: getDefaultDeckConfig(),
    });

    const standaloneFiles = plan.files.filter((file) => file.kind === "standalone-skill");
    const installedSkillIds = new Set(standaloneFiles.map((file) => file.skillId));

    expect(installedSkillIds.size).toBe(getStandaloneSkills().length + 2);
    expect(installedSkillIds).toContain("deck-onboard");
    expect(installedSkillIds).toContain("deck-archive");
    for (const skillId of FRONTEND_SKILL_IDS) {
      expect(installedSkillIds).toContain(skillId);
      expect(standaloneFiles).toContainEqual(expect.objectContaining({
        kind: "standalone-skill",
        skillId,
        packagePath: "SKILL.md",
        path: `skills/${skillId}/SKILL.md`,
      }));
    }

    expect(standaloneFiles).toContainEqual(expect.objectContaining({
      skillId: "web-quality-audit",
      packagePath: "scripts/analyze.sh",
      path: "skills/web-quality-audit/scripts/analyze.sh",
    }));
    expect(standaloneFiles).toContainEqual(expect.objectContaining({
      skillId: "playwright-cli",
      packagePath: "references/tracing.md",
      path: "skills/playwright-cli/references/tracing.md",
    }));
    expect(standaloneFiles).toContainEqual(expect.objectContaining({
      skillId: "design-lab",
      packagePath: "DESIGN_PRINCIPLES.md",
      path: "skills/design-lab/DESIGN_PRINCIPLES.md",
    }));
  });

  test("uses verified Runtime-owned Supermemory scope in the generic install adapter path", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "deck-opencode-scope-"));
    try {
      execFileSync("git", ["init"], { cwd: projectRoot, stdio: "ignore" });
      execFileSync("git", ["remote", "add", "origin", "https://github.com/kevin15011/deck.git"], { cwd: projectRoot, stdio: "ignore" });
      const configDir = join(projectRoot, "opencode-config");
      await mkdir(configDir, { recursive: true });
      const adapter = createOpenCodeRunnerAdapter({ developerTeamConfigDir: configDir });

      const plan = adapter.buildDeveloperTeamInstallPlan({
        projectRoot,
        environmentId: "opencode-development",
        deckConfig: getDefaultDeckConfig(),
        capabilityInstructions: {
          instructions: [{ packageId: "adaptive-memory", surface: "agent", markdown: "stale unscoped memory", teamId: "developer-team" }],
        },
      });
      const text = plan.files.map((file) => file.content).join("\n");

      expect(text).toContain("Runtime-managed recall and capture bind project scope server-side");
      expect(text).toContain("schemas permit model-selected project scope");
      expect(text).not.toContain('containerTag: "sm_project_v1_kevin15011_deck"');
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  test("attaches active OpenCode source declarations without Pi roots", async () => {
    const adapter = createOpenCodeRunnerAdapter();
    const provider = adapter.skillDiscovery;

    expect(provider?.runnerId).toBe("opencode");
    const result = await provider!.listSources({ projectRoot: "/tmp/project" });
    const sourceIds = result.sources.map((source) => source.declaration.sourceId);

    expect(sourceIds).toEqual(["opencode-config-skills", "opencode-legacy-skills"]);
    expect(sourceIds).not.toContain("pi-project-skills");
    expect(JSON.stringify(result)).not.toContain("/.config/opencode/");
  });

  test("composes Core generic roots with OpenCode sources and excludes Pi roots", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "deck-opencode-composition-"));
    const configDir = join(projectRoot, "opencode-config");
    try {
      await mkdir(join(projectRoot, ".agents", "skills", "generic"), { recursive: true });
      await mkdir(join(projectRoot, ".skills", "generic"), { recursive: true });
      await mkdir(join(projectRoot, ".pi", "skills", "pi-only"), { recursive: true });
      await mkdir(join(configDir, "skills", "opencode-only"), { recursive: true });
      await writeFile(join(projectRoot, ".agents", "skills", "generic", "SKILL.md"), "---\nname: generic-agents\n---\n");
      await writeFile(join(projectRoot, ".skills", "generic", "SKILL.md"), "---\nname: generic-skills\n---\n");
      await writeFile(join(projectRoot, ".pi", "skills", "pi-only", "SKILL.md"), "---\nname: pi-only\n---\n");
      await writeFile(join(configDir, "skills", "opencode-only", "SKILL.md"), "---\nname: opencode-only\n---\n");

      const adapter = createOpenCodeRunnerAdapter({
        developerTeamConfigDir: configDir,
        skillDiscoveryHomeDir: join(projectRoot, "home"),
      });
      const result = await discoverSkillsFromProvider({
        projectRoot,
        activeRunnerId: "opencode",
        provider: adapter.skillDiscovery!,
      });

      expect(result.outcome).toBe("complete");
      expect(result.observations.map((observation) => observation.name)).toEqual([
        "generic-agents",
        "generic-skills",
        "opencode-only",
      ]);
      expect(result.observations.some((observation) => observation.name === "pi-only")).toBe(false);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  test("reports an absent configured root as a complete empty source", async () => {
    const configDir = await mkdtemp(join(tmpdir(), "deck-opencode-discovery-"));
    try {
      const adapter = createOpenCodeRunnerAdapter({ developerTeamConfigDir: configDir });
      const result = await adapter.skillDiscovery!.listSources({ projectRoot: "/tmp/project" });

      expect(result.outcome).toBe("complete");
      expect(result.sources).toContainEqual(expect.objectContaining({
        kind: "filesystem",
        declaration: expect.objectContaining({ sourceId: "opencode-config-skills" }),
      }));
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  });

  test("reports an unreadable source root as indeterminate", async () => {
    const configDir = await mkdtemp(join(tmpdir(), "deck-opencode-discovery-"));
    await writeFile(join(configDir, "skills"), "not a directory");
    try {
      const adapter = createOpenCodeRunnerAdapter({ developerTeamConfigDir: configDir });
      const result = await adapter.skillDiscovery!.listSources({ projectRoot: "/tmp/project" });

      expect(result).toMatchObject({
        outcome: "indeterminate",
        reasonCode: "partial_source_evaluation",
      });
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  });

  test("bounds opaque inventory results and rejects unsafe opaque IDs", async () => {
    const adapter = createOpenCodeRunnerAdapter({
      skillInventoryDiscovery: async () => ({
        outcome: "complete" as const,
        observations: [
          { opaqueId: "safe-id", name: "Safe skill" },
          { opaqueId: "../../etc/passwd", name: "Unsafe skill" },
        ],
        diagnostics: [],
      }),
    });
    const result = await adapter.skillDiscovery!.listSources({ projectRoot: "/tmp/project" });
    const inventorySource = result.sources.find((source) => source.kind === "opaque_inventory");

    expect(result.outcome).toBe("complete");
    expect(inventorySource).toBeDefined();
    const inventory = await inventorySource!.readInventory();
    expect(inventory).toMatchObject({
      outcome: "complete",
      observations: [{ opaqueId: "safe-id" }],
    });
    const rejected = await adapter.skillDiscovery!.resolveLocator({
      projectRoot: "/tmp/project",
      locator: "runner:opencode:opencode-inventory/%2e%2e%2fsecret",
    });
    expect(rejected.status).toBe("rejected");

    const oversized = createOpenCodeRunnerAdapter({
      skillInventoryDiscovery: async () => ({
        outcome: "complete" as const,
        observations: Array.from({ length: 501 }, (_, index) => ({
          opaqueId: `skill-${index}`,
          name: `Skill ${index}`,
        })),
        diagnostics: [],
      }),
    });
    const oversizedResult = await oversized.skillDiscovery!.listSources({ projectRoot: "/tmp/project" });
    const oversizedInventory = oversizedResult.sources.find((source) => source.kind === "opaque_inventory");
    expect(oversizedResult.outcome).toBe("indeterminate");
    expect((await oversizedInventory!.readInventory()).outcome).toBe("indeterminate");
  });

  test("rechecks opaque exposure after discovery before resolving", async () => {
    let exposed = true;
    let inventoryReads = 0;
    const adapter = createOpenCodeRunnerAdapter({
      skillInventoryDiscovery: async () => {
        inventoryReads += 1;
        return {
          outcome: "complete" as const,
          observations: exposed ? [{ opaqueId: "ephemeral-id", name: "Ephemeral skill" }] : [],
          diagnostics: [],
        };
      },
    });
    const provider = adapter.skillDiscovery!;
    const discovery = await provider.listSources({ projectRoot: "/tmp/project" });
    const inventorySource = discovery.sources.find((source) => source.kind === "opaque_inventory");

    expect(inventorySource).toBeDefined();
    expect(await inventorySource!.readInventory()).toMatchObject({
      outcome: "complete",
      observations: [{ opaqueId: "ephemeral-id" }],
    });

    const present = await provider.resolveLocator({
      projectRoot: "/tmp/project",
      locator: "runner:opencode:opencode-inventory/ephemeral-id",
    });
    expect(present).toEqual({ status: "available", loadReference: "ephemeral-id" });

    exposed = false;
    const removed = await provider.resolveLocator({
      projectRoot: "/tmp/project",
      locator: "runner:opencode:opencode-inventory/ephemeral-id",
    });

    expect(removed).toEqual({ status: "missing" });
    expect(inventoryReads).toBe(3);
  });

  test("resolves available, missing, and rejected OpenCode locators", async () => {
    const root = await mkdtemp(join(tmpdir(), "deck-opencode-discovery-"));
    const configDir = join(root, ".config", "opencode");
    const skillDir = join(configDir, "skills", "fixture");
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "---\nname: fixture\n---\n");
    try {
      const adapter = createOpenCodeRunnerAdapter({ developerTeamConfigDir: configDir });
      const provider = adapter.skillDiscovery!;
      const available = await provider.resolveLocator({
        projectRoot: root,
        locator: "runner:opencode:opencode-config-skills/fixture/SKILL.md",
      });
      const missing = await provider.resolveLocator({
        projectRoot: root,
        locator: "runner:opencode:opencode-config-skills/missing/SKILL.md",
      });
      const rejected = await provider.resolveLocator({
        projectRoot: root,
        locator: "runner:opencode:opencode-config-skills/../../etc/passwd",
      });

      expect(available.status).toBe("available");
      expect(missing).toEqual({ status: "missing" });
      expect(rejected.status).toBe("rejected");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("passes RunnerActionContext.projectRoot into direct inventory review", async () => {
    const projectRoots: string[] = [];
    const adapter = createOpenCodeRunnerAdapter({
      toolsReview: (context: { projectRoot: string }) => {
        projectRoots.push(context.projectRoot);
        return toolsReviewFor("codebase-memory", true);
      },
    } as never);

    await adapter.getCapabilityInventory({
      projectRoot: "/tmp/t4-project",
      runnerId: "opencode",
      environmentId: "opencode-development",
      deckConfig: getDefaultDeckConfig(),
    });

    expect(projectRoots).toEqual(["/tmp/t4-project"]);
  });

  test("maps an already-present direct action to satisfied skipped without raw streams", async () => {
    const adapter = createOpenCodeRunnerAdapter({
      toolsReview: () => toolsReviewFor("codebase-memory", true),
      installTools: async () => { throw new Error("installer must not run"); },
    } as never);
    const action = {
      id: "capability.codebase-memory.install",
      kind: "install-opencode-plugin",
      title: "Install codebase-memory",
      capabilityId: "codebase-memory",
      toolId: "codebase-memory",
      status: "ready" as const,
    };

    const result = await adapter.runAction(action, {
      projectRoot: "/tmp/t4-project",
      runnerId: "opencode",
      environmentId: "opencode-development",
    });

    expect(result.status).toBe("skipped");
    expect(result.message).toContain("already present");
    expect(result.raw).toMatchObject({ outcome: "already-present" });
    expect(JSON.stringify(result)).not.toContain("stdout");
    expect(JSON.stringify(result)).not.toContain("stderr");
  });

  test("maps an injected package failure to failed without exposing raw streams", async () => {
    const adapter = createOpenCodeRunnerAdapter({
      toolsReview: () => toolsReviewFor("codebase-memory", false),
      installTools: async () => [{
        toolId: "codebase-memory",
        tool: "codebase-memory",
        outcome: "failed" as const,
        success: false as const,
        installerInvoked: true,
        message: "codebase-memory installation failed.",
        cause: "Install failed (ETXTBSY).",
        diagnostic: { stage: "install" as const, code: "installer-failed", exitCode: 1, lines: ["Install failed (ETXTBSY)."] },
        raw: { stage: "install" as const, exitCode: 1, stdout: "secret stdout", stderr: "secret stderr", stdoutTruncated: false, stderrTruncated: false, stdoutBytes: 13, stderrBytes: 13 },
      }],
    } as never);
    const action = {
      id: "capability.codebase-memory.install",
      kind: "install-opencode-plugin",
      title: "Install codebase-memory",
      capabilityId: "codebase-memory",
      toolId: "codebase-memory",
      status: "ready" as const,
    };

    const result = await adapter.runAction(action, {
      projectRoot: "/tmp/t4-project",
      runnerId: "opencode",
      environmentId: "opencode-development",
    });

    expect(result.status).toBe("failed");
    expect(result.message).toContain("failed");
    expect(result.raw).toMatchObject({ outcome: "failed" });
    expect(JSON.stringify(result)).not.toContain("secret stdout");
    expect(JSON.stringify(result)).not.toContain("secret stderr");
  });
});

describe("OpenCode Serena evidence handoff", () => {
  const ownedRoot = "/fixtures/deck-data/tools/serena";
  const executable = `${ownedRoot}/bin/serena`;
  const evidence: SerenaReadinessEvidence = {
    capabilityId: "serena",
    state: "ready",
    resolvedExecutablePath: executable,
    source: "installed-deck-tool",
    probe: "serena-help",
    fingerprint: "serena-fingerprint",
  };
  const operation = {
    runner: "opencode" as const,
    operationId: "operation-1",
    explicitlySelected: true,
  };
  const authorization = {
    kind: "interactive-tui-explicit-selection" as const,
    runner: "opencode" as const,
    operationId: operation.operationId,
  };
  const installAction = {
    id: "capability.serena.install",
    kind: "install-opencode-plugin",
    title: "Install Serena",
    capabilityId: "serena",
    toolId: "serena",
    source: "serena-agent",
    status: "ready" as const,
  };
  const configAction = {
    id: "capability.serena.mcp-config",
    kind: "write-mcp-config",
    title: "Configure Serena MCP",
    capabilityId: "serena",
    toolId: "serena",
    source: "serena-agent",
    status: "ready" as const,
  };

  function context(overrides: Record<string, unknown> = {}): any {
    return {
      projectRoot: "/project",
      runnerId: "opencode",
      environmentId: "opencode-development",
      operation,
      currentOperation: operation,
      serenaAuthorization: authorization,
      ...overrides,
    };
  }

  test("composes the Serena owned root and revalidator when production options omit them", async () => {
    const writerInputs: unknown[] = [];
    const effects: SerenaBootstrapEffects = {
      resolveDeckDataRoot: () => "/fixtures/deck-data",
      canonicalizePath: (path) => path,
      isUserOwnedPath: () => true,
      ensureDirectory: () => undefined,
      inspectPath: (path) => ({ state: "ready", resolvedPath: path, fingerprint: evidence.fingerprint }),
      fetchInstaller: async () => ({ status: 500, body: new Uint8Array() }),
      spawn: async () => { throw new Error("not expected"); },
      supportsControlledBootstrap: () => true,
      probeExecutable: (request) => ({
        state: "ready",
        resolvedPath: request.executablePath,
        fingerprint: evidence.fingerprint,
      }),
    };
    const adapter = createOpenCodeRunnerAdapter({
      serenaBootstrapEffects: effects,
      installTools: async () => [{
        toolId: "serena",
        tool: "Serena",
        outcome: "executed",
        success: true,
        installerInvoked: true,
        message: "Serena installation completed.",
        serenaBootstrapOutcome: "installed",
        serenaReadiness: evidence,
      }] as never,
      serenaMcpWriter: (input: unknown) => {
        writerInputs.push(input);
        return { ok: true as const, status: "created" as const };
      },
    } as never);

    const installResult = await adapter.runAction(installAction, context());
    const configResult = await adapter.runAction(configAction, context());

    expect(installResult.status).toBe("executed");
    expect(configResult.status).toBe("executed");
    expect(writerInputs).toHaveLength(1);
  });

  test("runs plan install, retains private evidence, revalidates, and writes once", async () => {
    const writerInputs: unknown[] = [];
    const installCalls: unknown[] = [];
    const adapter = createOpenCodeRunnerAdapter({
      installTools: async (...args: unknown[]) => {
        installCalls.push(args);
        return [{
          toolId: "serena",
          tool: "Serena",
          outcome: "executed",
          success: true,
          installerInvoked: true,
          message: "Serena installation completed.",
          serenaBootstrapOutcome: "installed",
          serenaReadiness: evidence,
        }] as never;
      },
      serenaOwnedRoot: ownedRoot,
      serenaRevalidator: async (received: SerenaReadinessEvidence) => ({ valid: true as const, evidence: received }),
      serenaMcpWriter: (input: unknown) => {
        writerInputs.push(input);
        return { ok: true as const, status: "created" as const };
      },
    } as never);

    const installResult = await adapter.runAction(installAction, context());
    const configResult = await adapter.runAction(configAction, context());

    expect(installResult.status).toBe("executed");
    expect(installResult.raw).not.toHaveProperty("serenaReadiness");
    expect(installCalls).toHaveLength(1);
    expect(configResult).toMatchObject({ actionId: configAction.id, status: "executed" });
    expect(writerInputs).toHaveLength(1);
    expect(writerInputs[0]).toMatchObject({
      authorization,
      operation,
      readiness: evidence,
      command: executable,
      args: ["start-mcp-server", "--context", "ide", "--project-from-cwd"],
    });
  });

  test("never calls the writer for missing authorization, failed install, cancellation, invalid evidence, or stale revalidation", async () => {
    const writerCalls: unknown[] = [];
    const scenarios: Array<{ name: string; installResult?: unknown; context?: Record<string, unknown>; revalidator?: (value: SerenaReadinessEvidence) => unknown }> = [
      { name: "missing authorization", context: { serenaAuthorization: undefined } },
      {
        name: "failed install",
        installResult: [{ toolId: "serena", tool: "Serena", outcome: "failed", success: false, installerInvoked: true, message: "failed", serenaBootstrapOutcome: "failed" }],
      },
      {
        name: "cancelled operation",
        installResult: [{ toolId: "serena", tool: "Serena", outcome: "skipped", success: false, installerInvoked: false, message: "cancelled", serenaBootstrapOutcome: "cancelled" }],
        context: (() => { const controller = new AbortController(); controller.abort(); return { signal: controller.signal }; })(),
      },
      {
        name: "invalid evidence",
        installResult: [{ toolId: "serena", tool: "Serena", outcome: "executed", success: true, installerInvoked: true, message: "installed", serenaBootstrapOutcome: "installed", serenaReadiness: { ...evidence, resolvedExecutablePath: "serena" } }],
      },
      {
        name: "stale revalidation",
        revalidator: async () => ({ valid: false as const, code: "stale-readiness-evidence" as const, diagnostic: { code: "stale", message: "stale" } }),
      },
    ];

    for (const scenario of scenarios) {
      const adapter = createOpenCodeRunnerAdapter({
        installTools: async () => (scenario.installResult ?? []) as never,
        serenaOwnedRoot: ownedRoot,
        serenaRevalidator: scenario.revalidator ?? (async (received: SerenaReadinessEvidence) => ({ valid: true as const, evidence: received })),
        serenaMcpWriter: (input: unknown) => {
          writerCalls.push({ scenario: scenario.name, input });
          return { ok: true as const, status: "created" as const };
        },
      } as never);

      const installResult = await adapter.runAction(installAction, context(scenario.context));
      const configResult = await adapter.runAction(configAction, context(scenario.context));

      expect(configResult.status, scenario.name).not.toBe("executed");
      expect(installResult.status === "executed" && scenario.name === "missing authorization").toBe(false);
    }

    expect(writerCalls).toHaveLength(0);
  });

  test("does not use a bare PATH Serena gate for a direct Serena action", async () => {
    let installerCalled = false;
    const adapter = createOpenCodeRunnerAdapter({
      toolsReview: () => { throw new Error("PATH inventory must not authorize Serena"); },
      serenaOwnedRoot: ownedRoot,
      installTools: async () => {
        installerCalled = true;
        return [{
          toolId: "serena",
          tool: "Serena",
          outcome: "already-present",
          success: true,
          installerInvoked: false,
          message: "Serena reused.",
          serenaBootstrapOutcome: "reused",
          serenaReadiness: evidence,
        }] as never;
      },
    } as never);

    const result = await adapter.runAction(installAction, context());

    expect(result.status).toBe("skipped");
    expect(installerCalled).toBe(true);
  });

  test("reuses Serena and replaces a legacy bare OpenCode command through one adapter flow", async () => {
    const directory = await mkdtemp(join(tmpdir(), "deck-opencode-serena-"));
    const operationRoot = join(directory, "deck-data", "tools", "serena");
    const operationExecutable = join(operationRoot, "bin", "serena");
    const configPath = join(directory, "opencode.json");
    const operationEvidence: SerenaReadinessEvidence = {
      ...evidence,
      resolvedExecutablePath: operationExecutable,
    };

    try {
      await mkdir(join(operationRoot, "bin"), { recursive: true });
      await writeFile(configPath, JSON.stringify({
        mcp: {
          unrelated: { type: "remote", url: "https://example.test/mcp" },
          serena: {
            type: "local",
            enabled: true,
            command: ["serena", "start-mcp-server", "--context", "ide", "--project-from-cwd"],
          },
        },
      }));

      const adapter = createOpenCodeRunnerAdapter({
        serenaOwnedRoot: operationRoot,
        serenaConfigPath: configPath,
        serenaRevalidator: async (received: SerenaReadinessEvidence) => ({ valid: true as const, evidence: received }),
        installTools: async () => [{
          toolId: "serena",
          tool: "Serena",
          outcome: "already-present",
          success: true,
          installerInvoked: false,
          message: "Serena reused.",
          serenaBootstrapOutcome: "reused",
          serenaReadiness: operationEvidence,
        }] as never,
      } as never);

      const installResult = await adapter.runAction(installAction, context());
      const configResult = await adapter.runAction(configAction, context());
      const written = JSON.parse(await readFile(configPath, "utf8"));

      expect(installResult.status).toBe("skipped");
      expect(configResult.status).toBe("executed");
      expect(written.mcp.serena.command).toEqual([
        operationExecutable,
        "start-mcp-server",
        "--context",
        "ide",
        "--project-from-cwd",
      ]);
      expect(written.mcp.unrelated).toEqual({ type: "remote", url: "https://example.test/mcp" });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("does not put default or package-instruction Serena into the generic install plan", () => {
    const adapter = createOpenCodeRunnerAdapter({
      toolsReview: () => toolsReviewFor("codebase-memory", false),
    } as never);
    const state = {
      runnerId: "opencode",
      environmentId: "opencode-development",
      selectedCapabilities: { serena: true },
      packageInstructions: { opencode: { serena: true } },
      adaptiveMemory: { provider: "none" },
    };

    const plan = adapter.buildInstallationPlan(state as never);

    expect(plan.steps.some((step) => step.capabilityId === "serena")).toBe(false);
  });
});
