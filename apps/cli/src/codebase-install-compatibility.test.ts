import { afterEach, expect, spyOn, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { gzipSync } from "node:zlib";
import { getDefaultDeckConfig } from "@deck/core";
import { createCodexTools } from "../../../packages/adapter-codex/src/tools";
import { createPiTools } from "../../../packages/adapter-pi/src/pi-owned-tools";
import { createClaudeRunnerAdapter } from "../../../packages/adapter-claude/src/runner-adapter";
import { createOpenCodeCodebaseTools } from "../../../packages/adapter-opencode/src/codebase-tools";
import { installOpenCodeTools } from "../../../packages/adapter-opencode/src/install-tools";
import { OPENCODE_INSTALLABLE_TOOLS } from "../../../packages/adapter-opencode/src/installation-plan";
import { createOpenCodeEvidenceContext, resolveOpenCodeInstalledEvidence } from "../../../packages/adapter-opencode/src/required-tools";
import { writeOpenCodeMcpConfig } from "../../../packages/adapter-opencode/src/opencode-mcp-config";

// Availability is opt-in; executable presence alone is not activation authority.
function codebaseConfig() {
  const config=getDefaultDeckConfig();
  config.capabilities={...config.capabilities,'codebase-memory':{enabled:true,runners:{}}};
  return config;
}
function seedOwnedOpenCode(path:string, home:string, config:any) {
  const entry=config.mcp['codebase-memory'];
  const other={...config.mcp};delete other['codebase-memory'];
  writeFileSync(path,JSON.stringify({...config,mcp:other}));
  expect(writeOpenCodeMcpConfig({configPath:path,homeDir:home,serverName:'codebase-memory',type:'local',command:entry.command}).ok).toBe(true);
}

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const sha = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const binary = "#!/bin/sh\nprintf 'codebase-memory-mcp 0.11.0\\n'\n# build A\n";
function fixture() {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "deck-all-codebase-"))); roots.push(home);
  const shared = join(home, ".local", "bin", "codebase-memory-mcp"); mkdirSync(dirname(shared), { recursive: true });
  writeFileSync(shared, binary.replace("build A", "build B"), { mode: 0o700 });
  const version = Bun.spawnSync([shared, "--version"], { stdout: "pipe", stderr: "pipe" });
  expect(version.exitCode).toBe(0); expect(version.stdout.toString().trim()).toBe("codebase-memory-mcp 0.11.0");
  const members = ["codebase-memory-mcp", "LICENSE", "install.sh", "THIRD_PARTY_NOTICES.md"].map((name) => {
    const body = Buffer.from(name === "codebase-memory-mcp" ? binary : "fixture");
    const header = Buffer.alloc(512); header.write(name); header.write(body.length.toString(8).padStart(11, "0"), 124); header[156] = 48;
    return Buffer.concat([header, body, Buffer.alloc((512 - body.length % 512) % 512)]);
  });
  const archive = gzipSync(Buffer.concat([...members, Buffer.alloc(1024)]));
  const release = { asset: "fixture.tar.gz", archiveBytes: archive.length, archiveSha256: sha(archive), binaryBytes: Buffer.byteLength(binary), binarySha256: sha(binary) };
  let downloads = 0;
  const effects = { fetchArchive: async () => { downloads++; return archive; } };
  return { home, shared, release, effects, downloads: () => downloads, dataRoot: join(home, "data", "deck"), resolveCommand: (name: string) => name === "codebase-memory-mcp" ? shared : undefined };
}

