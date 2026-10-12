import { describe, expect, test } from "bun:test";
import type { DriverTaskInput } from "@deck/core/session/driver";
import { createClaudeSessionDriver } from "./driver";
import { fixtureLines } from "./fixtures";
import { FakeTimers, harness } from "./test-support";

const SID = "3f2b8c1e-5d4a-4b7e-9a1c-0e2d3f4a5b6c";
const CRED = "/state/sessions/s1/tasks/lead/credential";

function input(over: Partial<DriverTaskInput> = {}): DriverTaskInput {
  return {
    taskId: "lead", memberId: "lead", cwd: "/work/project", assignment: { runnerId: "claude", modelId: "haiku" },
    rolePrompt: "role", prompt: "Reply with exactly: pong", nativeSessionId: SID,
    mcp: { servers: ["deck"], sessionTools: ["deck_approve", "deck_status"] },
    mcpServerSpecs: { deck: { command: "/bin/deck", args: ["internal", "session-mcp"], env: { DECK_SESSION_CREDENTIAL_FILE: CRED } } },
    approvals: "relay", credentialFile: CRED, disableNativeDelegation: true,
    ...over,
  };
}

/** Fixture lines whose session id equals the task's native id. */
const withSession = (name: string, sid = SID) => fixtureLines(name).map((l) => l.replace(/"session_id":"[0-9a-f-]{36}"/g, `"session_id":"${sid}"`));

function make(timers = new FakeTimers()) {
  const h = harness();
  const driver = createClaudeSessionDriver({ baseEnv: { PATH: "/bin" }, clock: timers, escalationMs: 10_000, killGraceMs: 2_000 });
  return { h, driver, timers };
}

