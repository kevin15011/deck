import { expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, watch } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createEmptyPiManifest, hashJsonValue } from "./pi-manifest";
import { buildCodebaseGuardEntry, codebaseGuardCliArgs, createCodebaseGuardInvocation, inspectCodebaseGuardEntry, parseCodebaseGuardArgs } from "./pi-codebase-guard-command";
import { runPiCodebaseGuard } from "./pi-codebase-guard";
import { DECK_PI_MEMORY_ENV_BLANKS, validateDeckPiMcpEntry } from "./pi-deck-mcp";
import { classifyNativeCodebase } from "./pi-native-codebase-readiness";

function fixture(body: string, raceBody = "", consumer = "", drainTimeoutMs = 2000, gateStartup = false) {
  const root = mkdtempSync(join(tmpdir(), "deck-guard-unit-"));
  const agentDir = join(root, "agent"), binary = join(root, "codebase-memory-mcp"), guardScript = join(root, "guard-main.ts"), marker = join(root, "pid");
  mkdirSync(join(agentDir, "deck"), { recursive: true });
  const startBody = `require('node:fs').writeFileSync(${JSON.stringify(marker)}, String(process.pid));\n${body}\n`;
  const script = `#!/usr/bin/env node\n${gateStartup ? `
const fs=require('node:fs');
const release=${JSON.stringify(join(root, "release"))};
const startFixture=()=>{${startBody}};
let started=false;
const watcher=fs.watch(${JSON.stringify(root)},()=>{if(!started&&fs.existsSync(release)){started=true;watcher.close();startFixture();}});
fs.writeFileSync(${JSON.stringify(join(root,"booted"))},String(process.pid));
` : startBody}`;
  writeFileSync(binary, script, { mode: 0o700 });
  const release = { asset: "fixture", archiveBytes: 1, archiveSha256: "0".repeat(64), binaryBytes: Buffer.byteLength(script), binarySha256: createHash("sha256").update(script).digest("hex") };
  writeFileSync(guardScript, `import {runPiCodebaseGuard} from ${JSON.stringify(join(import.meta.dir, "pi-codebase-guard.ts"))};\nimport {parseCodebaseGuardArgs} from ${JSON.stringify(join(import.meta.dir, "pi-codebase-guard-command.ts"))};\nconst parsed=parseCodebaseGuardArgs(process.argv.slice(4)); if(!parsed)process.exit(64);\n${consumer}\nconst code=await runPiCodebaseGuard(parsed,{${consumer ? "output:sink,error:diagnostic," : ""}drainTimeoutMs:${drainTimeoutMs},release:${JSON.stringify(release)},${raceBody ? `afterVerification:()=>{${raceBody}},` : ""}});\n${consumer ? `require('node:fs').writeFileSync(${JSON.stringify(join(root,"result.json"))},JSON.stringify({bytes,code}));` : ""}\nawait Promise.all([process.stdout,process.stderr].map(s=>new Promise(r=>s.write('',r))));process.exit(code);`);
  const invocation = createCodebaseGuardInvocation(process.execPath, guardScript);
  const entry = buildCodebaseGuardEntry(invocation, agentDir, binary);
  const manifest = createEmptyPiManifest(); manifest.mcp.servers["codebase-memory"] = hashJsonValue(entry);
  const mcpPath = join(agentDir, "mcp.json"), manifestPath = join(agentDir, "deck/manifest.json");
  writeFileSync(mcpPath, JSON.stringify({ mcpServers: { "codebase-memory": entry } })); writeFileSync(manifestPath, JSON.stringify(manifest));
  const runs: Array<{ child: ReturnType<typeof spawn>; closed: Promise<number | null> }> = [];
  return { root, agentDir, binary, script, entry, invocation, marker, mcpPath, manifestPath,
    start() {
      const child = spawn(entry.command, entry.args, { stdio: ["pipe", "pipe", "pipe"] });
      let stderr = "";
      child.stderr.on("data", chunk => { stderr += chunk; });
      const closed = new Promise<number | null>(resolve => child.once("close", resolve));
      runs.push({ child, closed });
      const ready = async (name = "pid") => {
        const path = join(root, name);
        const observed = () => {
          try {
            const value = readFileSync(path, "utf8");
            return name === "pid" || name === "booted" ? /^[1-9][0-9]*$/.test(value) : value === "ready";
          } catch (failure) {
            if ((failure as NodeJS.ErrnoException).code === "ENOENT") return false;
            throw failure;
          }
        };
        if (observed()) return;
        await new Promise<void>((resolve, reject) => {
          let settled = false;
          const done = (failure?: Error) => {
            if (settled) return;
            settled = true;
            watcher.close(); clearTimeout(timer); child.removeListener("close", onClose);
            if (failure) reject(failure); else resolve();
          };
          const check = () => { if (observed()) done(); };
          const onClose = () => done(observed() ? undefined : new Error(`Guard closed before fixture ${name}: ${stderr}`));
          const watcher = watch(root, check);
          const timer = setTimeout(() => done(new Error(`Fixture ${name} readiness timed out: ${stderr}`)), 5000);
          child.once("close", onClose);
          if (child.exitCode !== null || child.signalCode !== null) onClose(); else check();
        });
      };
      return { child, closed, ready, stderr: () => stderr };
    },
    async close() {
      // Failure cleanup must reap the supervisor before removing files it still watches.
      for (const { child, closed } of runs) {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
        let timer: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([closed, new Promise<void>(resolve => { timer = setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 1500); })]);
        clearTimeout(timer);
        await closed;
      }
      const childMarker = existsSync(marker) ? marker : join(root, "booted");
      if (existsSync(childMarker)) {
        const value = readFileSync(childMarker, "utf8");
        if (!/^[1-9][0-9]*$/.test(value) || Number(value) <= 1) throw new Error("Invalid fixture child PID during cleanup");
        const pid = Number(value);
        if (isAlive(pid)) { process.kill(pid, "SIGKILL"); throw new Error("Fixture cleanup found an orphaned owned child"); }
      }
      rmSync(root, { recursive: true, force: true });
    },
  };
}
const isAlive=(pid:number)=>{try{process.kill(pid,0);return true;}catch{return false;}};

