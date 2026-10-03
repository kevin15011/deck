import { describe, expect, test } from "bun:test";
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
});
