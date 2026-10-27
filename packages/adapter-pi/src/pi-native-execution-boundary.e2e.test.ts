import { writeExplicitCodebaseConfig } from "./__fixtures__/explicit-codebase";
import { expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as native from "@earendil-works/pi-coding-agent";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import { createEmptyPiManifest, hashJsonValue } from "./pi-manifest";
import { evaluatePiVersion } from "./pi-version";

type Fault = "ownership" | "integrity" | "missing";

/** Actual AgentSession + ExtensionRunner + generated default factory. Only the model is a local faux tripwire. */
async function fixture(fault: Fault, extra: native.ExtensionFactory[] = []) {
  const root = mkdtempSync(join(tmpdir(), "deck-pi-execution-boundary-"));
  const agentDir = join(root, "agent"), cwd = join(root, "project");
  mkdirSync(join(agentDir, "deck"), { recursive: true });
  mkdirSync(cwd);
  const saved = { XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME, HOME: process.env.HOME, PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR, DECK_PI_SESSION: process.env.DECK_PI_SESSION };
  process.env.HOME = root; process.env.XDG_CONFIG_HOME = join(root, ".config"); writeExplicitCodebaseConfig(root);
  process.env.PI_CODING_AGENT_DIR = agentDir;
  process.env.DECK_PI_SESSION = "1";
  const ownedRoot = join(root, "codebase-native-v0.11.0", `${process.platform}-${process.arch}`);
  const command = fault === "integrity" ? join(ownedRoot, "codebase-memory-mcp") : join(root, "missing/codebase-memory-mcp");
  if (fault === "integrity") {
    mkdirSync(ownedRoot, { recursive: true, mode: 0o700 });
    writeFileSync(command, `#!/usr/bin/env node\nrequire("node:fs").writeFileSync(${JSON.stringify(join(root, "binary-executed"))},"unsafe");\n`, { mode: 0o700 });
  }
  const entry = { command: join(root, "missing/codebase-memory-mcp"), args: [], exposure: "direct" };
  writeFileSync(join(agentDir, "mcp.json"), JSON.stringify({ mcpServers: { "codebase-memory": entry } }));
  const manifest = createEmptyPiManifest();
  manifest.mcp.servers["codebase-memory"] = hashJsonValue(entry);
  writeFileSync(join(agentDir, "deck/manifest.json"), JSON.stringify(manifest));
  let before = readFileSync(join(agentDir, "mcp.json"));
  const extensionPath = join(root, "tool-policy.mjs");
  copyFileSync(join(import.meta.dir, "../assets/pi/extensions/deck-tool-policy.generated.js"), extensionPath);
  const { default: shipped } = await import(extensionPath);
  const faux = fauxProvider();
  let modelRequests = 0, agentStarts = 0;
  faux.setResponses(Array.from({ length: 4 }, () => () => { modelRequests++; return fauxAssistantMessage("local execution tripwire"); }));
  const modelRuntime = await native.ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: null, refreshOnCreate: false, allowModelNetwork: false });
  modelRuntime.registerNativeProvider(faux.provider);
  const settingsManager = native.SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
  const loader = new native.DefaultResourceLoader({ cwd, agentDir, settingsManager, noSkills: true, noPromptTemplates: true, noContextFiles: true,
    extensionFactories: [pi => shipped(pi, native), ...extra],
  });
  await loader.reload();
  expect(loader.getExtensions().errors).toEqual([]);
  const { session } = await native.createAgentSession({ cwd, agentDir, modelRuntime, model: faux.getModel(), resourceLoader: loader, sessionManager: native.SessionManager.inMemory(cwd), settingsManager });
  const diagnostics: string[] = [];
  session.subscribe(event => { if (event.type === "agent_start") agentStarts++; });
  // Matches the public print-mode binding: no custom abort handler, and no shutdown handler supplied.
  const statuses = new Map<string, string | undefined>();
  await session.bindExtensions({ mode: "print", onError: error => diagnostics.push(error.error), uiContext: {
    notify: (message: string) => diagnostics.push(message),
    setStatus: (key: string, message: string | undefined) => statuses.set(key, message),
  } as never });
  // These are the accepted post-start limitation cases, not startup acceptance assertions.
  // Initial awaited factory and session startup succeeded above. Now mutate and use actual native reload.
  const mutatedEntry = { ...entry, command };
  manifest.mcp.servers["codebase-memory"] = hashJsonValue(mutatedEntry);
  writeFileSync(join(agentDir, "mcp.json"), JSON.stringify({ mcpServers: { "codebase-memory": mutatedEntry } }));
  writeFileSync(join(agentDir, "deck/manifest.json"), fault === "ownership" ? "invalid JSON" : JSON.stringify(manifest));
  before = readFileSync(join(agentDir, "mcp.json"));
  await session.reload();
  expect(loader.getExtensions().errors).toEqual([]);
  return {
    session, diagnostics, statuses, root,
    planToolCall(name: string) {
      faux.setResponses([
        () => { modelRequests++; return fauxAssistantMessage([fauxToolCall(name, {})], { stopReason: "toolUse" }); },
        () => { modelRequests++; return fauxAssistantMessage("tool attempt complete"); },
      ]);
    },
    counts: () => ({ modelRequests, agentStarts }),
    async close() {
      try {
        expect(readFileSync(join(agentDir, "mcp.json"))).toEqual(before);
        await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
      } finally {
        session.dispose();
        for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
        rmSync(root, { recursive: true, force: true });
      }
    },
  };
}

