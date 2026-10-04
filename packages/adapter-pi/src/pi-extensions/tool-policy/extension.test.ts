import { describe, expect, test } from "bun:test";

import type { ToolPolicyConfig } from "./config";
import { createDeckToolPolicyExtension } from "./extension";
import type { RtkRewriter } from "./rtk";

type Handler = (event: any, ctx: any) => Promise<unknown> | unknown;

function load(options: { env?: Record<string, string | undefined>; config?: Partial<ToolPolicyConfig>; rewriter?: RtkRewriter } = {}) {
  const handlers: Record<string, Handler[]> = {};
  const notices: string[] = [];
  const config: ToolPolicyConfig = { version: 1, rtkBinary: null, graphRedirect: false, ...options.config };
  createDeckToolPolicyExtension({ env: { DECK_PI_SESSION: "1", DECK_PI_ROLE: "lead", ...options.env }, config, rewriter: options.rewriter })({ on: (name: string, handler: Handler) => { (handlers[name] ??= []).push(handler); } } as never);
  const ctx = { hasUI: true, ui: { notify: (message: string) => notices.push(message) } };
  const call = async (toolName: string, input: Record<string, unknown>) => {
    const event = { type: "tool_call", toolCallId: "c1", toolName, input };
    let result: unknown;
    for (const handler of handlers.tool_call ?? []) result = (await handler(event, ctx)) ?? result;
    return { result: result as { block?: boolean; reason?: string } | undefined, event };
  };
  return { handlers, notices, call };
}

const spyRewriter = (kind: "rewritten" | "unchanged" | "unavailable" | "throws") => {
  const seen: string[] = [];
  const rewriter: RtkRewriter = { rewrite: async (command) => {
    seen.push(command);
    if (kind === "throws") throw new Error("rtk exploded");
    return kind === "rewritten" ? { kind, command: `'/owned/rtk' ${command}` } : { kind };
  } };
  return { rewriter, seen };
};

describe("role policy", () => {
  test("a read-only role gets { block, reason } for mutating tools and the call is not rewritten", async () => {
    const spy = spyRewriter("rewritten");
    const { call } = load({ env: { DECK_PI_ROLE: "quality", DECK_PI_CHILD: "1" }, config: { rtkBinary: "/owned/rtk" }, rewriter: spy.rewriter });
    const write = await call("write", { path: "a.txt", content: "x" });
    expect(write.result).toMatchObject({ block: true, reason: expect.stringContaining("read-only") });
    const bash = await call("bash", { command: "git status" });
    expect(bash.result?.block).toBe(true);
    expect(bash.event.input.command).toBe("git status");
    expect(spy.seen).toEqual([]);
  });

  test("read-only roles can still read and search", async () => {
    const { call } = load({ env: { DECK_PI_ROLE: "investigate", DECK_PI_CHILD: "1" } });
    expect((await call("read", { path: "a.ts" })).result).toBeUndefined();
    expect((await call("mcp__codebase_memory__search_graph", { name_pattern: "x" })).result).toBeUndefined();
  });

  test("the lead is not restricted by the role policy", async () => {
    const { call } = load();
    expect((await call("edit", { path: "a.ts" })).result).toBeUndefined();
  });

  test("registers nothing when no policy, RTK or graph redirect applies", () => {
    const { handlers } = load();
    expect(handlers.tool_call).toBeUndefined();
  });
});

describe("RTK rewrite", () => {
  test("mutates event.input.command in place for an eligible bash command", async () => {
    const spy = spyRewriter("rewritten");
    const { call } = load({ config: { rtkBinary: "/owned/rtk" }, rewriter: spy.rewriter });
    const { result, event } = await call("bash", { command: "git status" });
    expect(result).toBeUndefined();
    expect(event.input.command).toBe("'/owned/rtk' git status");
  });

  test("a command without an equivalent runs unchanged", async () => {
    const { call } = load({ config: { rtkBinary: "/owned/rtk" }, rewriter: spyRewriter("unchanged").rewriter });
    expect((await call("bash", { command: "echo hi" })).event.input.command).toBe("echo hi");
  });

  test("non-bash tools and empty commands are never sent to RTK", async () => {
    const spy = spyRewriter("rewritten");
    const { call } = load({ config: { rtkBinary: "/owned/rtk" }, rewriter: spy.rewriter });
    await call("read", { path: "a.ts" });
    await call("bash", { command: "   " });
    expect(spy.seen).toEqual([]);
  });

  test("an unavailable RTK leaves commands unchanged and records one diagnostic per session", async () => {
    const { call, notices } = load({ config: { rtkBinary: "/owned/rtk" }, rewriter: spyRewriter("unavailable").rewriter });
    expect((await call("bash", { command: "git status" })).event.input.command).toBe("git status");
    await call("bash", { command: "git diff" });
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain("RTK");
  });

  test("a throwing rewriter never blocks the tool call", async () => {
    const { call } = load({ config: { rtkBinary: "/owned/rtk" }, rewriter: spyRewriter("throws").rewriter });
    const { result, event } = await call("bash", { command: "git status" });
    expect(result).toBeUndefined();
    expect(event.input.command).toBe("git status");
  });
});

