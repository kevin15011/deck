import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createECDH, randomBytes, randomUUID } from "node:crypto";
import { EventLog } from "../event-log";
import { resolveStatePaths, ensureStateLayout } from "../paths";
import { WebService } from "../web-service";
import type { SessionService } from "../service";
import { waitFor } from "./test-helpers";
import { listOpenSpecArtifacts, readOpenSpecArtifact } from "../openspec-artifacts";
import { Database } from 'bun:sqlite';
const NativeWebSocket = WebSocket as unknown as {
  new (url: string, options: Bun.WebSocketOptions): WebSocket;
};
const roots: string[] = [], hosts: WebService[] = [], logs: EventLog[] = [];
afterEach(async () => { await Promise.all(hosts.splice(0).map(h => h.close())); logs.splice(0).forEach(l => l.close()); roots.splice(0).forEach(r => rmSync(r, { recursive: true, force: true })); });
function fixture(extra = {}) {
  const root = mkdtempSync(join(tmpdir(), "dw-"));
  roots.push(root);
  const paths = resolveStatePaths({ env: { XDG_STATE_HOME: root } });
  ensureStateLayout(paths);
  const log = EventLog.open({ dir: join(paths.sessionsDir, "s", "events"), sessionId: "s" });
  logs.push(log);
  const executed: unknown[] = [];
  const service: SessionService = { execute: async (i) => { executed.push(i); return { ok: true }; }, openLog: id => id === "s" ? log : undefined, hasRunningWork: () => false, query: () => ({ ok: true, data: { sessions: [{ sessionId: "s" }] } }) };
  const host = new WebService({ paths, service, config: { port: 0, trustedProxy: null, allowedOrigins: [], allowFunnel: false }, ...extra });
  hosts.push(host);
  host.enable();
  return { host, paths, log, executed, base: host.status().url! };
}
async function pair(f: ReturnType<typeof fixture>) { const p = f.host.pair(); const response = await fetch(`${f.base}/pair`, { method: "POST", headers: { Origin: f.base, "Content-Type": "application/json" }, body: JSON.stringify({ code: p.code, name: "Test" }) }); return { response, cookie: response.headers.get("set-cookie")!.split(";")[0]!, p }; }

test('P011 context observation crosses the production history and live chat transports', async () => {
  const f = fixture(), { cookie } = await pair(f), headers = { Cookie: cookie };
  const source = { taskId: 'lead', memberId: 'lead', runnerId: 'codex', nativeSessionId: 'thread' };
  f.log.append({ kind: 'task.created', source, data: { taskId: 'lead', attempt: 1 } });
  f.log.append({ kind: 'turn.started', source, data: { attempt: 1, nativeTurnId: 'turn' } });
  const context = { basis: 'codex-last-total', tokens: 34794, capacity: 258400, nativeThreadId: 'thread', nativeTurnId: 'turn', modelId: 'model' };
  f.log.append({ kind: 'usage', source, data: { attempt: 1, context }, raw: { runnerId: 'codex', protocol: 'codex-app-server', payload: { secret: 'RAW_NATIVE' }, truncated: false } });
  const url = `${f.base}/api/sessions/s/history`;
  const snapshot = await (await fetch(url, { headers })).json();
  expect(snapshot.events.find((e: any) => e.kind === 'usage')?.data.context).toEqual(context);
  expect(JSON.stringify(snapshot.events)).not.toContain('RAW_NATIVE');
  const socket = new NativeWebSocket(`${f.base.replace('http:', 'ws:')}/api/sessions/s/events?after=${snapshot.seq}&view=chat`, { headers: { ...headers, Origin: f.base } });
  const frames: any[] = []; socket.onmessage = event => frames.push(JSON.parse(String(event.data)));
  try {
    await waitFor(() => socket.readyState === WebSocket.OPEN);
    f.log.append({ kind: 'usage', source, data: { attempt: 1, context: { ...context, tokens: 40000 } } });
    f.log.append({ kind: 'turn.completed', source, data: { status: 'completed', attempt: 1 } });
    await waitFor(() => frames.some(f => f.event?.kind === 'turn.completed'));
    const live = frames.find(f => f.event?.kind === 'usage')?.event;
    const reconnected = await (await fetch(url, { headers })).json();
    expect(reconnected.events.filter((e: any) => e.kind === 'usage')).toHaveLength(1);
    expect(reconnected.events.find((e: any) => e.kind === 'usage')).toEqual(live);
  } finally { socket.close(); }
});

test("project actions require the authenticated same-origin workspace command boundary", async () => {
  const f = fixture();
  const commands = [{ type:"project.trust",projectId:"p",runnerId:"opencode",trusted:true,expectedRevision:0 }, { type: "project.rename", projectId: "p", name: "Renamed" }, { type: "project.remove", projectId: "p" }];
  const send = (command: unknown, headers: Record<string, string>) => fetch(`${f.base}/api/commands`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify({ command: { v: 1, commandId: randomUUID(), ...(command as object) } }) });
  for (const command of commands) expect((await send(command, { Origin: f.base })).status).toBe(401);
  expect(f.executed).toHaveLength(0);
  const { cookie } = await pair(f);
  for (const command of commands) expect((await send(command, { Origin: "http://evil.example", Cookie: cookie })).status).toBe(403);
  expect(f.executed).toHaveLength(0);
  for (const command of commands) expect((await send(command, { Origin: f.base, Cookie: cookie })).status).toBe(200);
  expect(f.executed).toHaveLength(commands.length);
});

test("sidebar status polling authenticates and bounds session IDs before dispatch", async () => {
  const queries: unknown[] = [];
  const f = fixture({ service: { execute: async () => ({ ok: true }), openLog: () => undefined, hasRunningWork: () => false, query: async (name: string, args: unknown) => { queries.push({ name, args }); return { ok: true, data: { sessions: [] } }; } } });
  const route = "/api/sessions/status?projectId=p&sessionId=s&sessionId=t";
  expect((await fetch(`${f.base}${route}`)).status).toBe(401);
  const { cookie } = await pair(f); const headers = { Cookie: cookie };
  expect((await fetch(`${f.base}${route}`, { headers })).status).toBe(200);
  expect(queries).toEqual([{ name: "sessions.status", args: { projectId: "p", sessionIds: ["s", "t"] } }]);
  for (const route of ["/api/sessions/status?projectId=p", "/api/sessions/status?projectId=p&sessionId=..%2Fescape", `/api/sessions/status?projectId=p&${Array(101).fill("sessionId=s").join("&")}`, "/api/sessions/status?projectId=p&projectId=q&sessionId=s"]) expect((await fetch(`${f.base}${route}`, { headers })).status).toBe(400);
  expect(queries).toHaveLength(1);
});

