import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createAgentSession, DefaultResourceLoader, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { createFauxCore, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { createDeckSubagentsExtension } from "./extension";

const fake = fileURLToPath(new URL("../../__fixtures__/fake-pi-child.mjs", import.meta.url));
function board(messages: any[]): any[] {
  for (const m of messages) {
    const text = typeof m.content === "string" ? m.content : (m.content ?? []).map((b: any) => b.text ?? "").join("\n");
    const match = /DECK_PI_TASK_BOARD\n([^\n]+)\nEND_DECK_PI_TASK_BOARD/.exec(text);
    if (match) return JSON.parse(match[1]!).jobs;
  }
  return [];
}
async function until(predicate: () => boolean) {
  const deadline = performance.now() + 9000;
  while (!predicate()) { if (performance.now() > deadline) throw Error("Lead did not integrate without another user prompt"); await Bun.sleep(10); }
}
test("native idle/busy completion automatically reviews, validates, resolves and synthesizes without chat flood or user nudge", async () => {
  const root = mkdtempSync(join(tmpdir(), "deck-background-native-"));
  let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
  try {
    const agents = join(root, "roles"), agentDir = join(root, "agent"); mkdirSync(agents); mkdirSync(agentDir);
    writeFileSync(join(agents, "deck-investigate.md"), "---\nname: deck-investigate\ntools: read,grep,find,ls\n---\nInvestigate");
    const core = createFauxCore({ api: "deck-test-background", provider: "deck-test-background", models: [{ id: "fake", name: "Fake" }] });
    const contexts: any[] = [], syntheses: string[] = [], validated = new Set<string>();
    let delegate = true, slow = false, slowTool = false, activeEnded = 0, phase = 1, admissionFailure = true, omitFirstFollowThrough = true;
    const loader = new DefaultResourceLoader({ cwd: root, agentDir, noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true, extensionFactories: [
      pi => {
        pi.registerTool({ name: "validate_result", label: "Validate result", description: "Validate delegated evidence", parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } as any,
          async execute(_id, input: { id: string }) { validated.add(input.id); return { content: [{ type: "text", text: "EVIDENCE_VALIDATED" }], details: {} }; } });
        pi.registerTool({ name: "hold_lead", label: "Lead work", description: "Existing Lead work must not be interrupted", parameters: { type: "object", properties: {} } as any,
          async execute() { await Bun.sleep(600); activeEnded = Date.now(); return { content: [{ type: "text", text: "LEAD_WORK_FINISHED" }], details: {} }; } });
        pi.registerProvider("deck-test-background", {
          api: core.api, apiKey: "fake", baseUrl: "http://127.0.0.1:1", models: [{ id: "fake", name: "Fake", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 100000, maxTokens: 4000 }],
          streamSimple: (model, context, options) => {
            const jobs = board(context.messages); contexts.push({ at: Date.now(), jobs, messages: structuredClone(context.messages) });
            const pending = jobs.find(j => j.outcomeId && ["pending", "reviewing"].includes(j.integration));
            let response: any;
            if (delegate) {
              delegate = false;
              response = fauxAssistantMessage([fauxToolCall("subagent", phase === 1 ? { agent: "deck-investigate", title: "First task", task: `HOLD phase-${phase} EVENTS` }
                : { tasks: [1, 2].map(n => ({ agent: "deck-investigate", title: `Concurrent task ${n}`, task: `HOLD phase-${phase} EVENTS ${n}` })) })], { stopReason: "toolUse" });
            } else if (slowTool) { slowTool = false; response = fauxAssistantMessage([fauxToolCall("hold_lead", {})], { stopReason: "toolUse" }); }
            else if (pending && omitFirstFollowThrough) {
              omitFirstFollowThrough = false; response = fauxAssistantMessage("ACK_ONLY_TESTS_BOUNDED_REMINDER");
            } else if (pending?.integration === "pending") response = fauxAssistantMessage([fauxToolCall("subagent", { action: "review", taskId: pending.taskId })], { stopReason: "toolUse" });
            else if (pending && !validated.has(pending.outcomeId)) response = fauxAssistantMessage([fauxToolCall("validate_result", { id: pending.outcomeId })], { stopReason: "toolUse" });
            else if (pending) response = fauxAssistantMessage([fauxToolCall("subagent", { action: "resolve", taskId: pending.taskId, outcomeId: pending.outcomeId, disposition: "integrated", summary: "Evidence validated and integrated" })], { stopReason: "toolUse" });
            else response = async () => {
              if (slow) { slow = false; await Bun.sleep(600); activeEnded = Date.now(); }
              const final = jobs.length === 0 && validated.size > 0;
              const text = final ? `LEAD_FINAL_SYNTHESIS_PHASE_${phase}` : "LEAD_CONVERSATIONAL";
              if (final) syntheses.push(text);
              return fauxAssistantMessage(text);
            };
            core.setResponses([response]); return core.streamSimple(model, context, options);
          },
        });
      },
      pi => createDeckSubagentsExtension({ agentsDir: agents, env: { PATH: process.env.PATH, HOME: root, PI_CODING_AGENT_DIR: agentDir }, piInvocation: args => ({ command: process.execPath, args: [fake, ...args] }), killGraceMs: 100 })(new Proxy(pi, { get(target, key) {
        if (key === "sendMessage") return (message: any, options: any) => { if (admissionFailure) { admissionFailure = false; throw Error("transient native admission failure"); } target.sendMessage(message, options); };
        return Reflect.get(target, key);
      } })),
    ] });
    await loader.reload();
    ({ session } = await createAgentSession({ cwd: root, agentDir, resourceLoader: loader, model: core.models[0], thinkingLevel: "off", sessionManager: SessionManager.create(root, join(root, "sessions")), settingsManager: SettingsManager.inMemory({ compaction: { enabled: false } }) }));
    await session.bindExtensions({});
    const ends: any[] = []; session.subscribe(e => { if (e.type === "tool_execution_end") ends.push(e); });
    await session.prompt("delegate"); expect(ends[0]?.result.content[0].text).toContain("accepted");
    await session.prompt("keep talking"); // Finishes before the child, proving conversational availability.
    await until(() => validated.size === 1 && syntheses.includes("LEAD_FINAL_SYNTHESIS_PHASE_1") && session!.isIdle);
    // No more user messages were needed, even after one transient send failure and an acknowledgement-only reply.
    expect(session.messages.some(m => JSON.stringify(m).includes("ACK_ONLY_TESTS_BOUNDED_REMINDER"))).toBe(true);
    const before = contexts.length; delegate = true; slow = true; phase = 2;
    await session.prompt("delegate two independent tasks while responding");
    await until(() => validated.size === 3 && syntheses.includes("LEAD_FINAL_SYNTHESIS_PHASE_2") && session!.isIdle);
    const outcomesDuringBusy = contexts.slice(before).filter(c => c.jobs.some((j: any) => j.outcomeId));
    expect(outcomesDuringBusy.length).toBeGreaterThan(0); expect(activeEnded).toBeGreaterThan(0);
    expect(outcomesDuringBusy.every(c => c.at >= activeEnded)).toBe(true);
    delegate = true; slowTool = true; phase = 3;
    await session.prompt("delegate while Lead is doing its own tool work");
    await until(() => validated.size === 5 && syntheses.includes("LEAD_FINAL_SYNTHESIS_PHASE_3") && session!.isIdle);
    expect(syntheses.filter(s => s.endsWith("PHASE_3"))).toHaveLength(1);
    const snapshots = session.sessionManager.getEntries().filter((e: any) => e.customType === "deck-subagents-v1") as any[];
    expect(snapshots.at(-1).data.jobs.every((j: any) => j.admitted && j.integration === "integrated")).toBe(true);
    const wakes = session.messages.filter((m: any) => m.customType === "deck-subagent-outcome") as any[];
    expect(wakes.length).toBeLessThanOrEqual(3); expect(wakes.every(m => m.display === false)).toBe(true);
    expect(wakes.some(m => JSON.stringify(m).includes("HELD:"))).toBe(false);
    expect(session.messages.some((m: any) => m.customType === "deck-subagent-report" || m.customType === "deck-subagent-board")).toBe(false);
    for (const c of contexts) expect(new Set(c.jobs.map((j: any) => j.taskId)).size).toBe(c.jobs.length);
    expect(syntheses.filter(s => s.endsWith("PHASE_1"))).toHaveLength(1);
    expect(syntheses.filter(s => s.endsWith("PHASE_2"))).toHaveLength(1);
    await session.extensionRunner?.emit({ type: "session_shutdown", reason: "quit" } as any);
  } finally { await session?.abort(); session?.dispose(); rmSync(root, { recursive: true, force: true }); }
}, 20000);
