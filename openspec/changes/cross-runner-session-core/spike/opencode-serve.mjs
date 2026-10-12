import { spawn } from "node:child_process";
const port = 47311;
const srv = spawn("opencode", ["serve", "--pure", "--port", String(port)], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
let log = ""; srv.stdout.on("data", d => log += d); srv.stderr.on("data", d => log += d);
const base = `http://127.0.0.1:${port}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function j(path, init) { const r = await fetch(base + path, init); const t = await r.text(); let b; try { b = JSON.parse(t) } catch { b = t.slice(0, 200) } return { status: r.status, body: b }; }
const T=Date.now(); const L=(...a)=>console.log(((Date.now()-T)/1000).toFixed(1)+"s",...a);
try {
  for (let i = 0; i < 40; i++) { try { await fetch(base + "/doc"); break } catch { await sleep(250) } }
  const doc = await j("/doc"); L("doc status", doc.status, "paths:", Object.keys(doc.body.paths || {}).filter(p => /session|event|permission|mcp/.test(p)).slice(0, 14));
  const s = await j("/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "spike" }) });
  L("create session", s.status, s.body.id);
  // SSE listener
  const ev = []; const ac = new AbortController();
  fetch(base + "/event", { signal: ac.signal }).then(async r => { const rd = r.body.getReader(); const dec = new TextDecoder(); for (;;) { const { value, done } = await rd.read(); if (done) break; for (const l of dec.decode(value).split("\n")) if (l.startsWith("data:")) { try { ev.push(JSON.parse(l.slice(5)).type) } catch {} } } }).catch(() => {});
  await sleep(300);
  const send = async (text) => j(`/session/${s.body.id}/message`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: { providerID: "opencode", modelID: "big-pickle" }, parts: [{ type: "text", text }] }) });
  const m1 = await send("Remember the word MANGO. Reply with only OK.");
  L("msg1", m1.status, JSON.stringify(m1.body.parts?.filter(p => p.type === "text").map(p => p.text) ?? m1.body).slice(0, 200));
  const m2 = await send("What word did I ask you to remember? Reply with only the word.");
  L("msg2", m2.status, JSON.stringify(m2.body.parts?.filter(p => p.type === "text").map(p => p.text) ?? m2.body).slice(0, 200));
  L("sse event types:", [...new Set(ev)].slice(0, 15));
  ac.abort();
} catch (e) { L("ERR", e.message, log.slice(-300)); }
finally { srv.kill("SIGINT"); }