for (const runner of ["codex", "pi", "opencode"] as const) {
  test(`${runner}: same-version wrong bytes use reviewed owned fallback without changing shared installation`, async () => {
    const f = fixture();
    const toolOptions = { homeDir: f.home, dataRoot: f.dataRoot, resolveCommand: f.resolveCommand, codebaseReleaseOverride: f.release, codebaseArtifactEffects: f.effects, verifyCodebaseNative: () => true };
    const tools = runner === "opencode" ? createOpenCodeCodebaseTools({ homeDirectory: f.home, dataRoot: f.dataRoot, resolveCommand: f.resolveCommand, release: f.release, artifactEffects: f.effects })
      : runner === "pi" ? createPiTools(toolOptions).codebase : createCodexTools({ ...toolOptions, nodeCommand: process.execPath, verifyNodeRuntime: () => true }).codebase;
    const before = readFileSync(f.shared);
    expect(tools.existing()).toBeUndefined(); expect(tools.command()).toBeUndefined(); expect(f.downloads()).toBe(0);
    expect(await tools.install()).toBe("installed");
    expect(tools.command()).toContain(`/codebase-native-v0.11.0/${process.platform}-${process.arch}/codebase-memory-mcp`);
    expect(readFileSync(tools.command()!, "utf8")).toBe(binary);
    expect(readFileSync(f.shared)).toEqual(before); expect(f.downloads()).toBe(1);
    expect(await tools.install()).toBe("unchanged"); expect(f.downloads()).toBe(1);
    writeFileSync(f.shared, binary); chmodSync(f.shared, 0o700);
    expect(tools.existing()).toBe(f.shared); expect(tools.command()).toBe(f.shared); expect(f.downloads()).toBe(1);
  });
}

test("Claude: reviewed owned install rematerializes plugin config while preserving old plugin and shared bytes", async () => {
  const f = fixture(); writeFileSync(f.shared, binary);
  const adapter = createClaudeRunnerAdapter({ homeDir: f.home, dataRoot: f.dataRoot, resolveCommand: f.resolveCommand, codebaseReleaseOverride: f.release, codebaseArtifactEffects: f.effects, verifyCodebaseNative: () => true });
  const input = { projectRoot: f.home, environmentId: "claude-development" as const, deckConfig: codebaseConfig(), capabilityIds: ["claude-team-files", "codebase-memory"] };
  const original = adapter.buildDeveloperTeamInstallPlan(input);
  expect(original.blocked).toBe(false);
  expect(original.files.find(file => file.path.endsWith("/.mcp.json"))?.content).toContain(f.shared);
  await adapter.applyDeveloperTeamInstall({ projectRoot: f.home, environmentId: "claude-development", plan: original });
  writeFileSync(f.shared, binary.replace("build A", "build B")); const before = readFileSync(f.shared);
  const result = await adapter.runAction!({ id: "claude.tool.codebase-memory.install", kind: "install-claude-codebase", capabilityId: "codebase-memory", title: "Install reviewed fixture", status: "ready" }, { projectRoot: f.home, runnerId: "claude", environmentId: "claude-development" });
  expect(result.status).toBe("executed"); expect(f.downloads()).toBe(1);
  const repaired = adapter.buildDeveloperTeamInstallPlan(input);
  expect(repaired.blocked).toBe(false);
  expect(repaired.files.find(file => file.path.endsWith("/.mcp.json"))?.content).toContain("codebase-native-v0.11.0");
  await adapter.applyDeveloperTeamInstall({ projectRoot: f.home, environmentId: "claude-development", plan: repaired });
  expect((await adapter.readSessionMcpServers(codebaseConfig()))["codebase-memory"]).toMatchObject({ command: expect.stringContaining("codebase-native-v0.11.0") });
  expect(readFileSync(f.shared)).toEqual(before);
  expect(readFileSync(original.files.find(file => file.path.endsWith("/.mcp.json"))!.path, "utf8")).toContain(f.shared);
});

test("OpenCode reviewed installer bypasses legacy existence evidence and never invokes shell/npm/provider effects", async () => {
  const f = fixture();
  const tools = createOpenCodeCodebaseTools({ homeDirectory: f.home, dataRoot: f.dataRoot, resolveCommand: f.resolveCommand, release: f.release, artifactEffects: f.effects });
  const context = { ...createOpenCodeEvidenceContext({ homeDirectory: f.home, projectRoot: f.home, environment: { HOME: f.home, PATH: "" } }), codebaseTools: tools };
  expect(resolveOpenCodeInstalledEvidence("codebase-memory", context).state).toBe("absent");
  const forbidden = () => { throw new Error("unexpected external effect"); };
  const [result] = await installOpenCodeTools("opencode", [OPENCODE_INSTALLABLE_TOOLS.find(tool => tool.id === "codebase-memory")!], () => {}, forbidden, { evidenceContext: context, downloadScript: forbidden, runShellScript: forbidden });
  expect(result?.outcome).toBe("executed"); expect(resolveOpenCodeInstalledEvidence("codebase-memory", context).state).toBe("usable");
  const configPath = join(f.home, "opencode.json");
  seedOwnedOpenCode(configPath, f.home, { model: "custom-model", mcp: { custom: { type: "remote", url: "https://example.test" }, "codebase-memory": { type: "local", command: [f.shared], enabled: true } } });
  expect(writeOpenCodeMcpConfig({ configPath, homeDir: f.home, serverName: "codebase-memory", type: "local", command: [tools.command()!] }).ok).toBe(true);
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  expect(config.model).toBe("custom-model"); expect(config.mcp.custom.url).toBe("https://example.test"); expect(config.mcp["codebase-memory"].command).toEqual([tools.command()]);
  expect(existsSync(f.shared)).toBe(true);
});

