import { createCodexRunnerAdapter } from "../../../../../packages/adapter-codex/src/runner-adapter";
import { prepareCodexNativeRole } from "../../../../../packages/adapter-codex/src/native-role";
// Opt-in real Codex CLI acceptance: the model and provider alone are fake.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { join, resolve, dirname } from "node:path";
import { createCodexTools } from "../../../../../packages/adapter-codex/src/tools";
import { buildCodexLaunchPlan } from "../../../../../packages/adapter-codex/src/launch";
import { CODEX_ROOT_LEAD_BOOTSTRAP } from "../../../../../packages/adapter-codex/src/role-bootstrap";
import { createCodexSessionDriver } from "../../../../../packages/adapter-codex/src/session-driver/driver";
import { Supervisor } from "../../../../../packages/session-host/src/supervisor";
import { createDriverSpawn } from "../../../../../packages/session-host/src/driver-spawn";
import { runChildAnchor } from "../../../../../packages/session-host/src/anchor";
import { resolveCanonicalSupermemoryProjectScope, validateDeckConfig } from "@deck/core";
import type { DriverTaskInput } from "@deck/core/session/driver";
import { authorizeCodexSupermemoryLaunch } from "../../codex-supermemory-launch";
import { executeRunnerLaunchPlan, type RunnerProcessEffects } from "../../runner-launch-command";
import { withNativeProjectReadiness } from "../../native-project-readiness";
import { resolveSessionChildMcp } from "../../session-shared-services";
import { startGlobalMemoryTransport } from "../../session-global-memory-transport";
import { prepareSessionNativeMemory } from "../../session-native-memory";
import { assertCodexContextSequence, modelVisibleText } from "./codex-context-oracle";

