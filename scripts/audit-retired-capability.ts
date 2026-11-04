import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";

// Architecture audit, not a prose snapshot. Only version-1 read/decommission boundaries may recognize retired identities.
const retired = /supermemory|adaptive[-_ ]?memory|deck[-_]memory|memory[-_]bridge|MemoryBroker|SessionMemoryPort|nativeMemory|deck_memory_|DECK_RUNNER_MEMORY|codex-memory-hook|(?<![-\w])memory-mcp|ADAPTIVE CONTEXT|memory\.(?:recalled|proposed|written)|memoryProvider|memoryBundle|memoryInjection|deck-runner-memory|DECK_CODEX_BRIDGE|isExplicitMemoryEvent|toLoopbackEvent|MemoryDiagnostic|RunnerMemory|NativeCapture|memoryToolsForRole|MEMORY_SEARCH_DENIED_ROLES/i;
export const TRANSITION_SCOPES = [
  { path: "apps/cli/src/runner-cleanup-command.ts", line: /^      for \(const \[id, capability\] of \[\['supermemory', 'supermemory'\], \['memory-bridge', 'deck-memory'\]\] as const\) \{$/, purpose: "Enumerate both legacy Codex hook selectors for exact-receipt cleanup at the active config path", until: "Version-1 installation migration support ends" },
  { path: "apps/cli/src/runner-cleanup-command.ts", line: /^    const capabilityIds = \["context-mode", "serena", "supermemory", "deck-memory", "adaptive-memory", \.\.\.\(!codebaseEnabled \? \["codebase-memory"\] : \[\]\)\];$/, purpose: "Reach exact receipted retired artifacts through the default CLI cleanup composition", until: "Version-1 installation migration support ends" },
  { path: "apps/cli/src/cli-args.ts", line: /^    if \(rest\.length === 1 && rest\[0\] === "codex-memory-hook"\)/, purpose: "Inert exact legacy hook dispatch before configuration construction", until: "Next major release after receipted native cleanup completes" },
  { path: "apps/cli/src/cli-args.ts", line: /^  if \(first === "supermemory"\)/, purpose: "Reject the legacy command before generic TUI fallback", until: "Generic strict unknown-command rejection replaces legacy argv support" },
  { path: "packages/core/src/config/deck-config.ts", line: /^(?:const TOP_LEVEL_FIELDS = |\s*if \(Object\.hasOwn\(raw, "adaptiveMemory"\)|\s*if \(value && typeof value === "object" && Object\.hasOwn\(value, "adaptive-memory"\)|\s*if \(pkgKey === )/, purpose: "Discard version-1 fields without weakening secret validation", until: "Version-1 config read support ends" },
  { path: "packages/core/src/session/events.ts", line: /^export const LEGACY_SESSION_EVENT_KINDS = /, purpose: "Read historical user ledgers; never emit or append these kinds", until: "Permanent durable-history compatibility" },
  { path: "packages/core/src/package-retirement.ts", line: /^const retired = /, purpose: "Find receipted retired installation contributions", until: "Version-1 installation migration support ends" },
  { path: "packages/adapter-codex/src/codex-config.ts", line: /^(?:\s*supermemory: |export const RETIRED_CODEX_HOOK_IDS = |const CODEX_HOOK_COMMAND = |\s*if \(working\.includes\(LEGACY_HOOK_MARKER\)|\s*if \(source\.includes\(LEGACY_HOOK_MARKER\))/, purpose: "Recognize old owned hooks for removal, never generate them", until: "Version-1 installation migration support ends" },
  { path: "packages/adapter-pi/src/pi-codebase-guard-command.ts", line: /^  const legacyKeys = \["DECK_RUNNER_MEMORY_ENDPOINT", "DECK_RUNNER_MEMORY_TOKEN", "DECK_RUNNER_MEMORY_TOKEN_FILE"\];$/, purpose: "Recognize only the exact empty legacy environment during receipt-checked Codebase guard migration; execution remains strict", until: "Version-1 Pi guard migration support ends" },
  { path: "packages/adapter-pi/assets/pi/extensions/deck-tool-policy.generated.js", line: /^  const legacyKeys = \["DECK_RUNNER_MEMORY_ENDPOINT", "DECK_RUNNER_MEMORY_TOKEN", "DECK_RUNNER_MEMORY_TOKEN_FILE"\];$/, purpose: "Generated parser for receipt-checked legacy Pi guard migration; runtime calls retain strict validation", until: "Version-1 Pi guard migration support ends" },
  { path: "packages/adapter-codex/src/retired-contributions.ts", line: /^export const RETIRED_CODEX_MCP_IDS = /, purpose: "Receipt-based removal in full/content-only installation", until: "Version-1 installation migration support ends" },
] as const;

export function auditRetiredCapability(root = resolve(import.meta.dir, "..")): string[] {
  const errors: string[] = [];
  const visit = (directory: string) => {
    if (!existsSync(directory)) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (["node_modules", "__fixtures__", "__tests__", "fixtures"].includes(entry.name)) continue;
      const path = join(directory, entry.name), rel = relative(root, path).replaceAll("\\", "/");
      if (entry.isDirectory()) { visit(path); continue; }
      if (!/\.(?:ts|tsx|js|json)$/.test(entry.name) || /\.test\.|\.int\./.test(entry.name)) continue;
      const lines = readFileSync(path, "utf8").split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        if (/^\s*(?:\/\/|\*|\/\*)/.test(line) || !retired.test(line)) continue;
        if (!TRANSITION_SCOPES.some(scope => scope.path === rel && scope.line.test(line))) errors.push(`${rel}:${i + 1}: retired runtime reference outside a transition boundary`);
      }
    }
  };
  for (const directory of ["packages", "apps"]) visit(join(root, directory));
  for (const path of ["packages/core/src/memory", "packages/adapter-supermemory", "packages/adapter-pi/src/pi-extensions/memory", "benchmarks/memory-live", "benchmarks/memory-inventory"]) {
    if (existsSync(join(root, path))) errors.push(`${path}: retired source origin still exists`);
  }
  return errors;
}
if (import.meta.main) {
  const errors = auditRetiredCapability();
  console.log(JSON.stringify({ errors, transitionScopes: TRANSITION_SCOPES.map(({ path, purpose, until }) => ({ path, purpose, until })) }, null, 2));
  process.exitCode = errors.length ? 1 : 0;
}