test("Codex rematerializes a stale standard command and preserves custom wrappers and unrelated config", async () => {
  const { buildCodexMcpServers, mergeCodexMcpServers } = await import("../../../packages/adapter-codex/src/mcp-config");
  const f = fixture();
  const tools = createCodexTools({ homeDir: f.home, dataRoot: f.dataRoot, resolveCommand: f.resolveCommand, codebaseReleaseOverride: f.release, codebaseArtifactEffects: f.effects, verifyCodebaseNative: () => true, nodeCommand: process.execPath, verifyNodeRuntime: () => true });
  await tools.codebase.install();
  const configPath = join(f.home, "config.toml");
  const unowned = `# personal\nmodel = "custom"\n[mcp_servers.codebase-memory]\ncommand = ${JSON.stringify(f.shared)}\n[mcp_servers.other]\ncommand = "custom"\n`;
  const original = mergeCodexMcpServers('# personal\nmodel = "custom"\n[mcp_servers.other]\ncommand = "custom"\n', buildCodexMcpServers({packageIds:['codebase-memory'],memoryProvider:'none',codebaseMemoryCommand:f.shared}).servers).content;
  writeFileSync(configPath, original);
  const desired = buildCodexMcpServers({ packageIds: ["codebase-memory"], memoryProvider: "none", codebaseMemoryCommand: tools.codebase.command() }).servers;
  expect(mergeCodexMcpServers(unowned, desired, {repairSelectedToolIds:['codebase-memory']})).toMatchObject({status:'blocked',content:unowned});
  const merged = mergeCodexMcpServers(readFileSync(configPath, "utf8"), desired, { repairSelectedToolIds: ["codebase-memory"], ownedServerIds: ["codebase-memory"] });
  expect(merged.status).toBe("updated"); writeFileSync(configPath, merged.content);
  expect(readFileSync(configPath, "utf8")).toContain(tools.codebase.command()!);
  expect(merged.content).toContain('model = "custom"'); expect(merged.content).toContain('[mcp_servers.other]\ncommand = "custom"');
  const custom = unowned.replace(JSON.stringify(f.shared), '"my-wrapper"');
  expect(mergeCodexMcpServers(custom, desired, { repairSelectedToolIds: ["codebase-memory"], ownedServerIds: ["codebase-memory"] })).toMatchObject({ status: "blocked", content: custom });
});

test("Pi rematerializes manifest-owned stale command and refuses user-modified entries", async () => {
  const { resolveDeckPiMcpServers } = await import("../../../packages/adapter-pi/src/pi-deck-mcp");
  const { planPiGlobalInstall, applyPiGlobalPlan, createNodePiFileIO } = await import("../../../packages/adapter-pi/src/pi-global-install");
  const f = fixture(); writeFileSync(f.shared, binary);
  const tools = createPiTools({ homeDir: f.home, dataRoot: f.dataRoot, resolveCommand: f.resolveCommand, codebaseReleaseOverride: f.release, codebaseArtifactEffects: f.effects, verifyCodebaseNative: () => true });
  const agentDir = join(f.home, "agent"), io = createNodePiFileIO();
  const desired = () => ({ agentDir, files: [{ relPath: "deck/package/package.json", content: '{"name":"deck-pi"}\n' }], packageEntry: "deck/package", skillExclusions: [], legacyDeckEvidence: false, mcpServers: resolveDeckPiMcpServers({ selected: ["codebase-memory"], tools, webSearchProvider: undefined, existingServers: {}, ownedServerNames: ["codebase-memory"] }).servers });
  const first = planPiGlobalInstall(desired(), io); expect(first.blocked).toBe(false); applyPiGlobalPlan(first, io);
  const configPath = join(agentDir, "mcp.json"); expect(readFileSync(configPath, "utf8")).toContain(f.shared);
  writeFileSync(f.shared, binary.replace("build A", "build B")); await tools.codebase.install();
  const repaired = planPiGlobalInstall(desired(), io); expect(repaired.blocked).toBe(false); applyPiGlobalPlan(repaired, io);
  expect(readFileSync(configPath, "utf8")).toContain(tools.codebase.command()!);
  const custom = JSON.parse(readFileSync(configPath, "utf8")); custom.mcpServers["codebase-memory"].args = ["--custom"];
  writeFileSync(configPath, JSON.stringify(custom)); const before = readFileSync(configPath, "utf8");
  expect(planPiGlobalInstall(desired(), io).blocked).toBe(true); expect(readFileSync(configPath, "utf8")).toBe(before);
});

