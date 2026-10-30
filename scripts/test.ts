import { readFileSync, existsSync } from "node:fs";
import { relative, resolve, dirname } from "node:path";
import { parse } from "yaml";

export type Tier = "fast" | "int" | "e2e";
export function classifyTier(path: string): Tier {
  return /\.e2e\.test\.[cm]?[jt]sx?$/.test(path) ? "e2e" : /\.int\.test\.[cm]?[jt]sx?$/.test(path) ? "int" : "fast";
}
export function fallbackScope(path: string): string | undefined {
  if (["bun.lock", "bun.lockb", "bunfig.toml", "package.json", "tsconfig.json", "scripts/test.ts", "scripts/test-preload.ts"].includes(path)) return "";
  if (/(^|\/)fixtures?\//.test(path) || /\.generated\./.test(path) || /(^|\/)package\.json$/.test(path) || !/\.[cm]?[jt]sx?$/.test(path)) {
    return /^(?:packages|apps)\/[^/]+\//.exec(path)?.[0] ?? "";
  }
}
export function selectAffected(tests: readonly string[], changed: readonly string[], graph: ReadonlyMap<string, readonly string[]>): string[] {
  const affected = new Set(changed);
  const reverse = new Map<string, string[]>();
  for (const [source, imports] of graph) for (const target of imports) reverse.set(target, [...(reverse.get(target) ?? []), source]);
  const queue = [...changed];
  for (let i = 0; i < queue.length; i++) for (const importer of reverse.get(queue[i]!) ?? []) {
    if (!affected.has(importer)) { affected.add(importer); queue.push(importer); }
  }
  const scopes = changed.map(fallbackScope).filter((s): s is string => s !== undefined);
  return tests.filter(path => affected.has(path) || scopes.some(scope => path.startsWith(scope)));
}
type QuarantineEntry = { path: string; owner: string; reason: string; link: string; created: string; expires: string; approval?: string };
export function validateQuarantine(value: unknown, now = new Date()): QuarantineEntry[] {
  if (!Array.isArray(value)) throw new Error("quarantine entries must be a list");
  const seen = new Set<string>();
  for (const entry of value) {
    for (const key of ["path", "owner", "reason", "link", "created", "expires"]) if (typeof entry?.[key] !== "string" || !entry[key].trim()) throw new Error(`quarantine entry requires ${key}`);
    if (entry.path.startsWith("/") || entry.path.split("/").includes("..") || seen.has(entry.path)) throw new Error("invalid or duplicate quarantine path");
    seen.add(entry.path);
    const created = Date.parse(entry.created), expires = Date.parse(entry.expires);
    if (!Number.isFinite(created) || !Number.isFinite(expires) || expires <= created || expires - created > 14 * 86400000) throw new Error(`${entry.path}: quarantine must expire within 14 days`);
    if (expires <= now.getTime()) throw new Error(`${entry.path}: quarantine expired`);
    if (/session-host|sdd-runtime|adapter-|git-safety|approval|authority|release|install|parity|generat|config|registry|secret|security|sandbox/.test(entry.path) && !entry.approval?.trim()) throw new Error(`${entry.path}: protected quarantine requires user approval reference`);
  }
  return value;
}
function git(root: string, args: string[]): string[] {
  const result = Bun.spawnSync(["git", ...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
  if (!result.success) throw new Error(new TextDecoder().decode(result.stderr));
  return new TextDecoder().decode(result.stdout).split("\0").filter(Boolean);
}
export function discoverTests(root: string): string[] {
  const config = Bun.TOML.parse(readFileSync(resolve(root, "bunfig.toml"), "utf8")) as { test?: { pathIgnorePatterns?: string[] } };
  const ignores = (config.test?.pathIgnorePatterns ?? []).map(pattern => new Bun.Glob(pattern));
  return [...new Set(git(root, ["ls-files", "--cached", "--others", "--exclude-standard", "-z"]))]
    .filter(path => /(?:^|[._-])(?:test|spec)\.[cm]?[jt]sx?$/.test(path) && existsSync(resolve(root, path)) && !ignores.some(g => g.match(path))).sort();
}
function importGraph(root: string): Map<string, string[]> {
  const graph = new Map<string, string[]>();
  const files = git(root, ["ls-files", "--cached", "--others", "--exclude-standard", "-z"]);
  for (const file of files) {
    if (!/\.[cm]?[jt]sx?$/.test(file) || !existsSync(resolve(root, file)) || file.startsWith("packages/core/src/skills/external/")) continue;
    const imports: string[] = [];
    try {
      const scanner = new Bun.Transpiler({ loader: file.endsWith("tsx") ? "tsx" : file.endsWith("jsx") ? "jsx" : "ts" });
      for (const item of scanner.scanImports(readFileSync(resolve(root, file), "utf8"))) {
        try { imports.push(relative(root, Bun.resolveSync(item.path, dirname(resolve(root, file))))); } catch { /* Built-ins and unavailable optional dependencies have no local source. */ }
      }
    } catch { imports.push(...files.filter(path => dirname(path) === dirname(file))); }
    graph.set(file, imports);
  }
  return graph;
}
export async function main(args = process.argv.slice(2), root = resolve(import.meta.dir, "..")): Promise<number> {
  let tier: Tier | "all" = "fast", changed: string | undefined;
  let quarantine = false, list = false, selfCheck = false;
  const passthrough: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--tier") tier = args[++i] as Tier | "all";
    else if (arg.startsWith("--tier=")) tier = arg.slice(7) as Tier | "all";
    else if (arg === "--changed" || arg.startsWith("--changed=")) changed = arg.includes("=") ? arg.slice(10) : "HEAD";
    else if (arg === "--quarantine") quarantine = true;
    else if (arg === "--list") list = true;
    else if (arg === "--self-check") selfCheck = true;
    else if (arg !== "--") passthrough.push(arg);
  }
  if (!["fast", "int", "e2e", "all"].includes(tier)) throw new Error(`Unknown tier: ${tier}`);
  if (passthrough.some(arg => /^--(changed|path-ignore-patterns|preload|only|todo|bail|retry)/.test(arg))) throw new Error("Selection-altering flags must be configured through the wrapper");
  const all = discoverTests(root);
  const quarantinePath = resolve(root, "tests/quarantine.yaml");
  const entries = validateQuarantine(parse(readFileSync(quarantinePath, "utf8"))?.entries ?? []);
  for (const entry of entries) if (!all.includes(entry.path)) throw new Error(`Unknown quarantine test: ${entry.path}`);
  const excluded = new Set(entries.map(e => e.path));
  if (selfCheck) {
    const union = ["fast", "int", "e2e"].flatMap(t => all.filter(path => classifyTier(path) === t));
    if (new Set(union).size !== all.length) throw new Error("Tier partition mismatch");
    console.log(`Tier union: ${all.length} discovered tests; fast=${all.filter(p => classifyTier(p) === "fast").length}, int=${all.filter(p => classifyTier(p) === "int").length}, e2e=${all.filter(p => classifyTier(p) === "e2e").length}`);
    return 0;
  }
  let selected = all.filter(path => quarantine ? excluded.has(path) : !excluded.has(path) && (changed ? classifyTier(path) !== "e2e" : tier === "all" || classifyTier(path) === tier));
  let reason = quarantine ? "quarantine" : `tier ${tier}`;
  const help = Bun.spawnSync([process.execPath, "test", "--help"], { stdout: "pipe", stderr: "pipe" });
  const flags = new TextDecoder().decode(help.stdout) + new TextDecoder().decode(help.stderr);
  const supportsParallel = flags.includes("--parallel=");
  let nativeChanged = false;
  if (changed !== undefined) {
    const paths = [...new Set([...git(root, ["diff", "--name-only", "-z", changed || "HEAD", "--"]), ...git(root, ["ls-files", "--others", "--exclude-standard", "-z"])])];
    nativeChanged = flags.includes("--changed=") && !paths.some(path => fallbackScope(path) !== undefined);
    selected = selectAffected(selected, paths, importGraph(root));
    reason = `changes versus ${changed || "HEAD"}; ${nativeChanged ? "native Bun --changed with import-closure selection" : "import closure plus non-import package fallbacks"}`;
  }
  console.log(`Selected ${selected.length}/${all.length} files: ${reason}`);
  if (list) { console.log(selected.join("\n")); return 0; }
  if (!selected.length) return 0; // Never invoke bare bun test for an empty selection.
  // Install/rollback fixtures copy complete skill trees and create 10,100 files;
  // session-manager batches persist 200 task lifecycles. Competing workers can
  // exhaust these workloads' existing deadlines.
  const serialWorkloadFiles = new Set([
    "apps/cli/src/upgrade-command/runner-recovery-composition.int.test.ts",
    "packages/adapter-codex/src/runner-adapter.tools.int.test.ts",
    "packages/session-host/src/__tests__/session-manager.int.test.ts",
  ]);
  const batches = [
    { files: selected.filter(path => !serialWorkloadFiles.has(path)), workers: 4 },
    { files: selected.filter(path => serialWorkloadFiles.has(path)), workers: 1 },
  ];
  let exitCode = 0;
  for (const { files, workers } of batches) {
    if (!files.length) continue;
    console.log(`Running ${files.length} files with ${workers} worker(s)`);
    const child = Bun.spawn([process.execPath, "test", ...(supportsParallel ? [`--parallel=${workers}`] : []), ...(nativeChanged ? [`--changed=${changed || "HEAD"}`] : []), "--timeout", "30000", ...passthrough, ...files.map(p => `./${p}`)], { cwd: root, stdin: "inherit", stdout: "inherit", stderr: "inherit" });
    const code = await child.exited;
    if (code !== 0 && exitCode === 0) exitCode = code;
  }
  return exitCode;
}
if (import.meta.main) {
  try { process.exitCode = await main(); } catch (error) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }
}
