import { spawn } from "node:child_process";
const p = spawn("codex", ["app-server"], { stdio: ["pipe", "pipe", "pipe"] });
const T = Date.now(); const L = (...a) => console.log(((Date.now() - T) / 1000).toFixed(1) + "s", ...a);
let buf = ""; const waiters = new Map(); const notes = []; let id = 0;
p.stderr.on("data", d => L("stderr", String(d).slice(0, 150)));
p.stdout.on("data", d => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); if (!l.trim()) continue; let m; try { m = JSON.parse(l) } catch { L("RAW", l.slice(0, 100)); continue } if (m.id !== undefined && waiters.has(m.id) && !m.method) { waiters.get(m.id)(m); waiters.delete(m.id) } else { notes.push(m); if (m.id !== undefined && m.method) { L("SERVER REQUEST", m.method); } } } });
const call = (method, params) => new Promise(res => { const i = ++id; waiters.set(i, res); p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: i, method, params }) + "\n"); });
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function turn(threadId, text) { const n0 = notes.length; const r = await call("turn/start", { threadId, input: [{ type: "text", text }] }); if (r.error) { L("turn err", JSON.stringify(r.error).slice(0, 200)); return } for (let k = 0; k < 120; k++) { await sleep(500); if (notes.slice(n0).some(m => m.method === "turn/completed")) break } const seen = notes.slice(n0); const msg = seen.filter(m => m.method === "item/completed" && m.params?.item?.type === "agentMessage").map(m => m.params.item.text); L("turn done; methods:", [...new Set(seen.map(m => m.method))].join(","), "| agent:", JSON.stringify(msg)); }
try {
  const init = await call("initialize", { clientInfo: { name: "deck-spike", title: "Deck spike", version: "0.0.0" } });
  L("initialize", JSON.stringify(init.result ?? init.error).slice(0, 200));
  p.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "initialized" }) + "\n");
  const t = await call("thread/start", { cwd: process.cwd(), sandbox: "read-only", approvalPolicy: "never", ephemeral: true });
  const tid = t.result?.thread?.id; L("thread/start", tid ?? JSON.stringify(t.error).slice(0, 200));
  if (tid) { await turn(tid, "Remember the word LEMON. Reply with only OK."); await turn(tid, "What word did I ask you to remember? Reply with only the word."); }
} catch (e) { L("ERR", e.message) } finally { p.kill("SIGINT") }
