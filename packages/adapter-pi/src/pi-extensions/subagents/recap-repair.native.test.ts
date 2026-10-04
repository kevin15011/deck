import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createAgentSession, DefaultResourceLoader, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { createFauxCore, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { createDeckSubagentsExtension } from "./extension";

function state(messages: any[], tag: string) {
  for (const m of messages) {
    const text = typeof m.content === "string" ? m.content : (m.content ?? []).map((b: any) => b.text ?? "").join("\n");
    const match = new RegExp(`${tag}\\n([^\\n]+)\\nEND_${tag}`).exec(text);
    if (match) return JSON.parse(match[1]!);
  }
}
async function until(fn: () => boolean) {
  const end = Date.now() + 9000;
  while (!fn()) { if (Date.now() > end) throw Error("Native repair trace timed out"); await Bun.sleep(5); }
}
async function harness(run: (h: any) => Promise<void>) {
  const root = mkdtempSync(join(tmpdir(), "deck-recap-repair-"));
  let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
  try {
    const agentsDir = join(root, "roles"), agentDir = join(root, "agent"); mkdirSync(agentsDir); mkdirSync(agentDir);
    writeFileSync(join(agentsDir, "deck-investigate.md"), "---\nname: deck-investigate\ntools: read,grep,find,ls\n---\nInvestigate");
    const core = createFauxCore({ api: "deck-recap-repair", provider: "deck-recap-repair", models: [{ id: "fake", name: "Fake" }] });
    const h: any = { contexts: [], finals: [], respond: () => fauxAssistantMessage("Original recommendation"), wakes: 0, suppressWakes: false };
    const loader = new DefaultResourceLoader({ cwd: root, agentDir, noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true, extensionFactories: [
      pi => {
        h.sendMessage = pi.sendMessage;
        pi.registerTool({ name: "hold_original", label: "Hold", description: "Deterministic original tool loop", parameters: { type: "object", properties: {} } as any,
          async execute() { await until(() => h.manager.getEntries().some((e: any) => e.customType === "deck-subagents-v1" && e.data.jobs.some((j: any) => j.outcomeId))); return { content: [{ type: "text", text: "Original tool finished" }], details: {} }; } });
        pi.registerProvider(core.provider, { api: core.api, apiKey: "fake", baseUrl: "http://127.0.0.1:1", models: [{ id: "fake", name: "Fake", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 100000, maxTokens: 4000 }],
          streamSimple: (model, context, options) => {
            const trace = { recap: state(context.messages, "DECK_PI_COMPLETION_RECAP"), jobs: state(context.messages, "DECK_PI_TASK_BOARD")?.jobs ?? [] };
            h.contexts.push(trace); core.setResponses([h.respond(trace)]); return core.streamSimple(model, context, options);
          } });
        createDeckSubagentsExtension({ agentsDir, env: { PATH: process.env.PATH, HOME: root, PI_CODING_AGENT_DIR: agentDir }, piInvocation: args => ({ command: process.execPath, args: [fileURLToPath(new URL("../../__fixtures__/fake-pi-child.mjs", import.meta.url)), ...args] }), killGraceMs: 50 })(new Proxy(pi, { get(target, key) {
          if (key === "registerTool") return (definition: any) => { h.tool = definition; target.registerTool(definition); };
          if (key === "sendMessage") return (...args: any[]) => { h.wakes++; if (!h.suppressWakes) return (target.sendMessage as any)(...args); };
          return Reflect.get(target, key);
        } }));
      },
    ] });
    await loader.reload(); h.manager = SessionManager.create(root, join(root, "sessions"));
    ({ session } = await createAgentSession({ cwd: root, agentDir, resourceLoader: loader, model: core.models[0], thinkingLevel: "off", sessionManager: h.manager, settingsManager: SettingsManager.inMemory({ compaction: { enabled: false } }) }));
    h.session = session; h.root = root;
    await session.bindExtensions({ onError: e => { throw Error(JSON.stringify(e)); } });
    session.subscribe(e => { if (e.type === "message_end" && e.message.role === "assistant" && e.message.stopReason === "stop") h.finals.push(e.message.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n")); });
    h.replaceSession = async (manager: SessionManager) => {
      await session!.extensionRunner!.emit({ type: "session_shutdown" } as any); await session!.abort(); session!.dispose();
      await loader.reload(); h.manager = manager;
      ({ session } = await createAgentSession({ cwd: root, agentDir, resourceLoader: loader, model: core.models[0], thinkingLevel: "off", sessionManager: manager, settingsManager: SettingsManager.inMemory({ compaction: { enabled: false } }) }));
      h.session = session; await session.bindExtensions({ onError: e => { throw Error(JSON.stringify(e)); } });
    };
    h.call = (params: any) => h.tool.execute("native", params, undefined, undefined, session!.extensionRunner!.createToolContext("native", undefined));
    h.integrate = (trace: any) => {
      const j = trace.jobs.find((j: any) => j.outcomeId && ["pending", "reviewing"].includes(j.integration));
      return j ? fauxAssistantMessage([fauxToolCall("subagent", j.integration === "pending" ? { action: "review", taskId: j.taskId } : { action: "resolve", taskId: j.taskId, outcomeId: j.outcomeId, disposition: "integrated", summary: `Validated ${j.title}` })], { stopReason: "toolUse" }) : fauxAssistantMessage("Completion answer");
    };
    await run(h);
  } finally { await session?.extensionRunner?.emit({ type: "session_shutdown" } as any); await session?.abort(); session?.dispose(); rmSync(root, { recursive: true, force: true }); }
}

for (const timing of ["synthetic input while streaming", "outcome during original tool loop", "outcome while original answer streams"] as const) {
  test(`native repair: anchor survives ${timing} without recursive capture`, async () => harness(async h => {
    let first = true, original = true, started = false, release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    h.respond = (trace: any) => {
      if (first) { first = false; return fauxAssistantMessage([fauxToolCall("subagent", { agent: "deck-investigate", title: "A", task: "HOLD A" }), ...(timing === "outcome during original tool loop" ? [fauxToolCall("hold_original", {})] : [])], { stopReason: "toolUse" }); }
      if (timing === "outcome during original tool loop" && trace.jobs.some((j: any) => j.outcomeId && ["pending", "reviewing"].includes(j.integration))) return h.integrate(trace);
      if (original) { original = false; return async () => { started = true; if (timing !== "outcome during original tool loop") await gate; return fauxAssistantMessage("Original recommendation"); }; }
      return h.integrate(trace);
    };
    const prompt = h.session.prompt("Genuine original question");
    if (timing !== "outcome during original tool loop") {
      await until(() => started);
      if (timing === "synthetic input while streaming") await h.session.sendUserMessage("Synthetic queued input", { deliverAs: "followUp" });
      else await until(() => h.manager.getEntries().some((e: any) => e.customType === "deck-subagents-v1" && e.data.jobs.some((j: any) => j.outcomeId)));
      release();
    }
    await prompt;
    await until(() => h.session.isIdle);
    const anchors = h.manager.getBranch().filter((e: any) => e.customType === "deck-recap-anchor-v1");
    expect(anchors).toHaveLength(1);
    const anchored = h.manager.getBranch().find((e: any) => e.id === anchors[0].data.entryId);
    expect(anchored.message.content[0].text).toBe("Original recommendation");
    if (timing === "synthetic input while streaming") {
      await until(() => h.contexts.some((c: any) => c.recap?.results.some((j: any) => j.integration === "integrated")) && h.session.isIdle);
      expect(h.contexts.filter((c: any) => c.recap).at(-1).recap.priorLeadAnswer).toBe("Original recommendation");
    }
    const count = h.contexts.length; await Bun.sleep(650); expect(h.contexts).toHaveLength(count);
  }), 15000);
}

test("native repair: queued genuine user binds only its own answer after old response finishes", async () => harness(async h => {
  let first = true, started = false, release!: () => void;
  const gate = new Promise<void>(r => { release = r; });
  h.respond = () => {
    if (first) { first = false; return async () => { started = true; await gate; return fauxAssistantMessage("Old original response"); }; }
    return fauxAssistantMessage("Queued user's recommendation");
  };
  const prompt = h.session.prompt("Old genuine input");
  await until(() => started);
  await h.session.prompt("Queued genuine input", { source: "rpc", streamingBehavior: "followUp" });
  release(); await prompt; await until(() => h.session.isIdle);
  const branch = h.manager.getBranch();
  const anchors = branch.filter((e: any) => e.customType === "deck-recap-anchor-v1");
  expect(anchors).toHaveLength(1);
  expect(branch.find((e: any) => e.id === anchors[0].data.entryId).message.content[0].text).toBe("Queued user's recommendation");
  h.respond = h.integrate;
  await h.call({ agent: "deck-investigate", title: "A", task: "HOLD A" });
  await until(() => h.contexts.some((c: any) => c.recap?.results.some((j: any) => j.integration === "integrated")) && h.session.isIdle);
  expect(h.contexts.filter((c: any) => c.recap).at(-1).recap.priorLeadAnswer).toBe("Queued user's recommendation");
}), 15000);

test("native repair: a selected running attempt carries into a genuine new block, not its old answer", async () => harness(async h => {
  h.suppressWakes = true;
  await h.session.prompt("First genuine question");
  await h.call({ agent: "deck-investigate", title: "A", task: "HOLD A" });
  h.respond = () => fauxAssistantMessage("New block recommendation");
  await h.session.prompt("Second genuine question while A runs", { source: "rpc" });
  h.respond = h.integrate; h.suppressWakes = false;
  await until(() => h.contexts.some((c: any) => c.recap?.results.some((j: any) => j.integration === "integrated")) && h.session.isIdle);
  expect(h.contexts.filter((c: any) => c.recap).at(-1).recap.priorLeadAnswer).toBe("New block recommendation");
}), 15000);

for (const legacy of [false, true]) {
 test(`native repair: selected earlier ${legacy ? "legacy" : "current"} block excludes later integrated and pending jobs but journal stays monotonic`, async () => harness(async h => {
  h.suppressWakes = true;
  await h.session.prompt("Original block A");
  const a = (await h.call({ agent: "deck-investigate", title: "A", task: "HOLD A" })).details.taskIds[0];
  await until(() => h.manager.getEntries().some((e: any) => e.customType === "deck-subagents-v1" && e.data.jobs.some((j: any) => j.id === a && j.outcomeId)));
  h.respond = h.integrate; await h.session.sendUserMessage("Integrate A");
  if (legacy) {
  // Also exercise restore of a pre-membership candidate block using native entries.
  const oldBranch = h.manager.getBranch();
  const originalAnchor = oldBranch.find((e: any) => e.customType === "deck-recap-anchor-v1").data;
  h.manager.appendCustomEntry("deck-recap-boundary-v1", { parent: h.manager.getSessionId(), file: h.manager.getSessionFile(), excluded: [] });
  h.manager.appendCustomEntry("deck-recap-anchor-v1", originalAnchor);
  h.manager.appendCustomEntry("deck-subagents-v1", h.manager.getEntries().filter((e: any) => e.customType === "deck-subagents-v1").at(-1).data);
  }
  const earlier = h.manager.getLeafId();
  await h.session.prompt("Later genuine block B");
  const b = (await h.call({ agent: "deck-investigate", title: "B", task: "HOLD B" })).details.taskIds[0];
  await until(() => h.manager.getEntries().some((e: any) => e.customType === "deck-subagents-v1" && e.data.jobs.some((j: any) => j.id === b && j.outcomeId)));
  await h.session.sendUserMessage("Integrate B");
  const c = (await h.call({ agent: "deck-investigate", title: "C", task: "HOLD C" })).details.taskIds[0];
  await until(() => h.manager.getEntries().some((e: any) => e.customType === "deck-subagents-v1" && e.data.jobs.some((j: any) => j.id === c && j.outcomeId)));
  await h.session.navigateTree(earlier);
  const before = h.contexts.length;
  h.respond = () => fauxAssistantMessage("Earlier branch continuation");
  await h.session.sendUserMessage("Synthetic earlier branch continuation");
  const trace = h.contexts[before];
  expect(trace.jobs.map((j: any) => j.title)).toEqual(["C"]);
  // Selection is separate from execution ownership; a later pending C cannot activate a recap here.
  expect(trace.recap).toBeUndefined();
  const { completionRecap } = await import("./recap");
  const journal = (await h.call({ action: "list" })).details.jobs;
  const current = h.manager.getEntries().filter((e: any) => e.customType === "deck-subagents-v1").at(-1).data.jobs;
  expect(journal).toHaveLength(3);
  const recap = state([{ content: completionRecap(h.manager.getBranch(), h.manager.getSessionId(), h.manager.getSessionFile(), current) }], "DECK_PI_COMPLETION_RECAP");
  expect(recap.results.map((j: any) => j.title)).toEqual(["A"]);
}), 15000);
}

test("native repair: old attempt and replaced session cannot borrow current recap ownership", async () => harness(async h => {
  h.suppressWakes = true;
  await h.session.prompt("Original failed-work question");
  const id = (await h.call({ agent: "deck-investigate", title: "Failure", task: "FAIL" })).details.taskIds[0];
  const records = () => h.manager.getEntries().filter((e: any) => e.customType === "deck-subagents-v1").at(-1).data.jobs;
  await until(() => records()[0].outcomeId);
  const oldOutcome = records()[0].outcomeId;
  await h.call({ action: "resolve", taskId: id, outcomeId: oldOutcome, disposition: "blocked", summary: "Old failure checked" });
  const earlier = h.manager.getLeafId();
  await h.session.prompt("Explicit later continuation");
  expect((await h.call({ action: "resume", taskId: id })).isError).toBeUndefined();
  await until(() => records()[0].outcomeId && records()[0].attempt === 2);
  expect(records()[0].outcomeId).not.toBe(oldOutcome);
  expect((await h.call({ action: "resolve", taskId: id, outcomeId: oldOutcome, disposition: "blocked", summary: "stale" })).isError).toBe(true);
  await h.session.navigateTree(earlier);
  const before = h.contexts.length;
  await h.session.sendUserMessage("Earlier selected branch");
  expect(h.contexts[before].recap).toBeUndefined();
  const { completionRecap } = await import("./recap");
  const restored = state([{ content: completionRecap(h.manager.getBranch(), h.manager.getSessionId(), h.manager.getSessionFile(), records()) }], "DECK_PI_COMPLETION_RECAP");
  expect(restored.results[0].outcomeId).toBe(oldOutcome); expect(restored.results[0].attempt).toBe(1);
  const oldParent = h.manager.getSessionId(), oldFile = h.manager.getSessionFile();
  const other = SessionManager.create(h.root, join(h.root, "other-sessions"));
  other.appendMessage({ role: "user", content: "Other session", timestamp: Date.now() }); other.appendMessage(fauxAssistantMessage("Other answer"));
  await h.replaceSession(other);
  const count = h.contexts.length;
  h.sendMessage({ customType: "deck-subagent-outcome", content: "foreign stale wake", display: false, details: { parent: oldParent, parentFile: oldFile, outcomes: [{ taskId: id, outcomeId: oldOutcome, attempt: 1 }] } }, { triggerTurn: true });
  await until(() => h.contexts.length > count && h.session.isIdle);
  expect(h.contexts.slice(count).every((c: any) => !c.recap && c.jobs.length === 0)).toBe(true);
}), 15000);

test("native repair: reload admitted unfinished outcome restores recap; resolved stale wake never synthesizes", async () => harness(async h => {
  h.suppressWakes = true;
  await h.session.prompt("Original recommendation question");
  const id = (await h.call({ agent: "deck-investigate", title: "A", task: "HOLD A" })).details.taskIds[0];
  await until(() => h.manager.getEntries().some((e: any) => e.customType === "deck-subagents-v1" && e.data.jobs.some((j: any) => j.id === id && j.outcomeId)));
  await h.session.sendUserMessage("Admit but leave unfinished");
  const admitted = h.manager.getEntries().filter((e: any) => e.customType === "deck-subagents-v1").at(-1).data.jobs[0];
  expect(admitted.admitted).toBe(true); expect(admitted.integration).toBe("pending");
  const before = h.contexts.length; h.respond = h.integrate; h.suppressWakes = false;
  await h.session.reload();
  await until(() => h.contexts.length > before && h.session.isIdle);
  const restored = h.contexts[before];
  expect(restored.recap?.priorLeadAnswer).toBe("Original recommendation");
  expect(restored.recap?.results[0].outcomeId).toBe(admitted.outcomeId);
  const count = h.contexts.length; await h.session.reload(); await Bun.sleep(650); expect(h.contexts).toHaveLength(count);
  h.sendMessage({ customType: "deck-subagent-outcome", content: "stale", display: false, details: { parent: h.manager.getSessionId(), parentFile: h.manager.getSessionFile(), outcomes: [{ taskId: id, outcomeId: admitted.outcomeId, attempt: 1 }] } }, { triggerTurn: true });
  await until(() => h.contexts.length > count && h.session.isIdle);
  expect(h.contexts.slice(count).every((c: any) => !c.recap)).toBe(true);
}), 15000);
