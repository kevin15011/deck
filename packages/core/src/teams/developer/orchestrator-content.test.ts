import { describe, expect, test } from "bun:test";

import { ORCHESTRATOR_COMPACT_AGENT_BODY, ORCHESTRATOR_COMPACT_SKILL_BODY, ORCHESTRATOR_CONTINUOUS_DELIVERY_LOOP_V1, ORCHESTRATOR_INTAKE_ALIGNMENT_V2, ORCHESTRATOR_SYSTEM_PROMPT_COMPACT, PERSONALITY_COMMUNICATION_GUIDA, PERSONALITY_COMMUNICATION_PRAGMATICA, getOrchestratorSystemPrompt } from "./orchestrator-content";

import { SKILL_DISCOVERY_AUTHORITY_BOUNDARY_V1 } from "./skill-discovery-content";

// Import git-safety for rule presence assertion
import { GIT_SAFETY_SENTINEL } from "./git-safety";

describe("ORCHESTRATOR_SYSTEM_PROMPT", () => {

  test("uses the canonical targeted, affected, Review, broad convergence order and rejects caller-controlled deckExecution authority", () => {
    for (const prompt of [ORCHESTRATOR_SYSTEM_PROMPT_COMPACT]) {
      expect(prompt).toContain("targeted -> affected_area -> Review -> broad");
      expect(prompt).not.toMatch(/attach .*deckExecution|pass .*deckExecution/i);
      expect(prompt).not.toContain("deterministic-targeted-repair-authority-v1");
      expect(prompt).not.toContain("Verify + Review (parallel)");
      expect(prompt).not.toContain("Both run in parallel after Apply");
      expect(prompt).toMatch(/runner adapters? delete[s]? (any )?[`"]?deckExecution/i);
      expect(prompt).toMatch(/trusted process-local Deck provider/i);
      expect(prompt).toMatch(/V1 modifying authority/i);
      expect(prompt).toMatch(/fails closed/i);
    }
  });
});

describe("continuous conversational development", () => {
  const surfaces = [ORCHESTRATOR_SYSTEM_PROMPT_COMPACT, ORCHESTRATOR_COMPACT_AGENT_BODY, ORCHESTRATOR_COMPACT_SKILL_BODY];

  test("all canonical surfaces preserve one in-scope feedback loop", () => {
    for (const surface of surfaces) {
      expect(surface).toContain(ORCHESTRATOR_INTAKE_ALIGNMENT_V2);
      expect(surface).toContain(ORCHESTRATOR_CONTINUOUS_DELIVERY_LOOP_V1);
      expect(surface).toContain("move this up");
      expect(surface).toContain("without restarting intake or the full lifecycle");
      expect(surface).toContain("Recover and consume that receipt exactly once");
      expect(surface).not.toContain("Permit at most three user-requested revision cycles");
    }
  });
});

// ---------------------------------------------------------------------------
// Deterministic authority boundary (T-RA-01, T-RA-02)
// ---------------------------------------------------------------------------

describe("Deterministic authority boundary", () => {
  test("no prompt surface instructs the coordinator to attach or pass deckExecution to an Apply agent", () => {
    const surfaces = [ORCHESTRATOR_SYSTEM_PROMPT_COMPACT, ORCHESTRATOR_COMPACT_SKILL_BODY];
    for (const surface of surfaces) {
      expect(surface).not.toMatch(/attach.*deckExecution|pass.*deckExecution/i);
    }
  });

  test("system prompt and compact prompt state the accepted authority boundary", () => {
    for (const prompt of [ORCHESTRATOR_SYSTEM_PROMPT_COMPACT]) {
      expect(prompt).toMatch(/runner adapters? delete[s]? (any )?[`"]?deckExecution/i);
      expect(prompt).toMatch(/trusted process-local Deck provider/i);
      expect(prompt).toMatch(/V1 modifying authority/i);
      expect(prompt).toMatch(/fails closed/i);
    }
  });

  test("skill bodies state the accepted authority boundary and do not delegate through deckExecution", () => {
    for (const body of [ORCHESTRATOR_COMPACT_SKILL_BODY]) {
      expect(body).toMatch(/runner adapters? delete[s]? (any )?[`"]?deckExecution/i);
      expect(body).toMatch(/trusted process-local Deck provider/i);
      expect(body).toMatch(/V1 modifying authority/i);
      expect(body).toMatch(/fails closed/i);
      expect(body).not.toMatch(/attach.*deckExecution|pass.*deckExecution/i);
    }
  });
});

describe("T9 skill discovery prompt lifecycle", () => {
  const compactSurfaces = [
    ORCHESTRATOR_SYSTEM_PROMPT_COMPACT,
    ORCHESTRATOR_COMPACT_AGENT_BODY,
    ORCHESTRATOR_COMPACT_SKILL_BODY,
  ];
  const allSurfaces = [...compactSurfaces];

  const countOccurrences = (value: string, needle: string): number =>
    value.split(needle).length - 1;

  test("keeps the fixed authority boundary exactly once on every prompt surface", () => {
    for (const surface of allSurfaces) {
      expect(countOccurrences(surface, SKILL_DISCOVERY_AUTHORITY_BOUNDARY_V1)).toBe(1);
    }
  });

  test("adds bounded context projection without candidate or body injection", () => {
    for (const surface of allSurfaces) {
      expect(surface).toContain("Skill Discovery Context");
      expect(surface).toContain("registry_path");
      expect(surface).toContain("reason_code");
      expect(surface).toContain("active_runner_id");
      expect(surface).toContain("smallest relevant set");
      expect(surface).not.toContain("## Skill: ");
      expect(surface).not.toContain("loadReference");
      expect(surface).not.toContain("/home/");
    }
  });
});

// ---------------------------------------------------------------------------
// Personality Variants
// ---------------------------------------------------------------------------

describe("getOrchestratorSystemPrompt", () => {
  test("guia variant contains teaching tone indicators", () => {
    const guia = getOrchestratorSystemPrompt("guia");
    expect(guia).toContain("Communication Style — Guia");
    // Core present in composition
    expect(guia).toContain("# Deck Developer Team");
    // Still longer than core
    expect(guia.length).toBeGreaterThan(ORCHESTRATOR_SYSTEM_PROMPT_COMPACT.length);
  });

  test("default (no arg) returns pragmatica", () => {
    // @ts-expect-error - testing JS behavior where no arg returns pragmatica
    const defaultPrompt = getOrchestratorSystemPrompt();
    // Same as pragmatica variant
    expect(defaultPrompt).toContain("Communication Style — Pragmatica");
    expect(defaultPrompt).toContain("# Deck Developer Team");
  });

  test("both variants (guia and pragmatica) are pairwise distinct", () => {
    const guia = getOrchestratorSystemPrompt("guia");
    const pragmatica = getOrchestratorSystemPrompt("pragmatica");

    // guia is longest (expanded)
    expect(guia.length).toBeGreaterThan(pragmatica.length);
    // All distinct strings
    expect(guia).not.toBe(pragmatica);
  });
});

// ---------------------------------------------------------------------------
// Communication Layer Tests
// ---------------------------------------------------------------------------

describe("PERSONALITY_COMMUNICATION_GUIDA", () => {

  test("does not contain operational keywords (triage, routing, registry, recovery)", () => {
    // These are actual operational keywords that should NOT appear
    expect(PERSONALITY_COMMUNICATION_GUIDA).not.toMatch(/triage/i);
    expect(PERSONALITY_COMMUNICATION_GUIDA).not.toMatch(/routing/i);
    expect(PERSONALITY_COMMUNICATION_GUIDA).not.toMatch(/registry/i);
    expect(PERSONALITY_COMMUNICATION_GUIDA).not.toMatch(/recovery/i);
  });

  test("has reasonable line count (≤ 40 lines)", () => {
    const lines = PERSONALITY_COMMUNICATION_GUIDA.split("\n").length;
    expect(lines).toBeLessThanOrEqual(40);
  });
});

describe("PERSONALITY_COMMUNICATION_PRAGMATICA", () => {

  test("does not contain operational keywords (triage, routing, registry, recovery)", () => {
    // These are actual operational keywords that should NOT appear
    expect(PERSONALITY_COMMUNICATION_PRAGMATICA).not.toMatch(/triage/i);
    expect(PERSONALITY_COMMUNICATION_PRAGMATICA).not.toMatch(/routing/i);
    expect(PERSONALITY_COMMUNICATION_PRAGMATICA).not.toMatch(/registry/i);
    expect(PERSONALITY_COMMUNICATION_PRAGMATICA).not.toMatch(/recovery/i);
  });

  test("has reasonable line count (≤ 40 lines)", () => {
    const lines = PERSONALITY_COMMUNICATION_PRAGMATICA.split("\n").length;
    expect(lines).toBeLessThanOrEqual(40);
  });
});


const EXPLICIT_COMMIT_ONLY_RULE_V1_EXPECTED = `## Explicit Commit-Only Requests

Treat an explicit commit-only request as authorization to record the unambiguous intended snapshot, not as acceptance, verification, review, release, Archive, amend, push, branch change, or authority to widen scope.

1. Run bounded \`git status\`, relevant unstaged and staged \`git diff\`, and recent \`git log\` inspection.
2. If unrelated work or intended paths are ambiguous, ask once for the exact path set and stop; never infer permission to include unrelated work.
3. Stage only the explicitly intended paths with exact pathspecs. Never use broad staging that can capture unrelated work. Re-check staged status and \`git diff --cached\` before committing.
4. Apply bounded, risk-relevant secret and safety checks without exposing sensitive values. A secret match, protected-risk question, excluded target, or unclear safety judgment stops the commit or routes the judgment to the appropriate specialist.
5. Execute only the explicitly requested commit with the requested or repository-consistent message. Do not amend, push, change branches, release, Archive, or perform any destructive Git operation unless separately authorized; destructive operations still require the canonical new-message, exact-command confirmation flow.
6. Do not launch Verify or Review solely because a commit was requested. If current final independent QA evidence does not bind to the exact committed subject and dependencies, report the commit as an **unverified snapshot**. Never imply acceptance, release readiness, Archive readiness, or commit-ready registry evidence.`;

describe("streamlined Orchestrator ownership and candidate validation", () => {
  const surfaces = [["compact session", ORCHESTRATOR_SYSTEM_PROMPT_COMPACT], ["compact agent", ORCHESTRATOR_COMPACT_AGENT_BODY], ["compact skill", ORCHESTRATOR_COMPACT_SKILL_BODY]] as const;

  test("removes pure-delegator prohibitions from every surface", () => {
    for (const [, surface] of surfaces) {
      expect(surface).not.toContain("Pure Delegator");
      expect(surface).not.toContain("delegate everything");
      expect(surface).not.toContain("never execute any specialist-capable task");
      expect(surface).not.toContain("never execute specialized agent work itself");
    }
  });

  test("composes every shared fragment exactly once in all six legacy and compact surfaces", async () => {
    const exports = await import("./orchestrator-content");
    const fragmentNames = [
      "ORCHESTRATOR_OWNERSHIP_BOUNDARY_V1",
      "ORCHESTRATOR_PRE_QA_FUNCTIONAL_LOOP_V1",
      "ORCHESTRATOR_PHASE_DECISION_ABSORPTION_V1",
      "ORCHESTRATOR_EXPLICIT_COMMIT_ONLY_RULE_V1",
    ] as const;

    for (const name of fragmentNames) {
      expect(name in exports).toBe(true);
      const fragment = (exports as unknown as Record<string, string>)[name];
      for (const [surfaceName, surface] of surfaces) {
        expect(surface.split(fragment).length - 1, `${name} composition count in ${surfaceName}`).toBe(1);
      }
    }

    expect((exports as unknown as Record<string, string>).ORCHESTRATOR_EXPLICIT_COMMIT_ONLY_RULE_V1).toBe(EXPLICIT_COMMIT_ONLY_RULE_V1_EXPECTED);
  });

  test("requires the non-destructive condition through the canonical ownership fragment on all six surfaces", async () => {
    const { ORCHESTRATOR_OWNERSHIP_BOUNDARY_V1: ownership } = await import("./orchestrator-content");
    const directOwnershipPredicate =
      "bounded, mechanical, deterministic, explicitly authorized, non-destructive, and requires no specialist implementation or judgment";

    expect(ownership).toContain(directOwnershipPredicate);
    expect(ownership.split("non-destructive").length - 1).toBe(1);
    for (const [surfaceName, surface] of surfaces) {
      expect(surface).toContain(directOwnershipPredicate);
      expect(surface.split("non-destructive").length - 1, `non-destructive count in ${surfaceName}`).toBe(1);
    }
  });

  test("locks relevant unstaged/staged diff inspection and exact commit handling", async () => {
    const { ORCHESTRATOR_EXPLICIT_COMMIT_ONLY_RULE_V1: commitOnly } = await import("./orchestrator-content");
    expect(commitOnly).toContain("relevant unstaged and staged `git diff`");
    expect(commitOnly).toContain("recent `git log`");
    expect(commitOnly).toContain("Stage only the explicitly intended paths with exact pathspecs");
    expect(commitOnly).toContain("Execute only the explicitly requested commit");
  });
});
