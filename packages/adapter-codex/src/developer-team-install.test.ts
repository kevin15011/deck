import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { getStandaloneSkill, getStandaloneSkills } from "@deck/core/skills/external";
import { buildCapabilityInstructionBundle } from "@deck/core/teams/developer/instruction-bundles";

import { buildCodexDeveloperTeamInstallPlan } from "./developer-team-install";
import { parseSkillDescriptor } from "../../core/src/skill-discovery/discovery";

describe("buildCodexDeveloperTeamInstallPlan", () => {
  test("plans native roles, agent-bound skills, all external bundles, bootstrap skills, config, and instructions", () => {
    const plan = buildCodexDeveloperTeamInstallPlan({ projectRoot: "/work/project", existingFiles: new Map() });
    const paths = plan.mutations.map((mutation) => mutation.relativePath);

    expect(paths.filter((path) => path.startsWith(".codex/agents/deck-") && path.endsWith(".toml"))).toHaveLength(7);
    expect(paths.filter((path) => path.startsWith(".agents/skills/deck-") && path.endsWith("/SKILL.md")).length).toBeGreaterThanOrEqual(9);
    expect(plan.inventory.externalStandaloneSkillIds).toHaveLength(29);
    expect(plan.inventory.bootstrapSkillIds).toEqual(["deck-onboard", "deck-archive"]);
    expect(paths).toContain(".codex/config.toml");
    expect(paths).toContain(".codex/hooks/developer-team-execution.js");
    expect(paths).toContain("AGENTS.md");
    expect(plan.diagnostics.some((diagnostic) => diagnostic.code === "trusted-bridge-unavailable")).toBe(false);
    expect(plan.expectedFiles).toHaveLength(plan.mutations.length);
    expect(paths).toContain(".codex/deck-manifest.json");
  });

  test("keeps all native Deck skill descriptors valid with YAML frontmatter at byte zero", () => {
    const plan = buildCodexDeveloperTeamInstallPlan({ projectRoot: "/work/project", existingFiles: new Map() });
    const skills = plan.expectedFiles.filter((file) => file.relativePath.endsWith("/SKILL.md") && file.relativePath.includes("/deck-"));
    expect(skills).toHaveLength(9);
    for (const skill of skills) {
      expect(skill.content.startsWith("---\n")).toBe(true);
      expect(parseSkillDescriptor(skill.content, skill.relativePath.split("/").at(-2))).toMatchObject({ ok: true });
    }
  });

  test("uses the durable manifest, not marker substrings, to authorize canonical updates", () => {
    const fresh = buildCodexDeveloperTeamInstallPlan({ projectRoot: "/p", existingFiles: new Map() });
    const manifest = fresh.expectedFiles.find((file) => file.relativePath === ".codex/deck-manifest.json")!;
    const skill = fresh.expectedFiles.find((file) => file.relativePath === ".agents/skills/api-and-interface-design/SKILL.md")!;
    const prior = new Map([[manifest.relativePath, manifest.content], [skill.relativePath, skill.content]]);
    const updated = buildCodexDeveloperTeamInstallPlan({ projectRoot: "/p", existingFiles: prior });
    expect(updated.blocked).toBe(false);

    prior.set(skill.relativePath, `${skill.content}\nuser edit`);
    const conflict = buildCodexDeveloperTeamInstallPlan({ projectRoot: "/p", existingFiles: prior });
    expect(conflict.blocked).toBe(true);
  });

  test("uses manifest hashes for standalone support updates and reports stale support files", () => {
    const fresh = buildCodexDeveloperTeamInstallPlan({ projectRoot: "/p", existingFiles: new Map() });
    const manifestFile = fresh.expectedFiles.find((file) => file.relativePath === ".codex/deck-manifest.json")!;
    const manifest = JSON.parse(manifestFile.content) as { version: 1; files: Record<string, string> };
    const support = fresh.expectedFiles.find((file) => file.kind === "external-skill" && !file.relativePath.endsWith("/SKILL.md"))!;
    const old = "old managed support";
    manifest.files[support.relativePath] = createHash("sha256").update(old).digest("hex");
    const stalePath = ".agents/skills/removed-skill/reference.md";
    manifest.files[stalePath] = createHash("sha256").update("stale").digest("hex");
    const existing = new Map([
      [manifestFile.relativePath, `${JSON.stringify(manifest, null, 2)}\n`],
      [support.relativePath, old],
      [stalePath, "stale"],
    ]);
    const plan = buildCodexDeveloperTeamInstallPlan({ projectRoot: "/p", existingFiles: existing });
    expect(plan.blocked).toBe(false);
    expect(plan.mutations.some((mutation) => mutation.relativePath === support.relativePath)).toBe(true);
    expect(plan.diagnostics.some((diagnostic) => diagnostic.code === "stale-managed-file-removal" && diagnostic.message.includes(stalePath))).toBe(true);
    expect(plan.mutations).toContainEqual(expect.objectContaining({ operation: "delete", relativePath: stalePath }));
  });

  test("matches every canonical standalone bundle and support file byte-for-byte", () => {
    const plan = buildCodexDeveloperTeamInstallPlan({ projectRoot: "/p", existingFiles: new Map() });
    const expected = new Map(plan.expectedFiles.map((file) => [file.relativePath, file.content]));
    for (const { skillId } of getStandaloneSkills()) {
      const bundle = getStandaloneSkill(skillId);
      expect(expected.get(`.agents/skills/${skillId}/SKILL.md`)).toBe(bundle.SKILL);
      for (const [path, content] of Object.entries(bundle.files)) expect(expected.get(`.agents/skills/${skillId}/${path}`)).toBe(content);
    }
  });

  test("blocks a same-id unowned collision instead of overwriting it", () => {
    const existingFiles = new Map([[".agents/skills/api-and-interface-design/SKILL.md", "user owned"]]);
    const plan = buildCodexDeveloperTeamInstallPlan({ projectRoot: "/work/project", existingFiles });
    expect(plan.blocked).toBe(true);
    expect(plan.mutations.some((mutation) => mutation.relativePath === ".agents/skills/api-and-interface-design/SKILL.md")).toBe(false);
  });

  test("preserves unowned AGENTS.md bytes inside a marker-owned update", () => {
    const original = "# User instructions\nKeep this exact.\n";
    const plan = buildCodexDeveloperTeamInstallPlan({
      projectRoot: "/work/project",
      existingFiles: new Map([["AGENTS.md", original]]),
    });
    const agents = plan.mutations.find((mutation) => mutation.relativePath === "AGENTS.md");
    expect(agents?.content.startsWith(original)).toBe(true);
    expect(agents?.content).toContain("<!-- deck:developer-team:start -->");
  });

  test("diagnoses override and nested instruction precedence without creating overrides", () => {
    const plan = buildCodexDeveloperTeamInstallPlan({
      projectRoot: "/work/project",
      existingFiles: new Map([["AGENTS.override.md", "user"], ["src/AGENTS.md", "nested"]]),
    });
    expect(plan.diagnostics.map((diagnostic) => diagnostic.code)).toContain("agents-instructions-shadowed");
    expect(plan.mutations.some((mutation) => mutation.relativePath.endsWith("AGENTS.override.md"))).toBe(false);
  });

  test("plans deletion only for stale files whose bytes still match ownership evidence", () => {
    const stale = "# deck-codex-v1\nname='retired'\n";
    const manifest = `${JSON.stringify({ version: 1, files: { ".codex/agents/deck-retired.toml": Bun.CryptoHasher.hash("sha256", stale, "hex") } }, null, 2)}\n`;
    const plan = buildCodexDeveloperTeamInstallPlan({
      projectRoot: "/work/project",
      existingFiles: new Map([[".codex/deck-manifest.json", manifest], [".codex/agents/deck-retired.toml", stale]]),
    });
    expect(plan.diagnostics.some((diagnostic) => diagnostic.code === "stale-managed-file-removal")).toBe(true);
    expect(plan.mutations).toContainEqual(expect.objectContaining({ operation: "delete", relativePath: ".codex/agents/deck-retired.toml", rollback: "restore" }));

    const tampered = buildCodexDeveloperTeamInstallPlan({
      projectRoot: "/work/project",
      existingFiles: new Map([[".codex/deck-manifest.json", manifest], [".codex/agents/deck-retired.toml", `${stale}user edit`]]),
    });
    expect(tampered.diagnostics.some((diagnostic) => diagnostic.code === "stale-managed-file-collision")).toBe(true);
    expect(tampered.mutations.some((mutation) => mutation.operation === "delete" && mutation.relativePath.includes("deck-retired"))).toBe(false);
  });

  test("blocks invalid Supermemory project scopes with provider-specific diagnostics", () => {
    const missing = buildCodexDeveloperTeamInstallPlan({
      projectRoot: "/work/project",
      existingFiles: new Map(),
      memoryProvider: "supermemory",
      supermemoryProjectScope: " ",
    });
    expect(missing.blocked).toBe(true);
    expect(missing.diagnostics).toContainEqual(expect.objectContaining({
      code: "supermemory-project-scope-missing",
      severity: "error",
    }));
    expect(JSON.stringify(missing.diagnostics)).not.toContain("Engram");

    const invalid = buildCodexDeveloperTeamInstallPlan({
      projectRoot: "/work/project",
      existingFiles: new Map(),
      memoryProvider: "supermemory",
      supermemoryProjectScope: "raw/project/name",
    });
    expect(invalid.blocked).toBe(true);
    expect(invalid.diagnostics).toContainEqual(expect.objectContaining({
      code: "supermemory-project-scope-invalid",
      severity: "error",
    }));
    expect(JSON.stringify(invalid.diagnostics)).toContain("redacted");
    expect(JSON.stringify(invalid.diagnostics)).not.toContain("raw/project/name");
    expect(JSON.stringify(invalid.diagnostics)).not.toContain("Engram");
  });

  test("propagates the exact canonical Supermemory scope across Codex session, roles, agent skills, external skills, and bootstrap skills", () => {
    const plan = buildCodexDeveloperTeamInstallPlan({
      projectRoot: "/work/project",
      existingFiles: new Map(),
      memoryProvider: "supermemory",
      supermemoryProjectScope: "sm_project_v1_kevin15011_deck",
      capabilityInstructions: buildCapabilityInstructionBundle(["adaptive-memory"], {
        supermemoryProjectScope: "sm_project_v1_kevin15011_deck",
        configuredSupermemoryProjectScope: "sm_project_v1_kevin15011_deck",
      }),
    });
    const expected = new Map(plan.expectedFiles.map((file) => [file.relativePath, file.content]));

    for (const path of [
      "AGENTS.md",
      ".codex/agents/deck-lead.toml",
      ".codex/agents/deck-apply-deep.toml",
      ".agents/skills/deck-apply-deep/SKILL.md",
      ".agents/skills/api-and-interface-design/SKILL.md",
      ".agents/skills/deck-onboard/SKILL.md",
    ]) {
      const content = expected.get(path) ?? "";
      expect(
        content.includes('containerTag: "sm_project_v1_kevin15011_deck"') || content.includes('containerTag: \\"sm_project_v1_kevin15011_deck\\"'),
        path,
      ).toBe(true);
      expect(content, path).toContain("x-sm-project is diagnostic/transport metadata only");
      expect(content, path).not.toContain("No manual containerTag required");
      expect(content, path).not.toContain("sm_project_default");
    }
  });
});
