import { afterEach, expect, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PassThrough } from "node:stream";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { WebService } from "../../../packages/session-host/src/web-service";
import type { RunnerAdapter } from "../../../packages/core/src/index";
import { ApprovalBroker, CredentialRegistry, ensureStateLayout, resolveStatePaths, Supervisor, type DaemonServices } from "../../../packages/session-host/src/index";
import { FakeDriver } from "../../../packages/session-host/src/testing/fake-driver";
import { createDeckConfigStore } from "../../cli/src/deck-config-store";
import { createCrossSessionService } from "../../cli/src/session-service";
import { SessionCodebaseReadiness } from "../../cli/src/session-codebase-readiness";
import { SessionControls } from "./session-controls";

const closes: Array<() => Promise<void>> = [], roots: string[] = [];
afterEach(async () => { for (const close of closes.splice(0)) await close(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
async function until(check: () => boolean | Promise<boolean>) { const start = Date.now(); while (!await check()) { if (Date.now() - start > 3000) throw new Error("test progress timed out"); await new Promise(resolve => setTimeout(resolve, 5)); } }
const render = (preparation: any) => renderToStaticMarkup(<SessionControls connected ended={false} working={false} busy={false} sharedActive={0} preparation={preparation} onReconnect={()=>{}} onPrepare={()=>{}} onCancel={()=>{}} onClose={()=>{}} onAssignments={()=>{}} onPredecessor={()=>{}}/>);

async function nativeLaunch(input: import("../../../packages/core/src/session/driver").DriverTaskInput, available: boolean) {
  const files=new Map<string,string>(); const io={writePrivateFile(name:string,content:string){files.set(name,content);return join(input.cwd,name);}};
  if (input.assignment.runnerId === "claude") {
    const {buildClaudeTurnLaunch}=await import("../../../packages/adapter-claude/src/session-driver/launch");
    buildClaudeTurnLaunch(input,io,{baseEnv:{}});
    expect("codebase-memory" in JSON.parse(files.get("mcp-config.json")!).mcpServers).toBe(available);
    expect(files.get("role-prompt.md")).toBe(input.rolePrompt);
  } else if (input.assignment.runnerId === "opencode") {
    const {buildOpenCodeLaunch}=await import("../../../packages/adapter-opencode/src/session-driver/launch");
    const launch=buildOpenCodeLaunch(input,io,{baseEnv:{}});
    expect(JSON.parse(files.get("opencode.json")!).mcp["codebase-memory"]?.enabled !== false && "codebase-memory" in JSON.parse(files.get("opencode.json")!).mcp).toBe(available);
    expect(JSON.parse(files.get("opencode.json")!).instructions).toBeUndefined();
  } else {
    const {codexThreadMcpConfig}=await import("../../../packages/adapter-codex/src/session-driver/launch");
    const servers=codexThreadMcpConfig(input,["codebase-memory"]).mcp_servers as Record<string,{enabled:boolean}>;
    expect(servers["codebase-memory"]?.enabled).toBe(available);
  }
}

function fixture(runnerId: string) {
  const home = realpathSync(mkdtempSync(join(realpathSync("/tmp"), "dca-"))); roots.push(home);
  const project = join(home, "project"); mkdirSync(project);
  const binary = join(home, "codebase-memory-mcp"); writeFileSync(binary, "wrong build", { mode: 0o700 });
  const paths = resolveStatePaths({ env: { HOME: home, XDG_STATE_HOME: join(home, "state") }, tmpdir: home }); ensureStateLayout(paths);
  const store = createDeckConfigStore({ homeDir: home, xdgConfigHome: join(home, "config") });
  store.write({ crossRunner: { enabled: true, members: { lead: { runnerId: runnerId as any, modelId: "fixture/model" } } }, adaptiveMemory: { enabled: false, activeProvider: "none" } });
  const driver = new FakeDriver(runnerId); driver.autoComplete = true;
  let healthy = false, spawns = 0, backendUnavailable = false, verificationFailure: Error | undefined, verificationGate: Promise<boolean> | undefined, verificationCalls=0;
  let verificationStarted: (() => void) | undefined;
  const readiness = new SessionCodebaseReadiness({ coldTimeoutMs: 50, warmTimeoutMs: 20, cleanupTimeoutMs: 20, verifyExecutable: async () => { verificationCalls++; verificationStarted?.(); if (verificationFailure) throw verificationFailure; return verificationGate ? await verificationGate : healthy; }, supervisor: { spawn() {
    spawns++; const stdin = new PassThrough(), stdout = new PassThrough(), stderr = new PassThrough();
    let exit!: (value: any) => void; const exited = new Promise<any>(resolve => { exit = resolve; });
    stdin.on("finish", () => exit({ code: 0, drained: true }));
    stdin.on("data", raw => { if (backendUnavailable) return; const message = JSON.parse(raw.toString()); if (!message.id) return;
      stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: message.method === "initialize" ? { protocolVersion: "2024-11-05", serverInfo: { name: "codebase-memory-mcp", version: "0.11.0" } } : { tools: ["search_graph", "trace_path", "get_code_snippet"].map(name=>({name})) } }) + "\n"); });
    return { stdin, stdout, stderr, ready: Promise.resolve({workerPid:1}), exited, anchorPid: 1, interrupt: ()=>true, terminateGroup: async()=>{stdin.end();} };
  } } });
  const adapter = { runnerId, getSessionDriver: () => driver, readSessionMcpServers: async () => ({ "codebase-memory": { command: binary, args: [], env: {} }, context7: { command: "unused-context7", args: [], env: {} } }) } as unknown as RunnerAdapter;
  const services = { paths, broker: new ApprovalBroker({ sink: { emit() {} } }), credentials: new CredentialRegistry({socketPath: paths.socket.path}), supervisor: new Supervisor({anchorCommand:["unused"]}), logger: {info(){},warn(){},error(){}} } as unknown as DaemonServices;
  const service = createCrossSessionService(services, { configStore: store, adapters: ()=>[adapter], codebaseReadiness: readiness, environment: {} });
  const web = new WebService({paths, service, config:{port:0,trustedProxy:null,allowedOrigins:[],allowFunnel:false}}); web.start();
  closes.push(async()=>{await web.close();await service.close();});
  const base = web.status().url!;
  const authentication = fetch(base + "/api/local-access", {method:"POST",headers:{Origin:base,"Content-Type":"application/json"},body:"{}"}).then(response=>response.headers.get("set-cookie")!.split(";")[0]!);
  const read = async (id: string) => {
    const response = await fetch(base + `/api/sessions/${id}/readiness`, {headers:{Origin:base,Cookie:await authentication}});
    expect(response.status).toBe(200); return (await response.json()).data;
  };
  const run = (command: any, sessionId?: string) => service.execute({ clientId:"test", sessionId, command:{v:1, commandId:crypto.randomUUID(), ...command} });
  return { service, driver, project, run, read, spawns:()=>spawns, verificationCalls:()=>verificationCalls, pause() {
    let release!: (ok:boolean)=>void;
    const started = new Promise<void>(resolve=>{verificationStarted=resolve;});
    verificationGate=new Promise<boolean>(resolve=>{release=resolve;});
    return { started, release:()=>release(true) };
  }, fail(error: Error) { verificationFailure=error; }, unavailable() { healthy=true; backendUnavailable=true; }, recover() { healthy=true; backendUnavailable=false; writeFileSync(binary,"repaired build identity"); } };
}

