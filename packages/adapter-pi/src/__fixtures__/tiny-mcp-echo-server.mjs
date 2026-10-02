// Test-only stdio MCP server (copied from the Phase 0 spike harness).
// `echo` returns the argument text plus the values of the Deck memory env variables it inherited, so tests can
// prove that no memory endpoint/token leaks to MCP children. `web-search` exists to exercise `-` -> `_` naming.
import readline from "node:readline";

const WATCHED = ["DECK_RUNNER_MEMORY_ENDPOINT", "DECK_RUNNER_MEMORY_TOKEN", "DECK_RUNNER_MEMORY_TOKEN_FILE", "TAVILY_API_KEY"];
const rl = readline.createInterface({ input: process.stdin });
const send = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);

rl.on("line", (line) => {
  let message;
  try { message = JSON.parse(line); } catch { return; }
  if (message.method === "initialize") {
    send({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: message.params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "tiny", version: "0.0.1" }, instructions: "Tiny echo server for tests." } });
  } else if (message.method === "tools/list") {
    send({ jsonrpc: "2.0", id: message.id, result: { tools: [
      { name: "echo", description: "Echo text and inherited watched env", inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] }, annotations: { readOnlyHint: true } },
      { name: "web-search", description: "dash name", inputSchema: { type: "object", properties: {} } },
    ] } });
  } else if (message.method === "tools/call") {
    const env = Object.fromEntries(WATCHED.map((name) => [name, process.env[name] ?? "unset"]));
    send({ jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text: `TINY_ECHO:${message.params.arguments?.text ?? ""}:env=${JSON.stringify(env)}` }] } });
  } else if (message.id !== undefined) {
    send({ jsonrpc: "2.0", id: message.id, result: {} });
  }
});