for (const fault of ["ownership", "integrity"] as const) {
  test(`accepted post-start limitation: protected ${fault} failure does not veto model turns`, async () => {
    const fx = await fixture(fault);
    try {
      await fx.session.prompt("Do not execute after the protected failure");
      expect(fx.diagnostics.join("\n")).toContain(fault === "ownership" ? "pi-codebase-ownership-invalid" : "codebase-memory-integrity-failed");
      expect(fx.counts()).toEqual({ modelRequests: 1, agentStarts: 1 });
    } finally { await fx.close(); }
  });
}

test("optional missing Codebase still permits native execution", async () => {
  const fx = await fixture("missing");
  try {
    await fx.session.prompt("Continue with file discovery");
    expect(fx.counts()).toEqual({ modelRequests: 1, agentStarts: 1 });
    expect(fx.diagnostics.some(message => message.includes("Codebase Memory is unavailable"))).toBe(true);
  } finally { await fx.close(); }
});

test("pre-start native abort/shutdown requests are not an execution veto", async () => {
  const fx = await fixture("ownership", [pi => {
    pi.on("before_agent_start", (_event, ctx) => { ctx.abort(); ctx.shutdown(); });
  }]);
  try {
    await fx.session.prompt("A pre-start abort must stop this if it is a usable veto");
    expect(fx.counts()).toEqual({ modelRequests: 1, agentStarts: 1 });
  } finally { await fx.close(); }
});

test("input handled stops ordinary prompts but cannot guard native custom-message turns", async () => {
  const fx = await fixture("ownership", [pi => { pi.on("input", () => ({ action: "handled" })); }]);
  try {
    await fx.session.prompt("Handled input");
    expect(fx.counts()).toEqual({ modelRequests: 0, agentStarts: 0 });
    await fx.session.sendCustomMessage({ customType: "boundary-probe", content: "Custom turn must also be blocked", display: false }, { triggerTurn: true });
    expect(fx.counts()).toEqual({ modelRequests: 1, agentStarts: 1 });
  } finally { await fx.close(); }
});

test("generation pin is not a runtime version gate", () => {
  expect(native.VERSION).toBe("1.0.0");
  expect(evaluatePiVersion("1.0.0").supported).toBe(true);
  expect(evaluatePiVersion("1.0.1").supported).toBe(true);
  expect(evaluatePiVersion("2.0.0").supported).toBe(true);
});

for (const fault of ["ownership", "integrity"] as const) {
  test(`post-start ${fault}: reload keeps protection, native tool execution is blocked and diagnostic stays visible`, async () => {
    let executions = 0;
    const fx = await fixture(fault, [pi => {
      // A late supported extension activation simulates an in-flight/late graph call; the guard must still block.
      pi.on("before_agent_start", () => pi.setActiveTools([...pi.getActiveTools(), "mcp__codebase_memory__search_graph"]));
      pi.registerTool({
      name: "mcp__codebase_memory__search_graph", label: "fixture", description: "local tool execution tripwire",
      parameters: { type: "object", properties: {} } as never,
      execute: async () => { executions++; return { content: [{ type: "text", text: "must not execute" }], details: {} }; },
      });
    }]);
    try {
      const reason = fault === "ownership" ? "pi-codebase-ownership-invalid" : "codebase-memory-integrity-failed";
      expect(fx.statuses.get("deck-codebase")).toContain(reason);
      const blocked: Array<{ isError: boolean }> = [];
      const results: string[] = [];
      fx.session.subscribe(event => { if (event.type === "tool_execution_end") { blocked.push({ isError: event.isError }); results.push(JSON.stringify(event.result)); } });
      fx.planToolCall("mcp__codebase_memory__search_graph");
      await fx.session.prompt("Try the affected tool");
      expect(executions).toBe(0);
      expect(blocked).toEqual([{ isError: true }]);
      expect(results.join("\n")).toContain(reason);
      expect(fx.statuses.get("deck-codebase")).toContain(reason);
      await fx.session.reload();
      expect(fx.statuses.get("deck-codebase")).toContain(reason);
      expect(fx.session.resourceLoader.getExtensions().errors).toEqual([]);
      expect(fx.session.getActiveToolNames()).not.toContain("mcp__codebase_memory__search_graph");
      expect(fx.diagnostics.join("\n")).toContain(reason);
      expect((await import("node:fs")).existsSync(join(fx.root, "binary-executed"))).toBe(false);
    } finally { await fx.close(); }
  });
}
