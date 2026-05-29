import { describe, expect, test } from "bun:test";
import { buildAdaptiveMemoryInstructionBundle } from "./adaptive-memory";
import type { CapabilityInstructionSurface } from "./index";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Count numbered items in a "Decision Examples" section by looking for
 * patterns like "1. ", "2. ", etc. at the start of lines.
 */
function countDecisionExamples(markdown: string): number {
  const lines = markdown.split("\n");
  let count = 0;
  for (const line of lines) {
    if (/^\d+\.\s+\*\*/.test(line.trim())) {
      count++;
    }
  }
  return count;
}

/**
 * Count work type rows in the "Suggested Topic Keys" table.
 */
function countSuggestedTopicKeys(markdown: string): number {
  const sectionMatch = markdown.match(/### Suggested Topic Keys\n\n([\s\S]*?)(?=\n### |\n\n##|$)/);
  if (!sectionMatch) return 0;

  const section = sectionMatch[1];
  const rows = section.split("\n").filter((line) => {
    const trimmed = line.trim();
    return trimmed.startsWith("|") && !trimmed.match(/^\|[-\s|]+\|$/);
  });

  return rows.length;
}

/**
 * Count lifecycle moment rows in the "Save Trigger Matrix" table.
 */
function countSaveTriggerMatrix(markdown: string): number {
  const sectionMatch = markdown.match(/### Save Trigger Matrix\n\n([\s\S]*?)(?=\n### |\n\n##|$)/);
  if (!sectionMatch) return 0;

  const section = sectionMatch[1];
  const rows = section.split("\n").filter((line) => {
    const trimmed = line.trim();
    return trimmed.startsWith("|") && !trimmed.match(/^\|[-\s|]+\|$/);
  });

  return rows.length;
}

// ---------------------------------------------------------------------------
// Repair Contract (2026-05-29): NO container tags
// All memory saves are plain content. Scoping is automatic.
// ---------------------------------------------------------------------------

/**
 * REQ-R8-001: Prompts must NOT contain container tag instructions like u:, p:, t:, o:
 * as prefixes for scoping. They should say to save memories as plain content.
 */
const NO_CONTAINER_TAG_INSTRUCTIONS = [
  "DO NOT use container tags",
  "Save memories as plain content",
  "Scoping is automatic",
];

/**
 * REQ-R8-002: Prompts must mention automatic scoping.
 */
const SCOPING_AUTOMATIC_INSTRUCTIONS = [
  "Automatic Scoping",
  "Derived from your Supermemory token",
  "x-sm-project header",
];

/**
 * Rules shared across ALL surfaces (agent, session, skill).
 * These existed before the change and must remain after.
 */
const ALL_SURFACES_MUST_PRESERVE = [
  // Core adaptive memory config (must preserve)
  "Adaptive memory is provided by the runner's configured memory system",
  "The active provider injects its tool instructions into agent prompts",

  // New sections added in Task 2 (must appear in all surfaces)
  "### Decision Examples",
  "### Suggested Topic Keys",
  "### Save Trigger Matrix",

  // Decision examples content (at least the concept)
  "architecture/state-management",
  "preference/kevin",
  "discovery/react-hooks-cleanup",
  "bugfix/n-plus-one-user-list",
  "session/2026-05-23-deck-refactor",

  // Suggested topic keys content (at least the table)
  "Architecture",
  "Bugfix",
  "Performance",
  "Config",
  "Preference",
  "Pattern",
  "Discovery",

  // Save trigger matrix content (the 7 moments)
  "Architecture decision made",
  "Bug fix completed",
  "User preference learned",
  "Session close",
  "Non-obvious discovery",
  "Configuration change",
  "Pattern established",
];

/**
 * Rules only present in agent surface (not session or skill).
 * Session and skill have a more compact format without these standalone sections.
 */
const AGENT_ONLY_MUST_PRESERVE = [
  // These sections are only in agent surface
  "reuse the same topic key",
  "### Session Limit",
  "Soft maximum of 7 memories",
];

/**
 * Rules only present in agent and skill surfaces (not session).
 */
const AGENT_SKILL_ONLY_MUST_PRESERVE = [
  // Provider sections — these exist only in agent and skill, not session
  "Provider: Supermemory",
  "Provider: Engram",
  "memory",
  "recall",

  // Detailed sections that session doesn't have (but agent/skill differ slightly)
  "### When to Save",
  "### Save Format",
  "**What**",
  "**Why**",
  "**Where**",
  "**Learned**",
  "### Fail-Open",
  "continue working normally",
  "Never block agent work",
  "### Authority Rule",
  "OpenSpec artifacts and Spec Registry",
];

// ---------------------------------------------------------------------------
// REQ-R8: Tests for repair contract
// ---------------------------------------------------------------------------

describe("buildAdaptiveMemoryInstructionBundle repair contract (REQ-R8)", () => {
  const bundle = buildAdaptiveMemoryInstructionBundle();
  const surfaces: CapabilityInstructionSurface[] = ["agent", "session", "skill"];

  // -------------------------------------------------------------------------
  // REQ-R8-001: No container tags in prompts
  // -------------------------------------------------------------------------

  describe("NO container tag literals (REQ-R8-001)", () => {
    for (const surface of surfaces) {
      test(`${surface} surface does NOT contain container tag literals`, () => {
        const fragment = bundle.instructions.find((f) => f.surface === surface);
        expect(fragment).toBeDefined();

        const md = fragment!.markdown;

        // Positive check: mentions plain content save (case insensitive)
        const containsPlainContent = md.toLowerCase().includes("save memories as plain content");
        expect(containsPlainContent).toBe(true);

        // CRITICAL: explicitly DO NOT contain literals u:, p:, t:, o: anywhere
        // The literals "u:", "p:", etc. should NOT appear anywhere in prompts
        expect(md).not.toMatch(/\b`u:`/);  // inline code form
        expect(md).not.toMatch(/\b`p:`/);  // inline code form
        expect(md).not.toMatch(/\b`t:`/);  // inline code form
        expect(md).not.toMatch(/\b`o:`/); // inline code form

        // Also check pipe-table form if present
        expect(md).not.toMatch(/\|\s*`u:`\s*\|/);
        expect(md).not.toMatch(/\|\s*`p:`\s*\|/);
        expect(md).not.toMatch(/\|\s*`t:`\s*\|/);
        expect(md).not.toMatch(/\|\s*`o:`\s*\|/);

        // Check that tool calls do NOT include containerTag parameter
        expect(md).not.toMatch(/containerTag\?:\s*string/);
      });
    }

    test("agent surface says memories are saved as plain content", () => {
      const fragment = bundle.instructions.find((f) => f.surface === "agent");
      expect(fragment).toBeDefined();
      expect(fragment!.markdown).toContain("Save memories as plain content");
    });
  });

  // -------------------------------------------------------------------------
  // REQ-R8-002: Automatic scoping mentioned
  // -------------------------------------------------------------------------

  describe("Automatic scoping (REQ-R8-002)", () => {
    for (const surface of surfaces) {
      test(`${surface} surface mentions automatic scoping`, () => {
        const fragment = bundle.instructions.find((f) => f.surface === surface);
        expect(fragment).toBeDefined();

        const md = fragment!.markdown;

        // At least one of the automatic scoping instructions should be present
        const hasScopingMention = SCOPING_AUTOMATIC_INSTRUCTIONS.some((instruction) =>
          md.includes(instruction)
        );
        expect(hasScopingMention).toBe(true);
      });
    }

    test("agent surface explains user scope from token", () => {
      const fragment = bundle.instructions.find((f) => f.surface === "agent");
      expect(fragment).toBeDefined();
      const md = fragment!.markdown;
      expect(md).toContain("Derived from your Supermemory token");
      expect(md).toContain("no userId needed");
    });

    test("agent surface explains project scope from x-sm-project", () => {
      const fragment = bundle.instructions.find((f) => f.surface === "agent");
      expect(fragment).toBeDefined();
      const md = fragment!.markdown;
      expect(md).toContain("x-sm-project");
    });
  });

  // -------------------------------------------------------------------------
  // REQ-AMI-001: Decision Examples section with ≥5 entries per surface
  // -------------------------------------------------------------------------

  describe("Decision Examples section (REQ-AMI-001)", () => {
    for (const surface of surfaces) {
      test(`${surface} surface has ≥5 decision examples`, () => {
        const fragment = bundle.instructions.find((f) => f.surface === surface);
        expect(fragment).toBeDefined();

        const count = countDecisionExamples(fragment!.markdown);
        expect(count).toBeGreaterThanOrEqual(5);
      });
    }

    test("agent surface covers all 5 required example types", () => {
      const fragment = bundle.instructions.find((f) => f.surface === "agent");
      expect(fragment).toBeDefined();

      const md = fragment!.markdown;
      expect(md).toContain("architecture/state-management");
      expect(md).toContain("preference/kevin");
      expect(md).toContain("discovery/react-hooks-cleanup");
      expect(md).toContain("bugfix/n-plus-one-user-list");
      expect(md).toContain("session/2026-05-23-deck-refactor");
    });
  });

  // -------------------------------------------------------------------------
  // REQ-AMI-002: Suggested Topic Keys covering ≥7 work types per surface
  // -------------------------------------------------------------------------

  describe("Suggested Topic Keys section (REQ-AMI-002)", () => {
    for (const surface of surfaces) {
      test(`${surface} surface covers ≥7 work types`, () => {
        const fragment = bundle.instructions.find((f) => f.surface === surface);
        expect(fragment).toBeDefined();

        const count = countSuggestedTopicKeys(fragment!.markdown);
        expect(count).toBeGreaterThanOrEqual(7);
      });
    }

    test("agent surface covers all 7 required work types", () => {
      const fragment = bundle.instructions.find((f) => f.surface === "agent");
      expect(fragment).toBeDefined();

      const md = fragment!.markdown;
      const required = [
        "Architecture",
        "Bugfix",
        "Performance",
        "Config",
        "Preference",
        "Pattern",
        "Discovery",
      ];

      for (const workType of required) {
        expect(md).toContain(workType);
      }
    });
  });

  // -------------------------------------------------------------------------
  // REQ-AMI-003: Save Trigger Matrix covering ≥7 lifecycle moments per surface
  // -------------------------------------------------------------------------

  describe("Save Trigger Matrix section (REQ-AMI-003)", () => {
    for (const surface of surfaces) {
      test(`${surface} surface covers ≥7 lifecycle moments`, () => {
        const fragment = bundle.instructions.find((f) => f.surface === surface);
        expect(fragment).toBeDefined();

        const count = countSaveTriggerMatrix(fragment!.markdown);
        expect(count).toBeGreaterThanOrEqual(7);
      });
    }

    test("agent surface covers all 7 required lifecycle moments", () => {
      const fragment = bundle.instructions.find((f) => f.surface === "agent");
      expect(fragment).toBeDefined();

      const md = fragment!.markdown;
      const required = [
        "Architecture decision made",
        "Bug fix completed",
        "User preference learned",
        "Session close",
        "Non-obvious discovery",
        "Configuration change",
        "Pattern established",
      ];

      for (const moment of required) {
        expect(md).toContain(moment);
      }
    });
  });

  // -------------------------------------------------------------------------
  // REQ-AMI-004: No existing rule text is missing or contradicted (OpenSpec hierarchy + fail-open preserved)
  // -------------------------------------------------------------------------

  describe("backward compatibility (REQ-AMI-004)", () => {
    for (const surface of surfaces) {
      test(`${surface} surface preserves all canonical rule text`, () => {
        const fragment = bundle.instructions.find((f) => f.surface === surface);
        expect(fragment).toBeDefined();

        const md = fragment!.markdown;

        // Rules shared across all surfaces
        for (const rule of ALL_SURFACES_MUST_PRESERVE) {
          expect(md).toContain(rule);
        }

        // Additional rules only required for agent and skill surfaces
        if (surface === "agent" || surface === "skill") {
          for (const rule of AGENT_SKILL_ONLY_MUST_PRESERVE) {
            expect(md).toContain(rule);
          }
        }

        // Additional rules only for agent surface
        if (surface === "agent") {
          for (const rule of AGENT_ONLY_MUST_PRESERVE) {
            expect(md).toContain(rule);
          }
        }
      });
    }

    test("agent surface contains all three new sections", () => {
      const fragment = bundle.instructions.find((f) => f.surface === "agent");
      expect(fragment).toBeDefined();

      const md = fragment!.markdown;
      expect(md).toContain("### Decision Examples");
      expect(md).toContain("### Suggested Topic Keys");
      expect(md).toContain("### Save Trigger Matrix");
    });

    test("skill surface contains all three new sections", () => {
      const fragment = bundle.instructions.find((f) => f.surface === "skill");
      expect(fragment).toBeDefined();

      const md = fragment!.markdown;
      expect(md).toContain("### Decision Examples");
      expect(md).toContain("### Suggested Topic Keys");
      expect(md).toContain("### Save Trigger Matrix");
    });

    test("session surface contains all three new sections", () => {
      const fragment = bundle.instructions.find((f) => f.surface === "session");
      expect(fragment).toBeDefined();

      const md = fragment!.markdown;
      expect(md).toContain("### Decision Examples");
      expect(md).toContain("### Suggested Topic Keys");
      expect(md).toContain("### Save Trigger Matrix");
    });

    test("agent and skill surfaces contain Provider sections (session does not)", () => {
      const agent = bundle.instructions.find((f) => f.surface === "agent");
      const skill = bundle.instructions.find((f) => f.surface === "skill");
      const session = bundle.instructions.find((f) => f.surface === "session");

      expect(agent).toBeDefined();
      expect(skill).toBeDefined();
      expect(session).toBeDefined();

      // FIX(R31): Session NOW HAS Provider sections (required for orchestrator tool references)
      expect(session!.markdown).toContain("Provider: Supermemory");
      expect(session!.markdown).toContain("Provider: Engram");
      expect(session!.markdown).toContain("memory");
      expect(session!.markdown).toContain("recall");

      // Agent and skill have Provider sections (unchanged)
      expect(agent!.markdown).toContain("Provider: Supermemory");
      expect(agent!.markdown).toContain("Provider: Engram");
      expect(agent!.markdown).toContain("memory");
      expect(agent!.markdown).toContain("recall");

      expect(skill!.markdown).toContain("Provider: Supermemory");
      expect(skill!.markdown).toContain("Provider: Engram");
      expect(skill!.markdown).toContain("memory");
      expect(skill!.markdown).toContain("recall");
    });

    test("OpenSpec hierarchy (OFFICIAL CONTEXT) is preserved", () => {
      const agent = bundle.instructions.find((f) => f.surface === "agent");
      expect(agent).toBeDefined();

      const md = agent!.markdown;
      expect(md).toContain("OPENSPEC IS OFFICIAL CONTEXT");
      expect(md).toContain("ADAPTIVE MEMORY IS ADVISORY");
      expect(md).toContain("OpenSpec artifact wins");
    });

    test("Fail-open is preserved", () => {
      const agent = bundle.instructions.find((f) => f.surface === "agent");
      expect(agent).toBeDefined();

      const md = agent!.markdown;
      expect(md).toContain("Fail-Open");
      expect(md).toContain("continue working normally");
      expect(md).toContain("Never block agent work");
    });
  });
});