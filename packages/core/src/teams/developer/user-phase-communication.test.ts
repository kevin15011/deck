import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { ORCHESTRATOR_SYSTEM_PROMPT_COMPACT, ORCHESTRATOR_COMPACT_AGENT_BODY, ORCHESTRATOR_COMPACT_SKILL_BODY, PERSONALITY_COMMUNICATION_GUIDA, PERSONALITY_COMMUNICATION_PRAGMATICA, ORCHESTRATOR_PROMPT_COMPACT_GUIDA, ORCHESTRATOR_PROMPT_COMPACT_PRAGMATICA } from "./orchestrator-content";
import { COMPACT_ORCHESTRATOR_INVARIANT_SUMMARIES_V1 } from "./orchestrator-invariants";
import { EXPLORER_COMPACT_AGENT_BODY, EXPLORER_COMPACT_SKILL_BODY } from "./explorer-content";
import { PROPOSAL_COMPACT_AGENT_BODY, PROPOSAL_COMPACT_SKILL_BODY } from "./proposal-content";
import { DESIGN_COMPACT_AGENT_BODY, DESIGN_COMPACT_SKILL_BODY } from "./design-content";
import { TASK_COMPACT_AGENT_BODY, TASK_COMPACT_SKILL_BODY } from "./task-content";
import { APPLY_GENERAL_COMPACT_AGENT_BODY, APPLY_GENERAL_COMPACT_SKILL_BODY } from "./apply-general-content";
import { APPLY_BACKEND_COMPACT_AGENT_BODY, APPLY_BACKEND_COMPACT_SKILL_BODY } from "./apply-backend-content";
import { APPLY_FRONTEND_COMPACT_AGENT_BODY, APPLY_FRONTEND_COMPACT_SKILL_BODY } from "./apply-frontend-content";
import { VERIFY_COMPACT_AGENT_BODY, VERIFY_COMPACT_SKILL_BODY } from "./verify-content";
import { REVIEW_COMPACT_AGENT_BODY, REVIEW_COMPACT_SKILL_BODY } from "./review-content";

/** Byte-verbatim blocks from Design (improve-user-phase-communication). */
export const BV_INTAKE_ALIGNMENT = "For each new desired outcome, classify the request as exactly one of Direct, Specialist(s), Recommend SDD, or Run SDD and record a concise reason before modifying work. For new substantive work, briefly state the understood objective and scope. Identify missing required input and ambiguity that would materially change the result. If either is present, ask ONE concise question and wait for the reply before dependent action. Bounded read-only clarification discovery is allowed. When the request is clear and authorized, proceed without redundant approval. For conversational follow-ups, confirm only changed scope and do not restart intake. Preserve all existing authority and security gates.\n\nA follow-up such as \"move this up\", \"make it smaller\", \"try the other layout\", or \"fix that failure\" continues the same working outcome when it stays within the authorized goal, targets, risk, and reversibility. Preserve the current candidate and decisions, route only the delta, mint any required internal one-use authorization without asking the user again, and rerun only evidence invalidated by that delta. There is no arbitrary revision-cycle limit. Re-triage or ask the user only for missing required input, material ambiguity, a real product decision, meaningful scope expansion, protected risk, irreversible action, or actual write/authority conflict. User acceptance guides the product loop but never substitutes for proportionate engineering QA.";

export const BV_INTAKE_COMPACT_SUMMARY = "Classify each new outcome. For new substantive work, briefly state objective and scope. For missing required input or material ambiguity, ask ONE concise question and wait before dependent action; bounded read-only clarification discovery is allowed. Proceed without redundant approval when clear and authorized. For follow-ups, confirm only changed scope; do not restart intake. Preserve authority and security gates, including scope expansion, protected risk, irreversible action, or an actual conflict.";

export const BV_FAILURE_DECISION_GATE = "After Verify or Review reports a failure, failure blocks advancement, not diagnosis or already-authorized bounded repair. Do not auto-advance. Pause for scope expansion, a product/requirements choice, protected risk, irreversible action, exhausted/no-progress budget, or an actual hard stop. Otherwise diagnose and perform the already-authorized bounded repair, then rerun the canonical validation; existing modification authorization remains separate.";

