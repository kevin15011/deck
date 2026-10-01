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
    expect(paths).not.toContain("AGENTS.md");
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

  test("does not create or append to an unmarked AGENTS.md while retaining native role and skill instructions", () => {
    const original = "# User instructions\nKeep this exact.\n";
    const plan = buildCodexDeveloperTeamInstallPlan({
      projectRoot: "/work/project",
      existingFiles: new Map([["AGENTS.md", original]]),
      capabilityInstructions: buildCapabilityInstructionBundle(["codebase-memory"]),
    });
    expect(plan.mutations.some((mutation) => mutation.relativePath === "AGENTS.md")).toBe(false);
    expect(plan.expectedFiles.some((file) => file.relativePath === "AGENTS.md")).toBe(false);
    expect(plan.expectedFiles.find((file) => file.relativePath === ".codex/agents/deck-lead.toml")?.content).toContain("Codebase Memory Package");
    expect(plan.expectedFiles.find((file) => file.relativePath === ".agents/skills/deck-apply-fast/SKILL.md")?.content).toContain("Codebase Memory Package");
    const contentOnly = buildCodexDeveloperTeamInstallPlan({
      projectRoot: "/work/project",
      existingFiles: new Map([["AGENTS.md", original]]),
      materializationScope: "content-only",
    });
    expect(contentOnly.mutations.some((mutation) => mutation.relativePath === "AGENTS.md")).toBe(false);
  });

  test("retires only a legacy AGENTS marker span with exact manifest ownership and preserves mode", () => {
    const original = "prefix\n<!-- deck:developer-team:start -->\nmanaged\n<!-- deck:developer-team:end -->\nsuffix\n";
    const manifest = `${JSON.stringify({ version: 1, files: { "AGENTS.md": createHash("sha256").update(original).digest("hex") } }, null, 2)}\n`;
    const plan = buildCodexDeveloperTeamInstallPlan({
      projectRoot: "/work/project",
      existingFiles: new Map([["AGENTS.md", original], [".codex/deck-manifest.json", manifest]]),
      existingModes: new Map([["AGENTS.md", 0o640]]),
    });
    const agents = plan.mutations.find((mutation) => mutation.relativePath === "AGENTS.md");
    expect(plan.blocked).toBe(false);
    expect(agents).toMatchObject({ content: "prefix\n\nsuffix\n", postimageMode: 0o640, rollback: "restore" });
    expect(plan.expectedFiles.find((file) => file.relativePath === "AGENTS.md")?.mode).toBe(0o640);
    const nextManifest = JSON.parse(plan.mutations.find((mutation) => mutation.relativePath === ".codex/deck-manifest.json")!.content) as { files: Record<string, string> };
    expect(nextManifest.files["AGENTS.md"]).toBeUndefined();
    expect(plan.ownershipReleases).toEqual(["AGENTS.md"]);
  });

  test("blocks legacy cleanup and preserves AGENTS.md for missing, mismatched, malformed, duplicate, or reversed ownership evidence", () => {
    const valid = "before\n<!-- deck:developer-team:start -->\nmanaged\n<!-- deck:developer-team:end -->\nafter\n";
    const cases = [
      { name: "missing", content: valid, manifest: undefined },
      { name: "mismatched", content: valid, manifest: `${JSON.stringify({ version: 1, files: { "AGENTS.md": createHash("sha256").update("different").digest("hex") } })}\n` },
      { name: "malformed", content: "before\n<!-- deck:developer-team:start -->\nafter\n", manifest: undefined },
      { name: "duplicate", content: `${valid}<!-- deck:developer-team:start -->\n`, manifest: undefined },
      { name: "reversed", content: "before\n<!-- deck:developer-team:end -->\n<!-- deck:developer-team:start -->\nafter\n", manifest: undefined },
    ];
    for (const scenario of cases) {
      const existing = new Map<string, string>([["AGENTS.md", scenario.content]]);
      if (scenario.manifest) existing.set(".codex/deck-manifest.json", scenario.manifest);
      const plan = buildCodexDeveloperTeamInstallPlan({ projectRoot: "/work/project", existingFiles: existing });
      expect(plan.blocked, scenario.name).toBe(true);
      expect(plan.mutations.some((mutation) => mutation.relativePath === "AGENTS.md"), scenario.name).toBe(false);
      expect(plan.ownershipReleases, scenario.name).toEqual([]);
      if (scenario.name === "mismatched") {
        const nextManifest = JSON.parse(plan.mutations.find((mutation) => mutation.relativePath === ".codex/deck-manifest.json")!.content) as { files: Record<string, string> };
        expect(nextManifest.files["AGENTS.md"]).toBe(createHash("sha256").update("different").digest("hex"));
      }
    }
  });

  test("does not plan AGENTS.md again after legacy cleanup ownership is released", () => {
    const plan = buildCodexDeveloperTeamInstallPlan({
      projectRoot: "/work/project",
      existingFiles: new Map([["AGENTS.md", "prefix\n\nsuffix\n"]]),
    });
    expect(plan.blocked).toBe(false);
    expect(plan.mutations.some((mutation) => mutation.relativePath === "AGENTS.md")).toBe(false);
    expect(plan.ownershipReleases).toEqual([]);
  });

  test("releases obsolete AGENTS.md ownership without writing or deleting an absent legacy file", () => {
    const obsoleteHash = createHash("sha256").update("retired legacy bytes").digest("hex");
    const manifest = `${JSON.stringify({ version: 1, files: { "AGENTS.md": obsoleteHash } }, null, 2)}\n`;
    const plan = buildCodexDeveloperTeamInstallPlan({
      projectRoot: "/work/project",
      existingFiles: new Map([[".codex/deck-manifest.json", manifest]]),
    });
    expect(plan.blocked).toBe(false);
    expect(plan.mutations.some((mutation) => mutation.relativePath === "AGENTS.md")).toBe(false);
    expect(plan.ownershipReleases).toEqual(["AGENTS.md"]);
    const nextManifest = JSON.parse(plan.mutations.find((mutation) => mutation.relativePath === ".codex/deck-manifest.json")!.content) as { files: Record<string, string> };
    expect(nextManifest.files["AGENTS.md"]).toBeUndefined();

    const repeated = buildCodexDeveloperTeamInstallPlan({
      projectRoot: "/work/project",
      existingFiles: new Map([[".codex/deck-manifest.json", `${JSON.stringify(nextManifest, null, 2)}\n`]]),
    });
    expect(repeated.ownershipReleases).toEqual(["AGENTS.md"]);
    expect(repeated.mutations.some((mutation) => mutation.relativePath === "AGENTS.md")).toBe(false);
  });

  test("binds an ownership-only AGENTS.md release to the confirmed absent post-state", () => {
    const obsoleteHash = createHash("sha256").update("retired legacy bytes").digest("hex");
    const manifest = `${JSON.stringify({ version: 1, files: { "AGENTS.md": obsoleteHash } }, null, 2)}\n`;
    const plan = buildCodexDeveloperTeamInstallPlan({
      projectRoot: "/work/project",
      existingFiles: new Map([[".codex/deck-manifest.json", manifest]]),
    }) as ReturnType<typeof buildCodexDeveloperTeamInstallPlan> & {
      ownershipReleaseChecks?: readonly { relativePath: string; precondition: { kind: string }; postcondition: { kind: string } }[];
    };

    expect(plan.ownershipReleases).toEqual(["AGENTS.md"]);
    expect(plan.ownershipReleaseChecks).toEqual([{
      relativePath: "AGENTS.md",
      precondition: { kind: "absent" },
      postcondition: { kind: "absent" },
    }]);
  });

  test("blocks unsafe AGENTS.md states without releasing its retained ownership", () => {
    const owned = "<!-- deck:developer-team:start -->\nmanaged\n<!-- deck:developer-team:end -->\n";
    const manifest = `${JSON.stringify({ version: 1, files: { "AGENTS.md": createHash("sha256").update(owned).digest("hex") } }, null, 2)}\n`;
    const plan = buildCodexDeveloperTeamInstallPlan({
      projectRoot: "/work/project",
      existingFiles: new Map([[".codex/deck-manifest.json", manifest]]),
      agentsFile: { state: "unsafe", reason: "symlink" },
    } as Parameters<typeof buildCodexDeveloperTeamInstallPlan>[0] & { agentsFile: { state: "unsafe"; reason: string } });

    expect(plan.blocked).toBe(true);
    expect(plan.diagnostics).toContainEqual(expect.objectContaining({ code: "agents-file-unsafe", severity: "error" }));
    expect(plan.ownershipReleases).toEqual([]);
    const nextManifest = JSON.parse(plan.mutations.find((mutation) => mutation.relativePath === ".codex/deck-manifest.json")!.content) as { files: Record<string, string> };
    expect(nextManifest.files["AGENTS.md"]).toBeDefined();
  });

  test("rejects direct planner inputs whose AGENTS.md map conflicts with its authoritative snapshot", () => {
    const reviewed = "before\n<!-- deck:developer-team:start -->\nmanaged\n<!-- deck:developer-team:end -->\nafter\n";
    const changedOutsideMarkers = "changed before\n<!-- deck:developer-team:start -->\nmanaged\n<!-- deck:developer-team:end -->\nafter\n";
    const manifest = `${JSON.stringify({ version: 1, files: { "AGENTS.md": createHash("sha256").update(reviewed).digest("hex") } })}\n`;
    const plan = buildCodexDeveloperTeamInstallPlan({
      projectRoot: "/work/project",
      existingFiles: new Map([["AGENTS.md", changedOutsideMarkers], [".codex/deck-manifest.json", manifest]]),
      agentsFile: { state: "file", content: reviewed, mode: 0o644 },
    });

    expect(plan.blocked).toBe(true);
    expect(plan.diagnostics).toContainEqual(expect.objectContaining({ code: "agents-file-snapshot-inconsistent", severity: "error" }));
    expect(plan.mutations.some((mutation) => mutation.relativePath === "AGENTS.md")).toBe(false);
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

  test("diagnoses unmarked raw Supermemory MCP as unmanaged and not authorized project memory", () => {
    const plan = buildCodexDeveloperTeamInstallPlan({
      projectRoot: "/work/project",
      existingFiles: new Map([[".codex/config.toml", '[mcp_servers.supermemory]\nurl = "https://mcp.supermemory.ai/mcp"\nhttp_headers = { "x-sm-project" = "sm_project_v1_other_repo" }\n']]),
      memoryProvider: "supermemory",
      supermemoryProjectScope: "sm_project_v1_kevin15011_deck",
    });

    expect(plan.blocked).toBe(false);
    expect(plan.diagnostics).toContainEqual(expect.objectContaining({ code: "supermemory-mcp-unmanaged", severity: "warning" }));
    expect(plan.diagnostics.map((diagnostic) => diagnostic.message).join(" ")).toContain("external-unobservable");
    expect(plan.diagnostics.map((diagnostic) => diagnostic.message).join(" ")).not.toContain("sm_project_v1_other_repo");
  });

  test("propagates Runtime-owned Supermemory scope guidance across Codex session, roles, agent skills, external skills, and bootstrap skills", () => {
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
      ".codex/agents/deck-lead.toml",
      ".codex/agents/deck-apply-deep.toml",
      ".agents/skills/deck-apply-deep/SKILL.md",
      ".agents/skills/api-and-interface-design/SKILL.md",
      ".agents/skills/deck-onboard/SKILL.md",
    ]) {
      const content = expected.get(path) ?? "";
      expect(content, path).toContain("Runtime-managed recall and capture bind project scope server-side");
      expect(content, path).toContain("schemas permit model-selected project scope");
      expect(content, path).not.toContain('containerTag: "sm_project_v1_kevin15011_deck"');
      expect(content, path).not.toContain('containerTag: \\"sm_project_v1_kevin15011_deck\\"');
      expect(content, path).not.toContain("No manual containerTag required");
      expect(content, path).not.toContain("sm_project_default");
    }
  });
});
