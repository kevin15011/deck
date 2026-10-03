import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { parseAgentMarkdown } from "./agents";
import { createChildRunner } from "./runner";

const FAKE_PI = fileURLToPath(new URL("../../__fixtures__/fake-pi-child.mjs", import.meta.url));

let dir: string;
let logPath: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "deck-runner-"));
  logPath = join(dir, "children.jsonl");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const INVESTIGATE = parseAgentMarkdown("deck-investigate", "---\nname: deck-investigate\nmodel: anthropic/sonnet\ntools: read,grep,find,ls,mcp__codebase_memory__search_graph\nthinking: medium\n---\n\nYou investigate.\n");
const APPLY = parseAgentMarkdown("deck-apply-fast", "---\nname: deck-apply-fast\ntools: read,write,bash\n---\n\nYou apply.\n");

function runner(overrides: Parameters<typeof createChildRunner>[0] = {}) {
  return createChildRunner({
    piInvocation: (args) => ({ command: process.execPath, args: [FAKE_PI, ...args] }),
    env: { PATH: process.env.PATH ?? "", FAKE_PI_LOG: logPath, DECK_RUNNER_MEMORY_TOKEN: "leaked-token", DECK_RUNNER_MEMORY_TOKEN_FILE: "/parent/file" },
    memory: () => ({ endpoint: "http://127.0.0.1:9/deck-runner-memory/v1", tokenFile: "/run/deck/token" }),
    killGraceMs: 150,
    ...overrides,
  });
}

const records = () => readFileSync(logPath, "utf8").trim().split("\n").map((line) => JSON.parse(line));

describe("child spawn contract", () => {
  test("spawns pi in JSON print mode with the assigned model/thinking, read-only tools and the role prompt file", async () => {
    const result = await runner().run({ agent: INVESTIGATE, task: "find the entry point", cwd: dir });
    expect(result.failed).toBe(false);
    expect(result.text).toBe("ECHO(anthropic/sonnet|medium|read,grep,find,ls,mcp__codebase_memory__search_graph): find the entry point");
    const [record] = records();
    expect(record.argv.slice(0, 4)).toEqual(["--mode", "json", "-p", "--no-session"]);
    expect(record.argv).toContain("--append-system-prompt");
    expect(record.argv.at(-1)).toBe("Task: find the entry point");
    expect(record.promptText).toBe("You investigate.\n");
    expect(record.promptFileExists).toBe(true);
    expect(record.cwd).toBe(dir);
  });

  test("stdin is ignored (never a pipe or TTY) so a non-TTY parent cannot hang the child", async () => {
    await runner().run({ agent: INVESTIGATE, task: "x", cwd: dir });
    expect(records()[0].stdinTarget).toBe("/dev/null");
  });

  test("the role prompt temp file is deleted after the child exits", async () => {
    await runner().run({ agent: INVESTIGATE, task: "x", cwd: dir });
    const promptFile = records()[0].argv[records()[0].argv.indexOf("--append-system-prompt") + 1] as string;
    expect(existsSync(promptFile)).toBe(false);
  });

  test("write-capable roles get no --tools allowlist and an unassigned role carries no model override", async () => {
    await runner().run({ agent: APPLY, task: "edit it", cwd: dir });
    const [record] = records();
    expect(record.argv).not.toContain("--tools");
    expect(record.argv).not.toContain("--model");
    expect(record.argv).not.toContain("--thinking");
  });

  test("a read-only role without a frontmatter allowlist falls back to the built-in read tools", async () => {
    const bare = parseAgentMarkdown("deck-quality", "---\nname: deck-quality\n---\n\nQ\n");
    await runner().run({ agent: bare, task: "check", cwd: dir });
    const record = records()[0];
    expect(record.argv[record.argv.indexOf("--tools") + 1]).toBe("read,grep,find,ls");
  });

  test("an invalid thinking level is rejected before any child is spawned", async () => {
    const bad = parseAgentMarkdown("deck-architect", "---\nname: deck-architect\nmodel: m\nthinking: ultra\n---\n\nA\n");
    const result = await runner().run({ agent: bad, task: "x", cwd: dir });
    expect(result.failed).toBe(true);
    expect(result.errorMessage).toContain("ultra");
    expect(existsSync(logPath)).toBe(false);
  });
});

