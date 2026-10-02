import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, chmodSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const script = resolve(import.meta.dir, "linux-install-sandbox.sh");
function run(args: string[], flags: Record<string, string> = {}) {
  const root = mkdtempSync(join(tmpdir(), "deck-sandbox-test-"));
  const log = join(root, "calls");
  writeFileSync(join(root, "docker"), '#!/bin/bash\nif [[ $1 == container && $2 == inspect ]]; then [[ ${ACTIVE_SESSION:-} == 1 ]]; exit; fi\nprintf "%s\\n" "$*" >> "$CALL_LOG"\nif [[ $1 == cp && ${FAIL_CP:-} == 1 ]]; then exit 1; fi\n');
  chmodSync(join(root, "docker"), 0o755);
  const candidate = join(root, "deck-canary");
  writeFileSync(candidate, "candidate");
  chmodSync(candidate, 0o755);
  try {
    const result = Bun.spawnSync(["bash", script, ...args], { env: { ...process.env, PATH: `${root}:${process.env.PATH}`, CALL_LOG: log, DECK_SANDBOX_CANARY: candidate, ...flags } });
    return { code: result.exitCode, calls: (() => { try { return readFileSync(log, "utf8"); } catch { return ""; } })() };
  } finally { rmSync(root, { recursive: true, force: true }); }
}
test("without Deck uses a disposable interactive container without host mounts", () => {
  const result = run(["without-deck"]);
  expect(result.code).toBe(0);
  expect(result.calls).toContain("create --rm -it");
  expect(result.calls).toContain("start -ai");
  expect(result.calls).not.toContain("cp ");
  expect(result.calls).not.toMatch(/--volume|--mount|--privileged|--env/);
});
test("with Deck copies only the supplied canary into the container", () => {
  const result = run(["with-deck"]);
  expect(result.code).toBe(0);
  expect(result.calls).toContain("cp ");
  expect(result.calls).toContain(":/home/tester/.local/bin/deck-canary");
  expect(result.calls).toContain("start -ai");
});
test("update refreshes runner layers while preserving base image cache", () => {
  const result = run(["update"]);
  expect(result.code).toBe(0);
  expect(result.calls).toContain("build --pull --build-arg RUNNER_REFRESH=");
  expect(result.calls).not.toContain("--no-cache");
});
test("invalid mode fails before Docker effects", () => {
  const result = run(["unknown"]);
  expect(result.code).not.toBe(0);
  expect(result.calls).toBe("");
});

test("an existing session is preserved", () => {
  const result = run(["without-deck"], { ACTIVE_SESSION: "1" });
  expect(result.code).not.toBe(0);
  expect(result.calls).not.toContain("create ");
  expect(result.calls).not.toContain("rm ");
});
test("failed canary copy removes only the newly created session", () => {
  const result = run(["with-deck"], { FAIL_CP: "1" });
  expect(result.code).not.toBe(0);
  expect(result.calls).toContain("rm -f deck-install-sandbox");
  expect(result.calls).not.toContain("start -ai");
});
