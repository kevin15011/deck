import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { createDeckSubagentsExtension } from "./extension";

const FAKE_PI = fileURLToPath(new URL("../../__fixtures__/fake-pi-child.mjs", import.meta.url));

let dir: string;
let logPath: string;
let agentsDir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "deck-subagents-"));
  logPath = join(dir, "children.jsonl");
  agentsDir = join(dir, "agents");
  ctx = { cwd: dir };
  mkdirSync(agentsDir);
  writeFileSync(join(agentsDir, "deck-investigate.md"), "---\nname: deck-investigate\nmodel: anthropic/sonnet\nthinking: low\ntools: read,grep,find,ls\n---\n\nInvestigate.\n");
  writeFileSync(join(agentsDir, "deck-quality.md"), "---\nname: deck-quality\nmodel: openai/gpt-5\nthinking: high\ntools: read,grep,find,ls\n---\n\nQuality.\n");
  writeFileSync(join(agentsDir, "deck-apply-fast.md"), "---\nname: deck-apply-fast\ntools: read,write,bash\n---\n\nApply.\n");
  writeFileSync(join(agentsDir, "deck-lead.md"), "---\nname: deck-lead\n---\n\nLead.\n");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

type Tool = { name: string; description: string; parameters: any; execute: (id: string, params: any, signal: AbortSignal | undefined, onUpdate: any, ctx: any) => Promise<any> };

function load(env: Record<string, string | undefined> = {}) {
  const tools: Tool[] = [];
  const handlers: Record<string, Array<(event: any, ctx: any) => unknown>> = {};
  const factory = createDeckSubagentsExtension({
    agentsDir,
    env: { PATH: process.env.PATH ?? "", FAKE_PI_LOG: logPath, ...env },
    piInvocation: (args) => ({ command: process.execPath, args: [FAKE_PI, ...args] }),
    killGraceMs: 150,
  });
  factory({ registerTool: (tool: Tool) => tools.push(tool), on: (name: string, handler: any) => { (handlers[name] ??= []).push(handler); } } as never);
  return { tools, handlers };
}

let ctx: { cwd: string };
const text = (result: any) => result.content.map((part: any) => part.text).join("");
const records = () => (existsSync(logPath) ? readFileSync(logPath, "utf8").trim().split("\n").map((line) => JSON.parse(line)) : []);

describe("registration", () => {
  test("registers one `subagent` tool describing the delegable roles", () => {
    const { tools } = load();
    expect(tools.map((tool) => tool.name)).toEqual(["subagent"]);
    expect(tools[0]!.description).toContain("deck-investigate");
    expect(tools[0]!.description).not.toContain("deck-lead");
    expect(Object.keys(tools[0]!.parameters.properties).sort()).toEqual(["agent", "chain", "cwd", "task", "tasks"]);
  });

  test("never registers in a subagent child (no recursion)", () => {
    const { tools, handlers } = load({ DECK_PI_CHILD: "1", DECK_PI_SESSION: "1", DECK_PI_ROLE: "investigate" });
    expect(tools).toEqual([]);
    expect(handlers.session_shutdown).toBeUndefined();
  });
});

describe("single mode", () => {
  test("delegates to one child and returns its final output", async () => {
    const { tools } = load();
    const result = await tools[0]!.execute("c1", { agent: "deck-investigate", task: "map the code" }, undefined, undefined, ctx);
    expect(result.isError).toBeUndefined();
    expect(text(result)).toBe("ECHO(anthropic/sonnet|low|read,grep,find,ls): map the code");
    expect(records()).toHaveLength(1);
  });

  test("an unknown role is an error result and no child is spawned", async () => {
    const { tools } = load();
    const result = await tools[0]!.execute("c1", { agent: "deck-wizard", task: "x" }, undefined, undefined, ctx);
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("Unknown agent");
    expect(text(result)).toContain("deck-investigate");
    expect(records()).toHaveLength(0);
  });

  test("the lead cannot delegate to itself", async () => {
    const { tools } = load();
    const result = await tools[0]!.execute("c1", { agent: "deck-lead", task: "x" }, undefined, undefined, ctx);
    expect(result.isError).toBe(true);
    expect(records()).toHaveLength(0);
  });

  test("a child crash is an error result with a stderr excerpt and does not throw", async () => {
    const { tools } = load();
    const result = await tools[0]!.execute("c1", { agent: "deck-quality", task: "FAIL please" }, undefined, undefined, ctx);
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("model not found");
  });

  test("ambiguous or empty parameters are rejected with guidance", async () => {
    const { tools } = load();
    const both = await tools[0]!.execute("c1", { agent: "deck-quality", task: "x", tasks: [{ agent: "deck-quality", task: "y" }] }, undefined, undefined, ctx);
    expect(both.isError).toBe(true);
    const none = await tools[0]!.execute("c1", {}, undefined, undefined, ctx);
    expect(none.isError).toBe(true);
    expect(records()).toHaveLength(0);
  });
});