test("workspace query endpoints require authentication and forward bounded explicit parameters", async () => {
  const queries: unknown[] = [];
  const f = fixture({ service: {
    execute: async () => ({ ok: true }), openLog: () => undefined, hasRunningWork: () => false,
    query: async (name: string, args: unknown) => { queries.push({ name, args }); return { ok: true, data: {} }; },
  } });
  const routes = ["/api/projects", "/api/directories?path=~%2F&prefix=rep&limit=10", "/api/sessions?projectId=p&limit=1&cursor=c", "/api/models?projectId=p", "/api/sessions/s/readiness"];
  for (const route of routes) expect((await fetch(`${f.base}${route}`)).status).toBe(401);
  const { cookie } = await pair(f); const headers = { Cookie: cookie };
  for (const route of routes) expect((await fetch(`${f.base}${route}`, { headers })).status).toBe(200);
  expect(queries).toEqual([
    { name: "projects.list", args: {} },
    { name: "directories.list", args: { path: "~/", prefix: "rep", limit: 10 } },
    { name: "sessions.list", args: { projectId: "p", cursor: "c", limit: 1 } },
    { name: "runners.models", args: { projectId: "p" } },
    { name: "session.readiness", args: { sessionId: "s" } },
  ]);
  expect((await fetch(`${f.base}/api/directories?path=a&path=b`, { headers })).status).toBe(400);
  expect((await fetch(`${f.base}/api/directories`, { headers: { ...headers, Host: "evil.example" } })).status).toBe(403);
});

test("OpenSpec endpoints require a device and forward only session-scoped selections", async () => {
  const queries: unknown[] = [];
  const f = fixture({ service: {
    execute: async () => ({ ok: true }), openLog: () => undefined, hasRunningWork: () => false,
    query: async (name: string, args: unknown) => {
      queries.push({ name, args });
      if ((args as any).sessionId === "unknown") return { ok: false, code: "session-unknown" };
      return { ok: true, data: name === "openspec.list" ? { changes: [] } : { changeId: "alpha", path: "specs/core/spec.md", markdown: "# Spec", updatedAt: "2026-10-13T00:00:00Z" } };
    },
  } });
  for (const suffix of ["", "/artifact?changeId=alpha&path=tasks.md"]) {
    expect((await fetch(`${f.base}/api/sessions/s/openspec${suffix}`)).status).toBe(401);
  }
  expect(queries).toHaveLength(0);
  const { cookie } = await pair(f), headers = { Cookie: cookie };
  expect(await (await fetch(`${f.base}/api/sessions/s/openspec?projectRoot=/outside`, { headers })).json()).toEqual({ ok: true, data: { changes: [] } });
  const response = await fetch(`${f.base}/api/sessions/s/openspec/artifact?changeId=alpha&path=specs%2Fcore%2Fspec.md&projectRoot=/outside`, { headers });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ ok: true, data: { markdown: "# Spec" } });
  expect(queries).toEqual([
    { name: "openspec.list", args: { sessionId: "s" } },
    { name: "openspec.read", args: { sessionId: "s", changeId: "alpha", path: "specs/core/spec.md" } },
  ]);
  expect((await fetch(`${f.base}/api/sessions/unknown/openspec`, { headers })).status).toBe(404);
  expect((await fetch(`${f.base}/api/sessions/s/openspec/artifact`, { headers })).status).toBe(400);
  expect((await fetch(`${f.base}/api/sessions/s/openspec`, { method: "POST", headers: { ...headers, Origin: f.base } })).status).toBe(404);
});

