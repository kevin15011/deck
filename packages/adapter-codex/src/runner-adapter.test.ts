import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createCodexRunnerAdapter } from "./runner-adapter";
import { createNodeCodexFileEffects } from "./node-effects";
import { CURRENT_CODEX_MODELS_FIXTURE } from "./__fixtures__/codex/models";
import { parseCodexModels } from "./codex-model-discovery";
import { DEVELOPER_TEAM_AGENTS } from "@deck/core/developer-team-catalog";

setDefaultTimeout(30_000);

describe("Codex RunnerAdapter production composition", () => {
  test("keeps package instructions separate from capability selection and installation", () => {
    const adapter = createCodexRunnerAdapter();
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
      const adapter = createCodexRunnerAdapter({
        journalRoot,
        preflight: {
          probe: async () => ({ found: true, version: "0.145.0", help: "Usage: codex\nexec\nresume", execHelp: "Usage: codex exec", resumeHelp: "Usage: codex resume [SESSION_ID]" }),
          inspectTrust: async () => "trusted",
        },
        sharedBinaryUsability: async (command) => ({ command, status: "ready", resolvedPath: `/bin/${command}`, diagnostics: [] }),
        codebaseIndexReadiness: () => true,
        supermemoryOAuthStatus: async () => ({ state: "not-authenticated" }),
      });
      const protectedIds = ["trusted-runner-host-bridge", "invocation-authorization", "execution-dossier", "controlled-effects", "registry-coordination", "bound-verification"];
      expect(adapter.getCapabilityIds()).toEqual(expect.arrayContaining([...protectedIds, "engram", "pi-hud", "opencode-mermaid-renderer", "deck-model-variants"]));
      for (const capabilityId of protectedIds) expect(adapter.getCapability(capabilityId)).toMatchObject({ capabilityId, status: "gap", requirementLevel: "required" });
      expect(adapter.getCapability("pi-hud")).toMatchObject({ supportStatus: "not-applicable" });
      expect(adapter.getCapability("opencode-mermaid-renderer")).toMatchObject({ supportStatus: "not-applicable" });

      const inventory = await adapter.getCapabilityInventory({ projectRoot, environmentId: "codex-development", runnerId: "codex" });
      for (const capabilityId of protectedIds) expect(inventory.capabilities).toContainEqual(expect.objectContaining({ capabilityId, isBlocked: true, requirementLevel: "required" }));
      expect(inventory.capabilities).toContainEqual(expect.objectContaining({ capabilityId: "engram", isBlocked: true }));
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

      const doctor = await adapter.diagnoseProject?.(projectRoot);
      for (const capabilityId of protectedIds) {
        const label = capabilityId.split("-").map((part) => `${part[0]!.toUpperCase()}${part.slice(1)}`).join(" ");
        expect(doctor).toContainEqual(expect.objectContaining({ category: `Capability: ${label}`, status: "error" }));
      }
      expect(doctor).toContainEqual(expect.objectContaining({ category: "Capability: Pi HUD", status: "warning", message: "Not applicable to codex." }));
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
      await rm(journalRoot, { recursive: true, force: true });
    }
  });

  test("normalizes none, Supermemory, and explicit Engram-gap review flows", () => {
    const adapter = createCodexRunnerAdapter();
    const inventory = { runnerId: "codex", environmentId: "codex-development", capabilities: [{ capabilityId: "supermemory-tool-bindings", label: "Supermemory", description: "memory", section: "memory", requirementLevel: "optional", installKind: "runner-native", isInstalled: false, isBlocked: false }] } as const;
    const state = (provider: "none" | "supermemory" | "engram") => ({ runnerId: "codex", environmentId: "codex-development", selectedCapabilities: {}, packageInstructions: {}, adaptiveMemory: { provider } }) as const;
    expect(adapter.buildReviewPlan(state("none"), inventory)).toMatchObject({ ready: true });
    const supermemoryReview = adapter.buildReviewPlan(state("supermemory"), inventory);
    expect(supermemoryReview.groups.configWrites).toContainEqual(expect.objectContaining({ capabilityId: "supermemory-tool-bindings" }));
    expect(supermemoryReview.groups.manualSteps).not.toContainEqual(expect.objectContaining({
      capabilityId: "supermemory-tool-bindings",
    }));
    expect(supermemoryReview.diagnostics).not.toContainEqual(expect.objectContaining({
      code: "codex-supermemory-user-authorization",
    }));
    expect(adapter.buildReviewPlan(state("engram"), inventory)).toMatchObject({
      ready: false,
      groups: { manualSteps: [expect.objectContaining({ capabilityId: "engram", status: "blocked" })] },
      diagnostics: [expect.objectContaining({ severity: "error", message: expect.stringContaining("Engram Codex integration is deferred") })],
    });
  });
  test("gates launch modes from inspected installed Codex help evidence", async () => {
    const adapter = createCodexRunnerAdapter({
      preflight: {
        probe: async () => ({ found: true, version: "0.145.0", help: "Usage: codex [OPTIONS]\nexec\nresume", execHelp: "Usage: codex exec [OPTIONS]", resumeHelp: "Usage: codex resume [SESSION_ID]" }),
        inspectTrust: async () => "trusted",
      },
    });
    await adapter.inspectProject?.("/tmp/codex-feature-gate");
    expect(await adapter.buildLaunchPlan?.({ projectRoot: "/tmp/codex-feature-gate", teamId: "developer-team", mode: "resume-latest" })).toMatchObject({
      status: "unsupported",
      code: "codex-resume-latest-unsupported",
    });
  });

  test("materializes and verifies the reviewed plan inside injected temp roots", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "deck-codex-project-"));
    const journalRoot = await mkdtemp(join(tmpdir(), "deck-codex-journal-"));
    try {
      const adapter = createCodexRunnerAdapter({ journalRoot });
      const plan = adapter.buildDeveloperTeamInstallPlan({ projectRoot, environmentId: "codex-development" });
      expect(plan.files.length).toBeGreaterThan(40);
      expect(plan.diagnostics).toContainEqual(expect.stringContaining("renameat2/openat"));
      const result = await adapter.applyDeveloperTeamInstall({ projectRoot, environmentId: "codex-development", plan });
      expect(result.changedCount).toBe(plan.files.length);
      expect((await adapter.verifyDeveloperTeamInstall(plan)).valid).toBe(true);
      expect(await readFile(join(projectRoot, ".codex", "agents", "deck-lead.toml"), "utf8")).toContain("deck-codex-v1");
      expect(await readFile(join(projectRoot, "AGENTS.md"), "utf8")).toContain("static-compatible");
      await chmod(join(projectRoot, ".codex", "agents", "deck-lead.toml"), 0o600);
      expect(await adapter.verifyDeveloperTeamInstall(plan)).toMatchObject({ valid: false, diagnostics: [expect.stringContaining("Mode drifted")] });
      await chmod(join(projectRoot, ".codex", "agents", "deck-lead.toml"), 0o644);

      const unchangedPlan = adapter.buildDeveloperTeamInstallPlan({ projectRoot, environmentId: "codex-development" });
      expect(unchangedPlan.files).toHaveLength(0);
      await Bun.write(join(projectRoot, ".agents", "skills", "idea-refine", "examples.md"), "tampered");
      expect((await adapter.verifyDeveloperTeamInstall(unchangedPlan)).valid).toBe(false);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
      await rm(journalRoot, { recursive: true, force: true });
    }
  });

  test("does not follow ownership-manifest paths through project symlinks", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "deck-codex-manifest-project-"));
    const externalRoot = await mkdtemp(join(tmpdir(), "deck-codex-manifest-external-"));
    try {
      const secret = "outside-project";
      await writeFile(join(externalRoot, "secret.txt"), secret);
      await mkdir(join(projectRoot, ".codex"), { recursive: true });
      await symlink(externalRoot, join(projectRoot, "escape"), "dir");
      await writeFile(join(projectRoot, ".codex", "deck-manifest.json"), `${JSON.stringify({
        version: 1,
        files: { "escape/secret.txt": createHash("sha256").update(secret).digest("hex") },
      })}\n`);

      const adapter = createCodexRunnerAdapter();
      const detected = await adapter.detectDeckInstall?.({ projectRoot });
      expect(detected?.managedPaths).toEqual([join(projectRoot, ".codex", "deck-manifest.json")]);
      expect(detected?.diagnostics).toContainEqual(expect.stringContaining("unsafe managed path"));

      const plan = adapter.buildDeveloperTeamInstallPlan({ projectRoot, environmentId: "codex-development" });
      expect(plan.files).not.toContainEqual(expect.objectContaining({ path: "escape/secret.txt" }));
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
      await rm(externalRoot, { recursive: true, force: true });
    }
  });

  test("allows plain launch after fresh materialization when Codex trust is indeterminate", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "deck-codex-untrusted-project-"));
    const journalRoot = await mkdtemp(join(tmpdir(), "deck-codex-untrusted-journal-"));
    try {
      const adapter = createCodexRunnerAdapter({
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
      const plan = adapter.buildDeveloperTeamInstallPlan({ projectRoot, environmentId: "codex-development" });
      await adapter.applyDeveloperTeamInstall({ projectRoot, environmentId: "codex-development", plan });

      const launch = await adapter.buildLaunchPlan?.({ projectRoot, teamId: "developer-team", mode: "interactive" });
      expect(launch?.status).toBe("ready");
      expect(launch?.diagnostics).toContainEqual(expect.objectContaining({ code: "materialized-but-inactive", severity: "warning" }));
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
      await rm(journalRoot, { recursive: true, force: true });
    }
  });

  test("keeps every default production route static-compatible when no released host binding exists", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "deck-codex-unbound-project-"));
    const journalRoot = await mkdtemp(join(tmpdir(), "deck-codex-unbound-journal-"));
    try {
      const adapter = createCodexRunnerAdapter({
        journalRoot,
        preflight: {
          probe: async () => ({ found: true, version: "0.146.1", help: "Usage: codex [OPTIONS]\nexec\nresume", execHelp: "Usage: codex exec [OPTIONS]", resumeHelp: "Usage: codex resume [SESSION_ID] --last" }),
          inspectTrust: async () => "trusted",
          readProject: async (root) => ({ config: await readFile(join(root, ".codex", "config.toml"), "utf8").catch(() => null), roles: [], skills: [], agentsInstructions: true }),
        },
      });
      const plan = adapter.buildDeveloperTeamInstallPlan({ projectRoot, environmentId: "codex-development" });
      await adapter.applyDeveloperTeamInstall({ projectRoot, environmentId: "codex-development", plan });
      expect(await Bun.file(join(projectRoot, ".codex", "hooks", "developer-team-execution.js")).exists()).toBe(false);
      expect(await readFile(join(projectRoot, ".codex", "config.toml"), "utf8")).not.toContain("deck-codex-hook-v1");

      const launches = await Promise.all([
        adapter.buildLaunchPlan?.({ projectRoot, teamId: "developer-team", mode: "interactive" }),
        adapter.buildLaunchPlan?.({ projectRoot, teamId: "developer-team", mode: "exec", prompt: [], stdin: "closed" }),
        adapter.buildLaunchPlan?.({ projectRoot, teamId: "developer-team", mode: "resume-by-id", sessionId: "session-1" }),
        adapter.buildLaunchPlan?.({ projectRoot, teamId: "developer-team", mode: "resume-latest" }),
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
      const adapter = createCodexRunnerAdapter({
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
      const plan = adapter.buildDeveloperTeamInstallPlan({ projectRoot, environmentId: "codex-development" });
      await adapter.applyDeveloperTeamInstall({ projectRoot, environmentId: "codex-development", plan });
      expect(await Bun.file(join(projectRoot, ".codex", "hooks", "developer-team-execution.js")).exists()).toBe(false);

      const interactive = await adapter.buildLaunchPlan?.({ projectRoot, teamId: "developer-team", mode: "interactive" });
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
      const adapter = createCodexRunnerAdapter({
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
      const adapter = createCodexRunnerAdapter({
        journalRoot,
        inventoryDiscovery: async () => ({ state: "ready", source: "live", discoveredAt: 1, fingerprint: "current-codex", inventory: parsed.inventory }),
      });
      await adapter.getModelInventory?.({ projectRoot, mode: "rescan" });
      const modelAssignments = Object.fromEntries(DEVELOPER_TEAM_AGENTS.map((agent) => [agent.id, "openai-codex/gpt-5.6-terra"]));
      const thinkingAssignments = Object.fromEntries(DEVELOPER_TEAM_AGENTS.map((agent) => [agent.id, "ultra"]));
      const plan = adapter.buildDeveloperTeamInstallPlan({
        projectRoot,
        environmentId: "codex-development",
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
      const adapter = createCodexRunnerAdapter({ journalRoot });

      expect(adapter.readModelAssignments(projectRoot)).toEqual({ "deck-lead": "openai-codex/gpt-5.6-sol" });
      expect(adapter.readThinkingAssignments(projectRoot)).toEqual({});
      expect(adapter.readModelAssignments("")).toEqual({});

      const diagnostics = await adapter.diagnoseProject?.(projectRoot) ?? [];
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
      const adapter = createCodexRunnerAdapter({ journalRoot });

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
      expect(await adapter.diagnoseProject?.(projectRoot)).toContainEqual(expect.objectContaining({
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
      expect(await adapter.diagnoseProject?.(projectRoot)).toContainEqual(expect.objectContaining({
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

  test("bootstraps new Codex roots as Deck Lead with persisted assignments while resumes stay untouched", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "deck-codex-root-lead-launch-"));
    const journalRoot = await mkdtemp(join(tmpdir(), "deck-codex-root-lead-launch-journal-"));
    try {
      await mkdir(join(projectRoot, ".codex", "agents"), { recursive: true });
      await writeFile(join(projectRoot, ".codex", "config.toml"), "[features]\nmulti_agent = true\n");
      await writeFile(join(projectRoot, ".codex", "agents", "deck-lead.toml"), 'model = "gpt-5.6-sol"\nmodel_reasoning_effort = "high"\n');
      const parsed = parseCodexModels(CURRENT_CODEX_MODELS_FIXTURE);
      if (!parsed.ok) throw new Error("expected Codex fixture to parse");
      const adapter = createCodexRunnerAdapter({
        journalRoot,
        preflight: {
          probe: async () => ({ found: true, version: "0.146.1", help: "Usage: codex [OPTIONS]\nexec\nresume", execHelp: "Usage: codex exec [OPTIONS]", resumeHelp: "Usage: codex resume [SESSION_ID] --last" }),
          inspectTrust: async () => "trusted",
          readProject: async () => ({ config: "[features]\nmulti_agent = true\n", roles: ["deck-lead.toml"], skills: ["deck-lead"], agentsInstructions: true }),
        },
        inventoryDiscovery: async () => ({ state: "ready", source: "live", discoveredAt: 1, fingerprint: "current-codex", inventory: parsed.inventory }),
      });
      const interactive = await adapter.buildLaunchPlan!({ projectRoot, teamId: "developer-team", mode: "interactive" });
      const exec = await adapter.buildLaunchPlan!({ projectRoot, teamId: "developer-team", mode: "exec", prompt: ["--flag", "quoted\nline"], stdin: "closed", stdinPayload: { type: "utf8", content: "--flag quoted\nline" } });
      const override = await adapter.buildLaunchPlan!({ projectRoot, teamId: "developer-team", mode: "interactive", modelId: "openai-codex/gpt-5.6-luna", reasoningLevel: "medium" });
      const invalidOverride = await adapter.buildLaunchPlan!({ projectRoot, teamId: "developer-team", mode: "interactive", modelId: "unknown/model", reasoningLevel: "invented" });
      const resume = await adapter.buildLaunchPlan!({ projectRoot, teamId: "developer-team", mode: "resume-by-id", sessionId: "session-1", modelId: "openai-codex/gpt-5.6-luna", reasoningLevel: "medium" });

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
        expect([...resume.plan.args]).toEqual(["resume", "session-1"]);
        expect(resume.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: "codex-resume-existing-history" })]));
        expect(resume.plan.args.join(" ")).not.toContain("developer_instructions");
        expect(resume.plan.args.join(" ")).not.toContain("model_reasoning_effort");
      }
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
      await rm(journalRoot, { recursive: true, force: true });
    }
  });

  test("exposes exact current Codex reasoning levels and the runner's default", async () => {
    const parsed = parseCodexModels(CURRENT_CODEX_MODELS_FIXTURE);
    if (!parsed.ok) throw new Error("expected Codex fixture to parse");
    const adapter = createCodexRunnerAdapter({
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
      const adapter = createCodexRunnerAdapter({
        journalRoot,
        mcpCapabilityIds: ["context7"],
        sharedBinaryUsability: async (command) => ({ status: "ready", command }),
        codebaseIndexReadiness: async () => true,
        supermemoryOAuthStatus: async () => ({ state: "not-authenticated" }),
      });
      const plan = adapter.buildDeveloperTeamInstallPlan({
        projectRoot,
        environmentId: "codex-development",
        memoryProvider: { id: "supermemory", displayName: "Supermemory", buildInjection: () => ({ instructions: [], toolBindings: [] }) },
        capabilityInstructions: (await import("@deck/core")).buildCapabilityInstructionBundle(["context-mode", "codebase-memory", "serena", "rtk"]),
      });
      await adapter.applyDeveloperTeamInstall({ projectRoot, environmentId: "codex-development", plan });
      const config = await readFile(join(projectRoot, ".codex", "config.toml"), "utf8");
      expect(config).toContain("[mcp_servers.context7]");
      expect(config).toContain("[mcp_servers.supermemory]");
       expect(config).not.toContain("bearer_token_env_var");
       expect(config).not.toContain("SUPERMEMORY_API_KEY");
        expect(await adapter.verifyDeveloperTeamInstall(plan)).toMatchObject({
          valid: true,
          verificationEvidence: [{ id: "mcp:supermemory" }],
          postInstallFollowUps: [{
            id: "supermemory-user-authorization",
            message: "Run codex mcp login supermemory when you are ready to authorize Supermemory.",
          }],
        });
       await writeFile(join(projectRoot, ".codex", "config.toml"), "[features]\nmulti_agent = false\n");
       const driftedVerification = await adapter.verifyDeveloperTeamInstall(plan);
       expect(driftedVerification).toMatchObject({ valid: false });
       expect(driftedVerification).not.toHaveProperty("postInstallFollowUps");
       await writeFile(join(projectRoot, ".codex", "config.toml"), config);
       const inventory = await adapter.getCapabilityInventory({ projectRoot, environmentId: "codex-development", runnerId: "codex" });
      for (const id of ["context-mode", "codebase-memory", "rtk", "serena", "context7"]) {
        expect(inventory.capabilities.find((capability) => capability.capabilityId === id)?.isInstalled).toBe(true);
      }
      expect(inventory.capabilities.find((capability) => capability.capabilityId === "supermemory-tool-bindings")).toMatchObject({
         isInstalled: false,
         isBlocked: false,
          diagnostics: [expect.stringContaining("pending user authorization")],
       });
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
        expect(adapter.buildInstallationPlan({ runnerId: "codex", environmentId: "codex-development", selectedCapabilities: { "context-mode": true }, packageInstructions: {}, adaptiveMemory: { provider: "none" } }).steps.every((step) => step.action !== "install")).toBe(true);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
      await rm(journalRoot, { recursive: true, force: true });
    }
  }, 30_000);

  test("reports reused, missing, unusable, MCP-missing, and index-missing readiness by capability ID", async () => {
    const adapter = createCodexRunnerAdapter({
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
      sharedBinaryUsability: async (command) => command === "context-mode"
        ? { status: "missing", command, reason: "not found" }
        : command === "codebase-memory-mcp"
          ? { status: "unusable", command, reason: "probe failed" }
          : { status: "ready", command, version: "test" },
      codebaseIndexReadiness: async () => false,
       supermemoryOAuthStatus: async () => ({ state: "not-authenticated" }),
    });
    const inventory = await adapter.getCapabilityInventory({ projectRoot: "/project", environmentId: "codex-development", runnerId: "codex" });
    const byId = new Map(inventory.capabilities.map((capability) => [capability.capabilityId, capability]));
    expect(byId.get("context-mode")).toMatchObject({ isInstalled: false, isBlocked: false, diagnostics: expect.arrayContaining([expect.stringContaining("missing")]) });
    expect(byId.get("codebase-memory")).toMatchObject({ isInstalled: false, isBlocked: true, diagnostics: expect.arrayContaining([expect.stringContaining("unusable"), expect.stringContaining("index not ready")]) });
    expect(byId.get("rtk")).toMatchObject({ isInstalled: true, isBlocked: false });
    expect(byId.get("serena")).toMatchObject({ isInstalled: false, isBlocked: false, diagnostics: expect.arrayContaining([expect.stringContaining("MCP configuration missing")]) });
    expect(byId.get("context7")).toMatchObject({ isInstalled: false, diagnostics: expect.arrayContaining([expect.stringContaining("MCP configuration missing")]) });
  });

  test("doctor covers ready, degraded, blocked, drifted, unsupported, and per-route static states", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "deck-codex-doctor-project-"));
    const journalRoot = await mkdtemp(join(tmpdir(), "deck-codex-doctor-journal-"));
    const probe = async () => ({ found: true as const, version: "0.146.1", help: "Usage: codex [OPTIONS]", execHelp: "Usage: codex exec [OPTIONS]", resumeHelp: "Usage: codex resume [SESSION_ID] --last" });
    const sharedBinaryUsability = async (command: string) => ({ status: "ready" as const, command, version: "test" });
    try {
      const ready = createCodexRunnerAdapter({
        journalRoot,
        preflight: {
          probe,
          inspectTrust: async () => "trusted",
          readProject: async (root) => ({ config: await readFile(join(root, ".codex", "config.toml"), "utf8").catch(() => null), roles: [], skills: [], agentsInstructions: true }),
        },
        sharedBinaryUsability,
        codebaseIndexReadiness: async () => true,
         supermemoryOAuthStatus: async () => ({ state: "authenticated" }),
      });
      const plan = ready.buildDeveloperTeamInstallPlan({
        projectRoot,
        environmentId: "codex-development",
        memoryProvider: { id: "supermemory", displayName: "Supermemory", buildInjection: () => ({ instructions: [], toolBindings: [] }) },
      });
      await ready.applyDeveloperTeamInstall({ projectRoot, environmentId: "codex-development", plan });
      await mkdir(join(projectRoot, ".deck"), { recursive: true });
      await writeFile(join(projectRoot, ".deck", "config.json"), JSON.stringify({
        version: 1,
        adaptiveMemory: { activeProvider: "supermemory", supermemory: { mcpServerName: "supermemory" } },
      }));
      const healthy = await ready.diagnoseProject?.(projectRoot) ?? [];
      expect(healthy).toContainEqual(expect.objectContaining({ category: "Binary and version", status: "ok" }));
      expect(healthy).toContainEqual(expect.objectContaining({ category: "Managed content", status: "ok" }));
      expect(healthy).toContainEqual(expect.objectContaining({
        category: "Capability: Supermemory",
        status: "ok",
        message: "Supermemory is configured and authenticated with native Codex OAuth.",
      }));
      for (const mode of ["interactive", "exec", "resume-by-id", "resume-latest"]) {
        expect(healthy).toContainEqual(expect.objectContaining({ category: `Execution route: ${mode}`, status: "warning", message: expect.stringContaining("static-compatible") }));
      }

      const unauthorized = createCodexRunnerAdapter({
        journalRoot,
        preflight: {
          probe,
          inspectTrust: async () => "trusted",
          readProject: async (root) => ({ config: await readFile(join(root, ".codex", "config.toml"), "utf8"), roles: [], skills: [], agentsInstructions: true }),
        },
        sharedBinaryUsability,
        codebaseIndexReadiness: async () => true,
        supermemoryOAuthStatus: async () => ({ state: "not-authenticated" }),
      });
      expect(await unauthorized.diagnoseProject?.(projectRoot)).toContainEqual(expect.objectContaining({
        category: "Capability: Supermemory",
        status: "warning",
        message: expect.stringContaining("pending user authorization"),
        suggestion: "Run codex mcp login supermemory when you are ready to authorize Supermemory.",
      }));

      const brokenSupermemory = createCodexRunnerAdapter({
        journalRoot,
        preflight: {
          probe,
          inspectTrust: async () => "trusted",
          readProject: async () => ({ config: "[features]\nmulti_agent = true\n", roles: [], skills: [], agentsInstructions: true }),
        },
        sharedBinaryUsability,
        codebaseIndexReadiness: async () => true,
      });
      expect(await brokenSupermemory.diagnoseProject?.(projectRoot)).toContainEqual(expect.objectContaining({
        category: "Capability: Supermemory",
        status: "error",
        message: expect.stringContaining("reviewed streamable HTTP configuration"),
      }));

      const untrusted = createCodexRunnerAdapter({
        journalRoot,
        preflight: { probe, inspectTrust: async () => "untrusted", readProject: async () => ({ config: "[features]\nmulti_agent = true\n", roles: [], skills: [], agentsInstructions: true }) },
        sharedBinaryUsability,
      });
      expect(await untrusted.diagnoseProject?.(projectRoot)).toContainEqual(expect.objectContaining({ category: "Trust activation", status: "warning" }));

      await writeFile(join(projectRoot, ".codex", "agents", "deck-lead.toml"), "user drift", "utf8");
      expect(await ready.diagnoseProject?.(projectRoot)).toContainEqual(expect.objectContaining({ category: "Managed content", status: "error", message: expect.stringContaining("ownership evidence") }));

      const blocked = createCodexRunnerAdapter({
        journalRoot,
        preflight: { probe, inspectTrust: async () => "trusted", readProject: async () => ({ config: "[broken", roles: [], skills: [], agentsInstructions: true }) },
        sharedBinaryUsability,
      });
      expect(await blocked.diagnoseProject?.(projectRoot)).toContainEqual(expect.objectContaining({ category: "Binary and version", status: "error" }));

      const unsupported = createCodexRunnerAdapter({
        journalRoot,
        preflight: { probe: async () => ({ found: true, version: "0.100.0", help: "" }) },
        sharedBinaryUsability,
      });
      const unsupportedChecks = await unsupported.diagnoseProject?.(projectRoot) ?? [];
      expect(unsupportedChecks).toContainEqual(expect.objectContaining({ category: "Binary and version", status: "error", message: expect.stringContaining("0.100.0") }));
      expect(unsupportedChecks).toContainEqual(expect.objectContaining({ category: "Execution route: interactive", status: "warning", message: expect.stringContaining("unsupported") }));
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
      await rm(journalRoot, { recursive: true, force: true });
    }
  }, 30_000);

  test("applies local-only through the effective Git exclude path with exact entries", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "deck-codex-local-project-"));
    const journalRoot = await mkdtemp(join(tmpdir(), "deck-codex-local-journal-"));
    const excludePath = join(projectRoot, ".git", "info", "exclude");
    try {
      const adapter = createCodexRunnerAdapter({
        journalRoot,
        gitEffects: {
          resolveExcludePath: () => excludePath,
          isTracked: (_root, relativePath) => relativePath === "AGENTS.md",
        },
      });
      const plan = adapter.buildDeveloperTeamInstallPlan({ projectRoot, environmentId: "codex-development", localOnly: true });
      expect(plan.files.some((file) => file.path.startsWith("git-info-exclude:"))).toBe(true);
      await adapter.applyDeveloperTeamInstall({ projectRoot, environmentId: "codex-development", plan });
      const exclude = await readFile(excludePath, "utf8");
      expect(exclude).toContain("/.codex/agents/deck-lead.toml");
      expect(exclude.split("\n")).not.toContain("/.codex/");
      expect(exclude).not.toContain("/AGENTS.md");
      const journals = (await readdir(journalRoot)).filter((name) => name.endsWith(".json"));
      expect(journals).toHaveLength(2);
      expect(new Set(journals).size).toBe(2);
      const unchanged = adapter.buildDeveloperTeamInstallPlan({ projectRoot, environmentId: "codex-development", localOnly: true });
      expect(unchanged.files).toHaveLength(0);
      expect(await adapter.verifyDeveloperTeamInstall(unchanged)).toMatchObject({ valid: true });
      await Bun.write(excludePath, "# independently changed\n");
      expect(await adapter.verifyDeveloperTeamInstall(unchanged)).toMatchObject({ valid: false, diagnostics: [expect.stringContaining("git-info-exclude")] });
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
      await rm(journalRoot, { recursive: true, force: true });
    }
  });

  test("operation-scoped rollback of a later native apply cannot affect earlier local-only state", async () => {
    const root = await mkdtemp(join(tmpdir(), "deck-codex-operation-scope-"));
    const firstRoot = join(root, "first");
    const secondRoot = join(root, "second");
    const journalRoot = join(root, "journals");
    try {
      await mkdir(firstRoot, { recursive: true });
      await mkdir(secondRoot, { recursive: true });
      const nodeEffects = createNodeCodexFileEffects({ journalRoot });
      let journalPersistCount = 0;
      const adapter = createCodexRunnerAdapter({
        journalRoot,
        fileEffects: {
          ...nodeEffects,
          persistJournalAtomic: async (journal) => {
            journalPersistCount += 1;
            await nodeEffects.persistJournalAtomic(journal);
          },
        },
        gitEffects: {
          resolveExcludePath: (projectRoot) => join(projectRoot, ".git", "info", "exclude"),
          isTracked: (_projectRoot, relativePath) => relativePath === "AGENTS.md",
        },
      });
      const firstPlan = adapter.buildDeveloperTeamInstallPlan({ projectRoot: firstRoot, environmentId: "codex-development", localOnly: true });
      const firstBackup = adapter.backupDeveloperTeamFiles(firstPlan);
      const firstApply = await adapter.applyDeveloperTeamInstall({ projectRoot: firstRoot, environmentId: "codex-development", plan: firstPlan });
      const firstReceipt = firstBackup.payload as NonNullable<typeof firstApply.operation>;
      expect(firstApply.operation).toEqual(firstReceipt);
      expect(firstReceipt.transactions.map((entry) => entry.kind)).toEqual(["native", "local-only"]);
      for (const transaction of firstReceipt.transactions) {
        const journal = JSON.parse(await readFile(join(journalRoot, `${transaction.id}.json`), "utf8")) as { operationId: string; operationKind: string };
        expect(journal).toMatchObject({ operationId: firstReceipt.operationId, operationKind: transaction.kind });
      }
      const firstRole = join(firstRoot, ".codex", "agents", "deck-lead.toml");
      const firstExclude = join(firstRoot, ".git", "info", "exclude");
      expect(await Bun.file(firstRole).exists()).toBe(true);
      expect(await readFile(firstExclude, "utf8")).toContain("/.codex/agents/deck-lead.toml");

      const secondPlan = adapter.buildDeveloperTeamInstallPlan({ projectRoot: secondRoot, environmentId: "codex-development" });
      const secondBackup = adapter.backupDeveloperTeamFiles(secondPlan);
      const secondApply = await adapter.applyDeveloperTeamInstall({ projectRoot: secondRoot, environmentId: "codex-development", plan: secondPlan });
      expect(journalPersistCount).toBe(9);
      expect(secondApply.operation).toEqual(secondBackup.payload as typeof secondApply.operation);
      const forged = { payload: { ...(secondBackup.payload as NonNullable<typeof secondApply.operation>), operationId: "forged-operation" }, diagnostics: [] };
      expect(await adapter.rollbackDeveloperTeamFiles(forged)).toMatchObject({ status: "conflict", diagnostics: [expect.stringContaining("does not belong")] });
      expect(journalPersistCount).toBe(9);
      expect(await Bun.file(join(secondRoot, ".codex", "agents", "deck-lead.toml")).exists()).toBe(true);
      expect(await adapter.rollbackDeveloperTeamFiles(secondBackup)).toMatchObject({ status: "rolled-back", conflicts: [] });
      expect(journalPersistCount).toBe(11);
      expect(await Bun.file(join(secondRoot, ".codex", "agents", "deck-lead.toml")).exists()).toBe(false);
      expect(await Bun.file(firstRole).exists()).toBe(true);
      expect(await readFile(firstExclude, "utf8")).toContain("/.codex/agents/deck-lead.toml");

      expect(await adapter.rollbackDeveloperTeamFiles(firstBackup)).toMatchObject({ status: "rolled-back", conflicts: [] });
      expect(journalPersistCount).toBe(15);
      expect(await Bun.file(firstRole).exists()).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  test("concurrent reviewed operations retain independent transaction receipts", async () => {
    const root = await mkdtemp(join(tmpdir(), "deck-codex-concurrent-operations-"));
    const roots = [join(root, "one"), join(root, "two")];
    try {
      await Promise.all(roots.map((projectRoot) => mkdir(projectRoot, { recursive: true })));
      const adapter = createCodexRunnerAdapter({ journalRoot: join(root, "journals") });
      const plans = roots.map((projectRoot) => adapter.buildDeveloperTeamInstallPlan({ projectRoot, environmentId: "codex-development" }));
      const backups = plans.map((plan) => adapter.backupDeveloperTeamFiles(plan));
      const applied = await Promise.all(plans.map((plan, index) => adapter.applyDeveloperTeamInstall({ projectRoot: roots[index]!, environmentId: "codex-development", plan })));
      expect(new Set(applied.map((result) => result.operation?.operationId)).size).toBe(2);
      expect(applied.map((result) => result.operation)).toEqual(backups.map((backup) => backup.payload as typeof applied[number]["operation"]));

      await adapter.rollbackDeveloperTeamFiles(backups[1]);
      expect(await Bun.file(join(roots[0]!, ".codex", "agents", "deck-lead.toml")).exists()).toBe(true);
      expect(await Bun.file(join(roots[1]!, ".codex", "agents", "deck-lead.toml")).exists()).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);
});