for (const fault of ["size", "hash", "manifest", "missing", "guard", "selection"] as const) test(`guard refuses ${fault} before spawn`, async () => {
  const f=fixture("setInterval(()=>{},1000);");
  try {
    if(fault==="size") writeFileSync(f.binary,"wrong");
    if(fault==="hash") writeFileSync(f.binary,f.script.replace("setInterval","setIntervxl"));
    if(fault==="manifest") writeFileSync(f.manifestPath,"invalid");
    if(fault==="missing") rmSync(f.binary);
    if(fault==="guard") writeFileSync(join(f.root,"guard-main.ts"),readFileSync(join(f.root,"guard-main.ts"),"utf8")+"\n// changed\n");
    if(fault==="selection") writeFileSync(f.mcpPath,JSON.stringify({mcpServers:{"codebase-memory":{command:"/custom-user-command"}}}));
    const run=f.start();run.child.stdin.end();
    expect(await run.closed).toBe(fault==="size"||fault==="hash"||fault==="missing"?69:78);
    expect(existsSync(f.marker)).toBe(false);
    expect(run.stderr()).toContain("Deck Codebase guard:");
    expect(run.stderr()).not.toContain(f.root);
  } finally {await f.close();}
});

test("guard preserves bytes and backpressure through EOF without orphaning child", async()=>{
  const f=fixture("process.stdin.pipe(process.stdout);");
  try{
    const run=f.start(), chunks:Buffer[]=[];
    const bytes=Buffer.alloc(2*1024*1024);for(let i=0;i<bytes.length;i++)bytes[i]=i%251;
    run.child.stdout.pause();run.child.stdin.end(bytes);
    await new Promise(r=>setTimeout(r,100));
    run.child.stdout.on("data",c=>chunks.push(c));run.child.stdout.resume();
    expect(await run.closed).toBe(0);expect(Buffer.concat(chunks)).toEqual(bytes);
    expect(isAlive(Number(readFileSync(f.marker,"utf8")))).toBe(false);
  }finally{await f.close();}
});
for(const signal of ["SIGTERM","SIGHUP","SIGINT"] as const)test(`guard cleans owned child on ${signal}`,async()=>{
 const f=fixture("process.on('SIGTERM',()=>{});setInterval(()=>{},1000);");
 try{const run=f.start();run.child.stdout.resume();await run.ready();const pid=Number(readFileSync(f.marker,"utf8"));run.child.kill(signal);expect(await run.closed).toBe(signal==="SIGTERM"?143:signal==="SIGINT"?130:129);expect(isAlive(pid)).toBe(false);}finally{await f.close();}
},10000);
// Each lifecycle has a bounded startup (5 s), drain (2 s), kill grace (0.5 s),
// and failure cleanup (1.5 s). Do not put two such lifecycles in a default 5 s test.
for (const [name, body, code] of [
  ["EOF bounds an uncooperative child", "process.on('SIGTERM',()=>{});setInterval(()=>{},1000);", 74],
  ["natural child exit code is preserved", "process.exit(23);", 23],
] as const) test(name, async () => {
  const f = fixture(body);
  try {
    const run = f.start(); run.child.stdout.resume();
    await run.ready();
    const pid = Number(readFileSync(f.marker, "utf8"));
    if (code === 74) run.child.stdin.end();
    expect(await run.closed).toBe(code);
    expect(isAlive(pid)).toBe(false);
  } finally { await f.close(); }
}, 10000);
test("guard shape is exact, owned and nonrecursive; parser does not accept commands or release overrides",async()=>{
 const f=fixture("process.stdin.pipe(process.stdout);");try{
 expect(f.entry.env).toEqual(DECK_PI_MEMORY_ENV_BLANKS);
 expect(validateDeckPiMcpEntry(f.entry,()=>true)).toEqual([]);
 expect(inspectCodebaseGuardEntry(f.entry,f.agentDir)?.binary).toBe(f.binary);
 for(const args of [[],["--binary",f.binary], [...codebaseGuardCliArgs({agentDir:f.agentDir,binary:f.binary,executableId:f.invocation.executableId}),"--release","arbitrary"]])expect(parseCodebaseGuardArgs(args)).toBeUndefined();
 expect(()=>inspectCodebaseGuardEntry({...f.entry,args:[...f.entry.args,"--extra"]},f.agentDir)).toThrow("pi-codebase-guard-invalid");
 expect(()=>inspectCodebaseGuardEntry({...f.entry,env:{TOKEN:"secret"}},f.agentDir)).toThrow("pi-codebase-guard-invalid");
 const recursive=buildCodebaseGuardEntry(f.invocation,f.agentDir,f.invocation.command);
 expect(()=>inspectCodebaseGuardEntry(recursive,f.agentDir)).toThrow("pi-codebase-guard-invalid");
 const before=readFileSync(f.mcpPath);expect(classifyNativeCodebase({agentDir:f.agentDir,compatible:()=>true})).toMatchObject({status:"ready",guarded:true});expect(readFileSync(f.mcpPath)).toEqual(before);
 }finally{await f.close();}
});
test("post-verification replacement is detected after spawn; no claim of side-effect prevention",async()=>{
 // The seam executes between hash and path-based spawn. A child could already have executed arbitrary effects.
 const f=fixture("process.stdin.pipe(process.stdout);", "require('node:fs').appendFileSync(parsed.binary,'// drift');");
 try{const run=f.start();run.child.stdout.resume();run.child.stdin.end("must not forward");expect(await run.closed).toBe(78);expect(run.stderr()).toContain("codebase-memory-integrity-failed");}finally{await f.close();}
});


