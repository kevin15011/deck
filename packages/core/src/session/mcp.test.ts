import { describe, expect, test } from "bun:test";
import { computeChildMcpSet } from "./mcp";

const base = {
  runnerPackages: ["context7", "serena", "supermemory", "web-search"],
  memoryProviderIds: ["supermemory"],
  webSearch: { enabled: true },
  sessionMcp: { id: "deck" },
};

describe("computeChildMcpSet", () => {
  test("removes adaptive-memory providers and adds the session server", () => {
    const set = computeChildMcpSet({ ...base, role: "member" });
    expect(set.servers).toEqual(["context7", "serena", "web-search", "deck"]);
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
    expect(member.sessionTools).not.toContain("deck_delegate");
    expect(member.sessionTools).toContain("deck_memory_recall");
    expect(member.sessionTools).toContain("deck_approve");
  });
  test("deduplicates and never lists the session id twice", () => {
    const set = computeChildMcpSet({ ...base, runnerPackages: ["deck", "serena", "serena"], role: "lead" });
    expect(set.servers.filter((s) => s === "deck").length).toBe(1);
    expect(set.servers.filter((s) => s === "serena").length).toBe(1);
  });
  test("memory provider removed even when it is the only package", () => {
    const set = computeChildMcpSet({ ...base, runnerPackages: ["supermemory"], webSearch: { enabled: false }, role: "member" });
    expect(set.servers).toEqual(["deck"]);
  });
});
