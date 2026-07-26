import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createOpenCodeRunnerAdapter } from "./runner-adapter";
import type { OpenCodeToolsReview } from "./required-tools";
import { getStandaloneSkills } from "@deck/core/skills/external";
import { discoverSkillsFromProvider } from "../../core/src/skill-discovery/discovery";

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

describe("OpenCode RunnerAdapter developer team install plan", () => {
  test("includes complete standalone external skills by default", () => {
    const adapter = createOpenCodeRunnerAdapter();
    const plan = adapter.buildDeveloperTeamInstallPlan({
      projectRoot: "/tmp/deck-opencode-runner-adapter-test",
      environmentId: "opencode-development",
    });

    const standaloneFiles = plan.files.filter((file) => file.kind === "standalone-skill");
    const installedSkillIds = new Set(standaloneFiles.map((file) => file.skillId));

    expect(installedSkillIds.size).toBe(getStandaloneSkills().length);
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
