import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createRtkRewriter } from "./rtk";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "deck-rtk-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** Fake RTK binary speaking the `rtk hook claude` protocol (stdin JSON -> stdout JSON). */
function fakeRtk(script: string): string {
  const path = join(dir, "rtk");
  writeFileSync(path, `#!/bin/sh\n${script}\n`);
  chmodSync(path, 0o755);
  return path;
}
const REWRITE_GIT = `
input=$(cat)
case "$input" in
  *'"git status"'*) printf '%s' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecisionReason":"RTK auto-rewrite","updatedInput":{"command":"rtk git status"}}}' ;;
  *) ;;
esac`;

describe("createRtkRewriter", () => {
  test("rewrites an eligible command and pins the executable word to the owned binary", async () => {
    const binary = fakeRtk(REWRITE_GIT);
    const rewriter = createRtkRewriter({ binary });
    const result = await rewriter.rewrite("git status");
    expect(result).toEqual({ kind: "rewritten", command: `'${binary}' git status` });
  });

  test("a command without an RTK equivalent passes through", async () => {
    const rewriter = createRtkRewriter({ binary: fakeRtk(REWRITE_GIT) });
    expect(await rewriter.rewrite("echo hi")).toEqual({ kind: "unchanged" });
  });

  test("a rewrite that cannot be safely pinned is ignored", async () => {
    const binary = fakeRtk(`cat >/dev/null; printf '%s' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","updatedInput":{"command":"rtk git status $(whoami)"}}}'`);
    expect(await createRtkRewriter({ binary }).rewrite("git status")).toEqual({ kind: "unchanged" });
  });

  test("a failing or malformed RTK never blocks: the command is unchanged", async () => {
    expect(await createRtkRewriter({ binary: fakeRtk("cat >/dev/null; exit 3") }).rewrite("git status")).toEqual({ kind: "unchanged" });
    expect(await createRtkRewriter({ binary: fakeRtk("cat >/dev/null; echo not-json") }).rewrite("git status")).toEqual({ kind: "unchanged" });
  });

  test("a hung RTK is abandoned after the timeout", async () => {
    const rewriter = createRtkRewriter({ binary: fakeRtk("cat >/dev/null; sleep 5"), timeoutMs: 200 });
    const started = Date.now();
    expect(await rewriter.rewrite("git status")).toEqual({ kind: "unchanged" });
    expect(Date.now() - started).toBeLessThan(2000);
  });

  test("a missing binary reports unavailable", async () => {
    expect(await createRtkRewriter({ binary: join(dir, "nope") }).rewrite("git status")).toEqual({ kind: "unavailable" });
  });
});
