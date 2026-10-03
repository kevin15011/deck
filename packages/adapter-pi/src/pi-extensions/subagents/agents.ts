import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { isDelegableAgentId, isReadOnlyRole, normalizeRole } from "../shared/roles";

/** A Deck role delivered inside the Deck Pi package (`<package>/agents/<id>.md`). */
export type DeckAgent = Readonly<{
  /** Agent id, e.g. `deck-investigate` (the markdown file name without extension). */
  id: string;
  /** Normalized role, e.g. `investigate`; used for `DECK_PI_ROLE` and the policy. */
  role: string;
  description: string;
  model: string | undefined;
  /** Raw frontmatter value; validated by the runner. */
  thinking: string | undefined;
  /** Frontmatter `tools:` allowlist. Only honored for read-only roles. */
  tools: readonly string[];
  readOnly: boolean;
  /** Role prompt: the markdown body after the frontmatter. */
  body: string;
}>;

function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'")))) {
    return trimmed.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  return trimmed;
}

/** Minimal `key: value` frontmatter reader (Deck writes flat scalars only). */
export function parseAgentMarkdown(id: string, content: string): DeckAgent {
  const normalized = content.replace(/\r\n/g, "\n");
  const fields: Record<string, string> = {};
  let body = normalized;
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(normalized);
  if (match) {
    body = normalized.slice(match[0].length);
    for (const line of match[1]!.split("\n")) {
      const separator = line.indexOf(":");
      if (separator <= 0 || /^\s/.test(line)) continue;
      fields[line.slice(0, separator).trim()] = unquote(line.slice(separator + 1));
    }
  }
  const role = normalizeRole(id);
  const tools = (fields.tools ?? "").split(",").map((tool) => tool.trim()).filter(Boolean);
  return {
    id,
    role,
    description: fields.description ?? "",
    model: fields.model?.trim() || undefined,
    thinking: fields.thinking?.trim() || undefined,
    tools,
    readOnly: isReadOnlyRole(role),
    body: body.replace(/^\n+/, ""),
  };
}

/** Reads every delegable agent from the Deck package agents directory. Never reads user or project agent dirs. */
export function discoverAgents(agentsDir: string): DeckAgent[] {
  let entries: string[];
  try {
    entries = readdirSync(agentsDir);
  } catch {
    return [];
  }
  const agents: DeckAgent[] = [];
  for (const entry of entries.sort()) {
    if (!entry.endsWith(".md")) continue;
    const id = entry.slice(0, -3);
    if (!isDelegableAgentId(id)) continue;
    try {
      agents.push(parseAgentMarkdown(id, readFileSync(join(agentsDir, entry), "utf-8")));
    } catch {
      // An unreadable agent file is simply not delegable.
    }
  }
  return agents;
}

/** Accepts `deck-quality` or the short `quality` form. */
export function findAgent(agents: readonly DeckAgent[], name: string): DeckAgent | undefined {
  const wanted = name.trim();
  return agents.find((agent) => agent.id === wanted) ?? agents.find((agent) => agent.role === normalizeRole(wanted));
}