test("OpenCode production actions rematerialize stale config and preserve custom configuration", async () => {
  const { createOpenCodeRunnerAdapter } = await import("../../../packages/adapter-opencode/src/runner-adapter");
  const f = fixture();
  const tools = createOpenCodeCodebaseTools({ homeDirectory: f.home, dataRoot: f.dataRoot, resolveCommand: f.resolveCommand, release: f.release, artifactEffects: f.effects });
  const evidence = { ...createOpenCodeEvidenceContext({ homeDirectory: f.home, projectRoot: f.home, environment: { HOME: f.home, PATH: "" } }), codebaseTools: tools };
  const adapter = createOpenCodeRunnerAdapter({ developerTeamConfigDir: f.home, evidenceContext: () => evidence });
  const context = { projectRoot: f.home, runnerId: "opencode" as const, environmentId: "opencode-development" as const };
  const action = { id: "fixture.install", kind: "install-opencode-plugin", title: "Install reviewed fixture", toolId: "codebase-memory", capabilityId: "codebase-memory", status: "ready" as const };
  expect((await adapter.runAction!(action, context)).status).toBe("executed");
  const configPath = join(f.home, "opencode.json");
  seedOwnedOpenCode(configPath, f.home, { model: "custom", mcp: { "codebase-memory": { type: "local", command: [f.shared], enabled: true }, custom: { type: "remote", url: "https://example.test" } } });
  expect((await adapter.runAction!({ ...action, id: "fixture.config", kind: "write-mcp-config" }, context)).status).toBe("executed");
  const config = JSON.parse(readFileSync(configPath, "utf8")); expect(config.mcp["codebase-memory"].command).toEqual([tools.command()]); expect(config.model).toBe("custom");
  config.mcp["codebase-memory"].command = ["custom-wrapper", "--custom"];
  writeFileSync(configPath, JSON.stringify(config)); const before = readFileSync(configPath, "utf8");
  expect((await adapter.runAction!({ ...action, id: "fixture.custom", kind: "write-mcp-config" }, context)).status).toBe("failed");
  expect(readFileSync(configPath, "utf8")).toBe(before);
});

test("OpenCode cancellation and archive integrity failure never publish an owned executable", async () => {
  const f = fixture();
  const tools = createOpenCodeCodebaseTools({ homeDirectory: f.home, dataRoot: f.dataRoot, resolveCommand: f.resolveCommand, release: f.release, artifactEffects: f.effects });
  const cancelled = new AbortController(); cancelled.abort();
  const [result] = await installOpenCodeTools("opencode", [OPENCODE_INSTALLABLE_TOOLS.find(tool => tool.id === "codebase-memory")!], () => {}, () => { throw new Error("unexpected external effect"); }, { codebaseTools: tools, signal: cancelled.signal });
  expect(result?.outcome).toBe("skipped"); expect(f.downloads()).toBe(0); expect(existsSync(tools.root)).toBe(false);
  const corrupt = createOpenCodeCodebaseTools({ homeDirectory: f.home, dataRoot: f.dataRoot, resolveCommand: f.resolveCommand, release: f.release, artifactEffects: { fetchArchive: async () => new Uint8Array(f.release.archiveBytes) } });
  await expect(corrupt.install()).rejects.toThrow("integrity mismatch"); expect(existsSync(corrupt.root)).toBe(false);
});

