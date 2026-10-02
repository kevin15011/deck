import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

import { FAUX_MODEL_ID, FAUX_PROVIDER_ID, createFauxProviderExtension } from "./__fixtures__/faux-provider-extension";

const ECHO_SERVER = fileURLToPath(new URL("./__fixtures__/tiny-mcp-echo-server.mjs", import.meta.url));

async function rpc(env: Record<string, string>, requests: Array<Record<string, unknown>>): Promise<Array<Record<string, any>>> {
  const child = Bun.spawn([process.execPath, ECHO_SERVER], { stdin: "pipe", stdout: "pipe", stderr: "pipe", env: { PATH: process.env.PATH ?? "", ...env } });
  child.stdin.write(`${requests.map((request) => JSON.stringify(request)).join("\n")}\n`);
  await child.stdin.end();
  const text = await new Response(child.stdout).text();
  await child.exited;
  return text.split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

describe("tiny MCP echo server fixture", () => {
  test("lists echo and a dashed tool name", async () => {
    const [, list] = await rpc({}, [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
    ]);
    expect(list!.result.tools.map((tool: { name: string }) => tool.name)).toEqual(["echo", "web-search"]);
  });

  test("reports the memory variables it inherited (and 'unset' otherwise)", async () => {
    const leaky = await rpc({ DECK_RUNNER_MEMORY_TOKEN: "super-secret" }, [{ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "echo", arguments: { text: "hi" } } }]);
    expect(leaky[0]!.result.content[0].text).toContain("super-secret");
    const clean = await rpc({}, [{ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "echo", arguments: { text: "hi" } } }]);
    expect(clean[0]!.result.content[0].text).toContain('"DECK_RUNNER_MEMORY_TOKEN":"unset"');
  });
});

describe("faux provider extension fixture", () => {
  test("registers a scripted provider on the Pi API", () => {
    const registered: Array<{ id: string; config: any }> = [];
    createFauxProviderExtension({ script: [{ text: "one" }] })({ registerProvider: (id: string, config: unknown) => registered.push({ id, config }) } as never);
    expect(registered).toHaveLength(1);
    expect(registered[0]!.id).toBe(FAUX_PROVIDER_ID);
    expect(registered[0]!.config.models[0].id).toBe(FAUX_MODEL_ID);
    expect(typeof registered[0]!.config.streamSimple).toBe("function");
  });
});
