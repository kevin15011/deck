import { describe, expect, test } from "bun:test";

import {
  EXPLORER_AGENT_BODY,
  EXPLORER_SKILL_BODY,
} from "./explorer-content";

// Import git-safety for rule presence assertion
import { GIT_SAFETY_SENTINEL } from "./git-safety";

// ---------------------------------------------------------------------------
// Placeholder detection — these tests guard against trivial/empty content
// ---------------------------------------------------------------------------

const PLACEHOLDER_SIGNALS = [
  "Placeholder",
  "TODO",
  "TBD",
  "Not yet implemented",
  "Coming soon",
  "placeholder",
];

function assertNotPlaceholder(content: string, label: string) {
  for (const signal of PLACEHOLDER_SIGNALS) {
    expect(content).not.toContain(signal);
  }
  // Must have substantial content (>500 chars means real prompt, not a stub)
  expect(content.length, `${label} should be >500 chars`).toBeGreaterThan(500);
}

// ---------------------------------------------------------------------------
// EXPLORER_AGENT_BODY
// ---------------------------------------------------------------------------

describe("EXPLORER_AGENT_BODY", () => {
  test("is not placeholder content", () => {
    assertNotPlaceholder(EXPLORER_AGENT_BODY, "EXPLORER_AGENT_BODY");
  });

  test("contains identity header with Explorer Agent name", () => {
    expect(EXPLORER_AGENT_BODY).toContain("# Explorer Agent");
  });

  test("states it investigates, does not implement", () => {
    expect(EXPLORER_AGENT_BODY).toMatch(/investigat/i);
    expect(EXPLORER_AGENT_BODY).toMatch(/do(es)? not implement/i);
  });

  test("contains team-scoped ID reference", () => {
    expect(EXPLORER_AGENT_BODY).toContain("deck-developer-explorer");
  });

  test("instructs to follow matching skill", () => {
    expect(EXPLORER_AGENT_BODY).toContain("Follow the matching skill");
  });

  test("does not reference Pi-specific launcher behavior", () => {
    expect(EXPLORER_AGENT_BODY).not.toContain("pi launcher");
    expect(EXPLORER_AGENT_BODY).not.toContain("deck pi");
    expect(EXPLORER_AGENT_BODY).not.toContain("/sdd-");
  });

  test("lists key non-goals: no code changes, no delegation, no specs", () => {
    expect(EXPLORER_AGENT_BODY).toMatch(/do(es)? not (modify|change|write|create|edit)/i);
    expect(EXPLORER_AGENT_BODY).toMatch(/do(es)? not delegate/i);
    expect(EXPLORER_AGENT_BODY).toMatch(/do(es)? not.*(create|write).*(spec|proposal)/i);
  });

  test("references structured findings output format", () => {
    expect(EXPLORER_AGENT_BODY).toMatch(/structured finding/i);
  });
});

// ---------------------------------------------------------------------------
// EXPLORER_SKILL_BODY
// ---------------------------------------------------------------------------