test("pre-aborted guard preserves cancellation before touching selection or spawning",async()=>{
 const controller=new AbortController();const reason=new DOMException("cancelled","AbortError");controller.abort(reason);
 await expect(runPiCodebaseGuard({agentDir:"/missing",binary:"/missing",executableId:`1:${"a".repeat(64)}`},{signal:controller.signal})).rejects.toBe(reason);
});
test("child stderr is byte exact and natural failure code is preserved",async()=>{
 const f=fixture("process.stderr.write(Buffer.from([0,255,10,13,65]),()=>process.exit(17));");
 try{const run=f.start();const chunks:Buffer[]=[];run.child.stderr.on("data",chunk=>chunks.push(chunk));run.child.stdout.resume();expect(await run.closed).toBe(17);expect(Buffer.concat(chunks)).toEqual(Buffer.from([0,255,10,13,65]));expect(isAlive(Number(readFileSync(f.marker,"utf8")))).toBe(false);}finally{await f.close();}
});


test("guard child blanks memory credentials even when invoked directly; parent environment is untouched",async()=>{
 const saved=process.env.DECK_RUNNER_MEMORY_TOKEN;process.env.DECK_RUNNER_MEMORY_TOKEN="fixture-secret";
 const f=fixture("process.stdout.write(JSON.stringify([process.env.DECK_RUNNER_MEMORY_ENDPOINT,process.env.DECK_RUNNER_MEMORY_TOKEN,process.env.DECK_RUNNER_MEMORY_TOKEN_FILE]));");
 try{const run=f.start(),chunks:Buffer[]=[];run.child.stdout.on("data",chunk=>chunks.push(chunk));expect(await run.closed).toBe(0);expect(JSON.parse(Buffer.concat(chunks).toString())).toEqual(["","",""]);expect(process.env.DECK_RUNNER_MEMORY_TOKEN).toBe("fixture-secret");expect(run.stderr()).not.toContain("fixture-secret");}finally{await f.close();if(saved===undefined)delete process.env.DECK_RUNNER_MEMORY_TOKEN;else process.env.DECK_RUNNER_MEMORY_TOKEN=saved;}
});

