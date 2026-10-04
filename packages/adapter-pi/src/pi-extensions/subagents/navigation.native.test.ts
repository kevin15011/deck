import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createAgentSession, DefaultResourceLoader, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { createFauxCore, fauxAssistantMessage } from "@earendil-works/pi-ai";
import { createDeckSubagentsExtension } from "./extension";

const fake = fileURLToPath(new URL("../../__fixtures__/fake-pi-child.mjs", import.meta.url));
async function until(fn: () => boolean) { const end = Date.now() + 3000; while (!fn()) { if (Date.now() > end) throw new Error("Timed out"); await Bun.sleep(10); } }
test("native tree journal survives old/root navigation and reload; veto/summary error/abort retain safe controls", async () => {
  const root = mkdtempSync(join(tmpdir(), "deck-navigation-native-"));
  let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
  let releaseSummary: (() => void) | undefined;
  try {
    const agentsDir = join(root, "roles"), agentDir = join(root, "agent"), log = join(root, "log"); mkdirSync(agentsDir); mkdirSync(agentDir);
    writeFileSync(join(agentsDir, "deck-quality.md"), "---\nname: deck-quality\n---\nReview");
    const core = createFauxCore({ api: "deck-navigation-test", provider: "deck-navigation-test", models: [{ id: "fake", name: "Fake" }] });
    let tool: any; let command: any; let veto = false; let summary: "error" | "aborted" = "error";
    let summaryGate: Promise<void> | undefined; let summaryStarted = false;
    const loader = new DefaultResourceLoader({ cwd: root, agentDir, noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true, extensionFactories: [
      pi => {
        pi.registerProvider(core.provider, { api: core.api, apiKey: "fake", baseUrl: "http://127.0.0.1:1", models: [{ id: "fake", name: "Fake", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 100000, maxTokens: 4000 }],
          streamSimple: (model, context, options) => { core.setResponses([async () => { summaryStarted = true; await summaryGate; return fauxAssistantMessage("", { stopReason: summary, errorMessage: "forced summary failure" }); }]); return core.streamSimple(model, context, options); },
        });
        createDeckSubagentsExtension({ agentsDir, env: { PATH: process.env.PATH, HOME: root, PI_CODING_AGENT_DIR: agentDir, FAKE_PI_LOG: log }, piInvocation: args => ({ command: process.execPath, args: [fake, ...args] }), killGraceMs: 50 })(new Proxy(pi, { get(target, key) {
          if (key === "registerTool") return (definition: any) => { tool = definition; target.registerTool(definition); };
          if (key === "registerCommand") return (name: string, definition: any) => { command = definition; target.registerCommand(name, definition); };
          if (key === "sendMessage") return () => {}; // Effects fake: never schedule an LLM turn for outcomes.
          return Reflect.get(target, key);
        } }));
        pi.on("session_before_tree", () => veto ? { cancel: true } : undefined);
      },
    ] });
    await loader.reload();
    const manager = SessionManager.create(root, join(root, "sessions"));
    ({ session } = await createAgentSession({ cwd: root, agentDir, resourceLoader: loader, model: core.models[0], thinkingLevel: "off", sessionManager: manager, settingsManager: SettingsManager.inMemory({ autoCompaction: false, retry: { enabled: false } } as any) }));
    await session.bindExtensions({ onError: () => {} });
    const call = (params: any) => tool.execute("test", params, undefined, undefined, session!.extensionRunner.createToolContext("test", undefined));
    const childCount = () => readFileSync(log, "utf8").trim().split("\n").map(l => JSON.parse(l)).filter(r => Array.isArray(r.argv)).length;
    const entries = () => manager.getEntries().filter((e: any) => e.type === "custom" && e.customType === "deck-subagents-v1") as any[];
    const beforeAcceptance = manager.appendMessage({ role: "user", content: "before acceptance", timestamp: Date.now() });
    manager.appendMessage(fauxAssistantMessage("initial lead"));
    const accepted = await call({ agent: "deck-quality", task: "HOLD" }); const id = accepted.details.taskIds[0];
    const runningEntry = entries().at(-1).id;
    await until(() => entries().at(-1)?.data.jobs[0]?.state === "completed");
    for (const target of [runningEntry, beforeAcceptance]) {
      expect((await session.navigateTree(target)).cancelled).toBe(false);
      expect((await call({ action: "inspect", taskId: id })).content[0].text).toContain("completed");
      expect((await call({ action: "resume", taskId: id })).isError).toBe(true);
      await session.reload();
      expect((await call({ action: "inspect", taskId: id })).content[0].text).toContain("completed");
    }
    for (const mode of ["veto", "error", "aborted"] as const) {
      const target = manager.appendMessage({ role: "user", content: "earlier node", timestamp: Date.now() });
      manager.appendMessage(fauxAssistantMessage("summarize this abandoned branch"));
      const r = await call({ agent: "deck-quality", task: "SLEEP" }); const taskId = r.details.taskIds[0];
      await Bun.sleep(80); const oldLeaf = manager.getLeafId();
      veto = mode === "veto"; if (mode !== "veto") summary = mode;
      if (mode === "error") await expect(session.navigateTree(target, { summarize: true })).rejects.toThrow("forced summary failure");
      else expect((await session.navigateTree(target, { summarize: mode !== "veto" })).cancelled).toBe(true);
      expect(manager.getLeafId()).not.toBe(target); // interruption entries may append, transcript selection never committed.
      expect(oldLeaf).not.toBe(target);
      expect((await call({ action: "inspect", taskId })).content[0].text).toContain("interrupted");
      expect((await call({ action: "list" })).isError).toBeUndefined();
      veto = false;
    }
    const delayedTarget = manager.appendMessage({ role: "user", content: "delayed navigation target", timestamp: Date.now() });
    manager.appendMessage(fauxAssistantMessage("pending branch"));
    const delayed = await call({ agent: "deck-quality", task: "SLEEP" }); const delayedId = delayed.details.taskIds[0];
    await until(() => childCount() === 5);
    summary = "aborted"; summaryStarted = false; summaryGate = new Promise(r => { releaseSummary = r; });
    const navigation = session.navigateTree(delayedTarget, { summarize: true });
    await until(() => summaryStarted);
    expect(session.isCompacting).toBe(true); expect(session.isIdle).toBe(false);
    const notifications: string[] = [];
    const commandContext = session.extensionRunner.createToolContext("test", undefined);
    await command.handler(`resume ${delayedId}`, { ...commandContext, ui: { ...commandContext.ui, notify: (message: string) => notifications.push(message) } });
    expect(notifications.join("\n")).toContain("navigation");
    expect((await call({ action: "resume", taskId: delayedId })).isError).toBe(true);
    expect((await call({ agent: "deck-quality", task: "must not start during navigation" })).isError).toBe(true);
    expect(childCount()).toBe(5);
    releaseSummary!(); expect((await navigation).cancelled).toBe(true); summaryGate = undefined;
    expect(session.isIdle).toBe(true);
    expect((await call({ action: "resume", taskId: delayedId })).isError).toBeUndefined();
    await until(() => childCount() === 6);
    expect((await call({ action: "cancel", taskId: delayedId })).isError).toBeUndefined();
    const next = await call({ agent: "deck-quality", task: "after cancellation" });
    expect(next.isError).toBeUndefined(); await until(() => entries().at(-1)?.data.jobs.at(-1)?.state === "completed");
    const children = readFileSync(log, "utf8").trim().split("\n").map(l => JSON.parse(l)).filter(r => Array.isArray(r.argv));
    expect(children).toHaveLength(7);
    await session.extensionRunner.emit({ type: "session_shutdown" } as any);
  } finally { releaseSummary?.(); await session?.extensionRunner.emit({ type: "session_shutdown" } as any); await session?.abort(); session?.dispose(); rmSync(root, { recursive: true, force: true }); }
}, 15000);
