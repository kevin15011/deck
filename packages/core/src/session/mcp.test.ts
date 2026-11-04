import { describe, expect, test } from "bun:test";
import { CROSS_RUNNER_LEAD_CONTINUITY_GUIDANCE, DECK_TASK_INTEGRATE_TOOL, computeChildMcpSet } from "./mcp";

const base = {
  runnerPackages: ["context7", "serena", "personal", "web-search"],
  webSearch: { enabled: true },
  sessionMcp: { id: "deck" },
};

describe("computeChildMcpSet", () => {
  test("keeps personal integrations and adds the authenticated session server", () => {
    expect(computeChildMcpSet({ ...base, role: "member" }).servers).toEqual(["context7", "serena", "personal", "web-search", "deck"]);
  });
  test("web search included only when enabled", () => {
    const off = computeChildMcpSet({ ...base, webSearch: { enabled: false }, role: "member" });
    expect(off.servers).not.toContain("web-search");
    const on = computeChildMcpSet({ ...base, runnerPackages: ["context7"], role: "member" });
    expect(on.servers).toContain("web-search");
  });
  test("lead gets delegation tools, members do not", () => {
    const lead = computeChildMcpSet({ ...base, role: "lead" });
    const member = computeChildMcpSet({ ...base, role: "member" });
    expect(lead.sessionTools).toContain("deck_delegate");
    expect(lead.sessionTools).toContain("deck_task_list");
    expect(member.sessionTools).not.toContain("deck_task_list");
    expect(lead.sessionTools).toContain(DECK_TASK_INTEGRATE_TOOL.name);
    expect(member.sessionTools).not.toContain(DECK_TASK_INTEGRATE_TOOL.name);
    expect(member.sessionTools).not.toContain("deck_delegate");
    expect(member.sessionTools).toContain("deck_session_history");
    expect(member.sessionTools).toContain("deck_approve");
  });
  test("deduplicates and never lists the session id twice", () => {
    const set = computeChildMcpSet({ ...base, runnerPackages: ["deck", "serena", "serena"], role: "lead" });
    expect(set.servers.filter((s) => s === "deck").length).toBe(1);
    expect(set.servers.filter((s) => s === "serena").length).toBe(1);
  });
});

test("canonical cross-runner guidance requires yielding, answer-last and explicit review without polling", () => {
  expect(CROSS_RUNNER_LEAD_CONTINUITY_GUIDANCE).toContain("yield promptly");
  expect(CROSS_RUNNER_LEAD_CONTINUITY_GUIDANCE).toContain("last action of the turn");
  expect(CROSS_RUNNER_LEAD_CONTINUITY_GUIDANCE).toContain("Reports remain unverified");
  expect(CROSS_RUNNER_LEAD_CONTINUITY_GUIDANCE).toContain("retrieval and delivery are not integration");
  expect(CROSS_RUNNER_LEAD_CONTINUITY_GUIDANCE).toContain("Do not request recap-only turns");
});

test("capability availability is bounded and contains only reviewed non-secret fields", async () => {
  const {validateCapabilityAvailability}=await import("./mcp");
  expect(validateCapabilityAvailability([{capabilityId:"codebase-memory",status:"unavailable",reasonCode:"codebase-memory-unsupported",message:"private diagnostic",path:"/private/path"}])).toEqual([{capabilityId:"codebase-memory",status:"unavailable",reasonCode:"codebase-memory-unsupported"}]);
  for (const value of [[{capabilityId:"supermemory",status:"unavailable",reasonCode:"codebase-memory-unavailable"}],[{capabilityId:"codebase-memory",status:"unavailable",reasonCode:"authorization-denied"}],[{},{}]]) expect(()=>validateCapabilityAvailability(value)).toThrow("capability-availability-invalid");
});
