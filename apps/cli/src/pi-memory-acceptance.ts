/** Opt-in actual Pi CLI canary; synthetic HOME, faux inference, fake provider only. */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { createSupermemoryRuntimeHost } from "./supermemory-runtime-host";
import { createSupermemoryHttpTransport } from "@deck/adapter-supermemory/runtime";
import type { NormalizedDeckConfig } from "@deck/core";

const evidence = resolve(process.argv[2]!);
const repo = resolve(import.meta.dir, "../../..");
const home = join(evidence, "home"), project = join(evidence, "project");
for (const directory of [home, project, join(evidence, "tmp")]) mkdirSync(directory, { recursive: true, mode: 0o700 });
const env = { HOME: home, TMPDIR: join(evidence, "tmp"), PATH: "/tools:/usr/bin:/bin", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", PI_CODING_AGENT_DIR: join(home, "agent") };
for (const args of [["init", "-q", project], ["-C", project, "remote", "add", "origin", "https://github.com/acme/pi-memory-canary.git"]]) assert.equal(Bun.spawnSync(["git", ...args], { env }).exitCode, 0);
const wire: { path: string; body: any }[] = [];
const transport = createSupermemoryHttpTransport({ apiKey: "synthetic-provider-key", fetchImpl: async (url, init) => {
  const path = new URL(String(url)).pathname, body = JSON.parse(String(init?.body ?? "{}"));
  wire.push({ path, body });
  return Response.json(path.endsWith("/search") ? { results: wire.filter(call => call.path.endsWith("/document")).map((call, index) => ({ id: `m${index}`, memory: `PI_SHARED_RECALL:${call.body.content}` })), searchTime: 1 } : path.endsWith("/profile") ? { profile: { static: [], dynamic: [], buckets: {} } } : { id: "d1", status: "queued" });
} });
const host = await createSupermemoryRuntimeHost({ projectRoot: project, deckConfig: { adaptiveMemory: { enabled: true } } as NormalizedDeckConfig, runnerId: "pi", apiKey: "synthetic", transport, stateHome: evidence, deferInitialRecallToLoopback: true });
assert(host.enabled);
const bridge = (await host.startLoopbackBridge())!;
const tokenFile = join(evidence, "loopback-token"); writeFileSync(tokenFile, bridge.token, { mode: 0o600 });
const fake = join(evidence, "faux.mjs");
writeFileSync(fake, `import { fauxProvider, fauxAssistantMessage } from ${JSON.stringify(join(repo, "packages/adapter-pi/node_modules/@earendil-works/pi-ai/dist/index.js"))};
import { writeFileSync } from 'node:fs';
export default function(pi) {
 const faux = fauxProvider();
 faux.setResponses([(context) => { writeFileSync(process.env.PI_CANARY_REQUEST, JSON.stringify(context)); return fauxAssistantMessage([{type:'thinking',thinking:'PRIVATE_REASONING'}, {type:'text',text:process.env.DECK_PI_ROLE==='apply-fast'?'Observed cobalt.':'Cobalt.'}]); }]);
 pi.registerProvider(faux.provider);
}`);
// Defense in depth for invocation outside the network-isolated launcher.
const guard = join(evidence, "network.cjs");
writeFileSync(guard, `const net=require('node:net'); const original=net.Socket.prototype.connect;
net.Socket.prototype.connect=function(...args){ const a=args[0]; const host=typeof a==='object'?a.host:typeof args[1]==='string'?args[1]:undefined;
 if(host && !['127.0.0.1','localhost','::1'].includes(host)) throw new Error('external network denied'); return original.apply(this,args); };
const originalFetch=globalThis.fetch;globalThis.fetch=(url,init)=>{ const u=new URL(String(url));if(!['127.0.0.1','localhost','[::1]'].includes(u.hostname))throw new Error('external fetch denied');return originalFetch(url,init); };`);
try {
  const laneCounts: { role: string; before: number; after: number }[] = [];
  for (const role of ["lead", "apply-fast", "disabled"]) {
    const before = wire.length;
    const requestFile = join(evidence, `${role}-request.json`);
    const child = Bun.spawn([process.env.NODE_EXECUTABLE ?? "node", join(repo, "packages/adapter-pi/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js"), "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-tools", "-e", fake, "-e", join(repo, "packages/adapter-pi/assets/pi/extensions/deck-memory.generated.js"), "--model", "faux/faux-1", "--mode", "json", "-p", role === "apply-fast" ? "Which color?" : "Use cobalt."], { cwd: project, env: { ...env, NODE_OPTIONS: `--require=${guard}`, DECK_PI_ROLE: role === "disabled" ? "lead" : role, ...(role === "disabled" ? { DECK_PI_MEMORY: "disabled" } : role === "lead" ? {} : { DECK_PI_CHILD: "1" }), DECK_RUNNER_MEMORY_ENDPOINT: bridge.endpoint, DECK_RUNNER_MEMORY_TOKEN_FILE: tokenFile, PI_CANARY_REQUEST: requestFile }, stdout: "pipe", stderr: "pipe" });
    const timer = setTimeout(() => child.kill("SIGKILL"), 15000);
    const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]).finally(() => clearTimeout(timer));
    writeFileSync(join(evidence, `${role}.log`), out + err);
    assert.equal(code, 0, `${role} failed: ${err}`);
    laneCounts.push({ role, before, after: wire.length });
    if (role === "disabled") assert.equal(wire.length, before, "Disabled process must make zero provider reads or writes");
    assert.equal((await Bun.file(requestFile).text()).includes("PI_SHARED_RECALL"), role !== "disabled");
    if (role === "apply-fast") assert((await Bun.file(requestFile).text()).includes("PI_SHARED_RECALL:Cobalt."), "Child must receive the earlier Lead public final from provider recall");
  }
  const writes = wire.filter(call => call.path.endsWith("/document"));
  assert.equal(writes.length, 4); // exactly one input and final for each native role
  assert.deepEqual(writes.map(call => call.body.content), ["Use cobalt.", "Cobalt.", "Which color?", "Observed cobalt."]);
  assert.equal(new Set(writes.map(call => call.body.id)).size, 4);
  assert.deepEqual(writes.map(call => call.body.metadata.role), ["user", "assistant", "user", "assistant"]);
  assert(wire.every(call => call.path.startsWith("/ns/sm_project_v1_acme_pi_memory_canary/")));
  assert(!JSON.stringify(writes).includes("PRIVATE_REASONING"));
  writeFileSync(join(evidence, "wire.json"), JSON.stringify(wire, null, 2));
  console.log(JSON.stringify({ ok: true, runner: "Pi 1.0.0 actual CLI", writes: writes.length, roles: ["lead", "apply-fast"], laneCounts, disabled: "zero effects", scope: "canonical project", provider: "fake", inference: "faux" }));
} finally { await bridge.close(); }
