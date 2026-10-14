// Native loopback serve fixture. No provider, auth-file or installation effects.
import { appendFileSync } from "node:fs";
import { createServer } from "node:http";
const argv = process.argv.slice(2);
if (process.env.FAKE_OPENCODE_LOG) appendFileSync(process.env.FAKE_OPENCODE_LOG, JSON.stringify({ argv, configDir: process.env.OPENCODE_CONFIG_DIR, disableProjectConfig: process.env.OPENCODE_DISABLE_PROJECT_CONFIG, disableClaudeCode: process.env.OPENCODE_DISABLE_CLAUDE_CODE, config: JSON.parse(process.env.OPENCODE_CONFIG_CONTENT || "{}"), passwordConfigured: (process.env.OPENCODE_SERVER_PASSWORD?.length ?? 0) >= 32 }) + "\n");
if (argv.includes("--version")) { console.log("1.18.31"); process.exit(0); }
const config = JSON.parse(process.env.OPENCODE_CONFIG_CONTENT || "{}");
const authorization = "Basic " + Buffer.from("opencode:" + process.env.OPENCODE_SERVER_PASSWORD).toString("base64");
const streams = new Set();
const session = { id: "fake-session" };
const server = createServer(async (req, res) => {
  if (req.headers.authorization !== authorization) { res.writeHead(401).end(); return; }
  if (req.url === "/event") { res.writeHead(200, { "content-type": "text/event-stream" }); res.write(": ready\n\n"); streams.add(res); req.on("close", () => streams.delete(res)); return; }
  let text = ""; for await (const chunk of req) text += chunk;
  const body = text ? JSON.parse(text) : {};
  let result = {};
  if (req.url === "/mcp") result = Object.fromEntries(Object.keys(config.mcp || {}).map(id => [id, { status: "connected" }]));
  else if (req.url === "/session" || req.url === "/session/fake-session") result = session;
  else if (req.url === "/permission") result = [];
  else if (req.url === "/session/fake-session/message") result = { info: { id: "fake-message", sessionID: session.id, role: "assistant" }, parts: [{ type: "text", text: "echo: " + body.parts?.[0]?.text }] };
  else if (req.url?.endsWith("/abort")) for (const stream of streams) stream.write('data: {"type":"session.idle","properties":{"sessionID":"fake-session"}}\n\n');
  res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(result));
});
server.listen(0, "127.0.0.1", () => console.log(`opencode server listening on http://127.0.0.1:${server.address().port}`));