test("OpenSpec HTTP reader rejects encoded traversal, symlinks, oversized and non-Markdown files", async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "web-openspec-")); roots.push(projectRoot);
  // Resolve macOS's /tmp alias as the production session creation path does.
  const { realpathSync } = await import("node:fs");
  const scope = { projectRoot: realpathSync(projectRoot), changeId: "alpha" };
  const dir = join(scope.projectRoot, "openspec", "changes", "alpha");
  mkdirSync(join(dir, "specs"), { recursive: true });
  writeFileSync(join(dir, "specs", "spec.md"), "# Current specification");
  writeFileSync(join(dir, "large.md"), Buffer.alloc(1024 * 1024 + 1));
  symlinkSync(join(dir, "specs", "spec.md"), join(dir, "linked.md"));
  const f = fixture({ service: {
    execute: async () => ({ ok: true }), openLog: () => undefined, hasRunningWork: () => false,
    query: (name: string, args: any) => name === "openspec.list" ? listOpenSpecArtifacts(scope) : readOpenSpecArtifact(scope, args.changeId, args.path),
  } });
  const { cookie } = await pair(f), headers = { Cookie: cookie };
  const base = `${f.base}/api/sessions/s/openspec/artifact?changeId=alpha&path=`;
  const good = await fetch(`${base}specs%2Fspec.md`, { headers });
  expect(good.status).toBe(200); expect(await good.json()).toMatchObject({ ok: true, data: { markdown: "# Current specification" } });
  for (const path of ["%2e%2e%2Fsecret.md", "%252e%252e%252fsecret.md", "%2Fsecret.md", "specs%5Cspec.md", "spec.md%00", "state.yaml"]) {
    const r = await fetch(`${base}${path}`, { headers });
    expect(r.status).toBe(400); expect(await r.json()).toMatchObject({ ok: false, code: "openspec-invalid" });
  }
  for (const [path, status, code] of [["linked.md", 403, "openspec-forbidden"], ["large.md", 413, "openspec-too-large"], ["deleted.md", 404, "openspec-not-found"]] as const) {
    const r = await fetch(`${base}${path}`, { headers });
    expect(r.status).toBe(status); expect(await r.json()).toMatchObject({ ok: false, code });
  }
  expect((await fetch(`${base}specs%2Fspec.md&path=other.md`, { headers })).status).toBe(400);
  expect((await fetch(`${f.base}/api/sessions/s/openspec/artifact?changeId=beta&path=tasks.md`, { headers })).status).toBe(403);
  expect((await fetch(`${f.base}/api/sessions/s/openspec`, { headers: { ...headers, Host: "evil.example" } })).status).toBe(403);
  f.host.revoke(f.host.devices()[0]!.id);
  expect((await fetch(`${base}specs%2Fspec.md`, { headers })).status).toBe(401);
});
describe("restricted paired web listener", () => {
  test("bind is loopback and unauthenticated API is refused with strict headers", async () => { const f = fixture(); const r = await fetch(`${f.base}/api/sessions`); expect(r.status).toBe(401); expect(r.headers.get("content-security-policy")).toContain("default-src 'self'"); expect(r.headers.get("x-content-type-options")).toBe("nosniff"); expect(f.host.status().hostname).toBe("127.0.0.1"); });
  test("pairing single use, cookie flags and private hashed persistence", async () => { const f = fixture(); const { response, cookie, p } = await pair(f); expect(response.status).toBe(200); expect(response.headers.get("set-cookie")).toContain("HttpOnly; SameSite=Strict"); const disk = readFileSync(f.paths.devicesFile, "utf8"); expect(disk).not.toContain(cookie.split("=")[1]!); expect(statSync(f.paths.devicesFile).mode & 0o777).toBe(0o600); const reuse = await fetch(`${f.base}/pair`, { method: "POST", headers: { Origin: f.base, "Content-Type": "application/json" }, body: JSON.stringify({ code: p.code }) }); expect(reuse.status).toBe(401); expect((await fetch(`${f.base}/api/sessions`, { headers: { Cookie: cookie } })).status).toBe(200); });
  test("rejects rebinding, cross origin, forwarding and administrative routes", async () => { const f = fixture(); const { cookie } = await pair(f); expect((await fetch(`${f.base}/api/sessions`, { headers: { Host: "evil.example", Cookie: cookie } })).status).toBe(403); expect((await fetch(`${f.base}/api/sessions`, { headers: { "X-Forwarded-For": "127.0.0.1", Cookie: cookie } })).status).toBe(403); expect((await fetch(`${f.base}/api/commands`, { method: "POST", headers: { Origin: "https://evil.example", Cookie: cookie, "Content-Type": "application/json" }, body: "{}" })).status).toBe(403); expect((await fetch(`${f.base}/api/bridge`, { headers: { Cookie: cookie } })).status).toBe(404); });
  test("validates commands, supports bounded replay and revokes persistent credentials", async () => { const f = fixture({ maxReplayEvents: 2 }); const { cookie } = await pair(f); for (let i = 0; i < 3; i++)
    f.log.append({ kind: "diagnostic", data: { code: "test", i } }); const replay = await (await fetch(`${f.base}/api/sessions/s/events?after=0`, { headers: { Cookie: cookie } })).json(); expect(replay.events.map((e: any) => e.seq)).toEqual([1, 2]); expect(replay.hasMore).toBe(true); const command = { v: 1, commandId: randomUUID(), type: "prompt.send", text: "hi" }; const post = () => fetch(`${f.base}/api/commands`, { method: "POST", headers: { Origin: f.base, Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: "s", command }) }); expect((await post()).status).toBe(200); expect(f.executed).toHaveLength(1); f.host.revoke(f.host.devices()[0]!.id); expect((await post()).status).toBe(401); });
  test("pairing expires and five failed attempts exhaust the challenge", async () => { let now = 0; const f = fixture({ now: () => now }); const p = f.host.pair(); const tryCode = (code: string) => fetch(`${f.base}/pair`, { method: "POST", headers: { Origin: f.base, "Content-Type": "application/json" }, body: JSON.stringify({ code }) }); for (let i = 0; i < 5; i++)
    expect((await tryCode("wrong")).status).toBe(401); expect((await tryCode(p.code)).status).toBe(401); const q = f.host.pair(); now = 300001; expect((await tryCode(q.code)).status).toBe(401); });
});
test("websocket replays then streams, rejects foreign origins and closes on device revocation", async () => {
  const f = fixture();
  const { cookie } = await pair(f);
  f.log.append({ kind: "diagnostic", data: { code: "before" } });
  const events: any[] = [];
  const ws = new NativeWebSocket(`${f.base.replace('http:', 'ws:')}/api/sessions/s/events?after=0`, { headers: { Origin: f.base, Cookie: cookie } });
  const closed = new Promise<number>(resolve => ws.onclose = e => resolve(e.code));
  ws.onmessage = e => events.push(JSON.parse(String(e.data)));
  const until = async (c: () => boolean) => { for (let i = 0; i < 100 && !c(); i++)
    await Bun.sleep(5); expect(c()).toBe(true); };
  await until(() => events.length === 1);
  f.log.append({ kind: "diagnostic", data: { code: "live" } });
  await until(() => events.length === 2);
  expect(events.map(e => e.event.seq)).toEqual([1, 2]);
  expect(f.host.clientCount).toBe(1);
  f.host.revoke(f.host.devices()[0]!.id);
  expect(await closed).toBe(1008);
  expect((await fetch(`${f.base}/api/sessions/s/events`, { headers: { Origin: 'https://evil.example', Cookie: cookie, Upgrade: 'websocket' } })).status).toBe(403);
});
test("websocket overflow signals resync without keeping an unbounded subscriber", async () => {
  const f = fixture({ maxQueuedBytes: 1 });
  const { cookie } = await pair(f);
  f.log.append({ kind: "diagnostic", data: { code: "large" } });
  const frames: any[] = [];
  const ws = new NativeWebSocket(`${f.base.replace('http:', 'ws:')}/api/sessions/s/events`, { headers: { Origin: f.base, Cookie: cookie } });
  ws.onmessage = e => frames.push(JSON.parse(String(e.data)));
  await new Promise<void>(resolve => ws.onclose = () => resolve());
  expect(frames).toEqual([{ type: 'resync' }]);
  expect(f.host.clientCount).toBe(0);
});
test("trusted HTTPS proxy still requires pairing and Secure cookie, Funnel additionally needs opt-in", async () => {
  const f = fixture({ config: { port: 0, trustedProxy: '127.0.0.1', allowedOrigins: ['https://deck.example'], allowFunnel: false } });
  const p = f.host.pair();
  const headers = { Host: 'deck.example', Origin: 'https://deck.example', 'Content-Type': 'application/json', 'X-Forwarded-Proto': 'https' };
  const r = await fetch(`${f.base}/pair`, { method: 'POST', headers, body: JSON.stringify({ token: new URL(p.url).hash.slice(6) }) });
  expect(r.status).toBe(200);
  expect(r.headers.get('set-cookie')).toContain('; Secure');
  expect((await fetch(`${f.base}/api/sessions`, { headers })).status).toBe(401);
  expect((await fetch(`${f.base}/api/sessions`, { headers: { ...headers, 'Tailscale-Funnel-Request': 'true' } })).status).toBe(403);
});
test("disable persists and shutdown frees the port after websocket use", async () => {
  const f = fixture();
  const { cookie } = await pair(f);
  const ws = new NativeWebSocket(`${f.base.replace('http:', 'ws:')}/api/sessions/s/events`, { headers: { Origin: f.base, Cookie: cookie } });
  await new Promise<void>(resolve => ws.onopen = () => resolve());
  const port = f.host.status().port;
  await f.host.disable();
  expect(f.host.status().enabled).toBe(false);
  const replacement = Bun.serve({ hostname: '127.0.0.1', port, fetch: () => new Response('replacement') });
  replacement.stop(true);
  const restarted = new WebService({ paths: f.paths, service: { execute: async () => ({ ok: true }), openLog: () => undefined, hasRunningWork: () => false }, config: { port, trustedProxy: null, allowedOrigins: [], allowFunnel: false } });
  hosts.push(restarted);
  restarted.start();
  expect(restarted.status().enabled).toBe(false);
  restarted.enable();
  expect(restarted.status().enabled).toBe(true);
});