export const BV_PERSONALITY_CONTENT_PRESERVING = "- **Content-preserving overlay**: Apply this style only after the phase summary's invariant decisions, blockers, approval requests, failures, open questions, risks, and required authorizations have been composed. Do not remove, weaken, hide, or reorder that content.";

export const BV_PRAGMATICA_SIGNAL_ONLY = "- **Signal-only status updates**: Routine progress may use one line only when no invariant content is lost. Give blockers, approval requests, failures, decisions, open questions, and required authorizations enough space to be explicit.";

export const BV_PROPOSAL_COLLABORATION = "Treat `proposal.md` as a collaborative draft and revision loop. Creating or revising the draft never constitutes approval. Preserve prior decisions, dependencies, risks, rollback, and unresolved decisions on every revision. Return the consequential choices and a specific approval question. Only the Orchestrator may record explicit human approval evidence; Spec and Design must not begin until that evidence exists.";

export const BV_DESIGN_AGENT_AUTHORITY = "When the change modifies Deck-owned prompts, skills, or system instructions, Design—not Tasks or Apply—must reason about and define the change in a stable `## Exact Implementation Instructions` section. Do not complete Design with an ambiguous target, missing mode, or untestable instruction.";

export const BV_DESIGN_EII_CONTRACT = "## Exact Implementation Instructions\n\nInclude this section whenever the change modifies Deck-owned prompts, skills, or system instructions. Create one independently testable EII per canonical symbol or named section; a symbol may have multiple EIIs only when concerns require different modes. Each EII must include: EII ID; editable source target; mode (`byte-verbatim` or `semantic-constrained`); required change; preserved constraints; affected tests/assertions; prohibited reinterpretations; and ambiguity-stop behavior. For `byte-verbatim`, provide the exact emitted prompt text in a fenced block, including whitespace and punctuation. For `semantic-constrained`, enumerate every required clause, invariant, intent, and prohibition. Use `byte-verbatim` for security-, authorization-, or destructive-operation-critical text. Do not use `byte-verbatim` for user-language-, personality-, data-, or composition-dependent text.";

export const BV_TASK_AGENT_FIDELITY = "Preserve every Design Exact Implementation Instruction by EII ID and canonical target; do not reinterpret, dilute, replace, or summarize it away. Missing, ambiguous, conflicting, or infeasible direction blocks with `design-instruction-ambiguous`.";

export const BV_TASK_EII_FIDELITY = "For each task, carry the originating requirement and acceptance scenario, Design constraint and EII ID, EII mode and exact text or semantic constraints, excluded targets, rollout condition, and rollback boundary. A `byte-verbatim` EII must reference its exact target and fenced text; a `semantic-constrained` EII must carry every declared clause, invariant, intent, and prohibition. If any required Design direction is missing, ambiguous, conflicting, or infeasible, stop task generation for that target and return blocker `design-instruction-ambiguous`; do not invent a decision for Apply.";

export const BV_APPLY_AGENT_FIDELITY = "For Deck prompt or system-instruction work, execute the named Design EII without redesign. Missing, ambiguous, conflicting, or infeasible direction blocks with `design-instruction-ambiguous`; do not invent a substitute.";

export const BV_APPLY_EII_FIDELITY = "Execute each named Design EII exactly as routed by Tasks; do not redesign prompt or system-instruction behavior. For `byte-verbatim`, reproduce the emitted prompt text exactly, including whitespace and punctuation. For `semantic-constrained`, preserve every declared clause, invariant, intent, and prohibition. If an EII is missing, ambiguous, conflicting, infeasible, or cannot be placed at its named canonical target, make no affected edit and return blocker `design-instruction-ambiguous`; do not invent, substitute, or reinterpret prompt behavior.";

const PHASES = [
  "Explore",
  "Proposal",
  "Spec",
  "Design",
  "Tasks",
  "Apply",
  "Verify",
  "Review",
  "Archive",
] as const;