if (process.argv[2] === "anchor") { await runChildAnchor(process.argv.slice(3)); process.exit(0); }
const rootResumeOnly = process.argv[4]?.startsWith("root-resume");
const resumeOnly = process.argv[4] === "resume" || rootResumeOnly;
const evidence = process.argv[2]!, home = process.env.HOME!;
assert.equal(home, "/tmp/lifecycle-home");
assert.deepEqual(Object.keys(networkInterfaces()), ["lo"]);
assert.equal(readFileSync("/proc/net/route", "utf8").trim().split("\n").length, 1);
assert(!existsSync("/home"));
const log = (name: string, data: unknown) => writeFileSync(join(evidence, name), JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
const token = "fake-hosted-credential", config = validateDeckConfig({ adaptiveMemory: { enabled: true, activeProvider: "supermemory" } });
const projects = ["alpha", "beta"].map(name => {
  const root = join(home, name); mkdirSync(root, { mode: 0o700 });
  for (const args of [["init", "-q"], ["remote", "add", "origin", `https://github.com/example/${name}.git`]]) assert.equal(Bun.spawnSync(["git", "-C", root, ...args]).exitCode, 0);
  const identity = resolveCanonicalSupermemoryProjectScope({ projectRoot: root, remotes: [] }); assert(identity.ok);
  return { name, root, scope: identity.scope };
});
assert.notEqual(projects[0]!.scope, projects[1]!.scope);
let current = projects[0]!, lane = "", step = 0, disabled = false;
const requests: any[] = [], launches: unknown[] = [], results: unknown[] = [];
const records = new Map<string, string[]>();
const tools = ["add_memory", "search_memory", "future_provider_operation"].map(name => ({ name, description: name,
  inputSchema: { type: "object", properties: { namespace: { type: "string" }, content: { type: "string" }, query: { type: "string" }, opaque: {} } },
  annotations: { readOnlyHint: name === "search_memory" }, futureProviderField: { preserve: true } }));
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
  const path = new URL(request.url).pathname, body = request.method === "POST" ? await request.json() as any : {};
  requests.push({ lane, project: current.name, path, body });
  if (path === "/mcp") {
    assert(!disabled, "disabled memory must not contact hosted MCP");
    assert.equal(request.headers.get("authorization"), `Bearer ${token}`);
    assert.equal(request.headers.get("x-sm-project"), null);
    if (body.id === undefined) return new Response(null, { status: 202 });
    let result: any = {};
    if (body.method === "initialize") result = { protocolVersion: body.params.protocolVersion, capabilities: { tools: {}, resources: {}, prompts: {} }, serverInfo: { name: "fake-hosted", version: "1" } };
    if (body.method === "tools/list") result = { tools };
    if (body.method === "resources/list") result = { resources: [] };
    if (body.method === "resources/templates/list") result = { resourceTemplates: [] };
    if (body.method === "prompts/list") result = { prompts: [] };
    if (body.method === "tools/call") {
      const args = body.params.arguments, namespace = args.namespace ?? "account-default";
      if (body.params.name === "add_memory") records.set(namespace, [...records.get(namespace) ?? [], args.content]);
      result = { content: [{ type: "text", text: JSON.stringify({ namespace, records: records.get(namespace) ?? [], opaque: args.opaque }) }], futureResult: { untouched: true } };
    }
    return Response.json({ jsonrpc: "2.0", id: body.id, result });
  }
  if (path.endsWith("/responses")) {
    const source = modelVisibleText(body);
    if (!disabled && !resumeOnly) assert(source.includes(current.scope), "exact project identity must reach model context");
    const operations = [
      { name: "add_memory", args: { namespace: current.scope, content: `${current.name} decision` } },
      { name: "search_memory", args: { namespace: current.scope, query: "project decision" } },
      { name: "add_memory", args: { namespace: "shared", content: "shared convention" } },
      { name: "search_memory", args: { namespace: "shared", query: "broader shared convention" } },
      { name: "search_memory", args: { namespace: projects.find(p => p !== current)!.scope, query: "other project" } },
      { name: "future_provider_operation", args: { opaque: ["future", 7] } },
    ];
    const operation = disabled || resumeOnly ? undefined : operations[step++];
    let item: any;
    if (operation) {
      const available = (body.tools ?? []).flatMap((tool: any) => tool.type === "namespace" ? tool.tools.map((child: any) => ({ ...child, namespace: tool.name })) : [tool]);
      const tool = available.find((tool: any) => tool.name?.endsWith(operation.name));
      assert(tool, `native tool missing: ${operation.name}; available=${JSON.stringify(body.tools)}`);
      item = { type: "function_call", id: `fc_${step}`, call_id: `call_${step}`, name: tool.name, ...(tool.namespace ? { namespace: tool.namespace } : {}), arguments: JSON.stringify(operation.args), status: "completed" };
    } else item = { type: "message", id: "final", role: "assistant", status: "completed", content: [{ type: "output_text", text: "Fixture completed.", annotations: [] }] };
    const response = { id: `response_${step}`, object: "response", created_at: 1, model: "gpt-5.4", status: "completed", output: [item], usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 } };
    const events = [{ type: "response.created", response: { ...response, status: "in_progress", output: [] } }, { type: "response.output_item.added", output_index: 0, item }, { type: "response.output_item.done", output_index: 0, item }, { type: "response.completed", response }];
    return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } });
  }
  assert(!disabled, "disabled memory must not run provider hooks");
  if (path.endsWith("/document")) { assert.equal(path, `/ns/${current.scope}/document`); return Response.json({ id: "fake-capture", status: "queued" }); }
  if (path.endsWith("/profile")) return Response.json({ profile: { static: [], dynamic: [] } });
  if (path.endsWith("/search")) return Response.json({ results: [], total: 0 });
  return Response.json({});
} });
const base = `http://127.0.0.1:${server.port}`;
const owned = createCodexTools({ homeDir: home, nodeCommand: process.env.NODE_EXECUTABLE,
  supermemoryArtifactEffects: { fetchTarball: async () => readFileSync(resolve(import.meta.dir, "../../../../../packages/adapter-codex/src/__fixtures__/supermemory/codex-supermemory-1.1.0.tgz")) } });
