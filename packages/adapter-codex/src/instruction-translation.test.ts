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
      .filter((file) => file.relativePath === "AGENTS.md" || file.relativePath === ".codex/agents/deck-lead.toml")
      .map((file) => file.content)
      .join("\n");
    expect(plan.blocked).toBe(false);
    expect(installed).not.toMatch(/Claude Code|OpenCode|WebFetch|--opencode/);
    expect(installed).toContain("Codex Tool Routing");
    expect(installed).toContain("no runner-specific RTK installer flag is assumed");
  });
});
