import { describe, expect, test } from "bun:test";

import {
  ORCHESTRATOR_AGENT_BODY,
  ORCHESTRATOR_SKILL_BODY,
  ORCHESTRATOR_SYSTEM_PROMPT,
} from "./orchestrator-prompt";

describe("ORCHESTRATOR_SYSTEM_PROMPT (re-exported from @deck/core)", () => {
  test("contains team identity header", () => {
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("# Deck Developer Team");
  });

  test("contains team-scoped agent IDs", () => {
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("deck-developer-orchestrator");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("deck-developer-explorer");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("deck-developer-archive");
  });

  test("contains role definition — orchestrator is coordinator, not executor", () => {
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("coordinator");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("delegate");
  });

  test("contains delegation rules table with inline vs delegate thresholds", () => {
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("Delegation Rules");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("4+");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("Multi-file");
  });

  test("contains mandatory delegation triggers", () => {
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("Mandatory Delegation Triggers");
  });

  test("contains SDD dependency graph", () => {
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("Dependency Graph");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("proposal");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("spec");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("design");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("tasks");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("apply");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("verify");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("archive");
  });

  test("notes that spec and design are parallel after proposal", () => {
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("parallel");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("Spec");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("Design");
  });

  test("notes that verify and review are separate parallel gates after apply", () => {
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("Verify");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("Review");
  });

  test("contains apply routing to general, backend, or frontend", () => {
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("General");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("Backend");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("Frontend");
  });

  test("references project AI notes under .deck/ai-notes/", () => {
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain(".deck/ai-notes/");
  });

  test("references skill injection via Project Standards", () => {
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("Project Standards");
  });

  test("does not contain OpenCode-specific model assignment details", () => {
    // Deck is runtime-agnostic; no hardcoded model aliases
    expect(ORCHESTRATOR_SYSTEM_PROMPT).not.toContain("claude-sonnet-4-20250514");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).not.toContain("Model Assignments");
  });

  test("does not reference slash commands (/sdd-new, /sdd-ff)", () => {
    // Deck Pi launcher uses `deck pi developer` profile; no slash commands needed
    expect(ORCHESTRATOR_SYSTEM_PROMPT).not.toContain("/sdd-new");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).not.toContain("/sdd-ff");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).not.toContain("/sdd-continue");
  });
});

describe("ORCHESTRATOR_AGENT_BODY", () => {
  test("contains identity and role header", () => {
    expect(ORCHESTRATOR_AGENT_BODY).toContain("# Orchestrator Agent");
  });

  test("states coordinator role, not executor", () => {
    expect(ORCHESTRATOR_AGENT_BODY).toContain("coordinator");
    expect(ORCHESTRATOR_AGENT_BODY).toContain("delegate");
  });

  test("contains delegation triggers section", () => {
    expect(ORCHESTRATOR_AGENT_BODY).toContain("Delegation Triggers");
    expect(ORCHESTRATOR_AGENT_BODY).toContain("4+");
  });

  test("contains instruction to follow matching skill", () => {
    expect(ORCHESTRATOR_AGENT_BODY).toContain("Follow the matching skill");
  });

  test("does not contain placeholder comment", () => {
    expect(ORCHESTRATOR_AGENT_BODY).not.toContain("Placeholder");
  });
});

describe("ORCHESTRATOR_SKILL_BODY", () => {
  test("contains skill title", () => {
    expect(ORCHESTRATOR_SKILL_BODY).toContain("# Orchestrator Skill");
  });

  test("contains SDD workflow methodology", () => {
    expect(ORCHESTRATOR_SKILL_BODY).toContain("SDD Workflow");
  });

  test("contains artifact persistence policy", () => {
    expect(ORCHESTRATOR_SKILL_BODY).toContain("Artifact Persistence");
  });

  test("does not contain old artifact store mode selection", () => {
    expect(ORCHESTRATOR_SKILL_BODY).not.toContain("| engram |");
    expect(ORCHESTRATOR_SKILL_BODY).not.toContain("| hybrid |");
  });

  test("does not contain chained PR or delivery strategy language", () => {
    expect(ORCHESTRATOR_SKILL_BODY).not.toContain("auto-chain");
    expect(ORCHESTRATOR_SKILL_BODY).not.toContain("Delivery Strategy");
    expect(ORCHESTRATOR_SKILL_BODY).not.toContain("Review Workload");
  });

  test("requires OpenSpec artifact persistence", () => {
    expect(ORCHESTRATOR_SKILL_BODY).toContain("openspec/");
    expect(ORCHESTRATOR_SKILL_BODY).toContain("required and non-optional");
  });

  test("contains project AI notes retrieval instructions", () => {
    expect(ORCHESTRATOR_SKILL_BODY).toContain("Project AI Notes");
    expect(ORCHESTRATOR_SKILL_BODY).toContain(".deck/ai-notes/");
  });

  test("contains skill resolution instructions", () => {
    expect(ORCHESTRATOR_SKILL_BODY).toContain("Skill Resolution");
  });

  test("does not contain placeholder comment", () => {
    expect(ORCHESTRATOR_SKILL_BODY).not.toContain("Placeholder");
  });
});