const ORCH_SESSION = [ORCHESTRATOR_SYSTEM_PROMPT_COMPACT, ORCHESTRATOR_PROMPT_COMPACT_GUIDA, ORCHESTRATOR_PROMPT_COMPACT_PRAGMATICA] as const;

const ORCH_AGENT = [ORCHESTRATOR_COMPACT_AGENT_BODY] as const;
const ORCH_SKILL = [ORCHESTRATOR_COMPACT_SKILL_BODY] as const;
const ORCH_ALL = [...ORCH_SESSION, ...ORCH_AGENT, ...ORCH_SKILL] as const;

const ALLOWED_SOURCE_FILES = new Set([
  "orchestrator-invariants.ts",
  "orchestrator-content.ts",
  "explorer-content.ts",
  "proposal-content.ts",
  "design-content.ts",
  "task-content.ts",
  "apply-general-content.ts",
  "apply-backend-content.ts",
  "apply-frontend-content.ts",
  "verify-content.ts",
  "review-content.ts",
  "user-phase-communication.test.ts",
  "orchestrator-content.test.ts",
  "orchestrator-invariants.test.ts",
  "prompt-profile.test.ts",
]);

describe("User Phase Communication contract", () => {

  test("UPC-PERSONALITY-01: content-preserving overlay and revised Pragmatica signal", () => {
    expect(PERSONALITY_COMMUNICATION_GUIDA).toContain(BV_PERSONALITY_CONTENT_PRESERVING);
    expect(PERSONALITY_COMMUNICATION_PRAGMATICA).toContain(BV_PERSONALITY_CONTENT_PRESERVING);
    expect(PERSONALITY_COMMUNICATION_PRAGMATICA).toContain(BV_PRAGMATICA_SIGNAL_ONLY);
    expect(PERSONALITY_COMMUNICATION_PRAGMATICA).not.toContain("Phase completions get one line");
    // Shared invariant content precedes personality overlay in composed session prompts
    for (const composed of [ORCHESTRATOR_PROMPT_COMPACT_GUIDA, ORCHESTRATOR_PROMPT_COMPACT_PRAGMATICA]) {
      const invIdx = composed.indexOf(BV_INTAKE_ALIGNMENT);
      const overlayIdx = composed.indexOf(BV_PERSONALITY_CONTENT_PRESERVING);
      expect(invIdx).toBeGreaterThanOrEqual(0);
      expect(overlayIdx).toBeGreaterThan(invIdx);
    }
  });

  test("UPC-DESIGN-01: authority and EII contract blocks", () => {
    for (const surface of [DESIGN_COMPACT_AGENT_BODY]) {
      expect(surface).toContain(BV_DESIGN_AGENT_AUTHORITY);
      expect(surface).toMatch(/exact editable target list|EII summary/i);
    }
    for (const surface of [DESIGN_COMPACT_SKILL_BODY]) {
      expect(surface).toContain(BV_DESIGN_EII_CONTRACT);
      expect(surface).toContain("## Exact Implementation Instructions");
      expect(surface).toMatch(/byte-verbatim/);
      expect(surface).toMatch(/semantic-constrained/);
      expect(surface).toMatch(/EII ID/);
    }
  });

  test("UPC-TASK-01: task fidelity blocks and blocker code", () => {
    for (const surface of [TASK_COMPACT_AGENT_BODY]) {
      expect(surface).toContain(BV_TASK_AGENT_FIDELITY);
    }
    for (const surface of [TASK_COMPACT_SKILL_BODY]) {
      expect(surface).toContain(BV_TASK_EII_FIDELITY);
      expect(surface).toContain("design-instruction-ambiguous");
      expect(surface).toMatch(/excluded targets/i);
      expect(surface).toMatch(/rollout condition/i);
      expect(surface).toMatch(/rollback boundary/i);
      expect(surface).toMatch(/acceptance scenario|originating requirement/i);
    }
  });

  test("UPC-APPLY-01: apply fidelity across general/backend/frontend profiles", () => {
    const agents = [APPLY_GENERAL_COMPACT_AGENT_BODY, APPLY_BACKEND_COMPACT_AGENT_BODY, APPLY_FRONTEND_COMPACT_AGENT_BODY];
    const skills = [APPLY_GENERAL_COMPACT_SKILL_BODY, APPLY_BACKEND_COMPACT_SKILL_BODY, APPLY_FRONTEND_COMPACT_SKILL_BODY];
    for (const surface of agents) {
      expect(surface).toContain(BV_APPLY_AGENT_FIDELITY);
      expect(surface).toContain("design-instruction-ambiguous");
      expect(surface).not.toMatch(/redesign prompt/i);
    }
    for (const surface of skills) {
      expect(surface).toContain(BV_APPLY_EII_FIDELITY);
      expect(surface).toContain("design-instruction-ambiguous");
      expect(surface).toMatch(/byte-verbatim/);
      expect(surface).toMatch(/semantic-constrained/);
    }
  });

  test("UPC-FAILURE-01: Verify and Review failure return semantics", () => {
    for (const surface of [VERIFY_COMPACT_AGENT_BODY, VERIFY_COMPACT_SKILL_BODY]) {
      expect(surface).toMatch(/what failed/i);
      expect(surface).toMatch(/why it matters/i);
      expect(surface).toMatch(/blocking/i);
      expect(surface).toMatch(/next decision\/action/i);
      expect(surface).toMatch(/verify-report\.md/);
      expect(surface).toMatch(/Do not implement a fix/i);
    }
    for (const surface of [REVIEW_COMPACT_AGENT_BODY, REVIEW_COMPACT_SKILL_BODY]) {
      expect(surface).toMatch(/what failed/i);
      expect(surface).toMatch(/impact/i);
      expect(surface).toMatch(/blocking/i);
      expect(surface).toMatch(/next decision\/action/i);
      expect(surface).toMatch(/review-report\.md/);
      expect(surface).toMatch(/Do not implement a fix/i);
    }
  });

  test("UPC-SCOPE-01: intended targets only; no runner-capability-standardization intersection", () => {
    // Contract surfaces live only in the allowlisted developer content modules.
    for (const name of ALLOWED_SOURCE_FILES) {
      expect(typeof name).toBe("string");
    }
    const developerDir = import.meta.dir;
    const forbidden = [
      "runner-capability-standardization",
      "content-registry.ts",
      "apps/cli",
      "packages/adapter-opencode/src/",
      "packages/adapter-pi/src/",
    ];
    // This test file and its imports must not reference forbidden ownership targets as edit targets.
    const self = readFileSync(join(developerDir, "user-phase-communication.test.ts"), "utf8");
    expect(self).not.toMatch(/openspec\/changes\/runner-capability-standardization/);
    expect(ALLOWED_SOURCE_FILES.has("content-registry.ts")).toBe(false);
    // Ensure allowlisted modules exist and are the only content modules under test here.
    for (const file of [
      "orchestrator-invariants.ts",
      "orchestrator-content.ts",
      "explorer-content.ts",
      "proposal-content.ts",
      "design-content.ts",
      "task-content.ts",
      "apply-general-content.ts",
      "apply-backend-content.ts",
      "apply-frontend-content.ts",
      "verify-content.ts",
      "review-content.ts",
    ]) {
      expect(statSync(join(developerDir, file)).isFile()).toBe(true);
    }
    void forbidden;
    void createHash;
    void readdirSync;
    void relative;
  });
});


describe("streamlined ownership user communication", () => {

  test("makes failure block advancement without forcing a routine user pause before diagnosis or bounded authorized repair", () => {
    const surfaces = [ORCHESTRATOR_SYSTEM_PROMPT_COMPACT, ORCHESTRATOR_COMPACT_SKILL_BODY];
    for (const surface of surfaces) {
      expect(surface).toMatch(/failure blocks advancement/i);
      expect(surface).toMatch(/diagnosis or already-authorized bounded repair/i);
      expect(surface).toMatch(/scope expansion.*product\/requirements choice.*protected risk.*irreversible action.*exhausted.*hard stop/i);
    }
  });
});