test('direct loopback browser access bootstraps a private credential without pairing',async()=>{
 const f=fixture();const bootstrap=()=>fetch(`${f.base}/api/local-access`,{method:'POST',headers:{Origin:f.base,'Content-Type':'application/json'},body:JSON.stringify({name:'Local browser'})});
 const r=await bootstrap();expect(r.status).toBe(200);const cookie=r.headers.get('set-cookie')!.split(';')[0]!;expect(r.headers.get('set-cookie')).toContain('HttpOnly; SameSite=Strict');expect((await fetch(`${f.base}/api/sessions`,{headers:{Cookie:cookie}})).status).toBe(200);expect(f.host.devices()).toHaveLength(1);
 const reused=await fetch(`${f.base}/api/local-access`,{method:'POST',headers:{Origin:f.base,'Content-Type':'application/json',Cookie:cookie},body:'{}'});expect(reused.status).toBe(200);expect(reused.headers.get('set-cookie')).toBeNull();expect(f.host.devices()).toHaveLength(1);
 f.host.revoke(f.host.devices()[0]!.id);const revoked=await fetch(`${f.base}/api/local-access`,{method:'POST',headers:{Origin:f.base,'Content-Type':'application/json',Cookie:cookie},body:'{}'});expect(revoked.status).toBe(403);expect((await revoked.json()).code).toBe('device-revoked');expect(f.host.devices()).toHaveLength(1);
});
test('local cookie bootstrap refuses missing/foreign origins, forms and all proxy paths',async()=>{
 const f=fixture({config:{port:0,trustedProxy:'127.0.0.1',allowedOrigins:['https://deck.example'],allowFunnel:true}});
 for(const headers of [ {'Content-Type':'application/json'}, {Origin:'null','Content-Type':'application/json'}, {Origin:'https://evil.example','Content-Type':'application/json'}, {Origin:f.base,'Content-Type':'text/plain'}, {Origin:'https://deck.example',Host:'deck.example','Content-Type':'application/json'}, {Origin:'https://deck.example',Host:'deck.example','Content-Type':'application/json','X-Forwarded-Proto':'https'}, {Origin:f.base,'Content-Type':'application/json','Tailscale-Funnel-Request':'true'}, {Origin:f.base,'Content-Type':'application/json',Forwarded:'for=127.0.0.1'}, {Origin:f.base,'Content-Type':'application/json','X-Forwarded-Host':'localhost'} ] as Record<string,string>[]){
  const r=await fetch(`${f.base}/api/local-access`,{method:'POST',headers,body:'{}'});expect(r.ok).toBe(false);expect(r.headers.get('set-cookie')).toBeNull();
 }
 expect(f.host.devices()).toHaveLength(0);
});

test('local access checks actual peer independently from matching Host and Origin', async () => {
 const f=fixture();
 const request=new Request(`${f.base}/api/local-access`,{method:'POST',headers:{Host:new URL(f.base).host,Origin:f.base,'Content-Type':'application/json'},body:'{}'});
 const response=await (f.host as any).fetch(request,{port:new URL(f.base).port,requestIP:()=>({address:'192.0.2.10'})});
 expect(response.status).toBe(403);expect(f.host.devices()).toHaveLength(0);
});
test('localhost access requires an exact matching loopback Host and origin', async () => {
 const f=fixture();const local=`http://localhost:${new URL(f.base).port}`;
 const r=await fetch(`${f.base}/api/local-access`,{method:'POST',headers:{Host:new URL(local).host,Origin:local,'Content-Type':'application/json'},body:'{}'});
 expect(r.status).toBe(200);
 const mismatch=await fetch(`${f.base}/api/local-access`,{method:'POST',headers:{Host:new URL(f.base).host,Origin:local,'Content-Type':'application/json'},body:'{}'});
 expect(mismatch.status).toBe(403);
});


test("image upload/read require device and same-origin auth, preserve binary bytes, and bound JSON separately", async () => {
 const calls:unknown[]=[]; const bytes=Buffer.alloc(2*1024*1024,17); const attachmentId="11111111-1111-4111-8111-111111111111";
 const attachment={attachmentId,mimeType:"image/png" as const,name:"paste.png",sizeBytes:bytes.length,width:1,height:1};
 const f=fixture({service:{execute:async()=>{calls.push("command");return{ok:true};},openLog:()=>undefined,hasRunningWork:()=>false,uploadAttachment:(input:unknown)=>{calls.push(input);return{ok:true,data:{attachment}};},readAttachment:()=>({attachment,bytes})}});
 const url=`${f.base}/api/sessions/s/attachments?name=paste.png`;
 expect((await fetch(url,{method:"POST",headers:{Origin:f.base,"Content-Type":"image/png"},body:bytes.subarray(0,70)})).status).toBe(401);
 const {cookie}=await pair(f); const headers={Origin:f.base,Cookie:cookie,"Content-Type":"image/png"};
 expect((await fetch(url,{method:"POST",headers:{...headers,Origin:"http://evil.example"},body:bytes.subarray(0,70)})).status).toBe(403);
 const uploaded=await fetch(url,{method:"POST",headers,body:bytes}); expect(uploaded.status).toBe(200); expect(await uploaded.json()).toEqual({ok:true,data:{attachment}});
 expect((calls[0] as any).bytes).toEqual(bytes);
 expect((await fetch(`${f.base}/api/sessions/s/attachments/${attachmentId}`)).status).toBe(401);
 const read=await fetch(`${f.base}/api/sessions/s/attachments/${attachmentId}`,{headers:{Cookie:cookie}}); expect(Buffer.from(await read.arrayBuffer())).toEqual(bytes);
 expect(read.headers.get("Content-Type")).toBe("image/png"); expect(read.headers.get("X-Content-Type-Options")).toBe("nosniff"); expect(read.headers.get("Content-Security-Policy")).toContain("blob:");
 expect((await fetch(url,{method:"POST",headers:{...headers,"Content-Type":"image/svg+xml"},body:"<svg/>"})).status).toBe(400);
 expect((await fetch(url,{method:"POST",headers:{...headers,Connection:"close"},body:Buffer.alloc(5*1024*1024+1)})).status).toBe(413);
 const command=await fetch(`${f.base}/api/commands`,{method:"POST",headers:{...headers,"Content-Type":"application/json",Connection:"close"},body:JSON.stringify({padding:"x".repeat(1024*1024+1)})}); expect(command.status).toBe(400);
 expect(calls).toHaveLength(1);
});


test("image uploads bound in-flight body memory and release reservations after abort", async () => {
  const f=fixture(); const {cookie}=await pair(f); const headers={Origin:f.base,Cookie:cookie,"Content-Type":"image/png"};
  const controllers:AbortController[]=[]; const streams:ReadableStreamDefaultController<Uint8Array>[]=[];
  const requests=Array.from({length:8},()=>{const abort=new AbortController();controllers.push(abort);const body=new ReadableStream<Uint8Array>({start(controller){streams.push(controller);controller.enqueue(new Uint8Array([1]));}});return fetch(`${f.base}/api/sessions/s/attachments`,{method:"POST",headers,body,signal:abort.signal}).catch(()=>undefined);});
  await waitFor(()=>(f.host as any).uploadsInFlight===8,2000,"upload body reservations");
  expect((await fetch(`${f.base}/api/sessions/s/attachments`,{method:"POST",headers,body:new Uint8Array([1])})).status).toBe(429);
  controllers[0]!.abort(); await waitFor(()=>(f.host as any).uploadsInFlight===7,2000,"aborted upload release");
  const retry=await fetch(`${f.base}/api/sessions/s/attachments`,{method:"POST",headers,body:new Uint8Array([1])}); expect(retry.status).toBe(400);
  controllers.forEach(controller=>controller.abort()); streams.forEach(controller=>{try{controller.close();}catch{}}); await Promise.all(requests);
  await waitFor(()=>(f.host as any).uploadsInFlight===0,2000,"all upload reservations released");
});

