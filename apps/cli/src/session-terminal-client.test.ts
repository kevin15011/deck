import { describe, expect, test } from "bun:test";
import type { SessionEvent, SessionEventKind } from "@deck/core/session/events";
import type { AttachHandlers, CommandOutcome } from "@deck/session-host";
import { renderEvent, runTerminalClient, type TerminalConnection } from "./session-terminal-client";

let seq = 0;
const ev = (kind: SessionEventKind, data: Record<string, unknown> = {}, source: SessionEvent["source"] = { taskId: "lead", memberId: "lead" }): SessionEvent =>
  ({ v: 1, sessionId: "s-1", seq: ++seq, ts: "2026-10-12T00:00:00.000Z", kind, source, data });

class Lines {
  private queue: string[] = [];
  private waiter: ((r: IteratorResult<string>) => void) | undefined;
  private done = false;
  push(line: string) { if (this.waiter) { const w = this.waiter; this.waiter = undefined; w({ value: line, done: false }); } else this.queue.push(line); }
  end() { this.done = true; this.waiter?.({ value: undefined as never, done: true }); }
  [Symbol.asyncIterator](): AsyncIterator<string> {
    return { next: () => this.queue.length ? Promise.resolve({ value: this.queue.shift()!, done: false }) : this.done ? Promise.resolve({ value: undefined as never, done: true }) : new Promise((r) => { this.waiter = r; }) };
  }
}

function setup(replies: Record<string, CommandOutcome> = {}) {
  seq = 0;
  const lines = new Lines();
  const out: string[] = [];
  const sent: Array<{ command: Record<string, unknown>; sessionId?: string }> = [];
  let handlers!: AttachHandlers;
  const attaches: number[] = [];
  const detached: string[] = [];
  const connection: TerminalConnection = {
    attach: async (_id, after, h) => { handlers = h; attaches.push(after); return { ok: true, data: { lastSeq: 0 } }; },
    command: async (command, sessionId) => {
      const c = command as Record<string, unknown>;
      sent.push({ command: c, sessionId });
      return { outcome: replies[String(c.type)] ?? { ok: true } };
    },
    detach: async (id) => { detached.push(id); },
  };
  let n = 0;
  const run = runTerminalClient({ connection, sessionId: "s-1", lines, write: (t) => out.push(t), newCommandId: () => `cmd-${++n}` });
  const text = () => out.join("");
  const tick = () => new Promise((r) => setTimeout(r, 5));
  return { lines, out, text, sent, run, tick, attaches, detached, emit: (e: SessionEvent) => handlers.onEvent(e), caughtUp: (s = seq) => handlers.onCaughtUp?.(s), resync: (r = "queue-overflow") => handlers.onResync?.(r) };
}

describe("renderEvent", () => {
  test("renders assistant text, tool lines, failures and ends of sessions; hides noise", () => {
    expect(renderEvent(ev("message.completed", { role: "assistant", text: "hello\nworld" }))).toEqual(["hello", "world"]);
    expect(renderEvent(ev("message.completed", { role: "user", text: "hi" }))).toEqual(["you> hi"]);
    expect(renderEvent(ev("tool.started", { name: "Bash", input: { command: "ls -la" } }))).toEqual(["[tool] Bash: ls -la"]);
    expect(renderEvent(ev("tool.completed", { isError: true, output: "nope\nmore" }))).toEqual(["[tool error] nope"]);
    expect(renderEvent(ev("tool.completed", { isError: false, output: "fine" }))).toEqual([]);
    expect(renderEvent(ev("turn.completed", { status: "interrupted" }))).toEqual(["-- turn interrupted --"]);
    expect(renderEvent(ev("turn.completed", { status: "failed", error: "boom" }))).toEqual(["-- turn failed: boom --"]);
    expect(renderEvent(ev("turn.completed", { status: "completed" }))).toEqual(["-- turn completed --"]);
    expect(renderEvent(ev("diagnostic", { code: "claude-isolation-violation" }))).toEqual(["[diagnostic] claude-isolation-violation"]);
    expect(renderEvent(ev("session.ended", {}))).toEqual(["[session ended]"]);
    for (const quiet of ["usage", "rate-limit", "runner.unmapped", "reasoning.delta", "task.state", "session.state", "command.accepted", "turn.started"] as const) {
      expect(renderEvent(ev(quiet, {}))).toEqual([]);
    }
  });

  test("terminal control sequences and secrets in model output are neutralised", () => {
    const [line] = renderEvent(ev("message.completed", { role: "assistant", text: "\u001b[31mred\u001b]0;title\u0007 token=abcdefghijklmnop" }));
    expect(line).not.toContain("\u001b");
    expect(line).not.toContain("abcdefghijklmnop");
    expect(line).toContain("red");
  });
});

