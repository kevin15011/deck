import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import * as os from "node:os";
import { mock } from "bun:test";
import { join } from "node:path";

const { homedir, tmpdir } = os;

// Loaded before production modules, once in each Bun test worker. Children inherit
// the sandbox; another test worker gets its own directory even in the same process.
export const realHome = process.env.DECK_TEST_REAL_HOME ?? homedir();
export const testRoot = realpathSync(mkdtempSync(join(tmpdir(), "deck-test-")));
export const isolatedPaths = {
  HOME: join(testRoot, "home"),
  CODEX_HOME: join(testRoot, "home", ".codex"),
  XDG_CONFIG_HOME: join(testRoot, "config"),
  XDG_STATE_HOME: join(testRoot, "state"),
  XDG_CACHE_HOME: join(testRoot, "cache"),
  XDG_DATA_HOME: join(testRoot, "data"),
  XDG_RUNTIME_DIR: join(testRoot, "run"),
  PI_CODING_AGENT_DIR: join(testRoot, "home", ".pi", "agent"),
  CLAUDE_CONFIG_DIR: join(testRoot, "home", ".claude"),
  OPENCODE_CONFIG_DIR: join(testRoot, "config", "opencode"),
};
for (const [key, path] of Object.entries(isolatedPaths)) {
  mkdirSync(path, { recursive: true });
  process.env[key] = path;
}
// Bun caches the native home before preload; keep node:os consumers in the
// same sandbox as process.env consumers, including tests with a nested HOME.
const testOs = { ...os, homedir: () => process.env.HOME || isolatedPaths.HOME };
mock.module("node:os", () => ({ ...testOs, default: testOs }));
process.env.DECK_TEST_REAL_HOME = realHome;
// A test process is not a continuation of the invoking agent's live session.
for (const key of Object.keys(process.env)) {
  if (key.startsWith("DECK_SESSION_") || key.startsWith("DECK_PI_CROSS_") ||
      ["OPENCODE_CONFIG", "OPENCODE_CONFIG_CONTENT"].includes(key)) delete process.env[key];
}
process.on("exit", () => rmSync(testRoot, { recursive: true, force: true }));

// Bun parallel workers virtualize process.env, but spawn's implicit environment
// still comes from the parent process. Supply the worker view only when omitted;
// explicit fixture environments (including empty ones) remain authoritative.
const spawn = Bun.spawn, spawnSync = Bun.spawnSync;
function workerEnvironment(args: any[]): any[] {
  if (Array.isArray(args[0])) return [args[0], { ...args[1], env: args[1]?.env ?? process.env }];
  return [{ ...args[0], env: args[0]?.env ?? process.env }];
}
Bun.spawn = ((...args: any[]) => Reflect.apply(spawn, Bun, workerEnvironment(args))) as typeof Bun.spawn;
Bun.spawnSync = ((...args: any[]) => Reflect.apply(spawnSync, Bun, workerEnvironment(args))) as typeof Bun.spawnSync;
