import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { createPiMemoryTokenHandoff, withPiMemoryLoopback } from "./pi-memory-token-handoff";

const dirs: string[] = [];
const base = () => { const dir = mkdtempSync(join(tmpdir(), "deck-token-handoff-")); dirs.push(dir); return dir; };
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe("createPiMemoryTokenHandoff", () => {
  test("writes the token to an owner-only file inside an owner-only directory and removes both on close", () => {
    const handoff = createPiMemoryTokenHandoff({ token: "tok-123", baseDirectory: base() });
    expect(readFileSync(handoff.tokenFile, "utf8").trim()).toBe("tok-123");
    expect(statSync(handoff.tokenFile).mode & 0o777).toBe(0o600);
    expect(statSync(dirname(handoff.tokenFile)).mode & 0o777).toBe(0o700);
    handoff.remove();
    expect(existsSync(handoff.tokenFile)).toBe(false);
    expect(existsSync(dirname(handoff.tokenFile))).toBe(false);
    expect(() => handoff.remove()).not.toThrow();
  });

  test("sweeps stale handoff directories left behind by a crashed launch but keeps fresh ones", () => {
    const root = base();
    const stale = createPiMemoryTokenHandoff({ token: "old", baseDirectory: root });
    const old = new Date(Date.now() - 3 * 24 * 3600 * 1000);
    utimesSync(dirname(stale.tokenFile), old, old);
    const fresh = createPiMemoryTokenHandoff({ token: "fresh", baseDirectory: root });
    createPiMemoryTokenHandoff({ token: "trigger", baseDirectory: root });
    expect(existsSync(stale.tokenFile)).toBe(false);
    expect(existsSync(fresh.tokenFile)).toBe(true);
  });
});

describe("withPiMemoryLoopback", () => {
  const plan = { command: "pi", args: ["--x"], cwd: "/p", stdio: "inherit", stdin: "inherit", executionClass: "static-compatible", envOverlay: { DECK_PI_SESSION: { value: "1" } } } as const;
  const bridge = { endpoint: "http://127.0.0.1:1/deck-runner-memory/v1", token: "secret-token", envOverlay: {
    DECK_RUNNER_MEMORY_ENDPOINT: { value: "http://127.0.0.1:1/deck-runner-memory/v1" },
    DECK_RUNNER_MEMORY_TOKEN: { value: "secret-token", sensitive: true },
    DECK_CODEX_BRIDGE_ENDPOINT: { value: "http://127.0.0.1:1/deck-runner-memory/v1" },
    DECK_CODEX_BRIDGE_TOKEN: { value: "secret-token", sensitive: true },
  }, close: async () => ({ diagnostics: [], metrics: [] }) };

  test("hands Pi the endpoint and the token-file path and never the bearer token", () => {
    const result = withPiMemoryLoopback(plan as never, bridge as never, "interactive", "/run/deck/token");
    expect(result.envOverlay).toEqual({
      DECK_PI_SESSION: { value: "1" },
      DECK_RUNNER_MEMORY_ENDPOINT: { value: "http://127.0.0.1:1/deck-runner-memory/v1" },
      DECK_RUNNER_MEMORY_TOKEN_FILE: { value: "/run/deck/token" },
    });
    expect(JSON.stringify(result)).not.toContain("secret-token");
    expect(result.bridgeBinding).toMatchObject({ surface: "deck-runner-memory-loopback-v1", mode: "interactive" });
  });
});
