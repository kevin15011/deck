import { spawn } from "node:child_process";
const S = process.argv[2]; const port = 47312;
const cfg = { mcp: { deck: { type: "local", command: ["node", `${S}/mcp/deck-mcp.mjs`], enabled: true, environment: { DECK_SPIKE_LOG: `${S}/mcp/oc.log` } } }, permission: { "deck_deck_delegate": "ask" } };
const srv = spawn("opencode", ["serve", "--pure", "--port", String(port)], { cwd: process.cwd(), env: { ...process.env, OPENCODE_CONFIG_CONTENT: JSON.stringify(cfg) }, stdio: "ignore" });
const T = Date.now(); const L = (...a) => console.log(((Date.now() - T) / 1000).toFixed(1) + "s", ...a);
const base = `http://127.0.0.1:${port}`; const sleep = ms => new Promise(r => setTimeout(r, ms));
async function j(path, init) { const r = await fetch(base + path, init); const t = await r.text(); let b; try { b = JSON.parse(t) } catch { b = t.slice(0, 200) } return { status: r.status, body: b }; }
const post = (path, body) => j(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });
try {
  for (let i = 0; i < 40; i++) { try { await fetch(base + "/doc"); break } catch { await sleep(250) } }
  const mcp = await j("/mcp"); L("mcp status", JSON.stringify(mcp.body).slice(0, 200));
  const s = await post("/session", { title: "spike2" }); const sid = s.body.id; L("session", sid);
  const model = { providerID: "opencode", modelID: "big-pickle" };
  const a = await post(`/session/${sid}/prompt_async`, { model, parts: [{ type: "text", text: "Call the deck_delegate tool with agent=apply and task=hello, then reply with the receipt text only." }] }); L("prompt_async", a.status);
  let replied = false;
  for (let k = 0; k < 80 && !replied; k++) { await sleep(500); const p = await j("/permission"); const list = Array.isArray(p.body) ? p.body : []; if (list.length) { L("PENDING PERMISSION", JSON.stringify(list[0]).slice(0, 300)); const r = await post(`/permission/${list[0].id}/reply`, { reply: "once" }); L("reply", r.status, JSON.stringify(r.body).slice(0, 80)); replied = true } }
  for (let k = 0; k < 60; k++) { await sleep(500); const st = await j(`/session/status`); if (!st.body?.[sid]) break }
  const msgs = await j(`/session/${sid}/message`); const texts = (msgs.body || []).flatMap(m => (m.parts || []).filter(p => p.type === "text" || p.type === "tool").map(p => p.type === "tool" ? `tool:${p.tool}:${p.state?.status}` : p.text));
  L("transcript", JSON.stringify(texts).slice(0, 400));
  // abort test
  const s2 = await post("/session", { title: "abort" });
  await post(`/session/${s2.body.id}/prompt_async`, { model, parts: [{ type: "text", text: "Write a very long essay of 3000 words about the history of computing." }] });
  await sleep(2500); const ab = await post(`/session/${s2.body.id}/abort`); L("abort", ab.status, JSON.stringify(ab.body).slice(0, 60));
  await sleep(1500); const st2 = await j("/session/status"); L("status after abort", JSON.stringify(st2.body).slice(0, 120));
} catch (e) { L("ERR", e.message) } finally { srv.kill("SIGINT") }
