import { parseTOML, type AST } from "toml-eslint-parser";

export const TOML_PARSER_DECISION = Object.freeze({
  packageName: "toml-eslint-parser",
  version: "1.0.3",
  license: "MIT",
  module: "ESM",
  sourceRanges: true,
  bunImportVerified: true,
} as const);

export type CodexConfigMergeResult =
  | { status: "unchanged" | "updated"; content: string; ownedRanges: readonly [number, number][] }
  | { status: "blocked"; content: string; diagnostics: readonly string[]; ownedRanges: readonly [] };

export const CODEX_HOOK_EVENTS = ["SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "SubagentStart", "Stop"] as const;
export type CodexHookEvent = (typeof CODEX_HOOK_EVENTS)[number];
/** Stable ownership identities; each owns exactly one marker-delimited block. */
export const CODEX_OWNED_HOOK_IDS = ["memory-bridge", "rtk", "supermemory"] as const;
export type CodexOwnedHookId = (typeof CODEX_OWNED_HOOK_IDS)[number];

export type CodexOwnedHook = Readonly<{
  event: CodexHookEvent;
  matcher?: string;
  command: string;
  timeout?: number;
  statusMessage?: string;
}>;
export type CodexOwnedHookBlock = Readonly<{ id: CodexOwnedHookId; hooks: readonly CodexOwnedHook[] }>;

const CODEX_HOOK_COMMAND = "deck internal codex-memory-hook";
/** The pre-v2 single-block form (inline `hooks = [...]`), recognised only for exact-match migration. */
const LEGACY_HOOK_MARKER = "# deck-codex-hook-v1";
const LEGACY_HOOK_BLOCK = `${LEGACY_HOOK_MARKER}\n[[hooks.SessionStart]]\nmatcher = "*"\nhooks = [{ type = "command", command = "${CODEX_HOOK_COMMAND}" }]\n\n[[hooks.UserPromptSubmit]]\nmatcher = "*"\nhooks = [{ type = "command", command = "${CODEX_HOOK_COMMAND}" }]\n\n[[hooks.PreToolUse]]\nmatcher = "*"\nhooks = [{ type = "command", command = "${CODEX_HOOK_COMMAND}" }]\n\n[[hooks.PostToolUse]]\nmatcher = "*"\nhooks = [{ type = "command", command = "${CODEX_HOOK_COMMAND}" }]\n\n[[hooks.SubagentStart]]\nmatcher = "*"\nhooks = [{ type = "command", command = "${CODEX_HOOK_COMMAND}" }]\n\n[[hooks.Stop]]\nmatcher = "*"\nhooks = [{ type = "command", command = "${CODEX_HOOK_COMMAND}" }]\n`;

/** Deck's loopback memory bridge: fail-open lifecycle forwarding through the installed `deck` binary. */
export const CODEX_MEMORY_BRIDGE_HOOK_BLOCK: CodexOwnedHookBlock = Object.freeze({
  id: "memory-bridge",
  hooks: CODEX_HOOK_EVENTS.map((event) => Object.freeze({ event, matcher: "*", command: CODEX_HOOK_COMMAND })),
});

const blockStart = (id: string) => `# deck-codex-hook:${id}:start`;
const blockEnd = (id: string) => `# deck-codex-hook:${id}:end`;

function tomlQuote(value: string): string {
  if (/[\0\r\n]/.test(value)) throw new Error("Hook values cannot contain control characters.");
  return JSON.stringify(value);
}

export function renderCodexOwnedHookBlock(block: CodexOwnedHookBlock): string {
  const lines = [blockStart(block.id)];
  block.hooks.forEach((hook, index) => {
    if (!CODEX_HOOK_EVENTS.includes(hook.event)) throw new Error(`Unsupported Codex hook event: ${hook.event}`);
    if (index > 0) lines.push("");
    lines.push(`[[hooks.${hook.event}]]`);
    if (hook.matcher !== undefined) lines.push(`matcher = ${tomlQuote(hook.matcher)}`);
    lines.push("", `[[hooks.${hook.event}.hooks]]`, 'type = "command"', `command = ${tomlQuote(hook.command)}`);
    if (hook.timeout !== undefined) lines.push(`timeout = ${Math.max(1, Math.floor(hook.timeout))}`);
    if (hook.statusMessage !== undefined) lines.push(`statusMessage = ${tomlQuote(hook.statusMessage)}`);
  });
  lines.push(blockEnd(block.id));
  return `${lines.join("\n")}\n`;
}

type LocatedBlock = { id: string; from: number; to: number };

/** Locates every marker-delimited owned block; ambiguity is reported instead of guessed. */
function locateOwnedBlocks(lines: readonly string[]): { blocks: LocatedBlock[]; ambiguous: boolean } {
  const blocks: LocatedBlock[] = [];
  let ambiguous = false;
  const seen = new Set<string>();
  for (let index = 0; index < lines.length; index += 1) {
    const start = lines[index]!.trimEnd().match(/^# deck-codex-hook:([a-z0-9-]+):start$/);
    if (!start) {
      if (/^# deck-codex-hook:[a-z0-9-]+:end$/.test(lines[index]!.trimEnd())) ambiguous = true;
      continue;
    }
    const id = start[1]!;
    let end = -1;
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const line = lines[cursor]!.trimEnd();
      if (line === blockEnd(id)) { end = cursor; break; }
      if (/^# deck-codex-hook:[a-z0-9-]+:(start|end)$/.test(line)) break;
    }
    if (end < 0 || seen.has(id)) { ambiguous = true; continue; }
    seen.add(id);
    blocks.push({ id, from: index, to: end });
    index = end;
  }
  return { blocks, ambiguous };
}

function lineArray(source: string): string[] {
  return source.length === 0 ? [] : source.split("\n").map((line, index, all) => (index < all.length - 1 ? `${line}\n` : line)).filter((line) => line.length > 0);
}

/**
 * Adds, replaces in place, or removes only Deck-owned hook blocks. User hooks (inline TOML or hooks.json) are
 * never read as ownership evidence and never rewritten, because Codex loads hooks from every source together.
 * Every `CODEX_OWNED_HOOK_IDS` entry absent from `desired` is removed; unknown marker ids are left untouched.
 */
export function mergeCodexOwnedHooks(source: string, desired: readonly CodexOwnedHookBlock[]): CodexConfigMergeResult {
  const blocked = (message: string): CodexConfigMergeResult => ({ status: "blocked", content: source, diagnostics: [message], ownedRanges: [] });
  try { parse(source); } catch { return blocked("Malformed TOML cannot be changed safely."); }
  const desiredIds = new Set(desired.map((block) => block.id));
  if (desiredIds.size !== desired.length) return blocked("Duplicate Deck hook block identity.");
  let rendered: Map<string, string>;
  try { rendered = new Map(desired.map((block) => [block.id, renderCodexOwnedHookBlock(block)])); }
  catch (error) { return blocked(error instanceof Error ? error.message : "Invalid Deck hook definition."); }

  let working = source;
  // Exact legacy single-block migration: any divergence is treated as user content and refused.
  if (working.includes(LEGACY_HOOK_MARKER)) {
    if (working.split(LEGACY_HOOK_MARKER).length - 1 !== 1 || !working.includes(LEGACY_HOOK_BLOCK)) return blocked("Deck Codex trusted-hook configuration is tampered or ambiguous.");
    const at = working.indexOf(LEGACY_HOOK_BLOCK);
    const after = working.slice(at + LEGACY_HOOK_BLOCK.length).replace(/^\n/, "");
    working = working.slice(0, at) + after;
  }

  const lines = lineArray(working);
  const located = locateOwnedBlocks(lines);
  if (located.ambiguous) return blocked("Deck Codex hook ownership markers are tampered or ambiguous.");
  const out: string[] = [];
  const present = new Set<string>();
  let cursor = 0;
  for (const block of located.blocks) {
    out.push(...lines.slice(cursor, block.from));
    cursor = block.to + 1;
    const known = (CODEX_OWNED_HOOK_IDS as readonly string[]).includes(block.id);
    const replacement = rendered.get(block.id);
    if (!known) { out.push(...lines.slice(block.from, block.to + 1)); continue; }
    present.add(block.id);
    if (replacement === undefined) {
      // Drop the separating blank line owned with the block: after it when content follows, before it at end of file.
      if (cursor >= lines.length) { if (out.length > 0 && out[out.length - 1]!.trim() === "") out.pop(); }
      else if (lines[cursor]!.trim() === "") cursor += 1;
      continue;
    }
    out.push(replacement);
  }
  out.push(...lines.slice(cursor));
  let content = out.join("");
  const additions = desired.filter((block) => !present.has(block.id)).map((block) => rendered.get(block.id)!);
  if (additions.length > 0) {
    const separator = content.length === 0 ? "" : content.endsWith("\n") ? "\n" : "\n\n";
    content = `${content}${separator}${additions.join("\n")}`;
  }
  if (content === source) return { status: "unchanged", content: source, ownedRanges: [] };
  try { parse(content); } catch { return blocked("The Deck hook TOML edit did not reparse."); }
  const ownedRanges: [number, number][] = [];
  for (const block of locateOwnedBlocks(lineArray(content)).blocks) {
    const before = lineArray(content).slice(0, block.from).join("").length;
    ownedRanges.push([before, before + lineArray(content).slice(block.from, block.to + 1).join("").length]);
  }
  return { status: "updated", content, ownedRanges };
}

/** True when Codex hooks are explicitly disabled, so Deck-owned hooks would never run. */
export function codexHooksFeatureDisabled(source: string): boolean {
  try {
    const ast = parse(source);
    for (const node of ast.body[0]?.body ?? []) {
      if (node.type === "TOMLKeyValue") {
        const key = node.key.keys.map(keyPartName).join(".");
        if ((key === "features.hooks" || key === "features.codex_hooks") && node.value.type === "TOMLValue" && node.value.value === false) return true;
      }
      if (node.type === "TOMLTable" && node.resolvedKey.join(".") === "features") {
        for (const child of node.body) {
          const key = child.key.keys.map(keyPartName).join(".");
          if ((key === "hooks" || key === "codex_hooks") && child.value.type === "TOMLValue" && child.value.value === false) return true;
        }
      }
    }
  } catch { /* malformed TOML is reported by the merge path */ }
  return false;
}

/** Ids of Deck-owned hook blocks currently present (including the pre-v2 single block as "memory-bridge"). */
export function inspectCodexOwnedHookIds(source: string): readonly CodexOwnedHookId[] {
  const ids = new Set<CodexOwnedHookId>();
  const located = locateOwnedBlocks(lineArray(source));
  for (const block of located.blocks) if ((CODEX_OWNED_HOOK_IDS as readonly string[]).includes(block.id)) ids.add(block.id as CodexOwnedHookId);
  if (source.includes(LEGACY_HOOK_MARKER)) ids.add("memory-bridge");
  return [...ids];
}

function parse(source: string): AST.TOMLProgram {
  return parseTOML(source, { tomlVersion: "1.0.0" });
}

function keyPartName(key: AST.TOMLBare | AST.TOMLQuoted): string {
  return key.type === "TOMLBare" ? key.name : key.value;
}

function featuresEntries(ast: AST.TOMLProgram): AST.TOMLKeyValue[] {
  const top = ast.body[0];
  const entries: AST.TOMLKeyValue[] = [];
  for (const node of top.body) {
    if (node.type === "TOMLKeyValue" && node.key.keys.map(keyPartName).join(".") === "features.multi_agent") {
      entries.push(node);
    }
    if (node.type === "TOMLTable" && node.resolvedKey.join(".") === "features") {
      for (const child of node.body) {
        if (child.key.keys.map(keyPartName).join(".") === "multi_agent") entries.push(child);
      }
    }
  }
  return entries;
}

export function mergeCodexProjectConfig(source: string, desired: { multiAgent: boolean }): CodexConfigMergeResult {
  let ast: AST.TOMLProgram;
  try {
    ast = parse(source);
  } catch {
    return { status: "blocked", content: source, diagnostics: ["Malformed TOML cannot be changed safely."], ownedRanges: [] };
  }

  const entries = featuresEntries(ast);
  if (entries.length > 1) {
    return { status: "blocked", content: source, diagnostics: ["The Deck-owned features.multi_agent key is ambiguous."], ownedRanges: [] };
  }

  let content: string;
  let ownedRanges: readonly [number, number][];
  if (entries.length === 1) {
    const valueRange = entries[0]!.value.range;
    const replacement = desired.multiAgent ? "true" : "false";
    content = source.slice(0, valueRange[0]) + replacement + source.slice(valueRange[1]);
    ownedRanges = [[valueRange[0], valueRange[0] + replacement.length]];
  } else {
    const featuresTable = ast.body[0]?.body.find((node): node is AST.TOMLTable => node.type === "TOMLTable" && node.resolvedKey.join(".") === "features" && !node.kind.startsWith("array"));
    if (featuresTable) {
      // Extend the user's existing [features] table instead of opening a duplicate header.
      const insertion = `\nmulti_agent = ${desired.multiAgent ? "true" : "false"}`;
      const at = featuresTable.body.length > 0 ? featuresTable.body[featuresTable.body.length - 1]!.range[1] : featuresTable.range[1];
      content = source.slice(0, at) + insertion + source.slice(at);
      ownedRanges = [[at, at + insertion.length]];
    } else {
      const separator = source.length === 0 || source.endsWith("\n") ? "" : "\n";
      const addition = `${separator}[features]\nmulti_agent = ${desired.multiAgent ? "true" : "false"}\n`;
      content = source + addition;
      ownedRanges = [[source.length, content.length]];
    }
  }

  try {
    const reparsed = parse(content);
    if (featuresEntries(reparsed).length !== 1) throw new Error("owned key did not reparse uniquely");
  } catch {
    return { status: "blocked", content: source, diagnostics: ["The source-preserving TOML edit did not reparse."], ownedRanges: [] };
  }
  return { status: content === source ? "unchanged" : "updated", content, ownedRanges };
}
