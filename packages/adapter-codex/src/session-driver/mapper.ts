import type { DriverEvent, NativeMemoryDescriptor } from "@deck/core/session/driver";
import { boundRaw, HOOK_STATUSES, sanitizeContextObservation } from "@deck/core/session/events";
import { redactText } from "@deck/core/session/redaction";
import { object, type RpcMessage } from "./rpc";

export const CODEX_PROTOCOL = "codex-app-server";
const text = (value: unknown): string => typeof value === "string" ? redactText(value, 32 * 1024) : "";
function bounded(value: unknown): unknown {
  if (value === undefined) return undefined;
  return boundRaw({ runnerId: "codex", protocol: CODEX_PROTOCOL, payload: value }, 16 * 1024).payload;
}
export function codexTurnStatus(value: unknown): "completed" | "interrupted" | "failed" {
  return value === "completed" ? "completed" : value === "interrupted" ? "interrupted" : "failed";
}
export function mapCodexNotification(message: RpcMessage, nativeMemory?: NativeMemoryDescriptor): DriverEvent[] {
  const p = object(message.params), item = object(p.item), turn = object(p.turn);
  const event = (kind: string, data: Record<string, unknown>): DriverEvent[] => [{ kind, data, raw: message }];
  switch (message.method) {
    case "hook/started":
    case "hook/completed": {
      const run = object(p.run);
      const hookId = typeof run.id === "string" ? redactText(run.id, 256) : "";
      if (!hookId) return [{ kind: "diagnostic", data: { code: "codex-hook-invalid" } }];
      const nativeEvent = typeof run.eventName === "string" ? run.eventName : "";
      const hookEvent = /^[A-Za-z][A-Za-z0-9_-]{0,127}$/.test(nativeEvent) ? nativeEvent : "unknown";
      const attributed = nativeMemory?.status === "ready" && (
        run.source === "plugin" && typeof nativeMemory.plugin?.hookConfigPath === "string" && run.sourcePath === nativeMemory.plugin.hookConfigPath
        || run.source === "sessionFlags" && nativeMemory.plugin?.exclusiveHookEvents?.includes(nativeEvent)
      );
      return [{ kind: message.method === "hook/started" ? "hook.started" : "hook.completed", data: {
        hookId, hookEvent, hookName: hookEvent, provenance: CODEX_PROTOCOL,
        status: (HOOK_STATUSES as readonly unknown[]).includes(run.status) ? run.status : "unknown",
        ...(["sync", "async"].includes(String(run.executionMode)) ? { executionMode: run.executionMode } : {}),
        ...(["command", "mcpTool", "prompt", "agent"].includes(String(run.handlerType)) ? { handlerType: run.handlerType } : {}),
        ...(typeof run.durationMs === "number" && Number.isFinite(run.durationMs) && run.durationMs >= 0 ? { durationMs: run.durationMs } : {}),
        ...(attributed ? { provider: "supermemory", integration: "runner-plugin" } : {}),
      } }];
    }
    case "turn/started": return event("turn.started", { nativeTurnId: turn.id, nativeThreadId: p.threadId });
    case "turn/completed": return event("turn.completed", { nativeTurnId: turn.id, status: codexTurnStatus(turn.status) });
    case "item/agentMessage/delta": return event("message.delta", { text: text(p.delta), messageId: p.itemId });
    case "item/reasoning/textDelta":
    case "item/reasoning/summaryTextDelta": {
      const summary = message.method === "item/reasoning/summaryTextDelta";
      const index = summary ? p.summaryIndex : p.contentIndex;
      const reasoningKind = summary ? "summary" : "text";
      return event("reasoning.delta", { text: text(p.delta), messageId: p.itemId, reasoningKind, format: "delta", ...(Number.isInteger(index) ? { partId: `${reasoningKind}:${index}` } : {}) });
    }
    case "thread/tokenUsage/updated": {
      const usage = object(p.tokenUsage);
      const context = sanitizeContextObservation({ basis: 'codex-last-total', tokens: object(usage.last).totalTokens, capacity: usage.modelContextWindow, nativeThreadId: p.threadId, nativeTurnId: p.turnId });
      return event("usage", { ...usage, ...(context ? { context } : {}) });
    }
    case "account/rateLimits/updated": return event("rate-limit", { ...object(p.rateLimits) });
    case "item/started":
    case "item/completed": {
      const complete = message.method === "item/completed";
      if (item.type === "contextCompaction") {
        // Reject oversized/redacted identities rather than truncate them into collisions.
        const identity = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= 256 && redactText(value, 256) === value;
        if (![item.id, p.threadId, p.turnId].every(identity)) return event("runner.unmapped", { nativeType: message.method });
        return event("diagnostic", { code: "context.compaction", state: complete ? "completed" : "started", itemId: item.id, nativeThreadId: p.threadId, nativeTurnId: p.turnId });
      }
      if (item.type === "agentMessage" && complete) return event("message.completed", { text: text(item.text), messageId: item.id });
      if (item.type === "reasoning" && complete) {
        const snapshots: DriverEvent[] = [];
        for (const [reasoningKind, values] of [["summary", item.summary], ["text", item.content]] as const) {
          if (!Array.isArray(values)) continue;
          for (const [index, value] of values.entries()) if (typeof value === "string" && value.length) snapshots.push(...event("reasoning.delta", { text: text(value), messageId: item.id, partId: `${reasoningKind}:${index}`, reasoningKind, format: "snapshot" }));
        }
        return snapshots;
      }
      if (["commandExecution", "fileChange", "mcpToolCall", "webSearch", "dynamicToolCall"].includes(String(item.type))) {
        const isError = item.status === "failed" || item.status === "declined" || item.success === false || item.error != null || (typeof item.exitCode === "number" && item.exitCode !== 0);
        return event(complete ? "tool.completed" : "tool.started", {
          ...(complete && !isError && item.type==='fileChange' && item.status==='completed' && Array.isArray(item.changes) ? {edits:item.changes.slice(0,257).flatMap((change:unknown)=>{
            const c=object(change),k=object(c.kind);const op=typeof c.kind==='string'?c.kind:k.type;
            if(typeof c.path!=='string'||!['add','update','delete'].includes(String(op)))return [];
            return [{path:c.path,op:typeof k.move_path==='string'?'rename-from':op,...(typeof c.diff==='string'?{diff:text(c.diff)}:{})},...(typeof k.move_path==='string'?[{path:k.move_path,op:'rename-to'}]:[])];
          })} : {}),
          nativeThreadId:p.threadId,nativeTurnId:p.turnId,
          toolCallId: item.id, tool: item.type, ...(typeof item.tool === "string" ? { toolName: text(item.tool) } : {}), ...(typeof item.server === "string" ? { server: text(item.server) } : {}),
          status: complete ? (isError ? "failed" : "completed") : "running", nativeStatus: item.status, isError,
          input: bounded(item.arguments ?? item.changes ?? (item.type === "webSearch" ? { query: item.query, action: item.action } : { command: item.command, cwd: item.cwd })),
          output: bounded(item.result ?? item.aggregatedOutput ?? item.contentItems ?? item.results ?? item.error),
          ...(item.error != null ? { error: bounded(item.error) } : {}), exitCode: item.exitCode, durationMs: item.durationMs,
        });
      }
      break;
    }
  }
  if (message.method?.startsWith("hook/")) return [{ kind: "runner.unmapped", data: { nativeType: redactText(message.method, 128) } }];
  return event("runner.unmapped", { nativeType: message.method ?? "rpc-response" });
}
