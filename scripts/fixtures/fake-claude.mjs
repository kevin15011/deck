// Stand-in for the `claude` CLI used by the session smoke harness and tests. It speaks just enough
// stream-json (shapes recorded from Claude Code 2.1.296) to drive a Deck session end to end:
//   claude --version                      -> "2.1.296 (Claude Code)"
//   SDK initialize control request       -> provider-free fixture model catalog
//   claude -p ... [--session-id|--resume] -> init / assistant / result for the first stdin line
// Every invocation appends its argv to $FAKE_CLAUDE_LOG (one JSON line) for assertions.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";

const argv = process.argv.slice(2);
if (process.env.FAKE_CLAUDE_LOG) appendFileSync(process.env.FAKE_CLAUDE_LOG, `${JSON.stringify({ argv, cwd: process.cwd() })}\n`);
const flag = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };

if (argv.includes("--version")) { console.log("2.1.296 (Claude Code)"); process.exit(0); }

const sessionId = flag("--session-id") ?? flag("--resume") ?? "00000000-0000-4000-8000-000000000000";
let servers = [];
let mcpConfig = {};
try { mcpConfig = JSON.parse(readFileSync(flag("--mcp-config"), "utf8")).mcpServers; servers = Object.keys(mcpConfig); } catch { /* none */ }

