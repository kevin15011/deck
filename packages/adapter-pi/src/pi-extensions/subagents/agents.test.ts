import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { discoverAgents, findAgent, parseAgentMarkdown } from "./agents";

const QUALITY = [
  "---",
  "name: deck-quality",
  'description: "Verifies \\"behavior\\" independently"',
  "skill: deck-quality",
  "model: openai/gpt-5",
  "tools: read,grep,find,ls,mcp__codebase_memory__search_graph",
  "thinking: high",
  "systemPromptMode: replace",
  "---",
  "",
  "You are Quality.",
  "",
].join("\n");

describe("parseAgentMarkdown", () => {
  test("reads model, thinking, tools and the role prompt body", () => {
    const agent = parseAgentMarkdown("deck-quality", QUALITY);
    expect(agent).toMatchObject({ id: "deck-quality", role: "quality", model: "openai/gpt-5", thinking: "high", readOnly: true });
    expect(agent.tools).toEqual(["read", "grep", "find", "ls", "mcp__codebase_memory__search_graph"]);
    expect(agent.description).toBe('Verifies "behavior" independently');
    expect(agent.body).toBe("You are Quality.\n");
  });

  test("an unassigned role has no model or thinking", () => {
    const agent = parseAgentMarkdown("deck-apply-fast", "---\nname: deck-apply-fast\ntools: read,write,bash\n---\n\nBody\n");
    expect(agent.model).toBeUndefined();
    expect(agent.thinking).toBeUndefined();
    expect(agent.readOnly).toBe(false);
  });
});

describe("discoverAgents", () => {
  test("reads only the given directory, excludes the lead and non-markdown files", () => {
    const dir = mkdtempSync(join(tmpdir(), "deck-agents-"));
    try {
      mkdirSync(join(dir, "agents"));
      writeFileSync(join(dir, "agents", "deck-quality.md"), QUALITY);
      writeFileSync(join(dir, "agents", "deck-lead.md"), "---\nname: deck-lead\n---\nLead\n");
      writeFileSync(join(dir, "agents", "scout.md"), "---\nname: scout\n---\nUser agent\n");
      writeFileSync(join(dir, "agents", "notes.txt"), "x");
      const agents = discoverAgents(join(dir, "agents"));
      expect(agents.map((agent) => agent.id)).toEqual(["deck-quality"]);
      expect(findAgent(agents, "quality")?.id).toBe("deck-quality");
      expect(findAgent(agents, "deck-lead")).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a missing directory yields no agents", () => {
    expect(discoverAgents("/nonexistent/deck/agents")).toEqual([]);
  });
});