test("OpenCode reviewed config migrates an exact PATH candidate and preserves malformed maps", async () => {
  const f = fixture(); const configPath = join(f.home, "opencode.json");
  const previous = join(f.home, "path-bin", "codebase-memory-mcp");
  const next = join(f.dataRoot, "opencode", "tools", "codebase-native-v0.11.0", "codebase-memory-mcp");
  seedOwnedOpenCode(configPath, f.home, { mcp: { "codebase-memory": { type: "local", command: [previous], enabled: true } } });
  expect(writeOpenCodeMcpConfig({ configPath, homeDir: f.home, serverName: "codebase-memory", type: "local", command: [next], codebasePreviousCommands: [previous] }).ok).toBe(true);
  expect(JSON.parse(readFileSync(configPath, "utf8")).mcp["codebase-memory"].command).toEqual([next]);
  writeFileSync(configPath, '{"mcp":[]}'); const before = readFileSync(configPath, "utf8");
  expect(writeOpenCodeMcpConfig({ configPath, serverName: "codebase-memory", type: "local", command: [next] }).ok).toBe(false);
  expect(readFileSync(configPath, "utf8")).toBe(before);
});

for (const phase of ["before action", "during acquisition"] as const) {
  test(`OpenCode production cancellation ${phase} never publishes or reports executed`, async () => {
    const { createOpenCodeRunnerAdapter } = await import("../../../packages/adapter-opencode/src/runner-adapter");
    const { readdirSync } = await import("node:fs");
    const f = fixture(), controller = new AbortController(); let receivedSignal: AbortSignal | undefined;
    const tools = createOpenCodeCodebaseTools({
      homeDirectory: f.home, dataRoot: f.dataRoot, resolveCommand: f.resolveCommand, release: f.release,
      artifactEffects: { fetchArchive: async (_asset: string, signal?: AbortSignal) => {
        receivedSignal = signal;
        const archive = await f.effects.fetchArchive();
        controller.abort();
        return archive;
      } },
    });
    const evidence = { ...createOpenCodeEvidenceContext({ homeDirectory: f.home, projectRoot: f.home, environment: { HOME: f.home, PATH: "" } }), codebaseTools: tools };
    const adapter = createOpenCodeRunnerAdapter({ developerTeamConfigDir: f.home, evidenceContext: () => evidence });
    const configPath = join(f.home, "opencode.json");
    writeFileSync(configPath, JSON.stringify({ mcp: { "codebase-memory": { type: "local", command: ["custom-wrapper"] } } }));
    const configBefore = readFileSync(configPath), sharedBefore = readFileSync(f.shared);
    if (phase === "before action") controller.abort();
    const result = await adapter.runAction!({ id: "cancel.install", kind: "install-opencode-plugin", title: "Install reviewed fixture", toolId: "codebase-memory", capabilityId: "codebase-memory", status: "ready" }, { projectRoot: f.home, runnerId: "opencode", environmentId: "opencode-development", signal: controller.signal });
    expect(result.status).toBe("skipped");
    expect(result.message.toLowerCase()).toContain("cancel");
    expect(f.downloads()).toBe(phase === "before action" ? 0 : 1);
    if (phase === "during acquisition") expect(receivedSignal).toBe(controller.signal);
    expect(existsSync(tools.root)).toBe(false);
    const parent = dirname(tools.root);
    expect(existsSync(parent) ? readdirSync(parent).filter(name => name.startsWith(".codebase-native-stage-")) : []).toEqual([]);
    expect(readFileSync(configPath)).toEqual(configBefore); expect(readFileSync(f.shared)).toEqual(sharedBefore);
  });
}