for (const runner of ["claude", "codex", "opencode"]) for (const reason of ["unsupported", "unavailable"] as const) {
  test(`${runner}: ${reason} production resolver -> preparation -> Web API/view -> turn omits Codebase and recovers`, async () => {
    const t = fixture(runner), created = await t.run({type:"session.create",projectRoot:t.project}); expect(created.ok).toBe(true);
    const id = (created as any).data.sessionId;
    if (reason === "unavailable") t.unavailable();
    await t.run({type:"session.prepare"}, id);
    const read = () => t.read(id);
    await until(async()=>["ready","failed"].includes((await read()).status));
    const state = await read(); expect(state.status).toBe("ready"); expect(state.reasonCode).toBe(`codebase-memory-${reason}`);
    expect(render(state)).toContain("Codebase Memory is unavailable"); expect(render(state)).toContain("Ready to send"); expect(t.driver.turns).toHaveLength(0); expect(t.spawns()).toBe(reason === "unsupported" ? 0 : 1);
    await t.run({type:"prompt.send",text:"Inspect repository"},id); await until(()=>t.driver.turns.length===1 && t.driver.turns[0]!.closed);
    const first = t.driver.turns[0]!.input; expect(first.mcp.servers).not.toContain("codebase-memory"); expect(first.mcp.servers).not.toContain("context7"); expect(first.mcpServerSpecs["codebase-memory"]).toBeUndefined();
    expect(first.rolePrompt).toContain("Use file listing, rg searches, and focused file reads"); expect(first.rolePrompt).not.toContain("search_graph"); await nativeLaunch(first,false);
    const events = t.service.openLog(id)!.readAfter(0); expect(JSON.stringify([...events])).not.toContain("wrong build");
    t.recover();
    await t.run({type:"session.prepare"},id); await until(async()=> (await read()).status==="ready" && !(await read()).reasonCode);
    expect(render(await read())).not.toContain("Codebase Memory is unavailable");
    await t.run({type:"prompt.send",text:"Inspect with recovered graph"},id); await until(()=>t.driver.turns.length===2 && t.driver.turns[1]!.closed);
    const second = t.driver.turns[1]!.input; expect(second.mcp.servers).toContain("codebase-memory"); expect(second.rolePrompt).not.toContain("Use file listing, rg searches, and focused file reads"); await nativeLaunch(second,true);
    expect(t.spawns()).toBe(reason === "unsupported" ? 1 : 2);
  });
}