test('recent history is bounded, cursor-stable, private, and separate from current controls', async () => {
  const f=fixture();
  f.log.append({kind:'approval.requested',data:{approvalId:'old'}});
  f.log.append({kind:'question.requested',data:{questionId:'secret',questions:[{id:'password',secret:true}]}});
  f.log.append({kind:'question.resolved',data:{questionId:'secret',outcome:'answered',by:'test',answers:{password:['never expose']}}});
  for(let i=0;i<180;i++)f.log.append({kind:'message.completed',source:{taskId:'lead'},data:{role:'assistant',text:`Message ${i}`}});
  f.log.append({kind:'approval.resolved',data:{approvalId:'old'}});
  f.log.append({kind:'approval.requested',data:{approvalId:'current'}});
  const path=`${f.base}/api/sessions/s/history`;
  expect((await fetch(path)).status).toBe(401);
  const {cookie}=await pair(f), headers={Cookie:cookie};
  const recent=await (await fetch(path,{headers})).json();
  expect(recent.messages).toHaveLength(40);
  expect(recent.messages.at(-1).data.text).toBe('Message 179');
  expect(recent.events.filter((e:any)=>e.kind==='approval.requested').map((e:any)=>e.data.approvalId)).toEqual(['current']);
  expect(recent.events.some((e:any)=>e.kind==='question.requested')).toBe(false);
  const fence=recent.seq;
  f.log.append({kind:'message.completed',data:{text:'Concurrent reply'}});
  const rows=[...recent.messages];let before=recent.before;
  while(before){const older=await(await fetch(`${path}?before=${before}`,{headers})).json();expect(older.messages.length).toBeLessThanOrEqual(40);rows.unshift(...older.messages);before=older.before;}
  expect(rows.filter((e:any)=>e.kind==='message.completed')).toHaveLength(180);
  expect(new Set(rows.map((e:any)=>e.historyId)).size).toBe(rows.length);
  expect(JSON.stringify(rows)).not.toContain('never expose');
  expect((await(await fetch(`${f.base}/api/sessions/s/events?after=${fence}`,{headers})).json()).events.at(-1).data.text).toBe('Concurrent reply');
  for(const query of ['before=-1','before=1&before=2','limit=999999','after=0','before=NaN'])expect((await fetch(`${path}?${query}`,{headers})).status).toBe(400);
});

test('chat websocket replay bridges the snapshot fence with stable delta identities',async()=>{
 const f=fixture();const {cookie}=await pair(f);const headers={Cookie:cookie};
 f.log.append({kind:'message.delta',data:{text:'Before '}});
 const page=await(await fetch(`${f.base}/api/sessions/s/history`,{headers})).json();
 f.log.append({kind:'message.delta',data:{text:'during'}});
 const socket=new NativeWebSocket(`${f.base.replace('http','ws')}/api/sessions/s/events?after=${page.seq}&view=chat`,{headers:{Cookie:cookie,Origin:f.base}});
 const frames:any[]=[];socket.onmessage=e=>frames.push(JSON.parse(String(e.data)));
 await waitFor(()=>frames.length===1);
 expect(frames[0].event.seq).toBe(page.seq+1);expect(frames[0].message.historyId).toBe(page.messages[0].historyId);expect(frames[0].message.data.text).toBe('during');
 f.log.append({kind:'message.completed',data:{text:'Completed stream'}});await waitFor(()=>frames.length===2);
 expect(frames[1].message.historyId).toBe(page.messages[0].historyId);expect(frames[1].message.data.text).toBe('Completed stream');socket.close();
});

const serveOrigin = 'https://deck.tail123.ts.net';
const serveHeaders = { Host: 'deck.tail123.ts.net', Origin: serveOrigin, 'Content-Type': 'application/json', 'Tailscale-User-Login': 'alice@example.com' };
const serveConfig = { port: 0, trustedProxy: '127.0.0.1', allowedOrigins: [serveOrigin], allowFunnel: true, tailscaleServeAccess: true };
test('opt-in Serve bootstrap issues a Secure revocable cookie bound to proxy identity', async () => {
 const f = fixture({config: serveConfig});
 const r = await fetch(`${f.base}/api/local-access`, {method:'POST',headers:serveHeaders,body:'{}'});
 expect(r.status).toBe(200);
 const cookie = r.headers.get('set-cookie')!.split(';')[0]!;
 expect(r.headers.get('set-cookie')).toContain('HttpOnly; SameSite=Strict; Secure');
 const headers = {...serveHeaders, Cookie:cookie};
 expect((await fetch(`${f.base}/api/sessions`,{headers})).status).toBe(200);
 const reused = await fetch(`${f.base}/api/local-access`,{method:'POST',headers,body:'{}'});
 expect(reused.status).toBe(200);expect(reused.headers.get('set-cookie')).toBeNull();
 for (const changed of [{'Tailscale-User-Login':''}, {'Tailscale-User-Login':'bob@example.com'}, {'Tailscale-Funnel-Request':'true'}] as Record<string,string>[])
  expect((await fetch(`${f.base}/api/sessions`,{headers:{...headers,...changed}})).ok).toBe(false);
 expect((await fetch(`${f.base}/api/sessions`,{headers:{Cookie:cookie}})).status).toBe(401);
 const ws = new NativeWebSocket(`${f.base.replace('http:','ws:')}/api/sessions/s/events`,{headers});
 await new Promise<void>((resolve,reject)=>{ws.onopen=()=>resolve();ws.onerror=()=>reject(new Error('Serve websocket failed'));});
 f.host.revoke(f.host.devices()[0]!.id);
 await waitFor(()=>ws.readyState===WebSocket.CLOSED);
 expect((await fetch(`${f.base}/api/sessions`,{headers})).status).toBe(401);
 const revoked = await fetch(`${f.base}/api/local-access`,{method:'POST',headers,body:'{}'});
 expect(revoked.status).toBe(403);expect((await revoked.json()).code).toBe('device-revoked');
 expect(f.host.devices()).toHaveLength(1);
});
test('Serve enrollment fails closed without mode, identity, peer, HTTPS allowed origin, or with Funnel', async () => {
 for (const config of [serveConfig,{...serveConfig,tailscaleServeAccess:undefined},{...serveConfig,tailscaleServeAccess:false},{...serveConfig,trustedProxy:null},{...serveConfig,trustedProxy:'192.0.2.1'}]) {
  const f=fixture({config});
  const noOrigin: Record<string,string> = {...serveHeaders}; delete noOrigin.Origin;
  const variants: Record<string,string>[] = config===serveConfig ? [
   noOrigin,
   {...serveHeaders,'Tailscale-User-Login':''}, {...serveHeaders,'Tailscale-User-Login':'alice,bob'},
   {...serveHeaders,Origin:''}, {...serveHeaders,Origin:'https://evil.ts.net'},
   {...serveHeaders,Origin:'http://deck.tail123.ts.net'}, {...serveHeaders,'Tailscale-Funnel-Request':'false'},
  ] : [serveHeaders];
  for(const headers of variants){const r=await fetch(`${f.base}/api/local-access`,{method:'POST',headers,body:'{}'});expect(r.status).toBe(403);expect(r.headers.get('set-cookie')).toBeNull();}
  const request=new Request(`${f.base}/api/local-access`,{method:'POST',headers:serveHeaders,body:'{}'});
  for(const address of [undefined,'192.0.2.5']) {
   const r=await (f.host as any).fetch(request.clone(),{port:new URL(f.base).port,requestIP:()=>address?{address}:null});expect(r.status).toBe(403);
  }
  expect(f.host.devices()).toHaveLength(0);
 }
});
test('Serve credentials retain identity binding after reload and stop authenticating when mode is off', async () => {
 const f=fixture({config:{...serveConfig}});
 const response=await fetch(`${f.base}/api/local-access`,{method:'POST',headers:serveHeaders,body:'{}'});
 const Cookie=response.headers.get('set-cookie')!.split(';')[0]!;
 await f.host.close();
 const service:SessionService={execute:async()=>({ok:true}),openLog:()=>undefined,hasRunningWork:()=>false,query:()=>({ok:true})};
 for(const tailscaleServeAccess of [true,false]){
  const restarted=new WebService({paths:f.paths,service,config:{...serveConfig,tailscaleServeAccess}});hosts.push(restarted);restarted.enable();
  expect((await fetch(`${restarted.status().url}/api/sessions`,{headers:{...serveHeaders,Cookie}})).status).toBe(tailscaleServeAccess?200:401);
  if(tailscaleServeAccess){
   const ws=new NativeWebSocket(`${restarted.status().url!.replace('http:','ws:')}/api/sessions/s/events`,{headers:{...serveHeaders,Cookie,'Tailscale-User-Login':''}});
   await new Promise<void>((resolve,reject)=>{ws.onopen=()=>reject(new Error('Unverified Serve websocket opened'));ws.onerror=()=>resolve();});
   expect(restarted.clientCount).toBe(0);
  }
  await restarted.close();
 }
});

