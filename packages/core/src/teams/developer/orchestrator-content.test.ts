import { describe, expect, test } from "bun:test";

import {
  ORCHESTRATOR_AGENT_BODY,
  ORCHESTRATOR_SKILL_BODY,
  ORCHESTRATOR_SYSTEM_PROMPT,
} from "./orchestrator-content";

describe("ORCHESTRATOR_SYSTEM_PROMPT", () => {
  test("contains team identity header", () => {
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("# Deck Developer Team");
  });

  test("contains team-scoped agent IDs", () => {
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("deck-developer-orchestrator");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("deck-developer-explorer");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("deck-developer-proposal");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("deck-developer-spec");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("deck-developer-design");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("deck-developer-task");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("deck-developer-apply-general");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("deck-developer-verify");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("deck-developer-review");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("deck-developer-archive");
  });

  test("does not contain old non-team-scoped IDs", () => {
    expect(ORCHESTRATOR_SYSTEM_PROMPT).not.toContain("`deck-orchestrator`");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).not.toContain("`deck-explorer`");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).not.toContain("`deck-archive`");
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

  test("requires SDD triage before execution mode", () => {
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("SDD Triage Gate");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("Direct");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("Specialist only");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("Recommend SDD");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("Run SDD");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("Do not ask for Automatic vs Interactive until this triage says **Run SDD**");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("Documentation-only requests are not automatically SDD");
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

  test("does not contain runtime-specific model assignment details", () => {
    expect(ORCHESTRATOR_SYSTEM_PROMPT).not.toContain("claude-sonnet-4-20250514");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).not.toContain("Model Assignments");
  });

  test("does not reference slash commands (/sdd-new, /sdd-ff)", () => {
    expect(ORCHESTRATOR_SYSTEM_PROMPT).not.toContain("/sdd-new");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).not.toContain("/sdd-ff");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).not.toContain("/sdd-continue");
  });

  test("does not contain old artifact-store mode selection", () => {
    expect(ORCHESTRATOR_SYSTEM_PROMPT).not.toContain("| engram |");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).not.toContain("| hybrid |");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).not.toContain("| none |");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).not.toMatch(/engram.*openspec.*hybrid/);
  });

  test("does not contain chained PR or delivery strategy language", () => {
    expect(ORCHESTRATOR_SYSTEM_PROMPT).not.toContain("auto-chain");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).not.toContain("ask-on-risk");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).not.toContain("single-pr");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).not.toContain("exception-ok");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).not.toContain("size:exception");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).not.toContain("Delivery Strategy");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).not.toContain("Review Workload Guard");
  });

  test("requires OpenSpec artifacts", () => {
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("openspec/");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("required and non-optional");
  });

  test("describes memory as auxiliary", () => {
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toMatch(/memory.*auxiliary|auxiliary.*memory/i);
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

  test("contains instruction to follow matching skill with team-scoped ID", () => {
    expect(ORCHESTRATOR_AGENT_BODY).toContain("deck-developer-orchestrator");
    expect(ORCHESTRATOR_AGENT_BODY).toContain("Follow the matching skill");
  });

  test("mentions SDD triage in agent body", () => {
    expect(ORCHESTRATOR_AGENT_BODY).toContain("Run SDD triage before asking for execution mode");
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

  test("contains SDD triage categories in skill body", () => {
    expect(ORCHESTRATOR_SKILL_BODY).toContain("Triage Gate");
    expect(ORCHESTRATOR_SKILL_BODY).toContain("**Direct**");
    expect(ORCHESTRATOR_SKILL_BODY).toContain("**Specialist only**");
    expect(ORCHESTRATOR_SKILL_BODY).toContain("**Recommend SDD**");
    expect(ORCHESTRATOR_SKILL_BODY).toContain("**Run SDD**");
    expect(ORCHESTRATOR_SKILL_BODY).toContain("Do not infer full SDD from");
  });

  test("contains team-scoped agent IDs in phase routing table", () => {
    expect(ORCHESTRATOR_SKILL_BODY).toContain("deck-developer-explorer");
    expect(ORCHESTRATOR_SKILL_BODY).toContain("deck-developer-proposal");
    expect(ORCHESTRATOR_SKILL_BODY).toContain("deck-developer-spec");
    expect(ORCHESTRATOR_SKILL_BODY).toContain("deck-developer-design");
    expect(ORCHESTRATOR_SKILL_BODY).toContain("deck-developer-task");
    expect(ORCHESTRATOR_SKILL_BODY).toContain("deck-developer-apply-*");
    expect(ORCHESTRATOR_SKILL_BODY).toContain("deck-developer-verify");
    expect(ORCHESTRATOR_SKILL_BODY).toContain("deck-developer-review");
    expect(ORCHESTRATOR_SKILL_BODY).toContain("deck-developer-archive");
  });

  test("contains artifact persistence policy", () => {
    expect(ORCHESTRATOR_SKILL_BODY).toContain("Artifact Persistence");
  });

  test("does not contain old artifact store mode selection", () => {
    expect(ORCHESTRATOR_SKILL_BODY).not.toMatch(/engram.*openspec.*hybrid.*none/);
    expect(ORCHESTRATOR_SKILL_BODY).not.toContain("Artifact Store Policy");
    expect(ORCHESTRATOR_SKILL_BODY).not.toContain("| engram |");
    expect(ORCHESTRATOR_SKILL_BODY).not.toContain("| hybrid |");
  });

  test("does not contain chained PR or delivery strategy language", () => {
    expect(ORCHESTRATOR_SKILL_BODY).not.toContain("auto-chain");
    expect(ORCHESTRATOR_SKILL_BODY).not.toContain("ask-on-risk");
    expect(ORCHESTRATOR_SKILL_BODY).not.toContain("single-pr");
    expect(ORCHESTRATOR_SKILL_BODY).not.toContain("exception-ok");
    expect(ORCHESTRATOR_SKILL_BODY).not.toContain("size:exception");
    expect(ORCHESTRATOR_SKILL_BODY).not.toContain("Delivery Strategy");
    expect(ORCHESTRATOR_SKILL_BODY).not.toContain("Review Workload");
  });

  test("requires OpenSpec artifact persistence", () => {
    expect(ORCHESTRATOR_SKILL_BODY).toContain("openspec/");
    expect(ORCHESTRATOR_SKILL_BODY).toContain("required and non-optional");
  });

  test("describes memory as auxiliary only", () => {
    expect(ORCHESTRATOR_SKILL_BODY).toMatch(/memory.*auxiliary|auxiliary.*memory/i);
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