let buffer = "";
let answered = false;
process.stdin.setEncoding("utf8");
process.stdin.on("data", async (chunk) => {
  buffer += chunk;
  const at = buffer.indexOf("\n");
  if (at < 0 || answered) return;
  answered = true;
  let request;
  try { request = JSON.parse(buffer.slice(0, at)); } catch { /* malformed user input below */ }
  if (request?.type === "control_request" && request.request?.subtype === "initialize") {
    process.stdout.write(JSON.stringify({ type: "control_response", response: {
      subtype: "success", request_id: request.request_id, response: { models: [
        { value: "haiku", displayName: "Fixture Haiku", description: "Offline fixture model" },
        { value: "sonnet", displayName: "Fixture Sonnet", description: "Offline fixture model", supportsEffort: true, supportedEffortLevels: ["high"] },
      ] },
    } }) + "\n");
    return;
  }
  let text = "";
  try {
    const content = request.message.content;
    text = typeof content === "string" ? content : content.filter(part => part.type === "text").map(part => part.text).join("\n");
    if (process.env.FAKE_CLAUDE_IMAGE_LOG) {
      const images = Array.isArray(content) ? content.filter(part => part.type === "image").map(part => {
        const bytes = Buffer.from(part.source.data, "base64");
        return { mimeType: part.source.media_type, sizeBytes: bytes.length, digest: createHash("sha256").update(bytes).digest("hex") };
      }) : [];
      appendFileSync(process.env.FAKE_CLAUDE_IMAGE_LOG, JSON.stringify({ images }) + "\n");
    }
  } catch { /* keep empty */ }
  const base = { session_id: sessionId };
  const out = (m) => process.stdout.write(`${JSON.stringify({ ...m, ...base })}\n`);
  out({ type: "system", subtype: "init", cwd: process.cwd(), tools: [], mcp_servers: servers.map((name) => ({ name, status: "connected", source: "dynamic" })), model: "fake-haiku", permissionMode: "default", apiKeySource: "none", claude_code_version: "2.1.296" });
  if (process.env.FAKE_CLAUDE_CROSS === "1" && ["cross-smoke-delegate", "cross-smoke-continue"].includes(text)) {
    const spec = mcpConfig.deck;
    if (!spec) throw new Error("Explicit session bridge missing");
    const bridge = spawn(spec.command, spec.args ?? [], { env: { ...process.env, ...spec.env }, stdio: ["pipe", "pipe", "pipe"] });
    const pending = new Map(); let incoming = ""; let serial = 0;
    const abort = () => { for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error("Bridge exited")); } pending.clear(); };
    bridge.on("error", abort); bridge.on("exit", abort);
    bridge.stdout.on("data", (chunk) => {
      incoming += chunk; let at;
      while ((at = incoming.indexOf("\n")) >= 0) {
        const line = incoming.slice(0, at); incoming = incoming.slice(at + 1);
        let response; try { response = JSON.parse(line); } catch { continue; }
        const request = pending.get(response.id); if (!request) continue;
        pending.delete(response.id); clearTimeout(request.timer); request.resolve(response);
      }
    });
    const rpc = (method, params) => new Promise((resolve, reject) => {
      const id = ++serial;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error("Bridge timeout")); }, 15000);
      pending.set(id, { resolve, reject, timer });
      bridge.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
    const call = async (name, args) => {
      const reply = await rpc("tools/call", { name, arguments: args });
      if (reply.error || reply.result?.isError) throw new Error("Cross fixture tool failed");
      return JSON.parse(reply.result.content[0].text);
    };
    try {
      await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "cross-fixture", version: "1" } });
      let ids;
      if (text === "cross-smoke-delegate") {
        ids = [
          (await call("deck_delegate", { agent: "architect", task: "compiled-codex-task" })).taskId,
          (await call("deck_delegate", { agent: "apply-fast", task: "compiled-opencode-task" })).taskId,
        ];
        writeFileSync(process.env.FAKE_CROSS_TASK_FILE, JSON.stringify(ids), { mode: 0o600 });
      } else {
        ids = [JSON.parse(readFileSync(process.env.FAKE_CROSS_TASK_FILE, "utf8"))[0]];
        await call("deck_delegate", { agent: "architect", task: "compiled-codex-continuation", continueTaskId: ids[0] });
      }
      const waited = await call("deck_task_wait", { taskIds: ids, timeoutSec: 10 });
      if (waited.tasks.some((task) => task.state !== "completed")) throw new Error("Cross fixture task did not complete");
      for (const taskId of ids) {
        const result = await call("deck_task_result", { taskId });
        if (result.state !== "completed") throw new Error("Cross fixture result missing");
      }
    } finally { bridge.stdin.end(); }
  }
  if (process.env.FAKE_CLAUDE_APPROVAL === "1") {
    const spec = mcpConfig["deck"];
    if (!spec) throw new Error("Explicit session bridge missing");
    const bridge = spawn(spec.command, spec.args ?? [], { env: {...process.env, ...spec.env}, stdio: ["pipe", "pipe", "pipe"] });
    let incoming = "";
    const reply = new Promise((resolve, reject) => {
      bridge.stdout.on("data", chunk => { incoming += chunk; let at; while ((at = incoming.indexOf("\n")) >= 0) { const line = incoming.slice(0, at); incoming = incoming.slice(at + 1); try { const value = JSON.parse(line); if (value.id === 2) resolve(value); } catch {} } });
      bridge.on("error", reject);
      bridge.on("exit", code => { if (code) reject(new Error("Bridge exited")); });
    });
    bridge.stdin.write(JSON.stringify({jsonrpc:"2.0",id:1,method:"initialize",params:{protocolVersion:"2024-11-05",capabilities:{},clientInfo:{name:"fixture",version:"1"}}}) + "\n");
    bridge.stdin.write(JSON.stringify({jsonrpc:"2.0",id:2,method:"tools/call",params:{name:"deck_approve",arguments:{tool_name:"Read",input:{file_path:"README.md"}}}}) + "\n");
    await reply;
    bridge.stdin.end();
  }
  out({ type: "assistant", message: { id: "msg_fake", type: "message", role: "assistant", content: [{ type: "text", text: `echo: ${text}` }], usage: { input_tokens: 1, output_tokens: 1 } }, parent_tool_use_id: null });
  out({ type: "result", subtype: "success", is_error: false, duration_ms: 5, num_turns: 1, result: `echo: ${text}`, total_cost_usd: 0, usage: { input_tokens: 1, output_tokens: 1 }, permission_denials: [], terminal_reason: "completed" });
  // flush before exiting: pipe writes are asynchronous
  process.stdout.write("", () => process.exit(0));
});
process.stdin.on("end", () => { if (!answered) process.exit(0); });