const pushSubscription = (suffix:string) => {
 const key=createECDH('prime256v1');key.generateKeys();return {endpoint:`https://fcm.googleapis.com/fcm/send/${suffix}`,keys:{p256dh:key.getPublicKey().toString('base64url'),auth:randomBytes(16).toString('base64url')}};
};
const pushService:SessionService={execute:async()=>({ok:true}),openLog:()=>undefined,hasRunningWork:()=>false,subscribeEvents:()=>()=>{},isPushAttentionCurrent:()=>true};
test('push opt-in persists current revocable cookie for 180 days and enforces its expiry after reload',async()=>{
 let now=Date.now();const f=fixture({now:()=>now,service:pushService});const {cookie,response:paired}=await pair(f);expect(paired.headers.get('set-cookie')).not.toContain('Max-Age');
 const enabled=await fetch(`${f.base}/api/push`,{method:'POST',headers:{Cookie:cookie,Origin:f.base,'Content-Type':'application/json'},body:JSON.stringify({subscription:pushSubscription('durable')})});expect(enabled.status).toBe(200);const renewed=enabled.headers.get('set-cookie')!;expect(renewed).toContain('Max-Age=15552000');expect(renewed).toContain('HttpOnly; SameSite=Strict');expect(renewed.split(';')[0]).toBe(cookie);
 expect(f.host.devices()[0]?.expiresAt).toBe(new Date(now+180*86400_000).toISOString());
 await f.host.close();const host=new WebService({paths:f.paths,service:pushService,now:()=>now,config:{port:0,trustedProxy:null,allowedOrigins:[],allowFunnel:false}});hosts.push(host);host.enable();const base=host.status().url!;
 expect((await fetch(`${base}/api/push`,{headers:{Cookie:cookie}})).status).toBe(200);now+=180*86400_000+1;expect((await fetch(`${base}/api/push`,{headers:{Cookie:cookie}})).status).toBe(401);
});
test('re-enrollment cannot steal surviving subscription; fresh subscription succeeds without weakening Origin checks',async()=>{
 const f=fixture({service:pushService});const first=await pair(f);const original=pushSubscription('former-device');const send=(cookie:string,subscription:unknown,origin=f.base)=>fetch(`${f.base}/api/push`,{method:'POST',headers:{Cookie:cookie,Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({subscription})});expect((await send(first.cookie,original)).status).toBe(200);
 const fresh=await fetch(`${f.base}/api/local-access`,{method:'POST',headers:{Origin:f.base,'Content-Type':'application/json'},body:'{}'});const cookie=fresh.headers.get('set-cookie')!.split(';')[0]!;expect(cookie).not.toBe(first.cookie);
 expect((await send(cookie,original)).status).toBe(400);expect((await send(cookie,pushSubscription('fresh-device'),'https://evil.test')).status).toBe(403);expect((await send(cookie,pushSubscription('fresh-device'))).status).toBe(200);
 const stored=JSON.parse(readFileSync(join(f.paths.webDir,'push.json'),'utf8')).subscriptions;expect(stored).toHaveLength(2);expect(stored.find((r:any)=>r.subscription.endpoint===original.endpoint).deviceId).toBe(f.host.devices()[0]!.id);
});

test('durable push opt-in retains HTTPS flags, Serve identity binding and immediate revocation',async()=>{
 const origin='https://deck.test.ts.net';const f=fixture({service:pushService,config:{port:0,trustedProxy:'127.0.0.1',allowedOrigins:[origin],allowFunnel:false,tailscaleServeAccess:true}});
 const headers={Host:'deck.test.ts.net',Origin:origin,'X-Forwarded-Proto':'https','Tailscale-User-Login':'alice@example.test','Content-Type':'application/json'};
 const paired=await fetch(`${f.base}/api/local-access`,{method:'POST',headers,body:'{}'});expect(paired.status).toBe(200);const cookie=paired.headers.get('set-cookie')!.split(';')[0]!;
 const enabled=await fetch(`${f.base}/api/push`,{method:'POST',headers:{...headers,Cookie:cookie},body:JSON.stringify({subscription:pushSubscription('secure')})});expect(enabled.status).toBe(200);expect(enabled.headers.get('set-cookie')).toContain('HttpOnly; SameSite=Strict; Secure; Max-Age=15552000');
 expect((await fetch(`${f.base}/api/push`,{headers:{...headers,Cookie:cookie,'Tailscale-User-Login':'bob@example.test'}})).status).toBe(401);f.host.revoke(f.host.devices()[0]!.id);expect((await fetch(`${f.base}/api/push`,{headers:{...headers,Cookie:cookie}})).status).toBe(401);
});

test('reply API authenticates exact device display, paged origins, and never executes a command',async()=>{
  const f=fixture();const a=await pair(f),b=await pair(f);
  const headers={Cookie:a.cookie,Origin:f.base,'Content-Type':'application/json'};
  expect((await fetch(`${f.base}/api/replies`)).status).toBe(401);
  await fetch(`${f.base}/api/sessions/s/replies`,{headers}); // enroll before reply
  await fetch(`${f.base}/api/sessions/s/replies`,{headers:{Cookie:b.cookie}});
  f.log.append({kind:'message.completed',source:{memberId:'lead',taskId:'lead'},data:{role:'user',text:'Earlier prompt'}});
  f.log.append({kind:'turn.started',source:{memberId:'lead',taskId:'lead'}});
  f.log.append({kind:'message.delta',source:{memberId:'lead',taskId:'lead'},data:{text:'Research ',role:'assistant'}});
  const message=f.log.append({kind:'message.completed',source:{memberId:'lead',taskId:'lead'},data:{text:'Research answer while other work runs.',role:'assistant'}});
  f.log.append({kind:'turn.completed',source:{memberId:'lead',taskId:'lead'},data:{status:'completed'}});
  for(let i=0;i<80;i++)f.log.append({kind:'message.completed',source:{memberId:'lead',taskId:'lead'},data:{text:`Later ${i}`,role:'user'}});
  const data=await(await fetch(`${f.base}/api/sessions/s/replies`,{headers})).json();expect(data.total).toBe(1);const reply=data.replies[0];
  const route=`${f.base}/api/sessions/s/replies/${reply.replyId}`;
  expect((await fetch(route,{method:'POST',headers:{...headers,Origin:'http://evil.test'},body:'{"displayed":true}'})).status).toBe(403);
  const page=await(await fetch(`${f.base}/api/sessions/s/history?around=${message.seq}`,{headers})).json();
  const exact=page.messages.find((row:any)=>row.seq===message.seq);expect(exact.historyId).toBe(message.seq-1);expect(page.after).toBeDefined();
  const tail=await(await fetch(`${f.base}/api/sessions/s/history?around=${f.log.lastSeq}`,{headers})).json();expect(tail.messages.length).toBe(40);expect(tail.messages.at(-1).seq).toBe(f.log.lastSeq);expect(tail.messages[0].seq).toBeLessThan(f.log.lastSeq-20);
  expect((await(await fetch(`${f.base}/api/sessions/s/replies`,{headers})).json()).total).toBe(1);
  const mapping=await(await fetch(`${f.base}/api/sessions/s/replies?messageSeq=${message.seq}`,{headers})).json();expect(mapping.replies[0].replyId).toBe(reply.replyId);
  expect((await fetch(route,{method:'POST',headers,body:'not-json'})).status).toBe(400);
  expect((await fetch(`${f.base}/api/sessions/s/replies/reply-999-998`,{method:'POST',headers,body:'{"displayed":true}'})).status).toBe(404);
  expect((await fetch(route,{method:'POST',headers,body:'{"displayed":true}'})).status).toBe(200);
  expect((await(await fetch(`${f.base}/api/sessions/s/replies`,{headers})).json()).total).toBe(0);
  expect((await(await fetch(`${f.base}/api/sessions/s/replies`,{headers:{Cookie:b.cookie}})).json()).total).toBe(1);
  expect(f.executed).toHaveLength(0);
  for(const suffix of ['?cursor=-1','?cursor=1&cursor=2','?messageSeq=NaN'])expect((await fetch(`${f.base}/api/sessions/s/replies${suffix}`,{headers})).status).toBe(400);
});

test('removal while an exact display body is pending returns unavailable identity without manufacturing a receipt',async()=>{
 const f=fixture(),{cookie}=await pair(f),headers={Cookie:cookie,Origin:f.base,'Content-Type':'application/json',Host:new URL(f.base).host};
 f.log.append({kind:'turn.started'});f.log.append({kind:'message.completed',data:{role:'assistant',text:'Visible reply before removal.'}});f.log.append({kind:'turn.completed',data:{status:'completed'}});
 const reply=(await(await fetch(`${f.base}/api/sessions/s/replies`,{headers})).json()).replies[0];
 const request=new Request(`${f.base}/api/sessions/s/replies/${reply.replyId}`,{method:'POST',headers,body:'{"displayed":true}'});
 let entered=false,release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve),text=request.text.bind(request);request.text=async()=>{entered=true;await gate;return text();};
 const response=(f.host as any).fetch(request,{port:Number(new URL(f.base).port),requestIP:()=>({address:'127.0.0.1'})}) as Promise<Response>;
 try{await waitFor(()=>entered);f.log.append({kind:'session.removed',data:{phase:'removed'}});expect((await(await fetch(`${f.base}/api/sessions/s/replies`,{headers})).json()).total).toBe(0);}finally{release();}
 expect((await response).status).toBe(404);expect(f.executed).toHaveLength(0);
});

