import { spawn } from "node:child_process";
const p = spawn("claude", ["-p", "--model", "haiku", "--tools", "", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose"], { stdio: ["pipe", "pipe", "ignore"] });
const T = Date.now(); const L = (...a) => console.log(((Date.now() - T) / 1000).toFixed(1) + "s", ...a);
let buf = ""; const types = [];
p.stdout.on("data", d => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); try { const e = JSON.parse(l); types.push(e.type + (e.subtype ? "/" + e.subtype : "")); if (e.type === "result") L("RESULT", e.subtype, "is_error=" + e.is_error, JSON.stringify(e.result ?? "").slice(0, 60)) } catch {} } });
p.on("exit", (c, s) => { L("exit", c, s, "events:", [...new Set(types)].filter(t => !t.startsWith("system/hook")).join(",")); process.exit(0) });
p.stdin.write(JSON.stringify({ type: "user", message: { role: "user", content: "Write a very long essay of 3000 words about the history of computing." } }) + "\n");
setTimeout(() => { L("SIGINT"); p.kill("SIGINT") }, 4000);
setTimeout(() => { L("force kill"); p.kill("SIGKILL") }, 20000);
