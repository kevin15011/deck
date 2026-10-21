// Native app-server JSONL fixture, including read-only inventory and effective config checks.
import { createHash } from "node:crypto";
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";
const argv = process.argv.slice(2);
if (process.env.FAKE_CODEX_LOG) appendFileSync(process.env.FAKE_CODEX_LOG, JSON.stringify({ argv, home: process.env.HOME }) + "\n");
if (argv.includes("--version")) { console.log("codex-cli 0.162.1"); process.exit(0); }
let servers = {};
let plugins = {};
const features = {};
for (let i = 0; i < argv.length; i++) {
  if (argv[i] !== "-c") continue;
  const entry = argv[++i];
  const feature = /^features\.(.+)=false$/.exec(entry);
  if (feature) features[feature[1]] = false;
  if (entry.startsWith("mcp_servers=")) servers = JSON.parse(entry.slice("mcp_servers=".length).replace(/([,{])"([^"\\]+)"=/g, '$1"$2":'));
  if (entry.startsWith("plugins=")) plugins = JSON.parse(entry.slice("plugins=".length).replace(/([,{])"([^"\\]+)"=/g, '$1"$2":'));
  const server = /^mcp_servers\."([^"]+)"=(.*)$/.exec(entry);
  if (server) servers[server[1]] = JSON.parse(server[2].replace(/([,{])"([^"\\]+)"=/g, '$1"$2":'));
  const disabled = /^mcp_servers\."([^"]+)"\.enabled=false$/.exec(entry);
  if (disabled) servers[disabled[1]] = { enabled: false };
}
const threads = new Map();
let activeThreadId = "fake-thread";
// Summaries prove exact protected declarations without persisting stdin secrets.
const digest = value => createHash("sha256").update(JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item)).digest("hex");
const send = value => process.stdout.write(JSON.stringify(value) + "\n");
createInterface({ input: process.stdin }).on("line", line => {
  const message = JSON.parse(line);
  if (message.id === undefined) return;
  let result = {};
  if (message.method === "initialize") result = { userAgent: "fake-codex" };
  else if (message.method === "config/read") result = { config: { mcp_servers: servers, features, plugins } };
  else if (message.method === "thread/start" || message.method === "thread/resume") {
    activeThreadId = message.params.threadId ?? "fake-thread";
    const overrides = message.params.config?.mcp_servers ?? {};
    // config/read remains native inventory; only this thread receives Deck additions.
    threads.set(activeThreadId, { ...servers, ...overrides });
    if (process.env.FAKE_CODEX_LOG) appendFileSync(process.env.FAKE_CODEX_LOG, JSON.stringify({ event: "thread-config", method: message.method, threadId: activeThreadId, approvalPolicy: message.params.approvalPolicy, approvalsReviewer: message.params.approvalsReviewer, sandbox: message.params.sandbox, mcpServerDigests: Object.fromEntries(Object.entries(overrides).map(([id, spec]) => [id, digest(spec)])) }) + "\n");
    result = { thread: { id: activeThreadId } };
  }
  else if (message.method === "mcpServerStatus/list") {
    const effective = threads.get(message.params?.threadId) ?? servers;
    result = { data: Object.keys(effective).filter(id => effective[id].enabled !== false).map(name => ({ name, runtimeStatus: "connected" })), nextCursor: null };
  }
  else if (message.method === "turn/start") result = { turn: { id: "fake-turn" } };
  send({ id: message.id, result });
  if (message.method === "turn/start") {
    send({ method: "turn/started", params: { threadId: activeThreadId, turn: { id: "fake-turn", status: "inProgress" } } });
    const prompt = message.params.input?.find(part => part.type === "text")?.text ?? "";
    send({ method: "item/completed", params: { threadId: activeThreadId, turnId: "fake-turn", item: { id: "fake-message", type: "agentMessage", text: "echo: " + prompt } } });
    send({ method: "turn/completed", params: { threadId: activeThreadId, turn: { id: "fake-turn", status: "completed" } } });
  }
});