test('receipt fails closed on source backlog with at most 4096 replayed events per request; current valid receipts stay idempotent',async()=>{
 const f=fixture(),{cookie}=await pair(f),headers={Cookie:cookie,Origin:f.base,'Content-Type':'application/json'};
 f.log.append({kind:'turn.started'});f.log.append({kind:'message.completed',data:{role:'assistant',text:'A valid retained reply.'}});f.log.append({kind:'turn.completed',data:{status:'completed'}});
 const reply=(await(await fetch(`${f.base}/api/sessions/s/replies`,{headers})).json()).replies[0],db=new Database(join(f.paths.webDir,'lead-replies.sqlite'));
 try{
  let checkpoint=(db.query('SELECT seq FROM sessions WHERE sessionId=?').get('s') as any).seq;
  for(let n=0;n<8193;n++)f.log.append({kind:'diagnostic',data:{code:'receipt-backlog-fixture'}});
  const post=()=>fetch(`${f.base}/api/sessions/s/replies/${reply.replyId}`,{method:'POST',headers,body:'{"displayed":true}'});
  for(let n=0;n<2;n++){
   const response=await post();expect(response.status).toBe(503);expect((await response.json()).code).toBe('reply-history-syncing');
   const next=(db.query('SELECT seq FROM sessions WHERE sessionId=?').get('s') as any).seq;expect(next-checkpoint).toBe(4096);checkpoint=next;expect((db.query('SELECT COUNT(*) AS n FROM displayed').get() as any).n).toBe(0);
  }
  expect((await post()).status).toBe(200);expect((await post()).status).toBe(200);expect((db.query('SELECT COUNT(*) AS n FROM displayed').get() as any).n).toBe(1);
  expect((await(await fetch(`${f.base}/api/sessions/s/replies`,{headers})).json()).total).toBe(0);expect(f.executed).toHaveLength(0);
 }finally{db.close();}
});

test('held receipt still rechecks device authorization before post-body replay or display',async()=>{
 const f=fixture(),{cookie}=await pair(f),headers={Cookie:cookie,Origin:f.base,'Content-Type':'application/json',Host:new URL(f.base).host};
 f.log.append({kind:'turn.started'});f.log.append({kind:'message.completed',data:{role:'assistant',text:'Visible before authorization changed.'}});f.log.append({kind:'turn.completed',data:{status:'completed'}});
 const reply=(await(await fetch(`${f.base}/api/sessions/s/replies`,{headers})).json()).replies[0];
 const request=new Request(`${f.base}/api/sessions/s/replies/${reply.replyId}`,{method:'POST',headers,body:'{"displayed":true}'});
 let entered=false,release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve),text=request.text.bind(request);request.text=async()=>{entered=true;await gate;return text();};
 const response=(f.host as any).fetch(request,{port:Number(new URL(f.base).port),requestIP:()=>({address:'127.0.0.1'})}) as Promise<Response>;
 try{await waitFor(()=>entered);f.host.revoke(f.host.devices()[0]!.id);}finally{release();}
 expect((await response).status).toBe(401);const db=new Database(join(f.paths.webDir,'lead-replies.sqlite'));try{expect((db.query('SELECT COUNT(*) AS n FROM displayed').get() as any).n).toBe(0);}finally{db.close();}
});

