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

describe("graph redirection", () => {
  test("the first code-structure search is guided to the graph tools; repeating the same call runs it", async () => {
    const { call } = load({ config: { graphRedirect: true } });
    const first = await call("bash", { command: "grep -rn createUser src/" });
    expect(first.result?.block).toBe(true);
    expect(first.result?.reason).toContain("mcp__codebase_memory__search_graph");
    expect(first.result?.reason).toMatch(/repeat the same call/i);
    expect((await call("bash", { command: "grep -rn createUser src/" })).result).toBeUndefined();
    expect((await call("bash", { command: "grep -rn deleteUser src/" })).result?.block).toBe(true);
  });

  test("the grep and find built-ins are redirected the same way", async () => {
    const { call } = load({ config: { graphRedirect: true } });
    expect((await call("grep", { pattern: "createUser", path: "src" })).result?.block).toBe(true);
    expect((await call("find", { pattern: "*.ts" })).result?.block).toBe(true);
  });

  test("non-code and literal searches are never blocked", async () => {
    const { call } = load({ config: { graphRedirect: true } });
    expect((await call("bash", { command: "grep -n timeout config/settings.yaml" })).result).toBeUndefined();
    expect((await call("bash", { command: "grep -rn 'connection refused' logs/" })).result).toBeUndefined();
    expect((await call("grep", { pattern: "retries", glob: "*.json" })).result).toBeUndefined();
  });

  test("without the redirect option searches are untouched", async () => {
    const { call } = load({ config: { graphRedirect: false, rtkBinary: "/owned/rtk" }, rewriter: spyRewriter("unchanged").rewriter });
    expect((await call("bash", { command: "grep -rn createUser src/" })).result).toBeUndefined();
  });
});

describe("handler order: policy, then RTK, then graph", () => {
  test("RTK has already rewritten the command when the graph decision is made, and graph classification uses the original command", async () => {
    const spy = spyRewriter("rewritten");
    const { call } = load({ config: { rtkBinary: "/owned/rtk", graphRedirect: true }, rewriter: spy.rewriter });
    const { result, event } = await call("bash", { command: "grep -rn createUser src/" });
    expect(spy.seen).toEqual(["grep -rn createUser src/"]);
    expect(event.input.command).toBe("'/owned/rtk' grep -rn createUser src/");
    expect(result?.block).toBe(true);
  });

  test("policy short-circuits before RTK and graph", async () => {
    const spy = spyRewriter("rewritten");
    const { call } = load({ env: { DECK_PI_ROLE: "investigate", DECK_PI_CHILD: "1" }, config: { rtkBinary: "/owned/rtk", graphRedirect: true }, rewriter: spy.rewriter });
    const { result } = await call("bash", { command: "grep -rn createUser src/" });
    expect(result?.reason).toContain("read-only");
    expect(spy.seen).toEqual([]);
  });
});