for (const channel of ["stdout", "stderr"] as const) test(`EOF waits for ${channel} consumer callbacks after child exit`, async () => {
 const f=fixture(`process.stdin.resume();process.stdin.on('end',()=>{let n=0;const timer=setInterval(()=>{process.${channel}.write(Buffer.alloc(65536,37));if(++n===32)clearInterval(timer);},5);});`, "", `import {Writable} from 'node:stream';let bytes=0;const sink=new Writable({write(chunk,enc,cb){setTimeout(()=>{require('node:fs').appendFileSync(parsed.agentDir+'/../received',chunk);bytes+=chunk.length;cb();},1000);}});const diagnostic=${channel === "stderr" ? "sink" : "process.stderr"};`,45000);
 try { const run=f.start();run.child.stdout.resume();run.child.stdin.end();expect(await run.closed).toBe(0);expect(JSON.parse(readFileSync(join(f.root,"result.json"),"utf8"))).toEqual({bytes:2097152,code:0});expect(readFileSync(join(f.root,"received"))).toEqual(Buffer.alloc(2097152,37)); } finally {await f.close();}
},45000);

for (const channel of ["stdout", "stderr"] as const) test(`stalled ${channel} is bounded and never reports success`, async () => {
 const f=fixture(`process.stdin.resume();process.stdin.on('end',()=>{process.${channel}.write(Buffer.alloc(2097152));});`, "", `import {Writable} from 'node:stream';let bytes=0;const sink=new Writable({write(chunk,enc,cb){/* Intentionally never acknowledge this write. */}});const diagnostic=${channel === "stderr" ? "sink" : "process.stderr"};const originalWrite=diagnostic.write.bind(diagnostic);diagnostic.write=(...args)=>{if(typeof args[0]==='string'&&args[0].includes('Deck Codebase guard:'))require('node:fs').writeFileSync(parsed.agentDir+'/../diagnostic',args[0]);return originalWrite(...args);};`);
 try {const run=f.start();run.child.stdout.resume();await run.ready();run.child.stdin.end();expect(await run.closed).toBe(74);const result=JSON.parse(readFileSync(join(f.root,"result.json"),"utf8"));expect(result.code).toBe(74);expect(result.bytes).toBe(0);expect(readFileSync(join(f.root,"diagnostic"),"utf8")).toBe("Deck Codebase guard: pi-codebase-output-drain-timeout.\n");expect(isAlive(Number(readFileSync(f.marker,"utf8")))).toBe(false);if(channel === "stdout")expect(run.stderr()).toContain("pi-codebase-output-drain-timeout");} finally {await f.close();}
},10000);