await owned.supermemory.install();
const proxy = { nodeCommand: owned.node.command()!, script: owned.supermemory.proxy()! };
let source = `model_provider="fixture"\nmodel="gpt-5.4"\n[features]\nhooks=true\n[model_providers.fixture]\nname="Fixture"\nbase_url="${base}/v1"\nwire_api="responses"\nrequires_openai_auth=false\n`;
writeFileSync(join(home, ".codex/config.toml"), source, { mode: 0o600 });
const adapter = createCodexRunnerAdapter({ userHome: home, codexHome: join(home, ".codex"), tools: { homeDir: home, nodeCommand: proxy.nodeCommand } });
const installation = adapter.buildDeveloperTeamInstallPlan({ projectRoot: projects[0]!.root, environmentId: "codex-development", deckConfig: config });
assert(!installation.blocked, JSON.stringify(installation.diagnostics));
for (const file of installation.files) { const path = join(home, file.path); mkdirSync(dirname(path), { recursive: true, mode: 0o700 }); writeFileSync(path, file.content, { mode: 0o600 }); }
let nativeRoleDescriptor = prepareCodexNativeRole(join(home, ".codex"), "deck-apply-deep");
assert(!nativeRoleDescriptor.preparation?.some(finding => finding.code === "codex-hooks-preserved"));
const supervisor = new Supervisor({ anchorCommand: [process.execPath, import.meta.path, "anchor"] });
const spawn = createDriverSpawn(supervisor);
const bounded = async <T>(promise: Promise<T>): Promise<T> => {
  let timer: ReturnType<typeof setTimeout>;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => timer = setTimeout(() => reject(new Error("canary deadline")), 12000))]); }
  finally { clearTimeout(timer!); }
};
try {
  if (resumeOnly) {
    if (rootResumeOnly) await exerciseRootResume();
    else { await exerciseColdResume(); await exerciseManagedResumeAndGlobal(); }
  } else {
  for (current of projects) for (lane of ["native", "managed"]) {
    step = 0;
    const before = requests.length;
    if (lane === "native") {
      const launch = buildCodexLaunchPlan({ mode: "exec", projectRoot: current.root, teamId: "developer-team", prompt: ["Exercise memory tools."], stdin: "closed", deckConfig: config } as any, { hookTrustBypass: true, interactive: true, exec: true, resumeById: true, resumeLatest: true }, [], { developerInstructions: "Preserved native role instruction." }); assert.equal(launch.status, "ready"); if (launch.status !== "ready") throw Error("launch");
      const plan = authorizeCodexSupermemoryLaunch(launch.plan, { token, projectRoot: current.root, canonicalRepoTag: current.scope }, { home, tools: { nodeCommand: proxy.nodeCommand } });
      // Supported upstream endpoint overrides are test effects only; production fixes both origins.
      plan.envOverlay = { ...plan.envOverlay, SUPERMEMORY_API_URL: { value: base }, SUPERMEMORY_MCP_URL: { value: base + "/mcp" } };
      plan.command = process.env.NATIVE_CODEX!;
      const outcome = await bounded(executeRunnerLaunchPlan(withNativeProjectReadiness(plan, "codex", () => config), { inheritedEnv: process.env, spawn: async (command: string, args: readonly string[], options: Parameters<RunnerProcessEffects["spawn"]>[2]) => {
        launches.push({ lane, project: current.name, command, args, envNames: Object.keys(options.env) });
        const child = Bun.spawn([command, ...args], { cwd: options.cwd, env: options.env, stdin: new Blob([(options.stdinPayload as any)?.content ?? ""]), stdout: "pipe", stderr: "pipe" });
        const [exitCode, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
        log(`${current.name}-native-output.json`, { exitCode, stdout, stderr });
        return { exitCode, stdout, stderr, signal: null };
      } } as any));
      assert.equal(outcome.exitCode, 0);
    } else {
      nativeRoleDescriptor = prepareCodexNativeRole(join(home, ".codex"), "deck-apply-deep");
      const prepared = prepareSessionNativeMemory("codex", current.root, config, process.env, { credential: () => ({ token, canonicalRepoTag: current.scope }) }); assert.equal(prepared?.nativeMemory.status, "ready");
      const input: DriverTaskInput = { taskId: current.name, memberId: "apply-deep", cwd: current.root, assignment: { runnerId: "codex", modelId: "fixture/gpt-5.4" }, rolePrompt: "Preserved managed role instruction.", prompt: "Exercise memory tools.", mcp: { servers: [], sessionTools: [] }, mcpServerSpecs: {}, approvals: "runner-default", credentialFile: join(home, "unused"), nativeMemory: prepared!.nativeMemory, nativeRoleDescriptor, disableNativeDelegation: true };
      const driver = createCodexSessionDriver({ executable: process.env.NATIVE_CODEX, baseEnv: { ...process.env, ...prepared?.envOverlay, SUPERMEMORY_API_URL: base, SUPERMEMORY_MCP_URL: base + "/mcp" }, rpcTimeoutMs: 8000 });
      const events: unknown[] = [];
      const handle = await driver.startTask(input, { writePrivateFile: (name, text) => { const path = join(home, name); writeFileSync(path, text, { mode: 0o600 }); return path; }, emit: event => events.push(event), approval: async () => ({ decision: "deny" }), spawn: async (command, args, options) => { launches.push({ lane, project: current.name, command, args, envNames: Object.keys(options?.env ?? {}) }); return spawn(command, args, options); } });
      try { const outcome = await bounded(handle.done); log(`${current.name}-managed.json`, { outcome, events }); assert.equal(outcome.status, "completed"); }
      finally { await handle.close(); }
    }
    const calls = requests.slice(before).filter(request => request.body.method === "tools/call");
    assert.equal(calls.length, 6);
    assert.deepEqual(calls.slice(0, 2).map(request => request.body.params.arguments.namespace), [current.scope, current.scope]);
    assert.deepEqual(calls.slice(2, 4).map(request => request.body.params.arguments.namespace), ["shared", "shared"]);
    assert.equal(calls[4].body.params.arguments.namespace, projects.find(project => project !== current)!.scope);
    assert.deepEqual(calls[5].body.params.arguments, { opaque: ["future", 7] });
    results.push({ project: current.name, lane, scope: current.scope, calls: calls.length });
  }
  // Exercise disable against installed native config; no credentials or provider calls.
  disabled = true; lane = "disabled";
  nativeRoleDescriptor = prepareCodexNativeRole(join(home, ".codex"), "deck-apply-deep");
  const prepared = prepareSessionNativeMemory("codex", current.root, validateDeckConfig({}), process.env, { credential: () => { throw Error("disabled credential access"); } });
  assert.equal(prepared?.nativeMemory.status, "disabled");
  const driver = createCodexSessionDriver({ executable: process.env.NATIVE_CODEX, baseEnv: process.env, rpcTimeoutMs: 8000 });
  const handle = await driver.startTask({ taskId: "disabled", memberId: "apply-deep", cwd: projects[0]!.root, assignment: { runnerId: "codex", modelId: "fixture/gpt-5.4" }, rolePrompt: "No memory.", prompt: "Answer once.", mcp: { servers: [], sessionTools: [] }, mcpServerSpecs: {}, approvals: "runner-default", credentialFile: join(home, "unused"), nativeMemory: prepared!.nativeMemory, nativeRoleDescriptor, disableNativeDelegation: true }, { writePrivateFile: (name, text) => { const path = join(home, name); writeFileSync(path, text, { mode: 0o600 }); return path; }, emit() {}, approval: async () => ({ decision: "deny" }), spawn });
  try { assert.equal((await bounded(handle.done)).status, "completed"); } finally { await handle.close(); }
  }
  log("results.json", { results, disabledNoProviderCalls: disabled ? true : "not exercised in resume mode", fakeInference: true, cloudAcceptance: "not exercised" });
} finally { log("requests.json", requests); log("launches.json", launches); await supervisor.shutdown(100); server.stop(true); }

async function exerciseColdResume() {
  lane = "native-start";
  const sentinel = "ROLE_SENTINEL_30_preserve_review_authority";
  // A native role/config is durable. Previous invocation-only CLI overrides are
  // not restored by Codex 0.164.0 after compaction (recorded separately).
  writeFileSync(join(home, ".codex/config.toml"), `developer_instructions=${JSON.stringify(sentinel)}\n` + readFileSync(join(home, ".codex/config.toml"), "utf8"), { mode: 0o600 });
  const features = { hookTrustBypass: true, interactive: true, exec: true, resumeById: true, resumeLatest: true };
  const launch = buildCodexLaunchPlan({ mode: "exec", projectRoot: current.root, teamId: "developer-team", prompt: ["Remember the initial task."], stdin: "closed", deckConfig: config } as any, features, [], { developerInstructions: sentinel });
  assert.equal(launch.status, "ready"); if (launch.status !== "ready") throw Error("launch");
  const run = async (plan: any) => {
    plan.command = process.env.NATIVE_CODEX!;
    plan.envOverlay = { ...plan.envOverlay, SUPERMEMORY_API_URL: { value: base }, SUPERMEMORY_MCP_URL: { value: base + "/mcp" } };
    return bounded(executeRunnerLaunchPlan(withNativeProjectReadiness(plan, "codex", () => config), { inheritedEnv: process.env, spawn: async (command: string, args: readonly string[], options: any) => {
      launches.push({ lane, command, args });
      const child = Bun.spawn([command, ...args], { cwd: options.cwd, env: options.env, stdin: new Blob([options.stdinPayload?.content ?? "Continue with the current task."]), stdout: "pipe", stderr: "pipe" });
      const [exitCode, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
      log(lane + ".json", { exitCode, stdout, stderr });
      return { exitCode, stdout, stderr, signal: null };
    } } as any));
  };
  const initial = authorizeCodexSupermemoryLaunch(launch.plan, { token, projectRoot: current.root, canonicalRepoTag: current.scope }, { home, tools: { nodeCommand: proxy.nodeCommand } });
  initial.args = ["-c", "model_auto_compact_token_limit=1", ...initial.args];
  const started = await run(initial); assert.equal(started.exitCode, 0);
  const id = JSON.parse(readFileSync(join(evidence, "native-start.json"), "utf8")).stderr.match(/session id: ([a-f0-9-]+)/i)?.[1];
  assert(id, "native session ID missing");
  lane = "native-cold-resume";
  current = projects[1]!;
  const resumed = buildCodexLaunchPlan({ mode: "resume-by-id", sessionId: id, projectRoot: current.root, teamId: "developer-team", deckConfig: config } as any, features);
  assert.equal(resumed.status, "ready"); if (resumed.status !== "ready") throw Error("resume");
  const plan = authorizeCodexSupermemoryLaunch(resumed.plan, { token, projectRoot: current.root, canonicalRepoTag: current.scope }, { home, tools: { nodeCommand: proxy.nodeCommand } });
  // Exec uses the same native resume/config semantics with deterministic stdin, no TTY.
  const resumeIndex = plan.args.indexOf("resume");
  plan.args = ["-c", "model_auto_compact_token_limit=1", ...plan.args.slice(0, resumeIndex), "exec", ...plan.args.slice(resumeIndex), "Continue after cold resume."];
  plan.stdio = "pipe"; plan.stdin = "closed";
  assert.equal((await run(plan)).exitCode, 0);
  const inference = requests.filter(r => r.lane === lane && r.path.endsWith("/responses"));
  log("cold-resume-check.json", inference.map(r => ({ role: modelVisibleText(r.body).includes(sentinel), project: modelVisibleText(r.body).includes(current.scope), input: r.body.input })));
  assert(inference.length > 1 && JSON.parse(readFileSync(join(evidence, "native-cold-resume.json"), "utf8")).stderr.includes("context compacted"), "native compaction must rebuild context");
  assert(inference.every(r => modelVisibleText(r.body).includes(sentinel)), "cold resume must preserve the role sentinel after context rebuilding");
  assert(modelVisibleText(inference.at(-1)!.body).includes(current.scope), "cold resume must retain current project identity");
  results.push({ lane, nativeSessionId: id, rolePreserved: true, projectPreserved: true, requests: inference.length });
}

async function exerciseManagedResumeAndGlobal() {
  const sentinel = "MANAGED_ROLE_SENTINEL_30";
  writeFileSync(join(home, ".codex/config.toml"), 'model_auto_compact_token_limit=1\n' + readFileSync(join(home, ".codex/config.toml"), "utf8"), { mode: 0o600 });
  const run = async (root: string, prepared: { nativeMemory?: DriverTaskInput["nativeMemory"]; envOverlay?: Record<string, string>; suppressedMcpServers?: readonly string[] }, resume?: string) => {
    nativeRoleDescriptor = prepareCodexNativeRole(join(home, ".codex"), "deck-apply-deep");
    const input: DriverTaskInput = { taskId: lane, memberId: "apply-deep", cwd: root, assignment: { runnerId: "codex", modelId: "fixture/gpt-5.4" }, rolePrompt: sentinel, prompt: "Continue the task.", mcp: { servers: [], sessionTools: [] }, mcpServerSpecs: {}, approvals: "runner-default", credentialFile: join(home, "unused"), nativeMemory: prepared.nativeMemory, nativeRoleDescriptor, disableNativeDelegation: true, suppressedMcpServers: prepared.suppressedMcpServers, ...(resume ? { resume: { nativeSessionId: resume } } : {}) };
    const driver = createCodexSessionDriver({ executable: process.env.NATIVE_CODEX, baseEnv: process.env, rpcTimeoutMs: 8000 });
    const events: unknown[] = [];
    const handle = await driver.startTask(input, { writePrivateFile: (name, text) => { const path = join(home, name); writeFileSync(path, text, { mode: 0o600 }); return path; }, emit: event => events.push(event), approval: async () => ({ decision: "deny" }), spawn: async (command, args, options) => {
      // Same custody ordering as SessionManager: clear inherited memory, then apply the resolver overlay.
      const env = Object.fromEntries(Object.entries(options?.env ?? {}).filter(([key]) => !/^SUPERMEMORY_|^DECK_MEMORY_/i.test(key)));
      Object.assign(env, prepared.envOverlay);
      assert(!Object.values(env).includes("host-only-global-fake"));
      launches.push({ lane, command, args, envNames: Object.keys(env) });
      return spawn(command, args, { ...options, env });
    } });
    try {
      const outcome = await bounded(handle.done);
      log(lane + ".json", { outcome, events, capture: handle.captureOutcome?.() });
      assert.equal(outcome.status, "completed");
      return await handle.nativeSessionId;
    } finally { await handle.close(); }
  };
  const prepare = () => {
    const memory = prepareSessionNativeMemory("codex", current.root, config, process.env, { credential: () => ({ token, canonicalRepoTag: current.scope }) });
    assert.equal(memory?.nativeMemory.status, "ready");
    return { ...memory!, envOverlay: { ...memory!.envOverlay, SUPERMEMORY_API_URL: base, SUPERMEMORY_MCP_URL: base + "/mcp" } };
  };
  current = projects[0]!; lane = "managed-start";
  const id = await run(current.root, prepare());
  current = projects[1]!; lane = "managed-cold-resume";
  assert.equal(await run(current.root, prepare(), id), id);
  const inference = requests.filter(r => r.lane === lane && r.path.endsWith("/responses"));
  assert(inference.length > 1, "forced compaction must rebuild managed context");
  assert(modelVisibleText(inference.at(-1)!.body).includes(sentinel));
  assert(modelVisibleText(inference.at(-1)!.body).includes(current.scope));
  results.push({ lane, nativeSessionId: id, rolePreserved: true, projectPreserved: true, requests: inference.length });

  lane = "managed-global";
  const root = join(home, "global"); mkdirSync(root, { mode: 0o700 });
  const upstream: unknown[] = [];
  const resolver = await resolveSessionChildMcp({ runnerId: "codex" } as any, config, process.env,
    { readiness: {} as any, context: { projectRoot: root } as any }, { credential: () => ({ token: "host-only-global-fake" }) },
    options => startGlobalMemoryTransport({ ...options, fetch: async (url, init) => {
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer host-only-global-fake");
      const path = new URL(String(url)).pathname, body = JSON.parse(String(init?.body));
      assert(!path.startsWith("/ns/")); assert.equal(body.containerTag, undefined); assert.equal(body.containerTags, undefined);
      upstream.push({ path, body });
      return Response.json(path === "/v3/documents" ? { id: "global-capture", status: "queued" } : { results: [], total: 0 });
    } }));
  assert.equal(resolver.nativeMemory?.status, "ready");
  try { await run(root, resolver); } finally { await resolver.release?.(); }
  assert(!requests.some(r => r.lane === lane && r.path === "/mcp"));
  assert(upstream.some((r: any) => r.path === "/v3/documents"), "global native Stop hook must capture through the session transport");
  log("global-upstream.json", upstream);
  results.push({ lane, legacyCapture: true, hostedCalls: 0, upstreamCredentialHostOnly: true });
}

/** Root continuity uses the actual adapter bootstrap, never a durable copy of it. */
async function exerciseRootResume() {
  disabled = process.argv[4] === "root-resume-disabled";
  const tui = process.argv[4] === "root-resume-tui";
  const selected = disabled ? validateDeckConfig({}) : config;
  if (disabled) {
    const install = adapter.buildDeveloperTeamInstallPlan({ projectRoot: current.root, environmentId: "codex-development", deckConfig: selected });
    assert(!install.blocked);
    for (const file of install.files) { const path = join(home, file.path); mkdirSync(dirname(path), { recursive: true, mode: 0o700 }); writeFileSync(path, file.content, { mode: 0o600 }); }
  }
  const durable = "DURABLE_NATIVE_USER_ROLE_33";
  const configPath = join(home, ".codex/config.toml");
  writeFileSync(configPath, `developer_instructions=${JSON.stringify(durable)}\n` + readFileSync(configPath, "utf8"), { mode: 0o600 });
  const observer = join(home, "observe-hook.py");
  writeFileSync(observer, "import sys,json\nwith open('/evidence/native-hook-events.jsonl','a') as f: f.write(sys.stdin.read()+'\\n')\n");
  writeFileSync(configPath, readFileSync(configPath, "utf8") + `\n[[hooks.SessionStart]]\nhooks = [{ type = "command", command = ${JSON.stringify("python3 " + observer)} }]\n`);
  const help = (args: string[]) => {
    const result = Bun.spawnSync([process.env.NATIVE_CODEX!, ...args], { stdout: "pipe", stderr: "pipe" });
    assert.equal(result.exitCode, 0); return result.stdout.toString();
  };
  const actual = { found: true, version: help(["--version"]).trim().split(" ").at(-1)!, help: help(["--help"]), execHelp: help(["exec", "--help"]), resumeHelp: help(["resume", "--help"]) };
  const rootAdapter = createCodexRunnerAdapter({ userHome: home, codexHome: join(home, ".codex"), preflight: { probe: async () => actual }, tools: { homeDir: home, nodeCommand: proxy.nodeCommand } });
  let inheritedRoot: Record<string, string> = {};
  const run = async (name: string, sessionId?: string, teamId = "developer-team") => {
    lane = name;
    log(name + "-config-before.json", readFileSync(configPath, "utf8"));
    const input = { projectRoot: current.root, teamId, deckConfig: selected,
      ...(sessionId ? { mode: "resume-by-id" as const, sessionId } : { mode: "exec" as const, prompt: ["Continue the task."], stdin: "closed" as const }) };
    const launch = await rootAdapter.buildLaunchPlan!(input);
    assert.equal(launch.status, "ready"); if (launch.status !== "ready") throw Error(JSON.stringify(launch));
    assert(!launch.plan.args.some(arg => arg.startsWith("developer_instructions=")), "root composition must preserve durable user instructions");
    const plan = disabled ? launch.plan : authorizeCodexSupermemoryLaunch(launch.plan, { token, projectRoot: current.root, canonicalRepoTag: current.scope }, { home, tools: { nodeCommand: proxy.nodeCommand } });
    const resolveRoot = plan.nativeSessionStartContext;
    plan.nativeSessionStartContext = event => {
      const context = resolveRoot?.(event);
      results.push({ lane, event, rootContext: !!context });
      log("root-events.json", results);
      return context;
    };
    plan.command = process.env.NATIVE_CODEX!;
    plan.envOverlay = { ...plan.envOverlay, SUPERMEMORY_API_URL: { value: base }, SUPERMEMORY_MCP_URL: { value: base + "/mcp" } };
    const index = plan.args.indexOf("resume");
    const interactive = tui && !!sessionId;
    plan.args = ["-c", "model_auto_compact_token_limit=1", ...(sessionId && !interactive ? [...plan.args.slice(0, index), "exec", ...plan.args.slice(index), "Continue after cold resume."] : plan.args)];
    plan.stdio = "pipe"; plan.stdin = "closed";
    const outcome = await bounded(executeRunnerLaunchPlan(withNativeProjectReadiness(plan, "codex", () => selected, undefined, undefined, () => rootAdapter.readPreparationGeneration!()), {
      inheritedEnv: process.env, spawn: async (command: string, args: readonly string[], options: any) => {
        inheritedRoot = options.env;
        launches.push({ lane, command, args });
        const child = Bun.spawn(interactive ? ["python3", join(home, "tui-probe.py"), command, ...args] : [command, ...args], { cwd: options.cwd, env: { ...options.env, TERM: "xterm-256color" }, stdin: new Blob([options.stdinPayload?.content ?? "Continue."]), stdout: "pipe", stderr: "pipe" });
        const [exitCode, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
        log(name + ".json", { exitCode, stdout, stderr });
        return { exitCode, stdout, stderr, signal: null };
      },
    } as any));
    assert.equal(outcome.exitCode, 0);
    log(name + "-config-after.json", readFileSync(configPath, "utf8"));
    const id = interactive ? sessionId : outcome.stderr.match(/session id: ([a-f0-9-]+)/i)?.[1]; assert(id);
    return id;
  };
  const root = await run("root-start");
  current = projects[1]!;
  if (tui) {
    // One short native PTY interaction, inside the same isolated namespace.
    writeFileSync(join(home, "tui-probe.py"), `import os,pty,select,sys,time,signal,fcntl,termios,struct
pid,fd=pty.fork()
if pid==0: os.execvpe(sys.argv[1],sys.argv[1:],os.environ)
fcntl.ioctl(fd,termios.TIOCSWINSZ,struct.pack('HHHH',32,110,0,0))
start=time.monotonic(); sent=False; chosen=False; output=b''
try:
 while time.monotonic()-start<9:
  if select.select([fd],[],[],.1)[0]:
   try: data=os.read(fd,65536)
   except OSError: break
   if not data: break
   output+=data
   if b'\\x1b[6n' in data: os.write(fd,b'\\x1b[1;1R')
   if b'\\x1b[c' in data: os.write(fd,b'\\x1b[?1;2c')
   if not chosen and b'Working directory' in output:
    os.write(fd,b'\\x1b[B\\r'); chosen=True
   if chosen and not sent and b'state=idle' in data:
    os.write(fd,b'Continue after cold resume.\\r'); sent=True
finally:
 try: os.kill(pid,signal.SIGTERM)
 except ProcessLookupError: pass
 os.waitpid(pid,0)
 sys.stdout.buffer.write(output)
`);
    await run("root-tui-resume", root);
    const inference = requests.filter(r => r.lane === "root-tui-resume" && r.path.endsWith("/responses"));
    const checks = assertCodexContextSequence(
      requests.filter(r => r.lane === "root-start" && r.path.endsWith("/responses")).map(r => r.body),
      inference.map(r => r.body),
      { prior: projects[0]!, current, required: [CODEX_ROOT_LEAD_BOOTSTRAP, durable], memoryEnabled: !disabled },
    );
    const passed = checks.length > 0;
    log("tui-check.json", { passed, inferenceRequests: inference.length, limitation: passed ? "PTY interaction only; no visual UI review" : "The bounded PTY interaction did not reach a verified model request; see root-tui-resume.json for native output." });
    assert(passed, "native TUI interaction unavailable; evidence retained");
    return;
  }
  assert.equal(await run("root-cold-resume", root), root);
  const inferenceFor = (name: string) => requests.filter(r => r.lane === name && r.path.endsWith("/responses")).map(r => r.body);
  const checks = assertCodexContextSequence(inferenceFor("root-start"), inferenceFor("root-cold-resume"), {
    prior: projects[0]!, current, required: [CODEX_ROOT_LEAD_BOOTSTRAP, durable], memoryEnabled: !disabled,
  });
  log("root-context-checks.json", checks);
  assert(JSON.parse(readFileSync(join(evidence, "root-cold-resume.json"), "utf8")).stderr.includes("context compacted"));
  results.push({ lane: "root-cold-resume", memory: !disabled, rootBootstrap: true, durableUserRole: true, currentProject: true, forcedCompaction: true });
  // Resuming an unrelated/custom session through Deck must not promote it.
  const unrelated = await run("custom-start", undefined, "custom-team");
  await run("custom-cold-resume", unrelated);
  log("custom-context-checks.json", assertCodexContextSequence(inferenceFor("custom-start"), inferenceFor("custom-cold-resume"), {
    prior: current, current, required: [durable], forbidden: [CODEX_ROOT_LEAD_BOOTSTRAP], memoryEnabled: !disabled,
  }));
  // Managed child drops the inherited native root refresh environment.
  lane = "managed-child-no-root";
  const prepared = prepareSessionNativeMemory("codex", current.root, selected, process.env, { credential: () => ({ token, canonicalRepoTag: current.scope }) });
  const descriptor = prepareCodexNativeRole(join(home, ".codex"), "deck-apply-deep");
  const driver = createCodexSessionDriver({ executable: process.env.NATIVE_CODEX, baseEnv: { ...inheritedRoot, ...prepared?.envOverlay, SUPERMEMORY_API_URL: base, SUPERMEMORY_MCP_URL: base + "/mcp" }, rpcTimeoutMs: 8000 });
  const childRole = "MANAGED_CHILD_ROLE_33";
  const handle = await driver.startTask({ taskId: lane, memberId: "apply-deep", cwd: current.root, assignment: { runnerId: "codex", modelId: "fixture/gpt-5.4" }, rolePrompt: childRole, prompt: "Answer once.", mcp: { servers: [], sessionTools: [] }, mcpServerSpecs: {}, approvals: "runner-default", credentialFile: join(home, "unused"), nativeMemory: prepared!.nativeMemory, nativeRoleDescriptor: descriptor, disableNativeDelegation: true }, {
    writePrivateFile: (name, text) => { const path = join(home, name); writeFileSync(path, text, { mode: 0o600 }); return path; }, emit() {}, approval: async () => ({ decision: "deny" }), spawn,
  });
  try { assert.equal((await bounded(handle.done)).status, "completed"); } finally { await handle.close(); }
  const childInference = requests.filter(r => r.lane === lane && r.path.endsWith("/responses"));
  assert(childInference.length > 0 && childInference.every(r => modelVisibleText(r.body).includes(childRole) && !modelVisibleText(r.body).includes(CODEX_ROOT_LEAD_BOOTSTRAP)));
  results.push({ unrelatedResumeNotPromoted: true, managedChildNotPromoted: true, disabledNoProviderCalls: disabled ? requests.every(r => r.path.endsWith("/responses")) : "not applicable" });
}
