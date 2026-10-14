import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { EventLog } from "../event-log";
import { resolveStatePaths, ensureStateLayout } from "../paths";
import { WebService } from "../web-service";
import type { SessionService } from "../service";
import { listOpenSpecArtifacts, readOpenSpecArtifact } from "../openspec-artifacts";
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