for(const cause of ["signal","drift"] as const)test(`${cause} takes priority over pending EOF drain`,async()=>{
 const f=fixture("process.stdin.resume();process.stdin.on('end',()=>{process.stdout.write(Buffer.alloc(2097152));setInterval(()=>{},1000);});", "", "import {Writable} from 'node:stream';let bytes=0;const sink=new Writable({write(c,e,cb){bytes+=c.length;require('node:fs').writeFileSync(parsed.agentDir+'/../pending','ready');}});const diagnostic=process.stderr;",10000);
 try{const run=f.start();run.child.stdout.resume();run.child.stdin.end();await run.ready("pending");if(cause==="signal")run.child.kill("SIGTERM");else writeFileSync(f.binary,f.script+"// drift");expect(await run.closed).toBe(cause==="signal"?143:78);expect(isAlive(Number(readFileSync(f.marker,"utf8")))).toBe(false);if(cause==="drift")expect(run.stderr()).toContain("Deck Codebase guard:");}finally{await f.close();}
},15000);

test("natural child exit waits for a delayed destination callback",async()=>{
 const f=fixture("process.stdout.write('final',()=>process.exit(23));", "", "import {Writable} from 'node:stream';let bytes=0;const sink=new Writable({write(c,e,cb){setTimeout(()=>{bytes+=c.length;cb();},700);}});const diagnostic=process.stderr;");
 try{const run=f.start();run.child.stdout.resume();expect(await run.closed).toBe(23);expect(JSON.parse(readFileSync(join(f.root,"result.json"),"utf8"))).toEqual({bytes:5,code:23});}finally{await f.close();}
});

for(const channel of ["stdout","stderr"] as const)test(`exited child with stalled ${channel} callback cannot report success`,async()=>{
 const f=fixture(`process.${channel}.write('final',()=>process.exit(0));`, "", `import {Writable} from 'node:stream';let bytes=0;const sink=new Writable({write(c,e,cb){bytes+=c.length;}});const diagnostic=${channel === "stderr" ? "sink" : "process.stderr"};`);
 try{const run=f.start();run.child.stdout.resume();expect(await run.closed).toBe(74);expect(JSON.parse(readFileSync(join(f.root,"result.json"),"utf8"))).toEqual({bytes:5,code:74});expect(isAlive(Number(readFileSync(f.marker,"utf8")))).toBe(false);}finally{await f.close();}
},10000);

test("EOF before fixture startup can time out without ever exercising a stalled consumer", async () => {
  const f = fixture("process.stdin.resume();", "", "", 2000, true);
  try {
    const run = f.start(); run.child.stdout.resume();
    await run.ready("booted");
    run.child.stdin.end();
    expect(await run.closed).toBe(74);
    expect(existsSync(f.marker)).toBe(false);
    expect(run.stderr()).toContain("pi-codebase-output-drain-timeout");
    expect(isAlive(Number(readFileSync(join(f.root, "booted"), "utf8")))).toBe(false);
  } finally { await f.close(); }
}, 10000);

test("stall deadline starts only after observed fixture startup, even when startup is gated", async () => {
  const f = fixture("process.stdin.resume();process.stdin.on('end',()=>process.stdout.write('final'));", "", "import {Writable} from 'node:stream';let bytes=0;const sink=new Writable({write(c,e,cb){bytes+=c.length;}});const diagnostic=process.stderr;", 2000, true);
  try {
    const run = f.start(); run.child.stdout.resume();
    await run.ready("booted");
    expect(existsSync(f.marker)).toBe(false);
    expect(run.child.stdin.writableEnded).toBe(false);
    const ready = run.ready();
    writeFileSync(join(f.root, "release"), "ready");
    await ready;
    expect(existsSync(f.marker)).toBe(true);
    run.child.stdin.end();
    expect(await run.closed).toBe(74);
    expect(JSON.parse(readFileSync(join(f.root, "result.json"), "utf8"))).toEqual({bytes:5,code:74});
    expect(isAlive(Number(readFileSync(f.marker, "utf8")))).toBe(false);
  } finally { await f.close(); }
}, 10000);