describe("EXPLORER_SKILL_BODY", () => {
  test("is not placeholder content", () => {
    assertNotPlaceholder(EXPLORER_SKILL_BODY, "EXPLORER_SKILL_BODY");
  });

  test("contains skill title", () => {
    expect(EXPLORER_SKILL_BODY).toContain("# Explorer Skill");
  });

  // --- Structured output format sections ---

  test("defines structured findings output with required sections", () => {
    expect(EXPLORER_SKILL_BODY).toMatch(/goal/i);
    expect(EXPLORER_SKILL_BODY).toMatch(/current.*(state|architecture)/i);
    expect(EXPLORER_SKILL_BODY).toMatch(/relevant.*(files|areas)/i);
    expect(EXPLORER_SKILL_BODY).toMatch(/constraint/i);
    expect(EXPLORER_SKILL_BODY).toMatch(/risk/i);
    expect(EXPLORER_SKILL_BODY).toMatch(/option|approach|tradeoff/i);
    expect(EXPLORER_SKILL_BODY).toMatch(/recommendation/i);
    expect(EXPLORER_SKILL_BODY).toMatch(/open.*(question|issue|item)/i);
  });

  // --- Tool preference ---

  test("prefers codebase graph/search tools for structural discovery", () => {
    expect(EXPLORER_SKILL_BODY).toMatch(/graph|knowledge graph|search_graph|codebase/i);
  });

  test("allows filesystem fallback when graph tools insufficient", () => {
    expect(EXPLORER_SKILL_BODY).toMatch(/fall.*back|fallback|filesystem|grep|glob/i);
  });

  // --- Constraints ---

  test("prohibits code modification", () => {
    expect(EXPLORER_SKILL_BODY).toMatch(/do not (modify|change|write|create|edit|implement)/i);
  });

  test("prohibits delegation", () => {
    expect(EXPLORER_SKILL_BODY).toMatch(/do not delegate/i);
  });

  test("advises against reading too broadly", () => {
    expect(EXPLORER_SKILL_BODY).toMatch(/avoid.*(broad|too much)|compress|summar|scope.*(narrow|focus)/i);
  });

  // --- Artifact persistence ---

  test("describes artifact persistence behavior", () => {
    expect(EXPLORER_SKILL_BODY).toMatch(/artifact|persist|store|openspec/i);
  });

  test("does not contain old artifact-store mode selection", () => {
    expect(EXPLORER_SKILL_BODY).not.toMatch(/engram \| openspec \| hybrid \| none/);
    expect(EXPLORER_SKILL_BODY).not.toContain("| engram |");
    expect(EXPLORER_SKILL_BODY).not.toContain("| hybrid |");
    expect(EXPLORER_SKILL_BODY).not.toContain("| none |");
  });

  test("requires OpenSpec artifact persistence", () => {
    expect(EXPLORER_SKILL_BODY).toContain("openspec/");
  });

  // --- Runtime neutrality ---

  test("does not reference Pi-specific behavior", () => {
    expect(EXPLORER_SKILL_BODY).not.toContain("pi launcher");
    expect(EXPLORER_SKILL_BODY).not.toContain("deck pi");
    expect(EXPLORER_SKILL_BODY).not.toContain("/sdd-");
    expect(EXPLORER_SKILL_BODY).not.toContain("claude-sonnet");
    expect(EXPLORER_SKILL_BODY).not.toContain("openai");
  });

  // --- Materially different from placeholder ---

  test("contains methodology steps that a placeholder would not have", () => {
    expect(EXPLORER_SKILL_BODY).toMatch(/step|phase|stage/i);
    expect(EXPLORER_SKILL_BODY).toMatch(/investigat|explor/i);
  });

  test("contains return format guidance for orchestrator consumption", () => {
    expect(EXPLORER_SKILL_BODY).toMatch(/return|output|report|findings/i);
  });
});

// ---------------------------------------------------------------------------
// Cross-check: Explorer content is distinct from Orchestrator content
// ---------------------------------------------------------------------------

describe("Explorer vs Orchestrator differentiation", () => {
  test("Explorer agent body does not contain orchestrator delegation rules", async () => {
    const { ORCHESTRATOR_AGENT_BODY } = await import("./orchestrator-content");
    // Explorer should NOT copy the orchestrator's delegation triggers
    expect(EXPLORER_AGENT_BODY).not.toContain("4-file rule");
    expect(EXPLORER_AGENT_BODY).not.toContain("Multi-file write rule");
    expect(EXPLORER_AGENT_BODY).not.toContain("Delegation Triggers");
    // Confirm orchestrator has them (sanity)
    expect(ORCHESTRATOR_AGENT_BODY).toContain("Delegation Triggers");
  });
});

// Git Safety Rule presence test
describe("Git Safety Rule presence", () => {
  test("AGENT_BODY contains critical Git discard protection rule", () => {
    expect(EXPLORER_AGENT_BODY).toContain(GIT_SAFETY_SENTINEL);
  });

  test("SKILL_BODY contains critical Git discard protection rule", () => {
    expect(EXPLORER_SKILL_BODY).toContain(GIT_SAFETY_SENTINEL);
  });
});

// Cognitive doc design canonical line test
describe("Cognitive doc design canonical line", () => {
  const CDD_CANONICAL_LINE =
    "Follow the cognitive-doc-design skill for artifact structure and documentation patterns.";

  test("SKILL_BODY contains cognitive-doc-design line exactly once", () => {
    const matches = EXPLORER_SKILL_BODY.split(CDD_CANONICAL_LINE).length - 1;
    expect(matches).toBe(1);
  });

  test("AGENT_BODY does NOT contain cognitive-doc-design line (immutability)", () => {
    expect(EXPLORER_AGENT_BODY).not.toContain(CDD_CANONICAL_LINE);
  });

  test("SKILL_BODY preserves ## Rules heading", () => {
    expect(EXPLORER_SKILL_BODY).toContain("## Rules");
  });
});