test.each(["codebase-memory-unavailable: forged optional failure", "codebase-memory-integrity-failed: private detail", "authorization-denied: private detail", "control-channel-failed: private detail", "permission-denied: private detail"])("protected failure stays failed, never optional: %s", async message => {
  const t = fixture("claude"); t.fail(Object.assign(new Error(message), {code:"EACCES"}));
  const created = await t.run({type:"session.create",projectRoot:t.project}), id = (created as any).data.sessionId;
  await t.run({type:"session.prepare"},id);
  await until(async()=> (await t.read(id)).status === "failed");
  const state=await t.read(id); expect(state.status).toBe("failed"); expect(state.capabilityAvailability).toBeUndefined();
  expect(t.driver.turns).toHaveLength(0); expect(t.spawns()).toBe(0);
  expect(JSON.stringify([...t.service.openLog(id)!.readAfter(0)])).not.toContain("private detail");
});

test("cancelling actual preparation cannot become optional ready", async () => {
  const t=fixture("claude"), {started,release}=t.pause();
  const created=await t.run({type:"session.create",projectRoot:t.project}),id=(created as any).data.sessionId;
  const prepared=await t.run({type:"session.prepare"},id);
  expect(prepared.ok).toBe(true);
  await started; expect(t.verificationCalls()).toBe(1);
  // Cancel at verifier entry, before any HTTP request can consume the 50 ms cold budget.
  const preparationId=(prepared as any).data.preparation.preparationId;
  expect(await t.run({type:"session.prepare.cancel",preparationId},id)).toMatchObject({ok:true,data:{preparation:{status:"cancelled",reasonCode:"preparation-cancelled"}}}); release();
  const state=await t.read(id);
  expect(state.status).toBe("cancelled");expect(state.capabilityAvailability).toBeUndefined();
  expect(t.spawns()).toBe(0);expect(t.driver.turns).toHaveLength(0);
});

test("a recovered actual turn clears the Web warning without another preparation", async () => {
  const t=fixture("codex"),created=await t.run({type:"session.create",projectRoot:t.project}),id=(created as any).data.sessionId;
  await t.run({type:"session.prepare"},id);await until(async()=> (await t.read(id)).status === "ready");
  expect((await t.read(id)).reasonCode).toBe("codebase-memory-unsupported");t.recover();
  await t.run({type:"prompt.send",text:"Use repaired capability"},id);await until(()=>t.driver.turns.length===1 && t.driver.turns[0]!.closed);
  expect((await t.read(id)).reasonCode).toBeUndefined();expect(render(await t.read(id))).not.toContain("Codebase Memory is unavailable");
  expect(t.driver.turns[0]!.input.rolePrompt).toContain("prior unavailable notices no longer apply");
});

test("bounded availability diagnostics do not add chat messages", async () => {
  const {CurrentEvents}=await import("../../../packages/core/src/session/chat-history");
  const current=new CurrentEvents();
  current.apply({v:1,sessionId:"s",seq:1,ts:new Date(0).toISOString(),source:{taskId:"lead"},kind:"diagnostic",data:{code:"capability.availability",availability:[{capabilityId:"codebase-memory",status:"unavailable",reasonCode:"codebase-memory-unavailable"}]}});
  expect(current.values()).toEqual([]);
});
