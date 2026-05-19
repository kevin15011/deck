import { describe, expect, test } from "bun:test";

import { getAgentContent, getTeamSessionInstructions } from "./content-registry";

const DEVELOPER_AGENT_IDS = [
  "deck-developer-orchestrator",
  "deck-developer-explorer",
  "deck-developer-proposal",
  "deck-developer-spec",
  "deck-developer-design",
  "deck-developer-task",
  "deck-developer-apply-general",
  "deck-developer-apply-backend",
  "deck-developer-apply-frontend",
  "deck-developer-verify",
  "deck-developer-review",
  "deck-developer-archive",
] as const;

const REGISTRY_WRITER_AGENT_IDS = DEVELOPER_AGENT_IDS.filter(
  (id) => id !== "deck-developer-orchestrator",
);

const PLANNING_AGENT_IDS = [
  "deck-developer-proposal",
  "deck-developer-spec",
  "deck-developer-design",
  "deck-developer-task",
] as const;

// ---------------------------------------------------------------------------
// getAgentContent
// ---------------------------------------------------------------------------

describe("getAgentContent", () => {
  test("returns content for orchestrator agent", () => {
    const content = getAgentContent("deck-developer-orchestrator");
    expect(content).toBeDefined();
    expect(content!.agentBody).toContain("# Orchestrator Agent");
    expect(content!.skillBody).toContain("# Orchestrator Skill");
    expect(content!.agentBody.length).toBeGreaterThan(200);
    expect(content!.skillBody.length).toBeGreaterThan(200);
  });

  test("returns content for explorer agent", () => {
    const content = getAgentContent("deck-developer-explorer");
    expect(content).toBeDefined();
    expect(content!.agentBody).toContain("# Explorer Agent");
    expect(content!.skillBody).toContain("# Explorer Skill");
    expect(content!.agentBody.length).toBeGreaterThan(200);
    expect(content!.skillBody.length).toBeGreaterThan(200);
  });

  test("returns real content for proposal agent", () => {
    const content = getAgentContent("deck-developer-proposal");
    expect(content).toBeDefined();
    expect(content!.agentBody).toContain("# Proposal Agent");
    expect(content!.skillBody).toContain("# Proposal Skill");
    expect(content!.agentBody.length).toBeGreaterThan(200);
    expect(content!.skillBody.length).toBeGreaterThan(200);
  });

  test("returns real content for spec agent", () => {
    const content = getAgentContent("deck-developer-spec");
    expect(content).toBeDefined();
    expect(content!.agentBody).toContain("# Spec Agent");
    expect(content!.skillBody).toContain("# Spec Skill");
    expect(content!.agentBody.length).toBeGreaterThan(200);
    expect(content!.skillBody.length).toBeGreaterThan(200);
    // Not placeholder
    expect(content!.agentBody).not.toContain("Placeholder");
    expect(content!.skillBody).not.toContain("Placeholder");
  });

  test("returns real content for design agent", () => {
    const content = getAgentContent("deck-developer-design");
    expect(content).toBeDefined();
    expect(content!.agentBody).toContain("# Design Agent");
    expect(content!.skillBody).toContain("# Design Skill");
    expect(content!.agentBody.length).toBeGreaterThan(200);
    expect(content!.skillBody.length).toBeGreaterThan(200);
    // Not placeholder
    expect(content!.agentBody).not.toContain("Placeholder");
    expect(content!.skillBody).not.toContain("Placeholder");
  });

  test("returns content for all 12 agents — no undefined gaps", () => {
    for (const id of DEVELOPER_AGENT_IDS) {
      const content = getAgentContent(id);
      expect(content).toBeDefined();
      expect(content!.agentBody).toBeTruthy();
      expect(content!.skillBody).toBeTruthy();
    }
  });

  test("returns undefined for unknown agent ID", () => {
    expect(getAgentContent("unknown-agent")).toBeUndefined();
    expect(getAgentContent("deck-orchestrator")).toBeUndefined();
  });

  test("all catalog agent content is not placeholder", () => {
    for (const id of DEVELOPER_AGENT_IDS) {
      const content = getAgentContent(id)!;
      expect(content.agentBody).not.toContain("Placeholder");
      expect(content.skillBody).not.toContain("Placeholder");
    }
  });

  test("artifact-writing agents require Spec Registry state and events", () => {
    for (const id of DEVELOPER_AGENT_IDS) {
      const content = getAgentContent(id)!;
      const combined = `${content.agentBody}\n${content.skillBody}`;
      expect(combined, id).toContain("Spec Registry");
      expect(combined, id).toContain("state.yaml");
      expect(combined, id).toContain("events.yaml");
    }
  });

  test("artifact-writing agents require merge/append registry updates", () => {
    for (const id of REGISTRY_WRITER_AGENT_IDS) {
      const content = getAgentContent(id)!;
      const combined = `${content.agentBody}\n${content.skillBody}`;
      expect(combined, id).toContain("Read existing");
      expect(combined, id).toContain("Merge phase");
      expect(combined, id).toContain("preserve previous artifacts");
      expect(combined, id).toContain("Append");
      expect(combined, id).toContain("preserve previous events");
      expect(combined, id).toContain("Never overwrite or drop previous phase artifacts or events");
      expect(combined, id).toContain("Registry Blocker");
    }
  });

  test("orchestrator rejects registry history resets", () => {
    const content = getAgentContent("deck-developer-orchestrator")!;
    const combined = `${content.agentBody}\n${content.skillBody}`;
    expect(combined).toContain("merge new state without dropping prior artifacts/provenance");
    expect(combined).toContain("append new events without dropping prior events");
    expect(combined).toContain("Reject or request repair");
    expect(combined).toContain("reset/dropped prior registry history");
  });

  test("orchestrator serializes registry reconciliation for parallel phases", () => {
    const content = getAgentContent("deck-developer-orchestrator")!;
    const combined = `${content.agentBody}\n${content.skillBody}`;
    expect(combined).toContain("Spec+Design");
    expect(combined).toContain("Verify+Review");
    expect(combined).toContain("registry-deferred mode");
    expect(combined).toContain("serializes the shared");
    expect(combined).toContain("deterministic serialized merge");
    expect(combined).toContain("do not advance until reconciliation proves");
  });

  test("planning prompts avoid hard word budgets", () => {
    for (const id of PLANNING_AGENT_IDS) {
      const content = getAgentContent(id)!;
      const combined = `${content.agentBody}\n${content.skillBody}`;
      expect(combined, id).not.toMatch(/Size budget/i);
      expect(combined, id).not.toMatch(/MUST be under \d+ words/i);
      expect(combined, id).not.toMatch(/under \d+ words/i);
    }
  });

  test("planning prompts require quality-focused conciseness", () => {
    for (const id of PLANNING_AGENT_IDS) {
      const content = getAgentContent(id)!;
      const combined = `${content.agentBody}\n${content.skillBody}`;
      expect(combined, id).toContain("compact as possible without omitting required fields");
      expect(combined, id).toMatch(/do not merge unrelated/i);
    }
  });

  test("task prompt requires self-check and forbids broad exploration", () => {
    const content = getAgentContent("deck-developer-task")!;
    const combined = `${content.agentBody}\n${content.skillBody}`;
    expect(combined).toContain("Required Self-Check Before Return");
    expect(combined).toContain("Every task has **Owner**, **Priority**, **Complexity**, **Parallel**, **Depends on**, **Files**, and **Verification** fields");
    expect(combined).toContain("Complexity Summary counts exactly match the task IDs");
    expect(combined).toContain("Every dependency reference points to a valid task ID");
    expect(combined).toContain("Review Workload Forecast is present");
    expect(combined).toContain("Open Questions / Blockers are classified");
    expect(combined).toContain("Do not perform broad exploration");
    expect(combined).toContain("explicit current-state/context provided by the Orchestrator");
  });

  test("orchestrator repairs contract violations and gates Apply blockers", () => {
    const content = getAgentContent("deck-developer-orchestrator")!;
    const combined = `${content.agentBody}\n${content.skillBody}`;
    expect(combined).toContain("violates the exact return contract");
    expect(combined).toContain("wrong or non-requested language");
    expect(combined).toContain("format mismatch");
    expect(combined).toContain("omits required fields");
    expect(combined).toContain("inconsistent counts");
    expect(combined).toContain("bad registry status/intent");
    expect(combined).toContain("misses the required review workload forecast");
    expect(combined).toContain("blocker handling unexplained");
    expect(combined).toContain("classify tasks as unblocked, blocked, or allowed-with-placeholder");
    expect(combined).toContain("Do not launch Apply for blocked tasks");
  });

  test("parallel phase agents support registry-deferred mode", () => {
    const parallelPhaseAgentIds = [
      "deck-developer-spec",
      "deck-developer-design",
      "deck-developer-verify",
      "deck-developer-review",
    ] as const;

    for (const id of parallelPhaseAgentIds) {
      const content = getAgentContent(id)!;
      const combined = `${content.agentBody}\n${content.skillBody}`;
      expect(combined, id).toContain("registry-deferred mode");
      expect(combined, id).toContain("do not write shared");
      expect(combined, id).toContain("Registry Write");
      expect(combined, id).toContain("Registry Intent");
      expect(combined, id).toContain("In default/non-parallel mode, perform the merge/append registry update yourself");
      expect(combined, id).toContain("Never overwrite or drop previous phase artifacts or events");
    }
  });

  test("archive prompt requires moving archived changes out of changes", () => {
    const content = getAgentContent("deck-developer-archive")!;
    const combined = `${content.agentBody}\n${content.skillBody}`;
    expect(combined).toContain("remove the source change directory");
    expect(combined).toContain("Archive means move, not duplicate");
    expect(combined).toContain("If cleanup fails");
  });

  test("core prompts do not hardcode Engram topic-key artifact locations", () => {
    for (const id of DEVELOPER_AGENT_IDS) {
      const content = getAgentContent(id)!;
      const combined = `${content.agentBody}\n${content.skillBody}`;
      expect(combined, id).not.toMatch(/engram topic key/i);
    }
  });

  test("old artifact-store modes remain absent across core prompts", () => {
    for (const id of DEVELOPER_AGENT_IDS) {
      const content = getAgentContent(id)!;
      const combined = `${content.agentBody}\n${content.skillBody}`;
      expect(combined, id).not.toMatch(/engram\s*\|\s*openspec\s*\|\s*hybrid\s*\|\s*none/i);
      expect(combined, id).not.toContain("| engram |");
      expect(combined, id).not.toContain("| hybrid |");
      expect(combined, id).not.toContain("| none |");
    }
  });

  test("real agents contain their display name", () => {
    const proposal = getAgentContent("deck-developer-proposal")!;
    expect(proposal.agentBody).toContain("Proposal Agent");

    const verify = getAgentContent("deck-developer-verify")!;
    expect(verify.agentBody).toContain("Verify Agent");
  });
});

