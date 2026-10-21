#!/usr/bin/env node
// Test-only graph fixture: registers the actual four discovery contracts over native stdio MCP.
import readline from "node:readline";
const names = ["search_graph", "trace_path", "get_code_snippet", "search_code"];
const send = (id, result) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
readline.createInterface({ input: process.stdin }).on("line", line => {
  const message = JSON.parse(line);
  if (message.id === undefined) return;
  if (message.method === "initialize") send(message.id, { protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "reviewed-graph-fixture", version: "0.11.0" } });
  else if (message.method === "tools/list") send(message.id, { tools: names.map(name => ({ name, description: "Fixture graph discovery", inputSchema: { type: "object", properties: {} } })) });
  else if (message.method === "tools/call" && names.includes(message.params.name)) send(message.id, { content: [{ type: "text", text: `FIXTURE_GRAPH:${message.params.name}` }] });
  else send(message.id, {});
});