describe("parallel mode", () => {
  test("runs tasks concurrently and returns every result in order", async () => {
    const { tools } = load();
    const result = await tools[0]!.execute("c1", { tasks: [{ agent: "deck-investigate", task: "HOLD one" }, { agent: "deck-quality", task: "HOLD two" }] }, undefined, undefined, ctx);
    expect(result.isError).toBeUndefined();
    expect(text(result)).toContain("2/2 succeeded");
    expect(text(result).indexOf("HELD: HOLD one")).toBeLessThan(text(result).indexOf("HELD: HOLD two"));
    const starts = records().filter((r) => r.startedAt);
    const ends = records().filter((r) => r.endedAt);
    expect(Math.max(...starts.map((r) => r.startedAt))).toBeLessThan(Math.min(...ends.map((r) => r.endedAt)));
  });

  test("never runs more than 4 children at once", async () => {
    const { tools } = load();
    const tasks = Array.from({ length: 8 }, (_, index) => ({ agent: "deck-investigate", task: `HOLD ${index}` }));
    const result = await tools[0]!.execute("c1", { tasks }, undefined, undefined, ctx);
    expect(text(result)).toContain("8/8 succeeded");
    const events = records().flatMap((r) => (r.startedAt ? [{ at: r.startedAt as number, delta: 1 }] : r.endedAt ? [{ at: r.endedAt as number, delta: -1 }] : []));
    events.sort((a, b) => a.at - b.at || a.delta - b.delta);
    let running = 0;
    let peak = 0;
    for (const event of events) { running += event.delta; peak = Math.max(peak, running); }
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThanOrEqual(2);
  });

  test("more than 8 tasks is rejected before any child starts", async () => {
    const { tools } = load();
    const tasks = Array.from({ length: 9 }, () => ({ agent: "deck-investigate", task: "x" }));
    const result = await tools[0]!.execute("c1", { tasks }, undefined, undefined, ctx);
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("Max is 8");
    expect(records()).toHaveLength(0);
  });

  test("one failing task does not hide the others", async () => {
    const { tools } = load();
    const result = await tools[0]!.execute("c1", { tasks: [{ agent: "deck-investigate", task: "fine" }, { agent: "deck-quality", task: "FAIL" }] }, undefined, undefined, ctx);
    expect(text(result)).toContain("1/2 succeeded");
    expect(text(result)).toContain("ECHO(");
    expect(text(result)).toContain("failed");
  });
});

describe("chain mode", () => {
  test("passes the previous step output through {previous} and returns the last output", async () => {
    const { tools } = load();
    const result = await tools[0]!.execute("c1", { chain: [{ agent: "deck-investigate", task: "first" }, { agent: "deck-quality", task: "review: {previous}" }] }, undefined, undefined, ctx);
    expect(text(result)).toBe("ECHO(openai/gpt-5|high|read,grep,find,ls): review: ECHO(anthropic/sonnet|low|read,grep,find,ls): first");
  });

  test("stops at the first failing step", async () => {
    const { tools } = load();
    const result = await tools[0]!.execute("c1", { chain: [{ agent: "deck-investigate", task: "FAIL" }, { agent: "deck-quality", task: "never {previous}" }] }, undefined, undefined, ctx);
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("Chain stopped at step 1");
    expect(records()).toHaveLength(1);
  });
});

describe("lifecycle", () => {
  test("aborting the tool call terminates the child and returns an error result", async () => {
    const { tools } = load();
    const controller = new AbortController();
    const pending = tools[0]!.execute("c1", { agent: "deck-investigate", task: "SLEEP" }, controller.signal, undefined, ctx);
    await Bun.sleep(300);
    controller.abort();
    const result = await pending;
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("aborted");
  });

  test("session shutdown kills running children", async () => {
    const { tools, handlers } = load();
    const pending = tools[0]!.execute("c1", { agent: "deck-investigate", task: "SLEEP" }, undefined, undefined, ctx);
    await Bun.sleep(300);
    for (const handler of handlers.session_shutdown ?? []) await handler({ type: "session_shutdown", reason: "quit" }, ctx);
    const result = await pending;
    expect(result.isError).toBe(true);
  });
});