describe("createClaudeSessionDriver.startTask", () => {
  test("declares the protocol, tested range and caller-assigned session ids", () => {
    const { driver } = make();
    expect(driver.runnerId).toBe("claude");
    expect(driver.protocol).toBe("claude-stream-json");
    expect(driver.testedVersions).toEqual({ min: "2.1.296", maxTested: "2.1.296" });
    expect(driver.newNativeSessionId!()).toMatch(/^[0-9a-f-]{36}$/);
  });

  test("spawns through the host with the first-turn argv, sends one stream-json prompt, closes stdin, and completes", async () => {
    const { h, driver } = make();
    const handle = await driver.startTask(input(), h.io);
    const child = await h.nextChild();
    expect(h.spawns[0]!.command).toBe("claude");
    expect(h.spawns[0]!.args).toContain("--session-id");
    expect(h.spawns[0]!.options?.cwd).toBe("/work/project");
    expect(child.stdin).toHaveLength(1);
    expect(JSON.parse(child.stdin[0]!)).toEqual({ type: "user", message: { role: "user", content: "Reply with exactly: pong" } });
    expect(child.stdinEnded).toBe(true);
    expect(await handle.nativeSessionId).toBe(SID);
    child.lines(withSession("turn-success.jsonl"));
    child.exit();
    expect(await handle.done).toEqual({ status: "completed" });
    expect(h.events.map((e) => e.kind)).toEqual(["turn.started", "message.completed", "rate-limit", "usage"]);
    expect(h.events[1]!.data.text).toBe("pong");
  });

  test("handles output split across chunks and a final unterminated line", async () => {
    const { h, driver } = make();
    const handle = await driver.startTask(input(), h.io);
    const child = await h.nextChild();
    const text = withSession("turn-success.jsonl").join("\n");
    child.stdout(text.slice(0, 137));
    child.stdout(text.slice(137)); // no trailing newline: flushed at exit
    child.exit();
    expect(await handle.done).toEqual({ status: "completed" });
    expect(h.events.at(-1)!.kind).toBe("usage");
  });

  test("a non-JSON stdout line is a diagnostic, not a crash", async () => {
    const { h, driver } = make();
    const handle = await driver.startTask(input(), h.io);
    const child = await h.nextChild();
    child.stdout("warning: something\n");
    child.lines(withSession("turn-success.jsonl"));
    child.exit();
    expect(await handle.done).toEqual({ status: "completed" });
    expect(h.events[0]).toMatchObject({ kind: "diagnostic", data: { code: "claude-nonjson-output" } });
  });

  test("isolation: an MCP server outside the expected set fails the turn closed and ends the process group", async () => {
    const { h, driver } = make();
    const handle = await driver.startTask(input({ mcp: { servers: ["deck", "serena"], sessionTools: [] }, mcpServerSpecs: { ...input().mcpServerSpecs, serena: { command: "s", args: [], env: {} } } }), h.io);
    const child = await h.nextChild();
    child.lines(withSession("turn-success.jsonl")); // init lists only "deck": serena missing
    const outcome = await handle.done;
    expect(outcome.status).toBe("failed");
    expect(outcome.error).toContain("claude-isolation-violation");
    expect(child.terminations).toHaveLength(1);
    const diag = h.events.find((e) => e.kind === "diagnostic" && e.data.code === "claude-isolation-violation")!;
    expect(diag.data).toMatchObject({ expected: ["deck", "serena"], actual: ["deck"], missing: ["serena"], extra: [] });
  });

  test("isolation: a leaked extra server is a violation (the --safe-mode inverse and the user-global MCP case)", async () => {
    const { h, driver } = make();
    const handle = await driver.startTask(input(), h.io);
    const child = await h.nextChild();
    const lines = withSession("turn-success.jsonl");
    lines[0] = lines[0]!.replace('"mcp_servers":[{"name":"deck","status":"connected","source":"dynamic"}]', '"mcp_servers":[{"name":"deck","status":"connected"},{"name":"context7","status":"connected"}]');
    child.lines(lines);
    const outcome = await handle.done;
    expect(outcome.status).toBe("failed");
    expect(h.events.find((e) => e.data.code === "claude-isolation-violation")!.data).toMatchObject({ extra: ["context7"] });
  });

  test("isolation: a safe-mode style empty list (init with no servers) is a violation", async () => {
    const { h, driver } = make();
    const handle = await driver.startTask(input(), h.io);
    const child = await h.nextChild();
    child.lines(withSession("safe-mode-init.jsonl"));
    expect((await handle.done).status).toBe("failed");
  });

  test("a server listed but not connected is reported without failing the turn", async () => {
    const { h, driver } = make();
    const handle = await driver.startTask(input(), h.io);
    const child = await h.nextChild();
    const lines = withSession("turn-success.jsonl");
    lines[0] = lines[0]!.replace('"status":"connected"', '"status":"failed"');
    child.lines(lines);
    child.exit();
    expect(await handle.done).toEqual({ status: "completed" });
    expect(h.events.find((e) => e.data.code === "claude-mcp-server-not-connected")!.data).toMatchObject({ server: "deck", status: "failed" });
  });

  test("a native session id different from the assigned one fails the turn (continuity would break)", async () => {
    const { h, driver } = make();
    const handle = await driver.startTask(input(), h.io);
    const child = await h.nextChild();
    child.lines(withSession("turn-success.jsonl", "99999999-9999-4999-8999-999999999999"));
    child.exit();
    const outcome = await handle.done;
    expect(outcome.status).toBe("failed");
    expect(h.events.some((e) => e.data.code === "claude-session-id-mismatch")).toBe(true);
  });

  test("executed hooks surface a diagnostic but do not fail the turn", async () => {
    const { h, driver } = make();
    const handle = await driver.startTask(input(), h.io);
    const child = await h.nextChild();
    child.lines(withSession("hooks-control.jsonl"));
    child.exit();
    expect(await handle.done).toEqual({ status: "completed" });
    expect(h.events.filter((e) => e.data.code === "claude-hook-executed")).toHaveLength(1);
  });

  test("process failures: no result, non-zero exit, lost anchor, undrained output, error results", async () => {
    for (const [lines, exit, expected] of [
      [[], { ok: false, code: 1 }, /exited with code 1/],
      [[], { ok: true }, /without a result/],
      [[], { ok: false, code: null, anchorLost: true, error: "Anchor ended" }, /Anchor ended/],
      [withSession("turn-success.jsonl"), { ok: false, drained: false, code: 0 }, /did not drain|failed/],
      [withSession("unknown-events.synthetic.jsonl", SID), { ok: true }, /maximum number of turns/],
    ] as const) {
      const { h, driver } = make();
      const handle = await driver.startTask(input(), h.io);
      const child = await h.nextChild();
      child.stderr("boom Bearer abcdefghijklmnopq");
      if (lines.length > 0) child.lines(lines);
      child.exit(exit as never);
      const outcome = await handle.done;
      expect(outcome.status).toBe("failed");
      expect(outcome.error).toMatch(expected);
      expect(outcome.error).not.toContain("abcdefghijklmnopq");
    }
  });

  test("a spawn failure fails the turn with a diagnostic instead of throwing", async () => {
    const { h, driver } = make();
    h.io.spawn = async () => { throw new Error("ENOENT claude"); };
    const handle = await driver.startTask(input(), h.io);
    expect(await handle.done).toMatchObject({ status: "failed", error: expect.stringContaining("ENOENT") });
  });

  test("an unsafe launch (bad model id) fails the turn without spawning", async () => {
    const { h, driver } = make();
    const handle = await driver.startTask(input({ assignment: { runnerId: "claude", modelId: "--bare" } }), h.io);
    expect((await handle.done).status).toBe("failed");
    expect(h.spawns).toHaveLength(0);
    expect(h.events[0]).toMatchObject({ kind: "diagnostic", data: { code: "claude-invalid-model" } });
  });
});