test('quota routes require device and same-origin access, enforce cooldown and filter event replay privacy',async()=>{
 const {QuotaStore}=await import('../quota');let effects=0;
 const quota=new QuotaStore({refresh:async()=>{effects++;return {primary:{usedPercent:8,windowDurationMins:300},credits:{balance:'PRIVATE'},accountId:'PRIVATE'};}});
 const f=fixture({quota});
 expect((await fetch(`${f.base}/api/quota`)).status).toBe(401);
 const {cookie}=await pair(f),headers={Cookie:cookie,Origin:f.base,'Content-Type':'application/json'};
 expect((await fetch(`${f.base}/api/quota/codex/refresh`,{method:'POST',headers:{...headers,Origin:'https://evil.test'},body:'{}'})).status).toBe(403);expect(effects).toBe(0);
 const response=await fetch(`${f.base}/api/quota/codex/refresh`,{method:'POST',headers,body:'{}'});expect(response.status).toBe(200);expect(JSON.stringify(await response.json())).not.toContain('PRIVATE');
 expect((await fetch(`${f.base}/api/quota/codex/refresh`,{method:'POST',headers,body:'{}'})).status).toBe(429);expect(effects).toBe(1);
 const snapshot=await (await fetch(`${f.base}/api/quota`,{headers})).json();expect(snapshot.runners.codex.snapshot.windows[0].usedPercent).toBe(8);
 f.log.append({kind:'rate-limit',source:{runnerId:'codex'},data:{credits:{balance:'PRIVATE'},accountId:'PRIVATE',primary:{windowDurationMins:300,usedPercent:8}},raw:{runnerId:'codex',protocol:'codex-app-server',truncated:false,payload:{secret:'PRIVATE'}}});
 const events=await(await fetch(`${f.base}/api/sessions/s/events`,{headers})).json();expect(JSON.stringify(events)).not.toContain('PRIVATE');
 const ws=new NativeWebSocket(`${f.base.replace('http:','ws:')}/api/sessions/s/events?after=0&view=chat`,{headers});const messages:string[]=[];ws.onmessage=e=>messages.push(String(e.data));
 try{
 await waitFor(()=>messages.some(m=>JSON.parse(m).event?.kind==='rate-limit'));
 const before=messages.length;
 f.log.append({kind:'rate-limit',source:{runnerId:'claude'},data:{unifiedWindows:{five_hour:{utilization:.4}},accountId:'PRIVATE'},raw:{runnerId:'claude',protocol:'claude-stream-json',truncated:false,payload:{accountId:'PRIVATE'}}});
 await waitFor(()=>messages.length>before);expect(messages.join('')).not.toContain('PRIVATE');expect(messages.join('')).toContain('usedPercent');
 }finally{ws.close();}
});

 test('Git HTTP endpoints require a device, reject root overrides, and forward only session selections', async () => {
  const queries:unknown[]=[];
  const f=fixture({service:{execute:async()=>({ok:true}),openLog:()=>undefined,hasRunningWork:()=>false,query:async(name:string,args:any)=>{
   queries.push({name,args});return args.sessionId==='unknown'?{ok:false,code:'session-unknown'}:{ok:true,data:{files:[]}};
  }}});
  expect((await fetch(`${f.base}/api/sessions/s/git`)).status).toBe(401);
  expect((await fetch(`${f.base}/api/sessions/s/git/diff?section=unstaged&path=a`)).status).toBe(401);
  expect((await fetch(`${f.base}/api/sessions/s/git/content?section=unstaged&path=a.md`)).status).toBe(401);
  expect(queries).toHaveLength(0);
  const {cookie}=await pair(f),headers={Cookie:cookie};
  expect((await fetch(`${f.base}/api/sessions/s/git`,{headers})).status).toBe(200);
  expect((await fetch(`${f.base}/api/sessions/s/git/diff?section=staged&path=a%20%5Bx%5D`,{headers})).status).toBe(200);
  expect(queries).toEqual([{name:'git.list',args:{sessionId:'s'}},{name:'git.read',args:{sessionId:'s',section:'staged',path:'a [x]'}}]);
  expect((await fetch(`${f.base}/api/sessions/s/git/content?section=staged&path=a.md`,{headers})).status).toBe(200);
  expect(queries.at(-1)).toEqual({name:'git.content',args:{sessionId:'s',section:'staged',path:'a.md'}});
  for(const suffix of ['/content?section=staged&path=a&projectRoot=/outside','/content?section=staged&path=a&path=b','?projectRoot=/outside','/diff?path=a','/diff?section=staged&path=a&path=b'])expect((await fetch(`${f.base}/api/sessions/s/git${suffix}`,{headers})).status).toBe(400);
  expect((await fetch(`${f.base}/api/sessions/unknown/git`,{headers})).status).toBe(404);
  expect((await fetch(`${f.base}/api/sessions/s/git`,{method:'POST',headers:{...headers,Origin:f.base}})).status).toBe(404);
 });
test('project file and image transport is authenticated and accepts only session-relative selectors',async()=>{
 const queries:unknown[]=[];const f=fixture({service:{execute:async()=>({ok:true}),openLog:()=>undefined,hasRunningWork:()=>false,query:async(name:string,args:any)=>{queries.push({name,args});return {ok:true,data:{path:'photo.png',kind:'image',mime:'image/png',base64:'AAAA',width:1,height:1,size:3}};}}});
 for(const route of ['/files?path=','/files?path=&cursor=abc','/files/content?path=photo.png'])expect((await fetch(`${f.base}/api/sessions/s${route}`)).status).toBe(401);
 expect(queries).toHaveLength(0);const {cookie}=await pair(f),headers={Cookie:cookie};
 expect((await fetch(`${f.base}/api/sessions/s/files?path=&showIgnored=true`,{headers})).status).toBe(200);
 const response=await fetch(`${f.base}/api/sessions/s/files/content?path=photo.png`,{headers});expect(response.status).toBe(200);expect((await response.json()).data.mime).toBe('image/png');
 expect(queries).toEqual([{name:'project.files',args:{sessionId:'s',path:'',showIgnored:true}},{name:'project.content',args:{sessionId:'s',path:'photo.png',showIgnored:false}}]);
 expect((await fetch(`${f.base}/api/sessions/s/files?path=&cursor=abc`,{headers})).status).toBe(200);expect(queries.at(-1)).toEqual({name:'project.files',args:{sessionId:'s',path:'',showIgnored:false,cursor:'abc'}});
 for(const suffix of ['?path=&cursor=','?path=&cursor=a&cursor=b','?path=&cursor=../outside','?path=&cursor='+ 'x'.repeat(8193),'/content?path=a&cursor=abc','?path=&root=/tmp','?path=a&path=b','?path=&showIgnored=1','/content?path=a&projectRoot=/tmp'])expect((await fetch(`${f.base}/api/sessions/s/files${suffix}`,{headers})).status).toBe(400);
});
