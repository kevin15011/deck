import { test, expect } from "bun:test";
import { mkdtemp, writeFile, rm, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { claudeModelSettings, discoverClaudeModels, parseClaudeModelInfo } from "./model-discovery";

test("accepts exact arbitrary runtime model IDs, resolved wire IDs, and explicit reported effort metadata", () => {
  const models = parseClaudeModelInfo([{ value: "vendor/custom-model-2030", resolvedModel: "wire-id-2030", displayName: "Custom model", description: "Runtime reported", supportsEffort: true, supportedEffortLevels: ["high", "max"] }]);
  expect(models[0]?.value).toBe("vendor/custom-model-2030");
  expect(models[0]?.resolvedModel).toBe("wire-id-2030");
  expect(() => parseClaudeModelInfo([{ value: "bad\nmodel", displayName: "bad", description: "bad" }])).toThrow();
});

test("initialize-only discovery handles fragmented control frames and never sends an inference message", async () => {
  const home = await mkdtemp(join(tmpdir(), "deck-claude-model-protocol-"));
  try {
    const executable = join(home, "claude");
    await writeFile(executable, `#!${process.execPath}
let input = ''; process.stdin.on('data', b => { input += b; if (!input.includes('\\n')) return;
const request = JSON.parse(input.trim());
if (request.type !== 'control_request' || request.request.subtype !== 'initialize') process.exit(9);
const frame = JSON.stringify({type:'control_response',response:{subtype:'success',request_id:request.request_id,response:{models:[{value:'custom-runtime-id',displayName:'Runtime custom',description:'fixture'}]}}})+'\\n';
process.stdout.write(JSON.stringify({type:'control_response',response:{subtype:'success',request_id:'unrelated',response:{models:[]}}})+'\\n');
process.stdout.write(frame.slice(0, 27)); setTimeout(() => process.stdout.write(frame.slice(27)), 5);
});`, { mode: 0o700 });
    const result = await discoverClaudeModels({ command: executable, home, projectRoot: home, timeoutMs: 2000 });
    expect(result[0]?.value).toBe("custom-runtime-id");
  } finally { await rm(home, { recursive: true, force: true }); }
});

test("discovery bounds timeout, malformed frames, errors and output without leaking stderr", async () => {
  const home = await mkdtemp(join(tmpdir(), "deck-claude-model-failures-"));
  try {
    const command = join(home, "claude");
    for (const [body, message] of [["setInterval(()=>{},1000)", "timed out"], ["process.stdout.write('not JSON\\n');setInterval(()=>{},1000)", "malformed"], ["process.stdout.write('x'.repeat(1024*1024+1));setInterval(()=>{},1000)", "bound"], ["process.stderr.write('secret-test');process.exit(2)", "failed"]]) {
      await writeFile(command, `#!${process.execPath}\n${body}`, { mode: 0o700 });
      await expect(discoverClaudeModels({ command, home, projectRoot: home, timeoutMs: 150 })).rejects.toThrow(message);
    }
    const controller = new AbortController(); controller.abort();
    await expect(discoverClaudeModels({ command, home, projectRoot: home, signal: controller.signal })).rejects.toThrow("cancelled");
    await writeFile(command, `#!${process.execPath}\nprocess.stdin.once('data', b => {const r = JSON.parse(b.toString());process.stdout.write(JSON.stringify({type:'control_response',response:{subtype:'error',request_id:r.request_id,error:'fixture-secret'}})+'\\n')});`, { mode: 0o700 });
    await expect(discoverClaudeModels({ command, home, projectRoot: home })).rejects.toThrow("control request failed");
    const pidPath = join(home, "probe.pid");
    await writeFile(command, `#!${process.execPath}\nimport {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(pidPath)}, String(process.pid));process.on('SIGTERM',()=>{});setInterval(()=>{},1000);`, { mode: 0o700 });
    const running = new AbortController();
    const probe = discoverClaudeModels({ command, home, projectRoot: home, signal: running.signal });
    let pid = 0;
    for (let n = 0; n < 100 && !pid; n++) { try { pid = Number(await readFile(pidPath, "utf8")); } catch { await Bun.sleep(5); } }
    expect(pid).toBeGreaterThan(0);
    running.abort(); await expect(probe).rejects.toThrow("cancelled");
    expect(() => process.kill(pid, 0)).toThrow();
  } finally { await rm(home, { recursive: true, force: true }); }
});

test("preserves inert user/project model metadata and excludes executable settings and credentials", async () => {
  const home = await mkdtemp(join(tmpdir(), "deck-claude-model-settings-"));
  const projectRoot = join(home, "project");
  try {
    await mkdir(join(home, ".claude")); await mkdir(join(projectRoot, ".claude"), { recursive: true });
    const path = join(home, ".claude", "settings.json");
    const content = JSON.stringify({ model: "user-model", availableModels: ["custom-model"], env: { ANTHROPIC_DEFAULT_OPUS_MODEL: "my-opus", ANTHROPIC_API_KEY: "fixture-secret" }, hooks: { SessionStart: "do-not-run" }, apiKeyHelper: "do-not-run", enabledPlugins: { foreign: true } });
    await writeFile(path, content, { mode: 0o600 });
    await writeFile(join(projectRoot, ".claude", "settings.local.json"), JSON.stringify({ model: "project-model" }), { mode: 0o600 });
    expect(claudeModelSettings(home, projectRoot)).toEqual({ model: "project-model", availableModels: ["custom-model"], env: { ANTHROPIC_DEFAULT_OPUS_MODEL: "my-opus" } });
    expect(await readFile(path, "utf8")).toBe(content);
  } finally { await rm(home, { recursive: true, force: true }); }
});

test("availableModels merges user/project/local lists but managed lists replace every lower scope", async () => {
  const home = await mkdtemp(join(tmpdir(), "deck-claude-model-layers-")); const project = join(home, "project");
  try {
    await mkdir(join(home, ".claude")); await mkdir(join(project, ".claude"), { recursive: true });
    await writeFile(join(home, ".claude", "settings.json"), JSON.stringify({ availableModels: ["user", "shared"] }), { mode: 0o600 });
    await writeFile(join(project, ".claude", "settings.json"), JSON.stringify({ availableModels: ["project", "shared"] }), { mode: 0o600 });
    await writeFile(join(project, ".claude", "settings.local.json"), JSON.stringify({ availableModels: ["local", "user"] }), { mode: 0o600 });
    expect(claudeModelSettings(home, project).availableModels).toEqual(["user", "shared", "project", "local"]);
    const managed = join(home, ".claude", "managed-settings.json");
    await writeFile(managed, JSON.stringify({ availableModels: ["managed"] }), { mode: 0o600 });
    expect(claudeModelSettings(home, project).availableModels).toEqual(["managed"]);
    await writeFile(managed, JSON.stringify({ availableModels: [] }), { mode: 0o600 });
    expect(claudeModelSettings(home, project).availableModels).toEqual([]);
    await writeFile(managed, JSON.stringify({ model: "managed" }), { mode: 0o600 });
    expect(claudeModelSettings(home, project).availableModels).toEqual(["user", "shared", "project", "local"]);
  } finally { await rm(home, { recursive: true, force: true }); }
});

test("probe kills TERM-ignoring descendants even after its direct child closes on success/cancel/timeout", async () => {
  if (process.platform === "win32") return;
  const home = await mkdtemp(join(tmpdir(), "deck-claude-model-descendants-"));
  try {
    for (const mode of ["success", "cancel", "timeout"] as const) {
      const heartbeat = join(home, `${mode}.ticks`); const command = join(home, "claude"); const worker = join(home, "worker.ts");
      await writeFile(worker, `import {appendFileSync} from 'node:fs';process.on('SIGTERM',()=>{});appendFileSync(${JSON.stringify(heartbeat)},'x');setInterval(()=>appendFileSync(${JSON.stringify(heartbeat)},'x'),10);`);
      await writeFile(command, `#!${process.execPath}\nimport {spawn} from 'node:child_process';import {existsSync} from 'node:fs';const worker=spawn(${JSON.stringify(process.execPath)},[${JSON.stringify(worker)}],{stdio:'ignore'});process.on('SIGTERM',()=>process.exit(0));process.stdin.once('data',b=>{const r=JSON.parse(b.toString());const t=setInterval(()=>{if(!existsSync(${JSON.stringify(heartbeat)}))return;clearInterval(t);${mode === "success" ? "process.stdout.write(JSON.stringify({type:'control_response',response:{subtype:'success',request_id:r.request_id,response:{models:[]}}})+'\\n');" : ""}},5)});`, { mode: 0o700 });
      const controller = new AbortController();
      const promise = discoverClaudeModels({ command, home, projectRoot: home, signal: controller.signal, timeoutMs: 500 });
      // Observe the fake effect only; no real provider or user state is touched.
      for (let n = 0; n < 100; n++) { try { await readFile(heartbeat); break; } catch { await Bun.sleep(5); } }
      try {
        if (mode === "cancel") controller.abort();
        if (mode === "success") expect(await promise).toEqual([]);
        else await expect(promise).rejects.toThrow(mode === "cancel" ? "cancelled" : "timed out");
        const before = await readFile(heartbeat, "utf8"); await Bun.sleep(150);
        expect(await readFile(heartbeat, "utf8")).toBe(before);
      } finally {
        // Cleanup the deliberately leaked fixture on RED, too.
        const { execFileSync } = await import("node:child_process");
        const pids = execFileSync("ps", ["-eo", "pid,args"], { encoding: "utf8" }).split("\n").filter((line) => line.includes(worker)).map((line) => Number(line.trim().split(/\s+/)[0]));
        for (const pid of pids) { try { process.kill(pid, "SIGKILL"); } catch {} }
      }
    }
  } finally { await rm(home, { recursive: true, force: true }); }
});

test("installed Claude initialize-only protocol reports a custom native modelPicker identifier without a provider message", async () => {
  const command = Bun.which("claude"); if (!command) return;
  const home = await mkdtemp(join(tmpdir(), "deck-claude-native-picker-"));
  try {
    const initial = await discoverClaudeModels({ command, home, projectRoot: home });
    const resolvedModel = initial.find((model) => model.resolvedModel)?.resolvedModel;
    expect(resolvedModel).toBeDefined();
    await mkdir(join(home, ".claude"));
    const path = join(home, ".claude", "settings.json");
    const content = JSON.stringify({ modelPicker: { options: [{ model: "deck-custom-runtime-model-2030", label: "Deck Runtime Custom", description: "Metadata fixture", behavesAs: resolvedModel }], replaceBuiltInOptions: true }, hooks: { SessionStart: [{ hooks: [{ type: "command", command: "exit 99" }] }] } });
    await writeFile(path, content, { mode: 0o600 });
    const selected = await discoverClaudeModels({ command, home, projectRoot: home });
    expect(selected.some((model) => model.value === "deck-custom-runtime-model-2030" && model.displayName === "Deck Runtime Custom")).toBe(true);
    expect(await readFile(path, "utf8")).toBe(content);
  } finally { await rm(home, { recursive: true, force: true }); }
});
