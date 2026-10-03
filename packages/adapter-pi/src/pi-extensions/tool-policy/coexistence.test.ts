import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { adaptBunBundleForNode } from "../../pi-bundle-compat";
import { readPiExecutionExtensionSource } from "../../pi-team-profile";
import { createDeckToolPolicyExtension } from "./extension";

type Handler = (event: any, ctx: any) => Promise<unknown> | unknown;

async function loadExecution(): Promise<(pi: unknown) => void> {
  const dir = mkdtempSync(join(tmpdir(), "deck-coexist-"));
  try {
    const file = join(dir, "execution.mjs");
    writeFileSync(file, adaptBunBundleForNode(readPiExecutionExtensionSource()));
    return (await import(pathToFileURL(file).href)).default;
  } finally {
    // The module is already evaluated; the file can go.
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Minimal Pi dispatcher: handlers run in registration order, the first `block` stops the call (as Pi does). */
function dispatcher(order: Array<"policy" | "execution">, execution: (pi: unknown) => void) {
  const handlers: Record<string, Handler[]> = {};
  const api = { on: (name: string, handler: Handler) => { (handlers[name] ??= []).push(handler); } };
  const factories = {
    policy: () => createDeckToolPolicyExtension({
      env: { DECK_PI_SESSION: "1", DECK_PI_ROLE: "lead" },
      config: { version: 1, rtkBinary: "/owned/rtk", graphRedirect: false },
      rewriter: { rewrite: async (command) => (command === "git status" ? { kind: "rewritten", command: "'/owned/rtk' git status" } : { kind: "unchanged" }) },
    })(api as never),
    execution: () => execution(api),
  };
  for (const name of order) factories[name]();
  const ctx = { sessionManager: { getSessionId: () => "sess-1" }, hasUI: false };
  return {
    async toolCall(toolName: string, input: Record<string, unknown>, toolCallId = "call-1") {
      const event = { type: "tool_call", toolCallId, toolName, input };
      for (const handler of handlers.tool_call ?? []) {
        const result = (await handler(event, ctx)) as { block?: boolean; reason?: string } | undefined;
        if (result?.block) return { blocked: result, event };
      }
      return { blocked: undefined, event };
    },
    async toolResult(toolName: string, input: Record<string, unknown>, toolCallId = "call-1") {
      for (const handler of handlers.tool_result ?? []) await handler({ type: "tool_result", toolCallId, toolName, input, content: [{ type: "text", text: "ok" }], isError: false }, ctx);
    },
  };
}

describe("tool-policy with the developer-team execution extension (either load order)", () => {
  for (const order of [["policy", "execution"], ["execution", "policy"]] as const) {
    test(`${order.join(" then ")}: RTK rewrites a bash call, the execution hooks pass it through, and the evidence hooks stay inert`, async () => {
      const pi = dispatcher([...order], await loadExecution());
      const { blocked, event } = await pi.toolCall("bash", { command: "git status" });
      expect(blocked).toBeUndefined();
      expect(event.input.command).toBe("'/owned/rtk' git status");
      await expect(pi.toolResult("bash", event.input)).resolves.toBeUndefined();
    });

    test(`${order.join(" then ")}: delegating to apply and QA roles is neither blocked by policy nor by the execution bridge in static-compatible mode`, async () => {
      const pi = dispatcher([...order], await loadExecution());
      for (const [agent, id] of [["deck-apply-fast", "c-apply"], ["deck-quality", "c-qa"]] as const) {
        const { blocked, event } = await pi.toolCall("subagent", { agent, task: "x" }, id);
        expect(blocked).toBeUndefined();
        // The execution bridge's evidence fields are only ever added by its own handler, never by interception.
        expect(Object.keys(event.input).sort()).toEqual(["agent", "task"]);
      }
    });
  }

  test("a call blocked by policy never reaches tool_result consumers (Pi emits no tool_result for blocked calls)", async () => {
    const handlers: Record<string, Handler[]> = {};
    createDeckToolPolicyExtension({ env: { DECK_PI_SESSION: "1", DECK_PI_CHILD: "1", DECK_PI_ROLE: "quality" }, config: { version: 1, rtkBinary: null, graphRedirect: false } })({ on: (name: string, handler: Handler) => { (handlers[name] ??= []).push(handler); } } as never);
    expect(handlers.tool_result).toBeUndefined();
    const result = await handlers.tool_call![0]!({ type: "tool_call", toolCallId: "c", toolName: "edit", input: { path: "a" } }, {});
    expect(result).toMatchObject({ block: true });
  });
});