test("OpenCode cancellation after staging allocation drains the owned temporary directory", async () => {
  const fs = await import("node:fs/promises"), { readdirSync } = await import("node:fs");
  const f = fixture(), controller = new AbortController();
  const tools = createOpenCodeCodebaseTools({ homeDirectory: f.home, dataRoot: f.dataRoot, resolveCommand: f.resolveCommand, release: f.release, artifactEffects: f.effects });
  const original = fs.mkdtemp;
  const allocate = spyOn(fs, "mkdtemp").mockImplementation((async (prefix: string, options?: Parameters<typeof fs.mkdtemp>[1]) => {
    const stage = await original(prefix, options);
    if (String(prefix).startsWith(join(dirname(tools.root), ".codebase-native-stage-"))) controller.abort();
    return stage;
  }) as typeof fs.mkdtemp);
  try {
    await expect(tools.install(controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(existsSync(tools.root)).toBe(false); expect(readdirSync(dirname(tools.root))).toEqual([]);
  } finally { allocate.mockRestore(); }
});

test.each(["empty", "extra file", "replaced executable"] as const)("OpenCode cancellation during native publication preserves concurrent %s state", async (state) => {
  const fs = await import("node:fs/promises"), { readdirSync } = await import("node:fs");
  const f = fixture(), controller = new AbortController();
  const tools = createOpenCodeCodebaseTools({ homeDirectory: f.home, dataRoot: f.dataRoot, resolveCommand: f.resolveCommand, release: f.release, artifactEffects: f.effects });
  const originalLink = fs.link;
  let published = false;
  const publish = spyOn(fs, "link").mockImplementation(async (source, destination) => {
    await originalLink(source, destination);
    if (destination === join(tools.root, "codebase-memory-mcp")) {
      published = true;
      if (state === "extra file") writeFileSync(join(tools.root, "custom"), "user content");
      if (state === "replaced executable") { rmSync(destination); writeFileSync(destination, "user replacement"); }
      controller.abort();
    }
  });
  const before = readFileSync(f.shared);
  try {
    await expect(tools.install(controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(published).toBe(true);
    if (state === "empty") { expect(existsSync(tools.root)).toBe(false); expect(readdirSync(dirname(tools.root))).toEqual([]); }
    else {
      const name = state === "extra file" ? "custom" : "codebase-memory-mcp";
      expect(readdirSync(tools.root)).toEqual([name]);
      expect(readFileSync(join(tools.root, name), "utf8")).toBe(state === "extra file" ? "user content" : "user replacement");
      expect(readdirSync(dirname(tools.root))).toEqual([tools.root.split("/").at(-1)!]);
    }
    expect(readFileSync(f.shared)).toEqual(before);
  } finally { publish.mockRestore(); }
});

test("OpenCode does not classify an unrelated acquisition failure as cancellation", async () => {
  const f = fixture(), controller = new AbortController();
  const tools = createOpenCodeCodebaseTools({ homeDirectory: f.home, dataRoot: f.dataRoot, resolveCommand: f.resolveCommand, release: f.release, artifactEffects: { fetchArchive: async () => {
    controller.abort(); throw Object.assign(new Error("permission denied"), { code: "EACCES" });
  } } });
  const [result] = await installOpenCodeTools("opencode", [OPENCODE_INSTALLABLE_TOOLS.find(tool => tool.id === "codebase-memory")!], () => {}, () => { throw new Error("unexpected external effect"); }, { codebaseTools: tools, signal: controller.signal });
  expect(result?.outcome).toBe("failed"); expect(result?.diagnostic?.code).toBe("codebase-native-install-failed");
  expect(existsSync(tools.root)).toBe(false);
});

for (const runner of ["claude", "codex", "opencode"] as const) {
  test(`${runner} real adapter admits stale optional shared tooling to managed readiness without config writes`, async () => {
    const { resolveSessionChildMcp } = await import("./session-shared-services");
    const { SessionCodebaseReadiness } = await import("./session-codebase-readiness");
    const f = fixture(); let adapter: import("@deck/core").RunnerAdapter, configPath: string;
    if (runner === "claude") {
      writeFileSync(f.shared, binary);
      const claude = createClaudeRunnerAdapter({homeDir:f.home,dataRoot:f.dataRoot,resolveCommand:f.resolveCommand,codebaseReleaseOverride:f.release});
      const plan=claude.buildDeveloperTeamInstallPlan({projectRoot:f.home,environmentId:"claude-development",deckConfig:codebaseConfig(),capabilityIds:["claude-team-files","codebase-memory"]});
      await claude.applyDeveloperTeamInstall({projectRoot:f.home,environmentId:"claude-development",plan});
      configPath=plan.files.find(file=>file.path.endsWith("/.mcp.json"))!.path; adapter=claude;
      writeFileSync(f.shared,binary.replace("build A","build B"));
    } else if (runner === "codex") {
      const {createCodexRunnerAdapter}=await import("../../../packages/adapter-codex/src/runner-adapter");
      const {buildCodexMcpServers,mergeCodexMcpServers}=await import("../../../packages/adapter-codex/src/mcp-config");
      const codexHome=join(f.home,".codex");mkdirSync(codexHome,{mode:0o700}); configPath=join(codexHome,"config.toml");
      writeFileSync(configPath,mergeCodexMcpServers("",buildCodexMcpServers({packageIds:["codebase-memory"],memoryProvider:"none",codebaseMemoryCommand:f.shared}).servers).content);
      adapter=createCodexRunnerAdapter({userHome:f.home,codexHome,tools:{dataRoot:f.dataRoot,resolveCommand:f.resolveCommand,codebaseReleaseOverride:f.release,nodeCommand:process.execPath,verifyNodeRuntime:()=>true}});
    } else {
      const {createOpenCodeRunnerAdapter}=await import("../../../packages/adapter-opencode/src/runner-adapter");
      configPath=join(f.home,"opencode.json");writeFileSync(configPath,JSON.stringify({mcp:{"codebase-memory":{type:"local",command:[f.shared],enabled:true}}}));
      adapter=createOpenCodeRunnerAdapter({developerTeamConfigDir:f.home});
    }
    const before=readFileSync(configPath), shared=readFileSync(f.shared);
    const readiness=new SessionCodebaseReadiness({supervisor:{spawn(){throw new Error("unverified binary must never run");}}});
    const config=codebaseConfig();config.adaptiveMemory.enabled=false;config.webSearch.enabled=false;
    try {
      const resolver=await resolveSessionChildMcp(adapter,config,{}, {readiness,context:{projectRoot:f.home,sessionId:"fixture",taskId:"lead",signal:new AbortController().signal}});
      expect(resolver.capabilityAvailability).toEqual([{capabilityId:"codebase-memory",status:"unavailable",reasonCode:"codebase-memory-unsupported"}]);
      expect(resolver.resolveServer("codebase-memory")).toBeUndefined();expect(f.downloads()).toBe(0);
      expect(readFileSync(configPath)).toEqual(before);expect(readFileSync(f.shared)).toEqual(shared);
      if (runner!=="opencode") {
        const root=join(f.dataRoot,runner,"tools","codebase-native-v0.11.0",`${process.platform}-${process.arch}`);mkdirSync(root,{recursive:true,mode:0o700});writeFileSync(join(root,"codebase-memory-mcp"),"tampered owned artifact",{mode:0o700});
        await expect(adapter.readSessionMcpServers!(codebaseConfig())).rejects.toThrow("codebase-memory-integrity-failed");
      }
    } finally {await readiness.close();}
  });
}

test("OpenCode public MCP writer uses reviewed selection, preserves custom config and refuses drift without downloads", async () => {
  const { createOpenCodeRunnerAdapter } = await import("../../../packages/adapter-opencode/src/runner-adapter");
  const f = fixture(); writeFileSync(f.shared, binary);
  const configDir = join(f.home, "config"); mkdirSync(configDir);
  const configPath = join(configDir, "opencode.json");
  const personal = { model: "personal", mcp: { custom: { type: "remote", url: "https://example.test" } } };
  writeFileSync(configPath, JSON.stringify(personal));
  const tools = createOpenCodeCodebaseTools({ homeDirectory: f.home, dataRoot: f.dataRoot, resolveCommand: f.resolveCommand, release: f.release, artifactEffects: f.effects });
  const adapter = createOpenCodeRunnerAdapter({ developerTeamConfigDir: configDir, evidenceContext: () => ({ ...createOpenCodeEvidenceContext({ homeDirectory: f.home, projectRoot: f.home, environment: { HOME: f.home, PATH: "" } }), codebaseTools: tools }) });
  const input = { serverName: "codebase-memory", projectRoot: f.home, command: ["untrusted-caller-command"] };
  expect(await adapter.writeMcpConfig!(input)).toMatchObject({ ok: true, path: configPath });
  const installed = JSON.parse(readFileSync(configPath,"utf8"));
  expect(installed.model).toBe(personal.model); expect(installed.mcp.custom).toEqual(personal.mcp.custom);
  expect(installed.mcp["codebase-memory"].command).toEqual([f.shared]);
  const before = readFileSync(configPath);
  const { getWebSearchProviderDescriptor } = await import("./web-search-provider");
  const provider = getWebSearchProviderDescriptor("tavily")!;
  expect(await adapter.writeMcpConfig!({ ...input, webSearchProvider: provider })).toMatchObject({ ok: false, diagnostics: ["Web Search MCP action identity does not match the selected provider descriptor."] });
  expect(readFileSync(configPath)).toEqual(before);
  writeFileSync(f.shared,binary.replace("build A","build B"));
  expect(await adapter.writeMcpConfig!(input)).toMatchObject({ ok: false, diagnostics: [expect.stringContaining("reviewed executable is unavailable")] });
  expect(readFileSync(configPath)).toEqual(before); expect(f.downloads()).toBe(0);
  writeFileSync(f.shared,binary);
  const custom = { ...personal, mcp: { ...personal.mcp, "codebase-memory": { type: "local", command: ["/personal/wrapper"], enabled: true } } };
  writeFileSync(configPath,JSON.stringify(custom));
  const customBefore=readFileSync(configPath);
  expect((await adapter.writeMcpConfig!(input)).ok).toBe(false);
  expect(readFileSync(configPath)).toEqual(customBefore); expect(f.downloads()).toBe(0);
});

test("OpenCode public writer normalizes padded identity before reviewed dispatch without mutation or downloads", async () => {
  const { createOpenCodeRunnerAdapter } = await import("../../../packages/adapter-opencode/src/runner-adapter");
  const f = fixture(); // Same-version, wrong-build shared executable is unavailable.
  const savedHome = process.env.HOME;
  const configDir = join(f.home, ".config", "opencode"); mkdirSync(configDir, { recursive: true });
  const configPath = join(configDir, "opencode.json");
  const personal = { model: "personal", mcp: { custom: { type: "remote", url: "https://example.test" } } };
  writeFileSync(configPath, JSON.stringify(personal));
  const tools = createOpenCodeCodebaseTools({ homeDirectory: f.home, dataRoot: f.dataRoot, resolveCommand: f.resolveCommand, release: f.release, artifactEffects: f.effects });
  const adapter = createOpenCodeRunnerAdapter({ developerTeamConfigDir: configDir, evidenceContext: () => ({ ...createOpenCodeEvidenceContext({ homeDirectory: f.home, projectRoot: f.home, environment: { HOME: f.home, PATH: "" } }), codebaseTools: tools }) });
  const input = { projectRoot: f.home, command: ["/unreviewed/caller-command"] };
  try {
    // Align the legacy default config path too: a fallback must fail for policy reasons,
    // not accidentally pass this regression because its destination does not exist.
    process.env.HOME = f.home;
    const before = readFileSync(configPath), shared = readFileSync(f.shared);
    for (const serverName of ["codebase-memory", " codebase-memory ", "\tcodebase-memory\n"]) {
      expect(await adapter.writeMcpConfig!({ ...input, serverName })).toMatchObject({ ok: false, path: configPath, diagnostics: [expect.stringContaining("reviewed executable is unavailable")] });
      expect(readFileSync(configPath)).toEqual(before);
      expect(readFileSync(f.shared)).toEqual(shared); expect(f.downloads()).toBe(0);
    }
    writeFileSync(f.shared, binary);
    expect(await adapter.writeMcpConfig!({ ...input, serverName: " codebase-memory " })).toMatchObject({ ok: true, path: configPath });
    const installed = JSON.parse(readFileSync(configPath, "utf8"));
    expect(installed.mcp["codebase-memory"].command).toEqual([f.shared]);
    expect(installed.mcp.custom).toEqual(personal.mcp.custom); expect(installed.model).toBe(personal.model);
    const custom = { ...personal, mcp: { ...personal.mcp, "codebase-memory": { type: "local", command: ["/personal/wrapper"], enabled: true } } };
    writeFileSync(configPath, JSON.stringify(custom)); const customBefore = readFileSync(configPath);
    expect((await adapter.writeMcpConfig!({ ...input, serverName: " codebase-memory " })).ok).toBe(false);
    expect(readFileSync(configPath)).toEqual(customBefore); expect(f.downloads()).toBe(0);
  } finally { if (savedHome === undefined) delete process.env.HOME; else process.env.HOME = savedHome; }
});
