import { describe, expect, test } from "bun:test";
import { buildAdaptiveMemoryInstructionBundle } from "@deck/core/teams/developer/instruction-bundles/adaptive-memory";
import { buildCapabilityInstructionBundle } from "@deck/core/teams/developer/instruction-bundles";
import { translatePiCapabilityInstructions } from "./instruction-translation";

const text = () => translatePiCapabilityInstructions(buildCapabilityInstructionBundle(["codebase-memory", "code-economy", "context-mode", "rtk", "serena", "web-search"]))!
  .instructions.map((f) => f.markdown).join("\n\n");

describe("Pi instruction translation", () => {
  test("describes the real Deck Pi mechanics", () => {
    const out = text();
    for (const expected of ["### Pi Tool Routing", "deck-tool-policy", "mcp__<server>__<tool>", "`subagent` tool", "one-time advisory", "`grep`, `find`, `ls`", "Deck-owned RTK"]) expect(out).toContain(expected);
    expect(out).toContain("**`search_graph`**");
  });

  test("drops other runners' hooks, installers and tools", () => {
    expect(text()).not.toMatch(/Claude Code|OpenCode|--opencode|WebFetch|additionalContext/);
  });

  test("tells the model about the explicit Pi memory tools and who may save", () => {
    const out = translatePiCapabilityInstructions(buildAdaptiveMemoryInstructionBundle({ supermemoryProjectScope: "sm_project_v1_abc123_deck" }))!.instructions.map((f) => f.markdown).join("\n\n");
    for (const expected of ["`memory_search`", "`memory_save`", "Read-only roles", "advisory", "Provider: Supermemory"]) expect(out).toContain(expected);
    expect(out).toMatch(/only exist|only available/i);
    expect(out).not.toMatch(/Claude Code|OpenCode|supermemory tool|mcp__plugin/);
  });
});
