import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";

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

export const FILE_BUDGET_MS = 2_000;
export const RUN_BUDGET_MS = 90_000;

/** Terminate the work at its deadline, including work that blocks its own event loop. */
export class BudgetExceededError extends Error {}

export async function withBudget(
  work: { exited: Promise<number>; kill: () => void },
  milliseconds: number,
  label: string,
  schedule: (callback: () => void, ms: number) => () => void = (callback, ms) => {
    const timer = setTimeout(callback, ms);
    return () => clearTimeout(timer);
  },
): Promise<number> {
  let cancel = () => {};
  try {
    return await Promise.race([
      work.exited,
      new Promise<never>((_, reject) => {
        cancel = schedule(() => {
          work.kill();
          reject(new BudgetExceededError(`${label} exceeded ${milliseconds / 1000}s wall-time budget`));
        }, milliseconds);
      }),
    ]);
  } finally {
    cancel();
  }
}

type FileResult = { code: number; text: string; overBudget: boolean };

/** Drain each parallel batch before retrying overruns alone, under the run deadline. */
export async function runWithTolerance(
  files: string[],
  runFile: (file: string) => Promise<FileResult>,
  stopped: () => boolean,
  warn: (message: string) => void = console.warn,
): Promise<(FileResult & { file: string })[]> {
  const results: (FileResult & { file: string })[] = [];
  for (let next = 0; next < files.length && !stopped(); next += 4) {
    const batch = await Promise.all(files.slice(next, next + 4).map(async file => ({ ...await runFile(file), file })));
    for (const first of batch) {
      if (stopped()) return results;
      let result = first;
      if (first.overBudget) {
        result = { ...await runFile(first.file), file: first.file };
        if (!result.overBudget) warn(`WARN ${first.file} exceeded 2s once; isolated retry completed within budget`);
      }
      results.push({ ...result, code: result.overBudget ? 1 : result.code });
    }
  }
  return results;
}

export async function main(args = process.argv.slice(2), root = resolve(import.meta.dir, "..")): Promise<number> {
  const started = performance.now();
  if (args.length) throw new Error("Use bun run test without arguments; use bun test <file> for focused checks");
  const active = new Set<ReturnType<typeof Bun.spawn>>();
  let stopped = false;
  const killChild = (child: ReturnType<typeof Bun.spawn>) => {
    try {
      if (process.platform === "win32") child.kill("SIGKILL");
      else process.kill(-child.pid, "SIGKILL");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
  };
  const killAll = () => {
    stopped = true;
    for (const child of active) killChild(child);
  };
  const run = async () => {
    const preparation = Bun.spawn([process.execPath, "run", resolve(root, "scripts/generate-web-assets.ts")], {
      cwd: root, stdout: "inherit", stderr: "inherit", detached: process.platform !== "win32",
    });
    active.add(preparation);
    const preparationCode = await preparation.exited;
    active.delete(preparation);
    if (preparationCode !== 0 || stopped) return 1;
    const all = discoverTests(root);
    const entries = validateQuarantine(parse(readFileSync(resolve(root, "tests/quarantine.yaml"), "utf8"))?.entries ?? []);
    for (const entry of entries) if (!all.includes(entry.path)) throw new Error(`Unknown quarantine test: ${entry.path}`);
    const excluded = new Set(entries.map(entry => entry.path));
    const files = all.filter(path => !excluded.has(path));
    console.log(`Running ${files.length} fast test files; 2s per file, 90s total`);
    let failed = 0, passedTests = 0, failedTests = 0, skippedTests = 0;
    const results = await runWithTolerance(files, async file => {
        const fileStarted = performance.now();
        const child = Bun.spawn([process.execPath, "test", `./${file}`], {
          cwd: root, stdin: "ignore", stdout: "pipe", stderr: "pipe", detached: process.platform !== "win32",
          env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0", DECK_TEST_WEB_ASSETS_READY: "1" },
        });
        active.add(child);
        const output = Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
        let code = 1, overBudget = false;
        try {
          code = await withBudget({ exited: Promise.all([child.exited, output]).then(([code]) => code), kill: () => killChild(child) }, FILE_BUDGET_MS, file);
          overBudget = performance.now() - fileStarted > FILE_BUDGET_MS;
        } catch (error) {
          code = 1;
          if (error instanceof BudgetExceededError) overBudget = true;
          else throw error;
        } finally {
          active.delete(child);
        }
        return { code, overBudget, text: (await output).join("\n") };
    }, () => stopped);
    for (const { file, code, text, overBudget } of results) {
        passedTests += Number(/(\d+) pass\b/.exec(text)?.[1] ?? 0);
        failedTests += Number(/(\d+) fail\b/.exec(text)?.[1] ?? 0);
        skippedTests += Number(/(\d+) skip\b/.exec(text)?.[1] ?? 0);
        if (code !== 0) {
          failed++;
          console.error(`FAIL ${file}${overBudget ? " exceeded 2s wall-time budget again on isolated retry" : ""}\n${text}`);
        }
    }
    console.log(`${results.length} files, ${failed} failed; ${passedTests} tests passed, ${failedTests} failed, ${skippedTests} skipped; ${((performance.now() - started) / 1000).toFixed(2)}s wall time`);
    return failed ? 1 : 0;
  };
  try {
    const code = await withBudget({ exited: run(), kill: killAll }, RUN_BUDGET_MS, "Test run");
    if (performance.now() - started > RUN_BUDGET_MS) throw new Error("Test run exceeded 90s wall-time budget");
    return code;
  } finally {
    killAll();
  }
}
if (import.meta.main) {
  try { process.exitCode = await main(); } catch (error) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }
}