describe("runTerminalClient (XR-9.1)", () => {
  test("attaches, renders live events, sends prompts with fresh command ids and the session id", async () => {
    const t = setup();
    await t.tick();
    expect(t.attaches).toEqual([0]);
    t.emit(ev("message.completed", { role: "assistant", text: "ready" }));
    expect(t.text()).toContain("ready");
    t.lines.push("build the thing");
    await t.tick();
    expect(t.sent).toEqual([{ command: { v: 1, commandId: "cmd-1", type: "prompt.send", text: "build the thing" }, sessionId: "s-1" }]);
    t.lines.end();
    expect((await t.run).reason).toBe("eof");
    expect(t.detached).toEqual(["s-1"]);
  });

  test("does not echo the user's own prompt back from the event stream, but shows other clients' prompts", async () => {
    const t = setup();
    await t.tick();
    t.caughtUp();
    t.lines.push("mine");
    await t.tick();
    t.emit(ev("message.completed", { role: "user", text: "mine" }));
    t.emit(ev("message.completed", { role: "user", text: "from elsewhere" }));
    expect(t.text()).not.toContain("you> mine");
    expect(t.text()).toContain("you> from elsewhere");
    t.lines.end();
    await t.run;
  });

  test("/interrupt, /stop, /tasks, /help and unknown slash commands", async () => {
    const t = setup();
    await t.tick();
    t.emit(ev("task.created", { taskId: "lead", memberId: "lead", runnerId: "claude", modelId: "opus" }));
    t.emit(ev("task.state", { taskId: "lead", state: "running" }));
    t.lines.push("/interrupt");
    t.lines.push("/tasks");
    t.lines.push("/help");
    t.lines.push("/wat");
    t.lines.push("/stop");
    await t.tick();
    expect(t.sent.map((s) => s.command.type)).toEqual(["turn.interrupt", "session.stop"]);
    expect(t.sent[0]!.command).toMatchObject({ taskId: "lead" });
    expect(t.text()).toContain("lead  running");
    expect(t.text()).toContain("/interrupt");
    expect(t.text()).toMatch(/unknown command: \/wat/i);
    t.lines.end();
    await t.run;
  });

  test("/detach leaves without stopping anything", async () => {
    const t = setup();
    await t.tick();
    t.lines.push("/detach");
    expect((await t.run).reason).toBe("detached");
    expect(t.sent).toEqual([]);
    expect(t.detached).toEqual(["s-1"]);
  });

  test("a refused prompt explains why (turn in progress, session ended, ownership unsettled)", async () => {
    const t = setup({ "prompt.send": { ok: false, code: "turn-in-progress" } });
    await t.tick();
    t.lines.push("x");
    await t.tick();
    expect(t.text()).toMatch(/turn is still running/i);
    t.lines.end();
    await t.run;
  });

  test("approvals: a live request prompts, y allows once, anything else denies, answered in order", async () => {
    const t = setup();
    await t.tick();
    t.caughtUp();
    t.emit(ev("approval.requested", { approvalId: "a-1", tool: "Bash", summary: "Bash: rm -rf x" }));
    t.emit(ev("approval.requested", { approvalId: "a-2", tool: "Write", summary: "Write: f.txt" }));
    expect(t.text()).toContain("[approval] Bash: rm -rf x");
    t.lines.push("y");
    t.lines.push("n");
    await t.tick();
    expect(t.sent.map((s) => s.command)).toEqual([
      { v: 1, commandId: "cmd-1", type: "approval.respond", approvalId: "a-1", decision: "allow-once" },
      { v: 1, commandId: "cmd-2", type: "approval.respond", approvalId: "a-2", decision: "deny" },
    ]);
    t.lines.end();
    await t.run;
  });

  test("approvals already resolved in the replayed backlog are not prompted; still-pending ones are, after catch-up", async () => {
    const t = setup();
    await t.tick();
    t.emit(ev("approval.requested", { approvalId: "old", tool: "Bash", summary: "old one" }));
    t.emit(ev("approval.resolved", { approvalId: "old", decision: "allow-once", by: "c-1" }));
    t.emit(ev("approval.requested", { approvalId: "open", tool: "Bash", summary: "still open" }));
    expect(t.text()).not.toContain("Allow?");
    t.caughtUp();
    expect(t.text()).toContain("still open");
    expect(t.text().match(/Allow\?/g)).toHaveLength(1);
    t.lines.push("yes");
    await t.tick();
    expect(t.sent[0]!.command).toMatchObject({ approvalId: "open", decision: "allow-once" });
    t.lines.end();
    await t.run;
  });

  test("a failed approval response can be retried without reattaching", async () => {
    const t = setup({ "approval.respond": { ok: false, code: "temporary-failure" } });
    await t.tick();
    t.caughtUp();
    t.emit(ev("approval.requested", { approvalId: "retry", tool: "Write", summary: "write file" }));
    t.lines.push("y");
    await t.tick();
    t.lines.push("n");
    await t.tick();
    t.lines.push("/detach");
    await t.run;
    expect(t.sent.map((s) => s.command)).toEqual([
      expect.objectContaining({ type: "approval.respond", approvalId: "retry", decision: "allow-once" }),
      expect.objectContaining({ type: "approval.respond", approvalId: "retry", decision: "deny" }),
    ]);
  });

  test("session.ended ends the client", async () => {
    const t = setup();
    await t.tick();
    t.emit(ev("session.ended", {}));
    expect((await t.run).reason).toBe("ended");
  });

  test("input arriving after session.ended never sends another command", async () => {
    const t = setup();
    await t.tick();
    t.emit(ev("session.ended", {}));
    await t.run;
    t.lines.push("late prompt");
    t.lines.end();
    await t.tick();
    expect(t.sent).toEqual([]);
  });

  test("a closed daemon connection exits even while stdin remains open", async () => {
    let close!: () => void;
    const closed = new Promise<void>((resolve) => { close = resolve; });
    const out: string[] = [];
    const run = runTerminalClient({
      connection: { closed, attach: async () => ({ ok: true }), command: async () => ({ outcome: { ok: true } }), detach: async () => {} },
      sessionId: "s", lines: new Lines(), write: (text) => out.push(text),
    });
    close();
    const result = await Promise.race([run, new Promise((resolve) => setTimeout(() => resolve("hung"), 30))]);
    expect(result).toEqual({ reason: "connection-lost" });
    expect(out.join("")).toContain("connection closed");
  });

  test("old events rebuild task and approval state while only recent messages are displayed", async () => {
    const lines = new Lines();
    const out: string[] = [];
    const sent: unknown[] = [];
    const run = runTerminalClient({
      connection: {
        attach: async (_id, _after, handlers) => {
          seq = 0;
          handlers.onEvent(ev("task.created", { taskId: "lead", runnerId: "claude", modelId: "opus" }));
          handlers.onEvent(ev("task.state", { taskId: "lead", state: "running" }));
          handlers.onEvent(ev("approval.requested", { approvalId: "old-open", tool: "Write", summary: "old pending approval" }));
          handlers.onEvent(ev("message.completed", { role: "assistant", text: "old message" }));
          seq = 100;
          handlers.onEvent(ev("message.completed", { role: "assistant", text: "recent message" }));
          handlers.onCaughtUp?.(seq);
          return { ok: true };
        },
        command: async (command) => { sent.push(command); return { outcome: { ok: true } }; }, detach: async () => {},
      },
      sessionId: "s", displayAfter: 100, lines, write: (text) => out.push(text),
    });
    lines.push("/tasks");
    lines.push("y");
    lines.push("/detach");
    await run;
    expect(out.join("")).not.toContain("old message");
    expect(out.join("")).toContain("recent message");
    expect(out.join("")).toContain("lead  running");
    expect(out.join("")).toContain("old pending approval");
    expect(sent).toEqual([expect.objectContaining({ approvalId: "old-open", decision: "allow-once" })]);
  });

  test("a resync reattaches from the last seen cursor", async () => {
    const t = setup();
    await t.tick();
    t.emit(ev("message.completed", { role: "assistant", text: "a" }));
    t.emit(ev("message.completed", { role: "assistant", text: "b" }));
    t.resync();
    await t.tick();
    expect(t.attaches).toEqual([0, 2]);
    t.lines.end();
    await t.run;
  });

  test("`after` starts the attach from the requested cursor", async () => {
    seq = 0;
    const lines = new Lines();
    const attaches: number[] = [];
    const run = runTerminalClient({
      connection: { attach: async (_id, after) => { attaches.push(after); return { ok: true }; }, command: async () => ({ outcome: { ok: true } }), detach: async () => {} },
      sessionId: "s", after: 40, lines, write: () => {},
    });
    await new Promise((r) => setTimeout(r, 5));
    lines.end();
    await run;
    expect(attaches).toEqual([40]);
  });

  test("an attach failure is reported and returned", async () => {
    const out: string[] = [];
    const result = await runTerminalClient({
      connection: { attach: async () => ({ ok: false, code: "unknown-session" }), command: async () => ({ outcome: { ok: true } }), detach: async () => {} },
      sessionId: "s", lines: new Lines(), write: (t) => out.push(t),
    });
    expect(result.reason).toBe("attach-failed");
    expect(out.join("")).toContain("unknown-session");
  });
});
