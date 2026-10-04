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
async function until(predicate: () => boolean) {
  const end = Date.now() + 9000;
  while (!predicate()) { if (Date.now() > end) throw Error("Native recap did not finish"); await Bun.sleep(5); }
}

test("native question -> initial answer -> A -> synthetic input -> B -> real user; reload and isolation, no recap-only turn", async () => {
  const root = mkdtempSync(join(tmpdir(), "deck-recap-native-"));
  let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
  try {
    const agents = join(root, "roles"), agentDir = join(root, "agent"); mkdirSync(agents); mkdirSync(agentDir);
    writeFileSync(join(agents, "deck-investigate.md"), "---\nname: deck-investigate\ntools: read,grep,find,ls\n---\nInvestigate");
    const core = createFauxCore({ api: "deck-recap-test", provider: "deck-recap-test", models: [{ id: "fake", name: "Fake" }] });
    const contexts: any[] = [], finals: string[] = [], validated = new Set<string>();
    let delegate = true, nextSingle = false, slowAnswer = false;
    const loader = new DefaultResourceLoader({ cwd: root, agentDir, noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true, extensionFactories: [
      pi => {
        pi.registerTool({ name: "validate_recap", label: "Validate", description: "Fake independent check", parameters: { type: "object", properties: { id: { type: "string" } } } as any,
          async execute(_id, input: { id: string }) { validated.add(input.id); return { content: [{ type: "text", text: "CHECKED" }], details: {} }; } });
        pi.registerProvider("deck-recap-test", { api: core.api, apiKey: "fake", baseUrl: "http://127.0.0.1:1", models: [{ id: "fake", name: "Fake", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 100000, maxTokens: 4000 }],
          streamSimple: (model, context, options) => {
            const recap = state(context.messages, "DECK_PI_COMPLETION_RECAP"), jobs = state(context.messages, "DECK_PI_TASK_BOARD")?.jobs ?? [];
            contexts.push({ recap, jobs });
            const pending = jobs.find((j: any) => j.outcomeId && ["pending", "reviewing"].includes(j.integration));
            let response: any;
            if (delegate) { delegate = false; response = fauxAssistantMessage([fauxToolCall("subagent", nextSingle ? { agent: "deck-investigate", title: "C", task: "HOLD C" } : { chain: [
              { agent: "deck-investigate", title: "A", task: "HOLD A" }, { agent: "deck-investigate", title: "B", task: "HOLD B" },
            ] })], { stopReason: "toolUse" }); }
            else if (pending?.integration === "pending") response = fauxAssistantMessage([fauxToolCall("subagent", { action: "review", taskId: pending.taskId })], { stopReason: "toolUse" });
            else if (pending && !validated.has(pending.outcomeId)) response = fauxAssistantMessage([fauxToolCall("validate_recap", { id: pending.outcomeId })], { stopReason: "toolUse" });
            else if (pending) response = fauxAssistantMessage([fauxToolCall("subagent", { action: "resolve", taskId: pending.taskId, outcomeId: pending.outcomeId, disposition: "integrated", summary: `Checked ${pending.title}` })], { stopReason: "toolUse" });
            else {
              const integrated = recap?.results.filter((j: any) => j.integration === "integrated") ?? [];
              const text = recap ? `${recap.priorLeadAnswer ?? "NO_ANCHOR"}; ${integrated.map((j: any) => j.leadResolution).join("; ")}` : "Recommend local implementation; work still pending";
              finals.push(text);
              response = slowAnswer ? async () => { slowAnswer = false; await Bun.sleep(200); return fauxAssistantMessage(text); } : fauxAssistantMessage(text);
            }
            core.setResponses([response]); return core.streamSimple(model, context, options);
          } });
      },
      createDeckSubagentsExtension({ agentsDir: agents, env: { PATH: process.env.PATH, HOME: root, PI_CODING_AGENT_DIR: agentDir }, piInvocation: args => ({ command: process.execPath, args: [fileURLToPath(new URL("../../__fixtures__/fake-pi-child.mjs", import.meta.url)), ...args] }), killGraceMs: 100 }),
    ] });
    await loader.reload();
    ({ session } = await createAgentSession({ cwd: root, agentDir, resourceLoader: loader, model: core.models[0], thinkingLevel: "off", sessionManager: SessionManager.create(root, join(root, "sessions")), settingsManager: SettingsManager.inMemory({ compaction: { enabled: false } }) }));
    await session.bindExtensions({ onError: error => { throw new Error(JSON.stringify(error)); } });
    await session.prompt("What route should we take? Check A then B.");
    expect(finals[0]).toContain("Recommend local implementation");
    await until(() => finals.some(f => f.includes("Checked A")) && session!.isIdle);
    await session.sendUserMessage("Synthetic extension message, not a new user");
    await until(() => finals.some(f => f.includes("Checked B")) && session!.isIdle);
    const final = finals.find(f => f.includes("Checked B"))!;
    expect(final).toContain("Recommend local implementation"); expect(final).toContain("Checked A"); expect(final.match(/Recommend local implementation/g)).toHaveLength(1);
    expect(contexts.filter(c => c.recap).every(c => c.recap.priorLeadAnswer === finals[0])).toBe(true);
    const lastRecap = contexts.filter(c => c.recap).at(-1).recap;
    expect(lastRecap.results).toHaveLength(2); expect(lastRecap.results.every((j: any) => j.integration === "integrated")).toBe(true);
    // No extra recap wake/call once the two actual results have settled.
    const count = contexts.length; await Bun.sleep(650); expect(contexts).toHaveLength(count);
    const entries = session.sessionManager.getBranch();
    expect(entries.filter((e: any) => e.customType === "deck-recap-boundary-v1")).toHaveLength(1);
    expect(entries.filter((e: any) => e.customType === "deck-recap-anchor-v1")).toHaveLength(1);
    expect(JSON.stringify(entries.filter((e: any) => e.customType?.startsWith("deck-recap-")))).not.toContain("Recommend local implementation");
    // Real reload/restore gets the original reference and resolutions from durable entries.
    const { completionRecap } = await import("./recap");
    const restored = SessionManager.open(session.sessionManager.getSessionFile()!);
    const restoredText = completionRecap(restored.getBranch(), restored.getSessionId(), restored.getSessionFile()!, [] as any)!;
    expect(restoredText).toContain("Recommend local implementation"); expect(restoredText).toContain("Checked A"); expect(restoredText).toContain("Checked B");
    expect(completionRecap(restored.getBranch(), "foreign", restored.getSessionFile()!, [] as any)).toBeUndefined();
    await session.reload();
    delegate = true; nextSingle = true;
    await session.sendUserMessage("Continue the already authorized check after resource reload");
    await until(() => finals.some(f => f.includes("Checked C")) && session!.isIdle);
    const afterReload = finals.find(f => f.includes("Checked C"))!;
    expect(afterReload).toContain("Recommend local implementation"); expect(afterReload).toContain("Checked A"); expect(afterReload).toContain("Checked B");
    const beforeUser = contexts.length; await session.prompt("New genuine user question", { source: "rpc" });
    expect(contexts.slice(beforeUser).every(c => !c.recap)).toBe(true);
    const fresh = completionRecap(session.sessionManager.getBranch(), session.sessionManager.getSessionId(), session.sessionManager.getSessionFile()!, [] as any)!;
    expect(fresh).not.toContain("Checked A"); expect(fresh).not.toContain("Checked B"); expect(fresh).not.toContain("Checked C");
    slowAnswer = true;
    const busy = session.prompt("A genuine question before queued input");
    await until(() => session!.isStreaming);
    await session.prompt("Queued genuine question", { source: "rpc", streamingBehavior: "followUp" });
    await busy; await until(() => session!.isIdle);
    const queuedBranch = session.sessionManager.getBranch();
    let lastBoundary = -1;
    queuedBranch.forEach((e: any, i: number) => { if (e.customType === "deck-recap-boundary-v1") lastBoundary = i; });
    expect(queuedBranch.slice(lastBoundary + 1).filter((e: any) => e.customType === "deck-recap-anchor-v1")).toHaveLength(1);
    await session.extensionRunner?.emit({ type: "session_shutdown", reason: "quit" } as any);
  } finally { await session?.abort(); session?.dispose(); rmSync(root, { recursive: true, force: true }); }
}, 15000);
