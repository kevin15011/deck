// Isolated diagnostic-reader regression. No native runner or provider is launched.
import { readFileSync, writeFileSync, rmSync, statSync, appendFileSync } from "node:fs";
import { join } from "node:path";

const root = process.env.DECK_PI_NAV_DIAGNOSTIC_FIXTURE_ROOT;
if (!root) throw new Error("Missing diagnostic fixture root");
const { input, mode, project, growthTarget } = JSON.parse(readFileSync(join(root, "input.json"), "utf8"));
const reads: { requested: number; received: number }[] = [];
if (mode === "growth") {
  // Real growth after descriptor stat: the saved size must not authorize an unbounded read.
  const fs = require("node:fs"), originalStat = fs.fstatSync, originalRead = fs.readSync;
  const inode = statSync(growthTarget).ino;
  let grew = false;
  const fstatSync = function(this: unknown, ...args: any[]) {
    const stat = originalStat.apply(this, args);
    if (!grew && stat.ino === inode) { grew = true; appendFileSync(growthTarget, "x".repeat(65536)); }
    return stat;
  };
  const readSync = function(this: unknown, ...args: any[]) {
    const matching = originalStat(args[0]).ino === inode;
    const received = originalRead.apply(this, args);
    if (matching) reads.push({ requested: args[3], received });
    return received;
  };
  const { mock } = await import("bun:test");
  mock.module("node:fs", () => ({ ...fs, fstatSync, readSync }));
}
const { captureNavigationFailure } = await import("../pi-extensions/subagents/navigation-diagnostics.test-support");
const original = new Error("original-navigation-failure");
let artifact: string | undefined, capturedError: string | undefined, originalErrorPreserved = false;
try {
  try { throw original; }
  catch (error) {
    try { artifact = captureNavigationFailure(input); }
    catch (reason) { capturedError = String(reason).slice(0, 256); }
    throw error;
  }
} catch (error) { originalErrorPreserved = error === original; }
finally {
  rmSync(project, { recursive: true, force: true });
  writeFileSync(join(root, "cleanup.json"), JSON.stringify({ finallyRan: true, originalErrorPreserved }));
}
writeFileSync(join(root, "result.json"), JSON.stringify({ artifact, capturedError, originalErrorPreserved, reads }));
