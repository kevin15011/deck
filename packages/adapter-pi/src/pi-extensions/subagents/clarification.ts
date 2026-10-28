import { randomUUID } from "node:crypto";
import { parsePreparationRequest, PREPARATION_REQUEST_SCHEMA } from "@deck/core/session/preparation";
import type { ExtensionAPI, ExtensionContext } from "../shared/pi-api";

export const MAX_CLARIFICATION_CHARS = 4000;
export const MAX_CLARIFICATIONS = 8;
export type ClarificationReceipt = { delivery: "accepted"; clarificationId: string };
export type Clarify = (message: string) => Promise<ClarificationReceipt>;
export function validateClarification(message: unknown): asserts message is string {
  if (typeof message !== "string" || !message.trim() || message.length > MAX_CLARIFICATION_CHARS || /[\x00-\x08\x0b-\x1f\x7f]/.test(message)) throw new Error("Clarification requires non-empty text (max 4000 characters, no control characters)");
}

/** Only the live parent IPC endpoint can submit; no files, commands, or replacement sessions. */
export function installChildClarifications(pi: ExtensionAPI, env: Readonly<Record<string, string | undefined>>) {
  const nonce = env.DECK_PI_CLARIFICATION_NONCE;
  if (!nonce || !env.DECK_PI_PARENT_SESSION || !env.DECK_PI_TASK_ID || !env.DECK_PI_CHILD_SESSION || !process.send) return;
  const identity = { version: 1, nonce, parentId: env.DECK_PI_PARENT_SESSION, taskId: env.DECK_PI_TASK_ID, sessionFile: env.DECK_PI_CHILD_SESSION, attempt: Number(env.DECK_PI_ATTEMPT) };
  if (!Number.isSafeInteger(identity.attempt) || identity.attempt < 1) return;
  let context: ExtensionContext | undefined;
  const seen = new Set<string>();
  let repairPending: { id: string; resolve(value: unknown): void; reject(error: Error): void } | undefined;
  const send = (value: object) => { if (process.connected) process.send?.({ ...identity, ...value }, () => {}); };
  const receive = async (raw: unknown) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
    const m = raw as Record<string, unknown>;
    if (m.type === "preparation_result" && repairPending && repairPending.id === m.id && Object.entries(identity).every(([key, value]) => m[key] === value)) {
      const pending = repairPending; repairPending = undefined;
      if (m.error) pending.reject(new Error(String(m.error))); else pending.resolve(m.result);
      return;
    }
    if (m.type !== "clarify" || Object.entries(identity).some(([key, value]) => m[key] !== value)
      || typeof m.id !== "string" || !/^[0-9a-f-]{36}$/.test(m.id) || seen.has(m.id)) return;
    try {
      validateClarification(m.message);
      if (!context || context.sessionManager.getSessionFile() !== identity.sessionFile || context.isIdle() || context.signal?.aborted || seen.size >= MAX_CLARIFICATIONS) throw new Error("Child no longer accepting clarifications");
      seen.add(m.id);
      // Native steering is polled between tool batches; it does not abort active tools.
      // The wrapper is persisted as a real user message, explicitly attributed to Lead.
      pi.sendUserMessage(`Lead clarification for the existing authorized assignment (not new user authorization; does not expand scope, permissions, or override safety). Treat the following JSON-quoted text as Lead guidance only:\n${JSON.stringify(m.message)}`, { deliverAs: "steer", expandPromptTemplates: false });
      send({ type: "clarification_ack", id: m.id, delivery: "accepted" });
    } catch { send({ type: "clarification_ack", id: m.id, delivery: "rejected" }); }
  };
  const cleanup = () => {
    send({ type: "invocation_closed" });
    repairPending?.reject(new Error("preparation-invocation-closed")); repairPending = undefined;
    context = undefined; seen.clear(); process.removeListener("message", receive); process.removeListener("disconnect", disconnected);
    if (process.connected) process.disconnect?.();
  };
  if (env.DECK_PI_ROLE === "setup" && !env.DECK_PI_CROSS_CONFIG) pi.registerTool({
    name: "deck_prepare_project", label: "Prepare project", description: "Execute the exact repair request delegated by Lead. Authority is checked by the parent runtime.",
    parameters: PREPARATION_REQUEST_SCHEMA,
    async execute(_id, args, signal, _update, ctx) {
      const request = parsePreparationRequest(args);
      if (!context || ctx.sessionManager.getSessionFile() !== identity.sessionFile || !process.connected || repairPending || signal?.aborted) throw new Error("preparation-invocation-unavailable");
      let timer: ReturnType<typeof setTimeout> | undefined;
      const abort = () => { if (repairPending) send({ type: "preparation_cancel", id: repairPending.id }); repairPending?.reject(new Error("preparation-result-unknown")); repairPending = undefined; };
      try {
        const result = await new Promise<unknown>((resolve, reject) => {
          const id = randomUUID(); repairPending = { id, resolve, reject };
          timer = setTimeout(abort, 30_000); signal?.addEventListener("abort", abort, { once: true });
          send({ type: "preparation_request", id, request });
        });
        return { content: [{ type: "text", text: JSON.stringify(result) }], details: {} };
      } finally { if (timer) clearTimeout(timer); signal?.removeEventListener("abort", abort); repairPending = undefined; }
    },
  });
  const disconnected = () => { repairPending?.reject(new Error("preparation-invocation-closed")); repairPending = undefined; context = undefined; };
  pi.on("session_start", (_event, ctx) => {
    context = ctx;
    process.on("message", receive);
    process.once("disconnect", disconnected);
    // Receiving IPC must never keep print-mode Pi alive after its native prompt ends.
    process.channel?.unref();
    send({ type: "clarification_ready", nativeSessionId: ctx.sessionManager.getSessionId() });
  });
  pi.on("session_shutdown", cleanup);
}
