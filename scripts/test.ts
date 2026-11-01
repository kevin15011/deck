import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

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
export const RUN_BUDGET_MS = 120_000;

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

type FileResult = { code: number; text: string; overBudget: boolean; durationMs?: number };

/** Keep four workers busy; slow files warn but are never retried or failed for timing. */
export async function runWithTolerance(
  files: string[],
  runFile: (file: string) => Promise<FileResult>,
  stopped: () => boolean,
  warn: (message: string) => void = console.warn,
): Promise<(FileResult & { file: string })[]> {
  const results: (FileResult & { file: string })[] = [];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, files.length) }, async () => {
    while (next < files.length && !stopped()) {
      const file = files[next++]!;
      const result = { ...await runFile(file), file };
      results.push(result);
      if (result.overBudget) warn(`WARN ${file} exceeded ${FILE_BUDGET_MS / 1000}s (diagnostic only)`);
    }
  }));
  if (stopped() || results.length !== files.length) throw new Error(`Test run stopped: completed ${results.length}/${files.length} files`);
  return results.sort((a, b) => files.indexOf(a.file) - files.indexOf(b.file));
}

/** A separate process enforces the deadline even during synchronous preparation/discovery. */
export async function runSupervised(command: string[], root: string, milliseconds: number): Promise<number> {
  const started = performance.now();
  let selected = 0, completed = 0;
  const child = Bun.spawn(command, {
    ipc(message) {
      if (message?.type === "suite-progress") { selected = message.selected; completed = message.completed; }
    },
    cwd: root, stdin: "ignore", stdout: "pipe", stderr: "pipe", detached: process.platform !== "win32",
  });
  const kill = () => {
    try {
      if (process.platform === "win32") child.kill("SIGKILL");
      else process.kill(-child.pid, "SIGKILL");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
  };
  const drain = new AbortController();
  try {
    const code = await withBudget({
      exited: Promise.all([
        child.exited,
        pipeline(Readable.fromWeb(child.stdout as import("node:stream/web").ReadableStream<Uint8Array>), process.stdout, { end: false, signal: drain.signal }),
        pipeline(Readable.fromWeb(child.stderr as import("node:stream/web").ReadableStream<Uint8Array>), process.stderr, { end: false, signal: drain.signal }),
      ]).then(([code]) => code),
      kill,
    }, Math.max(0, milliseconds - (performance.now() - started)), "Test run");
    if (performance.now() - started > milliseconds) throw new BudgetExceededError("Test run exceeded wall-time budget");
    return code;
  } catch (error) {
    if (error instanceof BudgetExceededError) console.error(`Test run stopped: ${completed}/${selected} files completed`);
    throw error;
  } finally {
    kill();
    drain.abort();
  }
}

export async function main(args = process.argv.slice(2), root = resolve(import.meta.dir, "..")): Promise<number> {
  if (args.length) throw new Error("Use bun run test without arguments; use bun test <file> for focused checks");
  return runSupervised([process.execPath, import.meta.path, "--suite-worker", root], root, RUN_BUDGET_MS);
}

async function runSuite(root: string): Promise<number> {
  const started = performance.now();
  const run = async () => {
    const preparation = Bun.spawn([process.execPath, "run", resolve(root, "scripts/generate-web-assets.ts")], {
      cwd: root, stdout: "inherit", stderr: "inherit",
    });
    const preparationCode = await preparation.exited;
    if (preparationCode !== 0) return 1;
    const all = discoverTests(root);
    const entries = validateQuarantine(parse(readFileSync(resolve(root, "tests/quarantine.yaml"), "utf8"))?.entries ?? []);
    for (const entry of entries) if (!all.includes(entry.path)) throw new Error(`Unknown quarantine test: ${entry.path}`);
    const excluded = new Set(entries.map(entry => entry.path));
    const files = all.filter(path => !excluded.has(path));
    console.log(`Running ${files.length} fast test files; 2s diagnostic warning, 120s total including preparation and output drain`);
    let completed = 0;
    process.send?.({ type: "suite-progress", selected: files.length, completed });
    let failed = 0, passedTests = 0, failedTests = 0, skippedTests = 0;
    const results = await runWithTolerance(files, async file => {
        const fileStarted = performance.now();
        const child = Bun.spawn([process.execPath, "test", `./${file}`], {
          cwd: root, stdin: "ignore", stdout: "pipe", stderr: "pipe",
          env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0", DECK_TEST_WEB_ASSETS_READY: "1" },
        });
        const [code, stdout, stderr] = await Promise.all([
          child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
        ]);
        process.send?.({ type: "suite-progress", selected: files.length, completed: ++completed });
        const durationMs = performance.now() - fileStarted;
        return { code, overBudget: durationMs > FILE_BUDGET_MS, durationMs, text: `${stdout}\n${stderr}` };
    }, () => false);
    console.log("Slowest test files (wall time including startup):");
    for (const result of [...results].sort((a, b) => (b.durationMs ?? 0) - (a.durationMs ?? 0)).slice(0, 10)) console.log(`${result.durationMs?.toFixed(0)}ms ${result.file}`);
    for (const { file, code, text } of results) {
        passedTests += Number(/(\d+) pass\b/.exec(text)?.[1] ?? 0);
        failedTests += Number(/(\d+) fail\b/.exec(text)?.[1] ?? 0);
        skippedTests += Number(/(\d+) skip\b/.exec(text)?.[1] ?? 0);
        if (code !== 0) {
          failed++;
          console.error(`FAIL ${file}\n${text}`);
        }
    }
    console.log(`${results.length}/${files.length} files completed, ${failed} failed; ${passedTests} tests passed, ${failedTests} failed, ${skippedTests} skipped; ${((performance.now() - started) / 1000).toFixed(2)}s wall time`);
    return failed ? 1 : 0;
  };
  return run();
}
if (import.meta.main) {
  try {
    process.exitCode = process.argv[2] === "--suite-worker" && process.argv.length === 4
      ? await runSuite(resolve(process.argv[3]!))
      : await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
