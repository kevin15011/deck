import { describe, expect, test } from "bun:test";
import {
  buildCapabilityInstructionBundle,
  buildCapabilityToolPolicyBundle,
  validateCapabilityInstructionMetadata,
  type CapabilityInstructionPackageId,
} from "../../core/src/teams/developer/instruction-bundles";
import { buildCodexDeveloperTeamInstallPlan } from "./developer-team-install";
import { translateCodexCapabilityInstructions, validateCodexInstructionTranslation } from "./instruction-translation";

const PACKAGE_IDS: readonly CapabilityInstructionPackageId[] = [
  "codebase-memory",
  "code-economy",
  "context-mode",
  "rtk",
  "adaptive-memory",
  "serena",
];

describe("Codex package-instruction translation", () => {
  test("preserves canonical metadata and tool policy while removing stale runner-specific terms for all six packages", () => {
    for (const packageId of PACKAGE_IDS) {
      const canonical = buildCapabilityInstructionBundle([packageId]);
      const canonicalSnapshot = structuredClone(canonical);
      const translated = translateCodexCapabilityInstructions(canonical)!;
      expect(validateCapabilityInstructionMetadata(translated, buildCapabilityToolPolicyBundle([packageId]))).toEqual([]);
      expect(validateCodexInstructionTranslation(translated)).toEqual([]);
      expect(translated.instructions.map(({ markdown: _markdown, ...metadata }) => metadata)).toEqual(
        canonical.instructions.map(({ markdown: _markdown, ...metadata }) => metadata),
      );
      expect(canonical).toEqual(canonicalSnapshot);
      expect(translated.instructions.map((fragment) => fragment.markdown).join("\n")).not.toMatch(/Claude Code|OpenCode|WebFetch|--opencode/);
    }
  });

  test("materializes only translated Codex instruction content", () => {
    const canonical = buildCapabilityInstructionBundle(PACKAGE_IDS);
    const plan = buildCodexDeveloperTeamInstallPlan({ projectRoot: "/project", existingFiles: new Map(), capabilityInstructions: canonical });
    const installed = plan.expectedFiles
      .filter((file) => file.relativePath === ".codex/agents/deck-lead.toml" || file.relativePath === ".agents/skills/deck-apply-fast/SKILL.md")
      .map((file) => file.content)
      .join("\n");
    expect(plan.blocked).toBe(false);
    expect(installed).not.toMatch(/Claude Code|OpenCode|WebFetch|--opencode/);
    expect(installed).toContain("Codex Tool Routing");
    expect(installed).toContain("no runner-specific RTK installer flag is assumed");
  });

  test("tells Codex about the explicit memory tools, their limits and the conservative role policy", () => {
    const translated = translateCodexCapabilityInstructions(buildCapabilityInstructionBundle(["adaptive-memory"]))!;
    for (const fragment of translated.instructions) {
      expect(fragment.markdown).toContain("### Explicit memory tools (Codex)");
      for (const expected of ["`memory_search`", "`memory_save`", "`deck-memory`", "Read-only roles", "advisory"]) expect(fragment.markdown).toContain(expected);
      expect(fragment.markdown).toMatch(/only exist|only available/i);
    }
    expect(validateCodexInstructionTranslation(translated)).toEqual([]);
    // Packages other than adaptive-memory are untouched.
    const rtk = translateCodexCapabilityInstructions(buildCapabilityInstructionBundle(["rtk"]))!;
    expect(rtk.instructions.every((fragment) => !fragment.markdown.includes("memory_search"))).toBe(true);
  });
});
