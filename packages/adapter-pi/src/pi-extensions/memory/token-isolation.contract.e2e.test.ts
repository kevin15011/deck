import { afterEach, describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

import { startFakeLoopbackHost } from "../../__fixtures__/fake-loopback-host";
import { createPiHarness, findRealPi, type PiHarness } from "../../pi-cli-harness";
import { DECK_PI_MEMORY_ENV_BLANKS } from "../../pi-deck-mcp";

const ECHO_SERVER = fileURLToPath(new URL("../../__fixtures__/tiny-mcp-echo-server.mjs", import.meta.url));
const node = Bun.which("node");
const realTest = findRealPi() !== undefined && node ? test : test.skip;

let harness: PiHarness | undefined;
let host: ReturnType<typeof startFakeLoopbackHost> | undefined;
afterEach(() => { host?.stop(); host = undefined; harness?.cleanup(); harness = undefined; });

const echoEntry = (env: Record<string, string>) => ({ "context-mode": { command: node!, args: [ECHO_SERVER], env, exposure: "direct" } });

async function echoedEnv(mcpEnv: Record<string, string>, leakToken: boolean): Promise<string> {
  harness = createPiHarness({ mcpServers: echoEntry(mcpEnv) });
  host = startFakeLoopbackHost({ dir: harness.root, advisory: "<DECK_ADAPTIVE_CONTEXT_JSON_V1>x</DECK_ADAPTIVE_CONTEXT_JSON_V1>" });
  const run = await harness.run(["use the tool"], {
    DECK_PI_SESSION: "1", DECK_PI_ROLE: "lead", ...host.env,
    ...(leakToken ? { DECK_RUNNER_MEMORY_TOKEN: host.token } : {}),
    FAUX_SCRIPT: "tool", FAUX_TOOL: "mcp__context_mode__echo", FAUX_TOOL_INPUT: JSON.stringify({ text: "hi" }),
  });
  const end = run.events.find((event) => event.type === "tool_execution_end" && event.toolName === "mcp__context_mode__echo");
  return JSON.stringify(end?.result ?? run.events.slice(-3));
}

describe("memory token isolation from MCP servers (real Pi 1.0 runtime)", () => {
  realTest("a stdio MCP server never sees the bearer token, even when the launcher leaked it into the Pi env, once Deck's env blanks are in place", async () => {
    const seen = await echoedEnv({ ...DECK_PI_MEMORY_ENV_BLANKS }, true);
    expect(seen).toContain("TINY_ECHO:hi");
    expect(seen).not.toContain("deck-loopback-fake-host-token");
    expect(seen).toContain('\\"DECK_RUNNER_MEMORY_TOKEN\\":\\"\\"');
  }, 120_000);

  realTest("R6 (verified on Pi 1.0.0): extension factories run, and scrub the token variables, before Pi spawns MCP stdio servers", async () => {
    // No Deck env blanks here: the MCP child inherits whatever is left in process.env at spawn time.
    const seen = await echoedEnv({}, true);
    expect(seen).toContain("TINY_ECHO:hi");
    expect(seen).toContain('\\"DECK_RUNNER_MEMORY_TOKEN\\":\\"unset\\"');
    expect(seen).toContain('\\"DECK_RUNNER_MEMORY_TOKEN_FILE\\":\\"unset\\"');
    expect(seen).not.toContain("deck-loopback-fake-host-token");
  }, 120_000);
});
