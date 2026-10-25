import { writeExplicitCodebaseConfig } from "../../__fixtures__/explicit-codebase";
import { beforeEach, afterEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createEmptyPiManifest, hashJsonValue } from "../../pi-manifest";
import { createReviewedPiMcp, installReviewedPiMcp } from "./native-mcp";
import { classifyNativeCodebase } from "../../pi-native-codebase-readiness";
import { loadMcpConfig } from "./native-config.pinned";
import { renderPiNativeConfig } from "../../../../../scripts/generate-pi-native-config";

// These ownership/integrity cases require explicit activation; absence has separate coverage.
let intentHome: string;
let savedIntentEnvironment: { HOME?: string; XDG_CONFIG_HOME?: string };
beforeEach(() => {
  savedIntentEnvironment = { HOME: process.env.HOME, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME };
  intentHome = mkdtempSync(join(tmpdir(), 'deck-native-mcp-intent-'));
  process.env.HOME = intentHome;
  process.env.XDG_CONFIG_HOME = join(intentHome, '.config');
  writeExplicitCodebaseConfig(intentHome);
});
afterEach(() => {
  for (const [key, value] of Object.entries(savedIntentEnvironment)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  rmSync(intentHome, { recursive: true, force: true });
});

test("generated read-only loader matches the installed pinned native contract", async () => {
  const sdk = dirname(import.meta.resolve("@earendil-works/pi-coding-agent").replace("file://", ""));
  const native = await import(join(sdk, "extensions/mcp/config.js"));
  expect(readFileSync(join(import.meta.dir, "native-config.pinned.ts"), "utf8")).toBe(renderPiNativeConfig());
  const root = mkdtempSync(join(tmpdir(), "deck-pi-config-contract-"));
  const cwd = join(root, "project");
  mkdirSync(join(cwd, ".pi"), { recursive: true });
  try {
    for (const [global, project] of [
      [{ mcpServers: { "codebase-memory": { command: "/shared", exposure: "direct" } } }, { mcpServers: { "codebase-memory": { command: "/project", exposure: "codemode-deferred" } } }],
      [{ autoEnableCodemode: false, mcpServers: { custom: { url: "https://example.invalid/mcp", oauth: { callbackPort: 1234 }, exposure: "deferred", toolExposure: { "get_*": "direct" } } } }, { autoEnableCodemode: true }],
      [{ mcpServers: { "foo-bar": { command: "/foo" }, "foo_bar": { command: "/collision" }, invalid: { exposure: "invented", command: "/bad" } } }, { mcpServers: { auth: { url: "https://example.invalid", auth: { provider: "secret" } } } }],
      [{ mcpServers: { disabled: { command: "/disabled", enabled: false }, stdio: { command: "/safe", args: ["literal"], env: { TOKEN: "${TOKEN}" }, cwd: "/work", timeout: 2 } } }, { mcpServers: [] }],
      ["not an object", { autoEnableCodemode: "bad" }],
    ]) {
      writeFileSync(join(root, "mcp.json"), JSON.stringify(global));
      writeFileSync(join(cwd, ".pi/mcp.json"), JSON.stringify(project));
      for (const projectTrusted of [false, true]) {
        const input = { agentDir: root, cwd, projectTrusted };
        expect(loadMcpConfig(input)).toEqual(native.loadMcpConfig(input));
      }
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("effective filter preserves project trust, disabled entries, custom ownership and persistent bytes", () => {
  const root = mkdtempSync(join(tmpdir(), "deck-pi-effective-mcp-"));
  const cwd = join(root, "project");
  mkdirSync(join(root, "deck"));
  mkdirSync(join(cwd, ".pi"), { recursive: true });
  const entry = { command: "/rejected", args: [], exposure: "direct" as const };
  const manifest = createEmptyPiManifest();
  manifest.mcp.servers["codebase-memory"] = hashJsonValue(entry);
  const globalPath = join(root, "mcp.json"), projectPath = join(cwd, ".pi/mcp.json");
  writeFileSync(globalPath, JSON.stringify({ autoEnableCodemode: false, mcpServers: { "codebase-memory": entry, personal: { command: "/personal" } } }));
  writeFileSync(join(root, "deck/manifest.json"), JSON.stringify(manifest));
  writeFileSync(projectPath, JSON.stringify({ mcpServers: { "codebase-memory": { command: "/custom-project", exposure: "direct" } } }));
  const globalBytes = readFileSync(globalPath), projectBytes = readFileSync(projectPath);
  let trusted = false;
  let ready = false;
  const checked: string[] = [];
  const gate = createReviewedPiMcp({ agentDir: root, compatible: command => { checked.push(command); return ready; } });
  const controller = new AbortController();
  const ctx = { cwd, isProjectTrusted: () => trusted, signal: controller.signal } as never;
  try {
    expect(gate.loadConfig(ctx).servers.map(s => s.name)).toEqual(["personal"]);
    expect(gate.status()).toBe("unavailable");
    trusted = true;
    expect(gate.loadConfig(ctx).servers.find(s => s.name === "codebase-memory")?.config).toMatchObject({ command: "/custom-project" });
    expect(gate.status()).toBe("custom");
    expect(checked).toEqual(["/rejected"]);
    trusted = false;
    ready = true;
    expect(gate.loadConfig(ctx).servers.find(s => s.name === "codebase-memory")).toBeUndefined();
    expect(gate.status()).toBe("blocked");
    expect(gate.protectedDiagnostic(ctx)).toContain("pi-codebase-guard-invalid");
    expect(readFileSync(globalPath)).toEqual(globalBytes);
    expect(readFileSync(projectPath)).toEqual(projectBytes);
    // User modification relinquishes Deck ownership even if the old manifest still names the server.
    writeFileSync(globalPath, JSON.stringify({ mcpServers: { "codebase-memory": { ...entry, command: "/custom-global" } } }));
    ready = false;
    expect(gate.loadConfig(ctx).servers[0]?.config).toMatchObject({ command: "/custom-global" });
    expect(gate.status()).toBe("custom");
    controller.abort(new DOMException("cancelled", "AbortError"));
    expect(() => gate.loadConfig(ctx)).toThrow(controller.signal.reason);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("verification and invalid ownership failures are never optional availability", () => {
  const root = mkdtempSync(join(tmpdir(), "deck-pi-protected-mcp-"));
  mkdirSync(join(root, "deck"));
  const entry = { command: "/tool", exposure: "direct" as const };
  const manifest = createEmptyPiManifest();
  manifest.mcp.servers["codebase-memory"] = hashJsonValue(entry);
  writeFileSync(join(root, "mcp.json"), JSON.stringify({ mcpServers: { "codebase-memory": entry } }));
  writeFileSync(join(root, "deck/manifest.json"), JSON.stringify(manifest));
  const ctx = { cwd: root, isProjectTrusted: () => false, signal: new AbortController().signal } as never;
  try {
    for (const error of [new DOMException("cancelled", "AbortError"), Object.assign(new Error("denied"), { code: "EACCES" }), new Error("codebase-memory-integrity-failed")]) {
      const gate = createReviewedPiMcp({ agentDir: root, compatible: () => { throw error; } });
      expect(() => classifyNativeCodebase({ agentDir: root, compatible: () => { throw error; } })).toThrow(error);
      if (error.name === "AbortError") {
        expect(() => gate.loadConfig(ctx)).toThrow(error);
      } else {
        expect(gate.loadConfig(ctx).servers).toEqual([]);
        expect(gate.status()).toBe("blocked");
        expect(gate.protectedDiagnostic(ctx)).toContain(error.message === "denied" ? "pi-codebase-control-failed" : error.message);
      }
    }
    const ownedRoot = join(root, "codebase-native-v0.11.0", `${process.platform}-${process.arch}`);
    mkdirSync(ownedRoot, { recursive: true, mode: 0o700 });
    const ownedCommand = join(ownedRoot, "codebase-memory-mcp");
    writeFileSync(ownedCommand, "corrupt", { mode: 0o700 });
    const ownedEntry = { ...entry, command: ownedCommand };
    manifest.mcp.servers["codebase-memory"] = hashJsonValue(ownedEntry);
    writeFileSync(join(root, "mcp.json"), JSON.stringify({ mcpServers: { "codebase-memory": ownedEntry } }));
    writeFileSync(join(root, "deck/manifest.json"), JSON.stringify(manifest));
    expect(() => classifyNativeCodebase({ agentDir: root })).toThrow("codebase-memory-integrity-failed");
    const gate = createReviewedPiMcp({ agentDir: root });
    expect(gate.loadConfig(ctx).servers).toEqual([]);
    expect(gate.toolBlock(ctx)).toContain("codebase-memory-integrity-failed");
    writeFileSync(join(root, "deck/manifest.json"), "x".repeat(1024 * 1024 + 1));
    expect(() => classifyNativeCodebase({ agentDir: root })).toThrow("pi-codebase-ownership-invalid");
    expect(gate.loadConfig(ctx).servers).toEqual([]);
    expect(gate.protectedDiagnostic(ctx)).toContain("pi-codebase-ownership-invalid");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

 test("omitting an owned selection never promotes a registered namespace it previously overrode", () => {
   const root = mkdtempSync(join(tmpdir(), "deck-pi-native-registered-"));
   mkdirSync(join(root, "deck"));
   const entry = { command: "/rejected", exposure: "direct" as const };
   const manifest = createEmptyPiManifest(); manifest.mcp.servers["codebase-memory"] = hashJsonValue(entry);
   writeFileSync(join(root, "mcp.json"), JSON.stringify({ mcpServers: { "codebase-memory": entry } }));
   writeFileSync(join(root, "deck/manifest.json"), JSON.stringify(manifest));
   const registered = [{ name: "codebase_memory", config: { command: "/custom" } }, { name: "personal", config: { command: "/personal" } }];
   const ctx = { cwd: root, isProjectTrusted: () => false, signal: new AbortController().signal } as never;
   try {
     const api = { on() {}, getMcpServers: () => registered };
     installReviewedPiMcp(api as never, { getAgentDir: () => root, createMcpExtension: options => proxied => {
       expect(options?.loadConfig?.(ctx).servers).toEqual([]);
       expect(proxied.getMcpServers().map(server => server.name)).toEqual(["personal"]);
     } }, { compatible: () => false });
     expect(api.getMcpServers()).toBe(registered);
   } finally { rmSync(root, { recursive: true, force: true }); }
 });

 test("an existing extension registration stays custom when no Deck selection overrides it", () => {
   const root = mkdtempSync(join(tmpdir(), "deck-pi-existing-registration-"));
   try {
     const registered = [{ name: "codebase-memory", config: { command: "/personal" }, extensionPath: "/personal-extension" }];
     const pi = { on() {}, getMcpServers: () => registered };
     const reviewed = installReviewedPiMcp(pi as never, { getAgentDir: () => root, createMcpExtension: options => () => {
       options?.loadConfig?.({ cwd: root, isProjectTrusted: () => false } as never);
     } });
     expect(reviewed.status()).toBe("custom");
     expect(pi.getMcpServers()).toBe(registered);
   } finally { rmSync(root, { recursive: true, force: true }); }
 });

test('search preparation observes the native connector first-prompt readiness barrier',async()=>{
 const home=mkdtempSync(join(tmpdir(),'deck-search-order-'));const saved={HOME:process.env.HOME,XDG_CONFIG_HOME:process.env.XDG_CONFIG_HOME};
 try{
  process.env.HOME=home;process.env.XDG_CONFIG_HOME=join(home,'.config');mkdirSync(join(home,'.config/deck'),{recursive:true});writeFileSync(join(home,'.config/deck/config.json'),JSON.stringify({webSearch:{enabled:true,provider:'tavily'}}));
  const handlers:Record<string,Function[]>={};let tools:any[]=[];
  const pi={on:(name:string,handler:Function)=>(handlers[name]??=[]).push(handler),getActiveTools:()=>tools.map(t=>t.name),getAllTools:()=>tools,getMcpServers:()=>[],setActiveTools:()=>{}};
  installReviewedPiMcp(pi as never,{getAgentDir:()=>join(home,'.pi/agent'),createMcpExtension:()=>native=>{native.on('before_agent_start',async()=>{await Promise.resolve();tools=[{name:'mcp__web_search__tavily_search'}];});}});
  for(const handler of handlers.before_agent_start)await handler({systemPrompt:'Prompt'},{ui:{setStatus(){}}});
  expect(tools).toHaveLength(1);
 }finally{for(const[key,value]of Object.entries(saved)){if(value===undefined)delete process.env[key];else process.env[key]=value;}rmSync(home,{recursive:true,force:true});}
});