describe("Claude driver interrupt (XR-5.4, task 1.14)", () => {
  test("SIGINT goes to the CLI only; a clean error_during_execution result is `interrupted` and cancels the escalation", async () => {
    const { h, driver, timers } = make();
    const handle = await driver.startTask(input(), h.io);
    const child = await h.nextChild();
    await handle.interrupt();
    expect(child.interrupts).toBe(1);
    expect(child.terminations).toHaveLength(0);
    child.lines(withSession("turn-interrupted.jsonl"));
    child.exit();
    expect(await handle.done).toEqual({ status: "interrupted" });
    timers.advance(60_000);
    expect(child.terminations).toHaveLength(0);
    expect(timers.pending).toBe(0);
  });

  test("an ignored interrupt escalates after 10 s to a group terminate and reports interrupted-forced", async () => {
    const { h, driver, timers } = make();
    const handle = await driver.startTask(input(), h.io);
    const child = await h.nextChild();
    await handle.interrupt();
    timers.advance(9_999);
    expect(child.terminations).toHaveLength(0);
    timers.advance(1);
    expect(child.terminations).toEqual([2_000]);
    expect(await handle.done).toEqual({ status: "interrupted-forced" });
    expect(h.events.some((e) => e.data.code === "claude-interrupt-escalated")).toBe(true);
  });

  test("an unreachable anchor escalates immediately", async () => {
    const { h, driver } = make();
    const handle = await driver.startTask(input(), h.io);
    const child = await h.nextChild();
    child.interruptDelivered = false;
    await handle.interrupt();
    expect(child.terminations).toHaveLength(1);
    expect(await handle.done).toEqual({ status: "interrupted-forced" });
  });

  test("repeated interrupts are idempotent and an interrupt after the turn ended is a no-op", async () => {
    const { h, driver } = make();
    const handle = await driver.startTask(input(), h.io);
    const child = await h.nextChild();
    await handle.interrupt();
    await handle.interrupt();
    expect(child.interrupts).toBe(1);
    child.lines(withSession("turn-interrupted.jsonl"));
    child.exit();
    await handle.done;
    await handle.interrupt();
    expect(child.interrupts).toBe(1);
  });

  test("a turn that finished successfully despite the interrupt stays completed", async () => {
    const { h, driver } = make();
    const handle = await driver.startTask(input(), h.io);
    const child = await h.nextChild();
    await handle.interrupt();
    child.lines(withSession("turn-success.jsonl"));
    child.exit();
    expect(await handle.done).toEqual({ status: "completed" });
  });
});

