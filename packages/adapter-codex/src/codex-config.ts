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

const CODEX_HOOK_MARKER = "# deck-codex-hook-v1";
const CODEX_HOOK_BLOCK = `${CODEX_HOOK_MARKER}\n[[hooks.SessionStart]]\nmatcher = "*"\nhooks = [{ type = "command", command = "bun .codex/hooks/developer-team-execution.js" }]\n\n[[hooks.UserPromptSubmit]]\nmatcher = "*"\nhooks = [{ type = "command", command = "bun .codex/hooks/developer-team-execution.js" }]\n\n[[hooks.PreToolUse]]\nmatcher = "*"\nhooks = [{ type = "command", command = "bun .codex/hooks/developer-team-execution.js" }]\n\n[[hooks.PostToolUse]]\nmatcher = "*"\nhooks = [{ type = "command", command = "bun .codex/hooks/developer-team-execution.js" }]\n`;

export function mergeCodexTrustedHookConfig(source: string, enabled: boolean): CodexConfigMergeResult {
  let ast: AST.TOMLProgram;
  try { ast = parse(source); } catch { return { status: "blocked", content: source, diagnostics: ["Malformed TOML cannot be changed safely."], ownedRanges: [] }; }
  const hookTables = ast.body[0]?.body.filter((node) => node.type === "TOMLTable" && node.resolvedKey[0] === "hooks") ?? [];
  if (!enabled) {
    if (!source.includes(CODEX_HOOK_MARKER)) return { status: "unchanged", content: source, ownedRanges: [] };
    const markerCount = source.split(CODEX_HOOK_MARKER).length - 1;
    if (markerCount !== 1 || !source.includes(CODEX_HOOK_BLOCK)) return { status: "blocked", content: source, diagnostics: ["Deck Codex trusted-hook configuration is tampered or ambiguous."], ownedRanges: [] };
    const content = source.replace(CODEX_HOOK_BLOCK, "").replace(/\n{3,}/g, "\n\n");
    return { status: "updated", content, ownedRanges: [] };
  }
  if (source.includes(CODEX_HOOK_MARKER)) {
    const markerCount = source.split(CODEX_HOOK_MARKER).length - 1;
    return markerCount === 1 && source.includes(CODEX_HOOK_BLOCK) && hookTables.length === 4
      ? { status: "unchanged", content: source, ownedRanges: [] }
      : { status: "blocked", content: source, diagnostics: ["Deck Codex trusted-hook configuration is tampered or ambiguous."], ownedRanges: [] };
  }
  const hasHooks = hookTables.length > 0;
  if (hasHooks) return { status: "blocked", content: source, diagnostics: ["Existing user Codex hooks collide with the Deck trusted bridge; automatic merge is refused."], ownedRanges: [] };
  const separator = source.length === 0 || source.endsWith("\n") ? "" : "\n";
  const addition = `${separator}${CODEX_HOOK_BLOCK}`;
  const content = source + addition;
  try { parse(content); } catch { return { status: "blocked", content: source, diagnostics: ["The trusted-hook TOML edit did not reparse."], ownedRanges: [] }; }
  return { status: "updated", content, ownedRanges: [[source.length, content.length]] };
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
    const separator = source.length === 0 || source.endsWith("\n") ? "" : "\n";
    const addition = `${separator}[features]\nmulti_agent = ${desired.multiAgent ? "true" : "false"}\n`;
    content = source + addition;
    ownedRanges = [[source.length, content.length]];
  }

  try {
    const reparsed = parse(content);
    if (featuresEntries(reparsed).length !== 1) throw new Error("owned key did not reparse uniquely");
  } catch {
    return { status: "blocked", content: source, diagnostics: ["The source-preserving TOML edit did not reparse."], ownedRanges: [] };
  }
  return { status: content === source ? "unchanged" : "updated", content, ownedRanges };
}