describe("child isolation env", () => {
  test("marks the child, passes endpoint and token-file path, and never forwards the bearer token", async () => {
    await runner().run({ agent: INVESTIGATE, task: "x", cwd: dir });
    const { env } = records()[0];
    expect(env).toMatchObject({ DECK_PI_SESSION: "1", DECK_PI_CHILD: "1", DECK_PI_ROLE: "investigate", DECK_RUNNER_MEMORY_ENDPOINT: "http://127.0.0.1:9/deck-runner-memory/v1", DECK_RUNNER_MEMORY_TOKEN_FILE: "/run/deck/token" });
    expect(env.DECK_RUNNER_MEMORY_TOKEN).toBeUndefined();
  });

  test("without a memory handoff no memory variables reach the child", async () => {
    await runner({ memory: () => undefined }).run({ agent: INVESTIGATE, task: "x", cwd: dir });
    const { env } = records()[0];
    expect(env.DECK_RUNNER_MEMORY_TOKEN_FILE).toBeUndefined();
    expect(env.DECK_RUNNER_MEMORY_TOKEN).toBeUndefined();
  });
});

describe("failure and abort handling", () => {
  test("a non-zero exit becomes a failed result with a bounded stderr excerpt", async () => {
    const result = await runner().run({ agent: INVESTIGATE, task: "FAIL now", cwd: dir });
    expect(result.failed).toBe(true);
    expect(result.exitCode).toBe(1);
    expect(result.errorMessage).toContain("model not found");
    expect(result.errorMessage!.length).toBeLessThan(2500);
  });

  test("a spawn error is a failed result, not an exception", async () => {
    const result = await runner({ piInvocation: () => ({ command: "/nonexistent/pi-binary", args: [] }) }).run({ agent: INVESTIGATE, task: "x", cwd: dir });
    expect(result.failed).toBe(true);
  });

  test("abort sends SIGTERM and the child ends", async () => {
    const controller = new AbortController();
    const pending = runner().run({ agent: INVESTIGATE, task: "SLEEP", cwd: dir, signal: controller.signal });
    await Bun.sleep(300);
    controller.abort();
    const result = await pending;
    expect(result.aborted).toBe(true);
    expect(result.failed).toBe(true);
  });

  test("a child that ignores SIGTERM is killed with SIGKILL after the grace period", async () => {
    const controller = new AbortController();
    const started = Date.now();
    const pending = runner({ killGraceMs: 200 }).run({ agent: INVESTIGATE, task: "IGNORE_TERM", cwd: dir, signal: controller.signal });
    await Bun.sleep(300);
    controller.abort();
    const result = await pending;
    expect(result.aborted).toBe(true);
    expect(Date.now() - started).toBeGreaterThanOrEqual(450);
    expect(Date.now() - started).toBeLessThan(4000);
  });

  test("killAll terminates in-flight children (lead shutdown)", async () => {
    const instance = runner({ killGraceMs: 150 });
    const pending = instance.run({ agent: INVESTIGATE, task: "SLEEP", cwd: dir });
    await Bun.sleep(300);
    instance.killAll();
    const result = await pending;
    expect(result.failed).toBe(true);
  });

  test("a child that exceeds the timeout is terminated and reported as timed out", async () => {
    const result = await runner({ timeoutMs: 300 }).run({ agent: INVESTIGATE, task: "SLEEP", cwd: dir });
    expect(result.timedOut).toBe(true);
    expect(result.failed).toBe(true);
    expect(result.errorMessage).toContain("timed out");
  });
});
