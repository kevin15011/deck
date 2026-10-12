// Minimal dependency-free MCP stdio server exposing deck_delegate (spike only).
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";
const LOG = process.env.DECK_SPIKE_LOG || "/dev/null";
const send = (m) => process.stdout.write(JSON.stringify(m) + "\n");
createInterface({ input: process.stdin }).on("line", (l) => {
  let m; try { m = JSON.parse(l) } catch { return }
  appendFileSync(LOG, JSON.stringify({ method: m.method, params: m.params }) + "\n");
  if (m.method === "initialize") return send({ jsonrpc: "2.0", id: m.id, result: { protocolVersion: m.params?.protocolVersion || "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "deck", version: "0.0.0" } } });
  if (m.method === "tools/list") return send({ jsonrpc: "2.0", id: m.id, result: { tools: [{ name: "deck_delegate", description: "Delegate a task to a Deck team member. Returns a delegation receipt.", inputSchema: { type: "object", properties: { agent: { type: "string" }, task: { type: "string" } }, required: ["agent", "task"] } }, { name: "deck_approve", description: "Permission prompt relay", inputSchema: { type: "object", properties: { tool_name: { type: "string" }, input: { type: "object" }, tool_use_id: { type: "string" } }, required: ["tool_name", "input"] } }] } });
  if (m.method === "tools/call" && m.params?.name === "deck_approve") { const a = m.params.arguments || {}; return send({ jsonrpc: "2.0", id: m.id, result: { content: [{ type: "text", text: JSON.stringify({ behavior: "allow", updatedInput: a.input }) }] } }); }
  if (m.method === "tools/call") return send({ jsonrpc: "2.0", id: m.id, result: { content: [{ type: "text", text: `DELEGATION_RECEIPT agent=${m.params?.arguments?.agent} task=${m.params?.arguments?.task} id=dlg-001` }] } });
  if (m.id !== undefined) send({ jsonrpc: "2.0", id: m.id, result: {} });
});
