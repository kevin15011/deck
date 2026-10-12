import { spawn } from "node:child_process";
const p = spawn("codex", ["app-server"], { stdio: ["pipe", "pipe", "pipe"] });
const T = Date.now(); const L = (...a) => console.log(((Date.now() - T) / 1000).toFixed(1) + "s", ...a);
let buf = ""; const waiters = new Map(); const notes = []; let id = 0; const mode = process.argv[2] || "approve";
const sleep = ms => new Promise(r => setTimeout(r, ms));
p.stdout.on("data", d => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); if (!l.trim()) continue; let m; try { m = JSON.parse(l) } catch { continue }
  if (m.id !== undefined && m.method) { L("SERVER REQUEST", m.method, JSON.stringify(m.params).slice(0, 260)); const decision = mode === "decline" ? "decline" : "accept"; p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: m.id, result: { decision } }) + "\n"); notes.push(m); }
  else if (m.id !== undefined && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id) } else notes.push(m); } });
const call = (method, params) => new Promise(res => { const i = ++id; waiters.set(i, res); p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: i, method, params }) + "\n"); });
try {
  await call("initialize", { clientInfo: { name: "deck-spike", title: "Deck spike", version: "0.0.0" } });
  p.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "initialized" }) + "\n");
  const t = await call("thread/start", { cwd: process.cwd(), sandbox: "read-only", approvalPolicy: "on-request", ephemeral: true });
  const tid = t.result?.thread?.id; L("thread", tid);
  const r = await call("turn/start", { threadId: tid, input: [{ type: "text", text: "Run this exact shell command and nothing else: echo hi > approved.txt . Then reply DONE." }] });
  const turnId = r.result?.turn?.id; L("turn", turnId, r.error ? JSON.stringify(r.error).slice(0, 200) : "");
  for (let k = 0; k < 90; k++) { await sleep(500); if (notes.some(m => m.method === "turn/completed")) break; }
  const msgs = notes.filter(m => m.method === "item/completed" && m.params?.item?.type === "agentMessage").map(m => m.params.item.text);
  L("methods:", [...new Set(notes.map(m => m.method))].join(","));
  L("agent:", JSON.stringify(msgs));
} catch (e) { L("ERR", e.message) } finally { p.kill("SIGINT") }