describe("Claude driver follow-up turns and close", () => {
  test("send() resumes the same native session in a new process and returns that turn's outcome", async () => {
    const { h, driver } = make();
    const handle = await driver.startTask(input(), h.io);
    const first = await h.nextChild();
    first.lines(withSession("turn-success.jsonl"));
    first.exit();
    await handle.done;
    const pending = handle.send("What did I ask?");
    const second = await h.nextChild(2);
    expect(h.spawns[1]!.args).toContain("--resume");
    expect(h.spawns[1]!.args[h.spawns[1]!.args.indexOf("--resume") + 1]).toBe(SID);
    expect(h.spawns[1]!.args).not.toContain("--session-id");
    expect(JSON.parse(second.stdin[0]!).message.content).toBe("What did I ask?");
    second.lines(withSession("turn-resume.jsonl"));
    second.exit();
    expect(await pending).toEqual({ status: "completed" });
  });

  test("send() while a turn runs is rejected", async () => {
    const { h, driver } = make();
    const handle = await driver.startTask(input(), h.io);
    await h.nextChild();
    await expect(handle.send("again")).rejects.toThrow(/already running/);
  });

  test("a task started with resume never passes --session-id", async () => {
    const { h, driver } = make();
    await driver.startTask(input({ nativeSessionId: undefined, resume: { nativeSessionId: SID } }), h.io);
    await h.nextChild();
    expect(h.spawns[0]!.args).toContain("--resume");
    expect(h.spawns[0]!.args).not.toContain("--session-id");
  });

  test("close() ends the running process group and further sends fail", async () => {
    const { h, driver } = make();
    const handle = await driver.startTask(input(), h.io);
    const child = await h.nextChild();
    await handle.close();
    expect(child.terminations).toHaveLength(1);
    await handle.done;
    await expect(handle.send("x")).rejects.toThrow(/closed/);
  });
});

describe("Claude driver probe (XR-4.6, XR-12.1, task 1.13)", () => {
  const probeWith = (stdout: string | Error, tos?: () => boolean) =>
    createClaudeSessionDriver({
      exec: async () => { if (stdout instanceof Error) throw stdout; return { code: 0, stdout }; },
      ...(tos ? { tosAcknowledged: tos } : {}),
    }).probe({ cwd: "/tmp" });

  test("in range: ready, isolation verified, capabilities listed", async () => {
    expect(await probeWith("2.1.296 (Claude Code)\n")).toMatchObject({
      status: "ready", version: "2.1.296", mcpIsolationVerified: true,
      capabilities: expect.arrayContaining(["caller-assigned-session-id", "approval-relay", "strict-mcp-config"]),
    });
  });
  test("above the tested maximum: degraded (continues); below the minimum: blocked", async () => {
    expect(await probeWith("2.2.0 (Claude Code)")).toMatchObject({ status: "degraded", reasonCode: "claude-version-untested", version: "2.2.0" });
    expect(await probeWith("2.1.218 (Claude Code)")).toMatchObject({ status: "blocked", reasonCode: "claude-version-unsupported" });
  });
  test("missing or unparsable executable: blocked", async () => {
    expect(await probeWith(new Error("ENOENT"))).toMatchObject({ status: "blocked", reasonCode: "claude-not-installed" });
    expect(await probeWith("garbage")).toMatchObject({ status: "blocked", reasonCode: "claude-version-unparsable" });
  });
  test("ToS gate (XR-12.1): unacknowledged blocks before anything runs; acknowledged proceeds", async () => {
    let ran = false;
    const blocked = await createClaudeSessionDriver({ tosAcknowledged: () => false, exec: async () => { ran = true; return { code: 0, stdout: "2.1.296" }; } }).probe({ cwd: "/tmp" });
    expect(blocked).toMatchObject({ status: "blocked", reasonCode: "claude-session-tos-unacknowledged" });
    expect(ran).toBe(false);
    expect((await probeWith("2.1.296 (Claude Code)", () => true)).status).toBe("ready");
  });
});
