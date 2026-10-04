import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { startFakeLoopbackHost } from "./__fixtures__/fake-loopback-host";
import { adaptBunBundleForNode } from "./pi-bundle-compat";
import { readPiExecutionExtensionSource } from "./pi-team-profile";

/**
 * Task 5.7 (see design.md deviation 22): the generated execution bundle still contains the legacy memory code
 * (owned by developer-team-execution-convergence; it cannot be regenerated without the canonical Bun). It reads the
 * bearer token only from `DECK_RUNNER_MEMORY_TOKEN`, which Deck never puts in the Pi environment (the token travels
 * by 0600 file and only `deck-memory` reads it), so every legacy memory path is a no-op. This test pins that.
 */
let dir: string;
let host: ReturnType<typeof startFakeLoopbackHost>;
const saved = { endpoint: process.env.DECK_RUNNER_MEMORY_ENDPOINT, token: process.env.DECK_RUNNER_MEMORY_TOKEN, tokenFile: process.env.DECK_RUNNER_MEMORY_TOKEN_FILE };
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "deck-exec-neutral-"));
  host = startFakeLoopbackHost({ dir, advisory: "<DECK_ADAPTIVE_CONTEXT_JSON_V1>x</DECK_ADAPTIVE_CONTEXT_JSON_V1>" });
});
afterEach(() => {
  host.stop();
  for (const [key, value] of [["DECK_RUNNER_MEMORY_ENDPOINT", saved.endpoint], ["DECK_RUNNER_MEMORY_TOKEN", saved.token], ["DECK_RUNNER_MEMORY_TOKEN_FILE", saved.tokenFile]] as const) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  rmSync(dir, { recursive: true, force: true });
});

async function loadExecutionExtension(): Promise<(pi: unknown) => void> {
  const file = join(dir, `execution-${Math.random().toString(36).slice(2)}.mjs`);
  writeFileSync(file, adaptBunBundleForNode(readPiExecutionExtensionSource()));
  return (await import(pathToFileURL(file).href)).default;
}

describe("legacy execution-extension memory path is neutralized by token-file handoff", () => {
  test("with the endpoint and token file in the environment but no bearer token, input/tool_call/shutdown send nothing to the host", async () => {
    process.env.DECK_RUNNER_MEMORY_ENDPOINT = host.endpoint;
    process.env.DECK_RUNNER_MEMORY_TOKEN_FILE = host.tokenFile;
    delete process.env.DECK_RUNNER_MEMORY_TOKEN;
    const handlers: Record<string, (event: any, ctx: any) => Promise<unknown> | unknown> = {};
    (await loadExecutionExtension())({ on: (name: string, handler: any) => { handlers[name] = handler; } });
    const ctx = { sessionManager: { getSessionId: () => "sess-x" } };
    await handlers.input!({ type: "input", text: "hello" }, ctx);
    await handlers.tool_call!({ type: "tool_call", toolName: "subagent", toolCallId: "c1", input: { agent: "deck-investigate", task: "x" } }, ctx);
    await handlers.session_shutdown!({ type: "session_shutdown", reason: "quit" }, ctx);
    expect(host.events).toHaveLength(0);
  });

  test("sanity: the same extension does reach the host when a bearer token is (wrongly) present, so the assertion above is meaningful", async () => {
    process.env.DECK_RUNNER_MEMORY_ENDPOINT = host.endpoint;
    process.env.DECK_RUNNER_MEMORY_TOKEN = host.token;
    const handlers: Record<string, (event: any, ctx: any) => Promise<unknown> | unknown> = {};
    (await loadExecutionExtension())({ on: (name: string, handler: any) => { handlers[name] = handler; } });
    await handlers.input!({ type: "input", text: "hello" }, { sessionManager: { getSessionId: () => "sess-x" } });
    expect(host.events.length).toBeGreaterThan(0);
  });
});