// ---------------------------------------------------------------------------
// getTeamSessionInstructions
// ---------------------------------------------------------------------------

describe("getTeamSessionInstructions", () => {
  test("returns real orchestrator session instructions for developer-team", () => {
    const instructions = getTeamSessionInstructions("developer-team");
    expect(instructions).toBeDefined();
    expect(instructions).toContain("# Deck Developer Team");
    expect(instructions).toContain("deck-developer-orchestrator");
    expect(instructions).toContain("Delegation Rules");
    expect(instructions).toContain("Dependency Graph");
    // Not placeholder
    expect(instructions).not.toContain("Follow the team's established workflow");
  });

  test("returns undefined for unknown team", () => {
    expect(getTeamSessionInstructions("unknown-team")).toBeUndefined();
  });

  test("session instructions contain all agent role references", () => {
    const instructions = getTeamSessionInstructions("developer-team")!;
    expect(instructions).toContain("deck-developer-explorer");
    expect(instructions).toContain("deck-developer-proposal");
    expect(instructions).toContain("deck-developer-spec");
    expect(instructions).toContain("deck-developer-design");
    expect(instructions).toContain("deck-developer-task");
    expect(instructions).toContain("deck-developer-apply-general");
    expect(instructions).toContain("deck-developer-apply-backend");
    expect(instructions).toContain("deck-developer-apply-frontend");
    expect(instructions).toContain("deck-developer-verify");
    expect(instructions).toContain("deck-developer-review");
    expect(instructions).toContain("deck-developer-archive");
  });
});
