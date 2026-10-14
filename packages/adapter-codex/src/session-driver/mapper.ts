import type { DriverEvent } from "@deck/core/session/driver";
import { redactText } from "@deck/core/session/redaction";
import { object, type RpcMessage } from "./rpc";

export const CODEX_PROTOCOL = "codex-app-server";
const text = (value: unknown): string => typeof value === "string" ? redactText(value, 32 * 1024) : "";
function bounded(value: unknown): unknown {
  if (value === undefined) return undefined;
  const serialized = JSON.stringify(value);
  if (serialized.length > 16 * 1024) return redactText(serialized, 16 * 1024);
  return JSON.parse(redactText(serialized, 16 * 1024));
}
export function codexTurnStatus(value: unknown): "completed" | "interrupted" | "failed" {
  return value === "completed" ? "completed" : value === "interrupted" ? "interrupted" : "failed";
}
export function mapCodexNotification(message: RpcMessage): DriverEvent[] {
  const p = object(message.params), item = object(p.item), turn = object(p.turn);
  const event = (kind: string, data: Record<string, unknown>): DriverEvent[] => [{ kind, data, raw: message }];
  switch (message.method) {
    case "turn/started": return event("turn.started", { nativeTurnId: turn.id });
    case "turn/completed": return event("turn.completed", { nativeTurnId: turn.id, status: codexTurnStatus(turn.status) });
    case "item/agentMessage/delta": return event("message.delta", { text: text(p.delta), messageId: p.itemId });
    case "item/reasoning/textDelta":
    case "item/reasoning/summaryTextDelta": return event("reasoning.delta", { text: text(p.delta), messageId: p.itemId });
    case "thread/tokenUsage/updated": return event("usage", { ...object(p.tokenUsage) });
    case "account/rateLimits/updated": return event("rate-limit", { ...object(p.rateLimits) });
    case "item/started":
    case "item/completed": {
      const complete = message.method === "item/completed";
      if (item.type === "agentMessage" && complete) return event("message.completed", { text: text(item.text), messageId: item.id });
      if (["commandExecution", "fileChange", "mcpToolCall", "webSearch", "dynamicToolCall"].includes(String(item.type)))
        return event(complete ? "tool.completed" : "tool.started", { toolCallId: item.id, tool: item.type, status: item.status, input: bounded(item.arguments ?? item.changes ?? { command: item.command, cwd: item.cwd }), output: bounded(item.result ?? item.aggregatedOutput), exitCode: item.exitCode });
      break;
    }
  }
  return event("runner.unmapped", { nativeType: message.method ?? "rpc-response" });
}