describe("graph guidance (advisory)", () => {
  const result = async (handlers: Record<string, Handler[]>, id: string, content: unknown[], isError = false) => {
    let out: unknown;
    for (const handler of handlers.tool_result ?? []) out = (await handler({ type: "tool_result", toolCallId: id, input: {}, content, isError }, {})) ?? out;
    return out as { content?: Array<{ type: string; text: string }> } | undefined;
  };
  const callWithId = async (h: ReturnType<typeof load>, id: string, toolName: string, input: Record<string, unknown>) => {
    const event = { type: "tool_call", toolCallId: id, toolName, input };
    let blocked: unknown;
    for (const handler of h.handlers.tool_call ?? []) blocked = (await handler(event, {})) ?? blocked;
    return blocked;
  };

  test("a code-structure search is never blocked; its result gains one concise advisory", async () => {
    const h = load({ config: { graphRedirect: true } });
    expect(await callWithId(h, "c1", "bash", { command: "grep -rn createUser src/" })).toBeUndefined();
    const out = await result(h.handlers, "c1", [{ type: "text", text: "src/a.ts:1: createUser" }]);
    expect(out?.content).toHaveLength(2);
    expect(out?.content?.[0]?.text).toContain("createUser");
    expect(out?.content?.[1]?.text).toContain("mcp__codebase_memory__search_graph");
    expect(out?.content?.[1]?.text).not.toMatch(/repeat the same call/i);
  });

  test("the advisory is added at most once per session", async () => {
    const h = load({ config: { graphRedirect: true } });
    await callWithId(h, "c1", "bash", { command: "grep -rn createUser src/" });
    expect(await result(h.handlers, "c1", [])).toBeDefined();
    await callWithId(h, "c2", "bash", { command: "grep -rn deleteUser src/" });
    expect(await result(h.handlers, "c2", [])).toBeUndefined();
  });

  test("the grep and find built-ins get the same advisory without being blocked", async () => {
    const h = load({ config: { graphRedirect: true } });
    expect(await callWithId(h, "c1", "grep", { pattern: "createUser", path: "src" })).toBeUndefined();
    expect(await result(h.handlers, "c1", [{ type: "text", text: "x" }])).toBeDefined();
  });

  test("failed searches and unrelated calls get no advisory", async () => {
    const h = load({ config: { graphRedirect: true } });
    await callWithId(h, "c1", "bash", { command: "grep -rn createUser src/" });
    expect(await result(h.handlers, "c1", [], true)).toBeUndefined();
    expect(await result(h.handlers, "other", [])).toBeUndefined();
  });

  test("non-code and literal searches are untouched", async () => {
    const h = load({ config: { graphRedirect: true } });
    for (const [id, tool, input] of [["a", "bash", { command: "grep -n timeout config/settings.yaml" }], ["b", "bash", { command: "grep -rn 'connection refused' logs/" }], ["c", "grep", { pattern: "retries", glob: "*.json" }]] as const) {
      expect(await callWithId(h, id, tool, input as Record<string, unknown>)).toBeUndefined();
      expect(await result(h.handlers, id, [])).toBeUndefined();
    }
  });

  test("without the option no tool_result handler is registered", () => {
    expect(load({ config: { graphRedirect: false, rtkBinary: "/owned/rtk" }, rewriter: spyRewriter("unchanged").rewriter }).handlers.tool_result).toBeUndefined();
  });
});

describe("handler order: policy, then RTK, then graph", () => {
  test("RTK rewrites the command, graph classification uses the original command, and the call is never blocked", async () => {
    const spy = spyRewriter("rewritten");
    const { call } = load({ config: { rtkBinary: "/owned/rtk", graphRedirect: true }, rewriter: spy.rewriter });
    const { result, event } = await call("bash", { command: "grep -rn createUser src/" });
    expect(spy.seen).toEqual(["grep -rn createUser src/"]);
    expect(event.input.command).toBe("'/owned/rtk' grep -rn createUser src/");
    expect(result).toBeUndefined();
  });

  test("policy short-circuits before RTK and graph", async () => {
    const spy = spyRewriter("rewritten");
    const { call } = load({ env: { DECK_PI_ROLE: "investigate", DECK_PI_CHILD: "1" }, config: { rtkBinary: "/owned/rtk", graphRedirect: true }, rewriter: spy.rewriter });
    const { result } = await call("bash", { command: "grep -rn createUser src/" });
    expect(result?.reason).toContain("read-only");
    expect(spy.seen).toEqual([]);
  });
});
