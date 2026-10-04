import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createChildRunner } from "./runner";
import { parseAgentMarkdown } from "./agents";
import { installChildClarifications } from "./clarification";

const agent = parseAgentMarkdown("deck-investigate", "---\nname: deck-investigate\ntools: read\n---\nRead only");
for (const mode of ["exit", "cancel", "malformed"] as const) test(`clarification transport ${mode} rejects pending delivery and cleans up`, async () => {
  const root = mkdtempSync(join(tmpdir(), "deck-clarify-")), script = join(root, "child.mjs");
  writeFileSync(script, `const e=process.env; const identity={version:1,nonce:e.DECK_PI_CLARIFICATION_NONCE,parentId:e.DECK_PI_PARENT_SESSION,taskId:e.DECK_PI_TASK_ID,sessionFile:e.DECK_PI_CHILD_SESSION,attempt:Number(e.DECK_PI_ATTEMPT)};
process.on('message', m => {
 if (${JSON.stringify(mode)} === 'exit') process.exit(0);
 if (${JSON.stringify(mode)} === 'malformed') for(const change of [{nonce:'foreign'},{parentId:'foreign'},{taskId:'foreign'},{sessionFile:'foreign'},{attempt:2},{delivery:'consumed'},{version:2}]) process.send({...identity,type:'clarification_ack',id:m.id,delivery:'accepted',...change});
}); process.send({...identity,type:'clarification_ready'});`);
  const ac = new AbortController(); let deliver: any, saved: any;
  const runner = createChildRunner({ piInvocation: () => ({ command: "node", args: [script] }), timeoutMs: 10000, killGraceMs: 50 });
  let pending: ReturnType<typeof runner.run> | undefined;
  try {
    // No persistent lease needed for this transport-only fake.
    pending = runner.run({ agent, task: "read", cwd: root, sessionFile: join(root, "session"), parentId: "parent", taskId: "task", attempt: 1, signal: ac.signal, onClarifyReady: fn => { deliver = fn; if (fn) saved = fn; } });
    const deadline = Date.now() + 4000;
    while (!deliver) { if (Date.now() > deadline) throw new Error("Missing transport"); await Bun.sleep(10); }
    const sent = deliver("Existing assignment guidance");
    if (mode === "cancel") ac.abort();
    await expect(sent).rejects.toThrow(mode === "malformed" ? "timed out" : "transport closed");
    runner.killAll(); await pending;
    expect(deliver).toBeUndefined();
    await expect(saved("late guidance")).rejects.toThrow("no longer running");
  } finally { runner.killAll(); await pending; rmSync(root, { recursive: true, force: true }); }
}, 15000);

test("child IPC rejects malformed/foreign/stale/idle messages and removes its listener on shutdown", async () => {
  const original = new Map(["send", "connected", "disconnect"].map(key => [key, Object.getOwnPropertyDescriptor(process, key)]));
  const handlers: Record<string, any> = {}, calls: any[] = [], replies: any[] = [];
  const env = { DECK_PI_CLARIFICATION_NONCE: "nonce", DECK_PI_PARENT_SESSION: "parent", DECK_PI_TASK_ID: "task", DECK_PI_CHILD_SESSION: "/child", DECK_PI_ATTEMPT: "3" };
  let idle = false;
  const ctx = { sessionManager: { getSessionFile: () => "/child" }, isIdle: () => idle };
  const frame = { version: 1, nonce: "nonce", parentId: "parent", taskId: "task", sessionFile: "/child", attempt: 3, type: "clarify", id: "11111111-1111-4111-8111-111111111111", message: "Keep the existing scope" };
  const before = process.listenerCount("message");
  try {
    Object.defineProperty(process, "connected", { configurable: true, value: true });
    Object.defineProperty(process, "disconnect", { configurable: true, value: () => {} });
    Object.defineProperty(process, "send", { configurable: true, value: (m: any, cb: any) => { replies.push(m); cb?.(); } });
    installChildClarifications({ on: (name: string, fn: any) => { handlers[name] = fn; }, sendUserMessage: (...args: any[]) => calls.push(args) } as never, env);
    handlers.session_start({}, ctx);
    for (const raw of [null, [], {}, { ...frame, nonce: "wrong" }, { ...frame, taskId: "foreign" }, { ...frame, parentId: "foreign" }, { ...frame, sessionFile: "/foreign" }, { ...frame, attempt: 2 }, { ...frame, id: "bad" }, { ...frame, message: {} }, { ...frame, message: "x".repeat(4001) }]) process.emit("message", raw);
    await Bun.sleep(0); expect(calls).toHaveLength(0);
    process.emit("message", frame); await Bun.sleep(0);
    expect(calls).toHaveLength(1); expect(calls[0][1]).toEqual({ deliverAs: "steer", expandPromptTemplates: false });
    expect(replies.at(-1).delivery).toBe("accepted");
    process.emit("message", frame); await Bun.sleep(0); expect(calls).toHaveLength(1);
    idle = true; process.emit("message", { ...frame, id: "22222222-2222-4222-8222-222222222222" }); await Bun.sleep(0);
    expect(calls).toHaveLength(1); expect(replies.at(-1).delivery).toBe("rejected");
    idle = false;
    for (let n = 2; n <= 9; n++) {
      const digit = String(n);
      process.emit("message", { ...frame, id: `${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}` });
    }
    await Bun.sleep(0);
    expect(calls).toHaveLength(8); expect(replies.at(-1).delivery).toBe("rejected");
    handlers.session_shutdown(); expect(process.listenerCount("message")).toBe(before);
  } finally {
    handlers.session_shutdown?.();
    for (const [key, descriptor] of original) { if (descriptor) Object.defineProperty(process, key, descriptor); else delete (process as any)[key]; }
  }
});
