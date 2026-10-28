import { buildPiGlobalMaterialization } from "../../global-materialization";
import { createNodePiFileIO, planPiGlobalInstall, applyPiGlobalPlan } from "../../pi-global-install";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
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
  // protects: only a verified, live owned child can establish invocation identity;
  // oracle: Slice 3 requires selection -> child correlation -> current invocation.
  test.each(["generation", "exit", "cancel", "wrong-session", "wrong-nonce", "wrong-parent"])("binds verified selection to native lifecycle: %s", async mode => {
    const desired = buildPiGlobalMaterialization({ agentDir: dir, projectRoot: dir, legacyDeckEvidence: false }).desired;
    const io = createNodePiFileIO(); applyPiGlobalPlan(planPiGlobalInstall(desired, io), io);
    const packageRoot = join(dir, "deck/package");
    const rolePath = join(packageRoot, "agents/deck-setup.md");
    const agent = parseAgentMarkdown("deck-setup", readFileSync(rolePath, "utf8"));
    writeFileSync(join(dir, "child.jsonl"), JSON.stringify({type:"session", id:"native-child", deckParent:mode === "wrong-parent" ? "different" : "parent", deckTaskId:"task", cwd:dir}) + "\n", {mode:0o600});
    const child = join(dir, "lifecycle.ts");
    writeFileSync(child, `
      import { installChildClarifications } from ${JSON.stringify(join(import.meta.dir, "clarification.ts"))};
      const handlers = {};
      installChildClarifications({ registerTool() {}, on: (name, fn) => handlers[name] = fn }, {...process.env, ...( ${JSON.stringify(mode)} === "wrong-nonce" ? {DECK_PI_CLARIFICATION_NONCE:"forged"} : {})});
      if (process.env.DECK_PI_CONTAINMENT) process.send({version:1, nonce:process.env.DECK_PI_CONTAINMENT, pid:process.pid});
      handlers.session_start({}, { sessionManager: { getSessionId: () => ${JSON.stringify(mode)} === "wrong-session" ? "another-child" : "native-child", getSessionFile: () => process.env.DECK_PI_CHILD_SESSION } });
      setTimeout(() => { handlers.session_shutdown(); }, 250);
    `);
    const bindings: any[] = [];
    const controller = new AbortController();
    const owned = runner({ packageRoot,
      piInvocation: args => ({ command: process.execPath, args: [child, ...args] }),
      onVerifiedInvocation: binding => {
        bindings.push(binding);
        expect(binding.current()).toBe(true);
        if (mode === "cancel") { controller.abort(); expect(binding.current()).toBe(false); }
        if (mode !== "generation") return;
        const original = readFileSync(rolePath, "utf8");
        writeFileSync(rolePath, original + "changed");
        expect(binding.current()).toBe(false);
        writeFileSync(rolePath, original);
        // Once revoked, restoring bytes cannot revive an invocation.
        expect(binding.current()).toBe(false);
      },
    });
    const result = await owned.run({ agent, task: "identity", cwd: dir, parentId: "parent", taskId: "task", attempt: 2, sessionFile: join(dir, "child.jsonl"), signal: controller.signal });
    expect(result.failed).toBe(mode === "cancel");
    if (mode.startsWith("wrong-")) { expect(bindings).toHaveLength(0); return; }
    expect(bindings).toHaveLength(1);
    expect(bindings[0]).toMatchObject({ roleId: "deck-setup", nativeSessionId: "native-child", taskId: "task", attempt: 2, parentId: "parent" });
    expect(bindings[0].current()).toBe(false);
  });
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
    expect(realpathSync(record.cwd)).toBe(realpathSync(dir));
  });

  test("passes the Deck package as a CLI package source so its skills win name collisions in children", async () => {
    const desired=buildPiGlobalMaterialization({agentDir:dir,projectRoot:dir,legacyDeckEvidence:false}).desired;
    const io=createNodePiFileIO(); applyPiGlobalPlan(planPiGlobalInstall(desired,io),io);
    const packageRoot=join(dir,"deck/package");
    const agent=parseAgentMarkdown("deck-quality",readFileSync(join(packageRoot,"agents/deck-quality.md"),"utf8"));
    const result=await runner({ packageRoot }).run({ agent, task: "x", cwd: dir });
    expect(result.failed).toBe(false);
    const { argv } = records()[0];
    expect(argv[argv.indexOf("--extension") + 1]).toBe(packageRoot);
    expect(argv.indexOf("--extension")).toBeLessThan(argv.indexOf("Task: x"));
    for (const relative of ["agents/deck-quality.md","role-policy.json","extensions/deck-tool-policy/impl.js","extensions/deck-subagents/index.js"]) {
      const path=join(packageRoot,relative), before=readFileSync(path,"utf8");
      writeFileSync(path,before+"changed");
      const rejected=await runner({packageRoot}).run({agent,task:"must not spawn",cwd:dir});
      expect(rejected.failed).toBe(true); expect(rejected.errorMessage).toContain("Review & Install");
      expect(records()).toHaveLength(1);
      writeFileSync(path,before);
    }
  });

  test("without a package root no --extension flag is added", async () => {
    await runner().run({ agent: APPLY, task: "x", cwd: dir });
    expect(records()[0].argv).not.toContain("--extension");
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
    expect(record.argv[record.argv.indexOf("--tools") + 1]).toBe("read,grep,find,ls,memory_search");
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
  test("forwards the parent readiness reference unchanged to native child lifecycles", async () => {
    const environment = { DECK_SESSION_START_CONTEXT: "/private/context.json", DECK_SESSION_START_DIGEST: "digest", DECK_SESSION_START_GENERATION: "generation", DECK_SESSION_START_EPOCH: "epoch" };
    const result = await runner({ env: { PATH: process.env.PATH ?? "", FAKE_PI_LOG: logPath, ...environment } }).run({ agent: INVESTIGATE, task: "readiness handoff", cwd: dir });
    expect(result.failed).toBe(false);
    expect(records()[0].env).toMatchObject(environment);
  });
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
    const started = performance.now();
    const pending = runner({ killGraceMs: 200 }).run({ agent: INVESTIGATE, task: "IGNORE_TERM", cwd: dir, signal: controller.signal });
    await Bun.sleep(300);
    controller.abort();
    const result = await pending;
    expect(result.aborted).toBe(true);
    expect(performance.now() - started).toBeGreaterThanOrEqual(450);
    expect(performance.now() - started).toBeLessThan(4000);
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

test('personal native MCP declarations reach read-only member --tools without expanding built-in authority',async()=>{
 const result=await runner({personalToolNames:()=>['mcp__docs__lookup','mcp__docs__lookup']}).run({agent:INVESTIGATE,task:'inspect',cwd:dir});
 expect(result.failed).toBe(false);const argv=records()[0].argv;expect(argv[argv.indexOf('--tools')+1]).toBe('read,grep,find,ls,mcp__codebase_memory__search_graph,mcp__docs__lookup');expect(argv[argv.indexOf('--tools')+1]).not.toContain('bash');
});

// Protects tool-level cancellation while a parent repair is waiting for its target lock.
test("native repair cancellation revokes the exact pending IPC invocation", async () => {
  const desired = buildPiGlobalMaterialization({ agentDir: dir, projectRoot: dir, legacyDeckEvidence: false }).desired;
  const io = createNodePiFileIO(); applyPiGlobalPlan(planPiGlobalInstall(desired, io), io);
  const packageRoot = join(dir, "deck/package"), sessionFile = join(dir, "child.jsonl");
  const agent = parseAgentMarkdown("deck-setup", readFileSync(join(packageRoot, "agents/deck-setup.md"), "utf8"));
  writeFileSync(sessionFile, JSON.stringify({ type: "session", id: "native", deckParent: "parent", deckTaskId: "task", cwd: dir }) + "\n", { mode: 0o600 });
  const child = join(dir, "cancel-repair.ts");
  writeFileSync(child, `
    import { installChildClarifications } from ${JSON.stringify(join(import.meta.dir, "clarification.ts"))};
    const handlers = {}; let tool;
    installChildClarifications({ on: (name, fn) => handlers[name] = fn, registerTool: t => tool = t }, process.env);
    process.send({version:1, nonce:process.env.DECK_PI_CONTAINMENT, pid:process.pid});
    const ctx = { sessionManager: {getSessionId: () => "native", getSessionFile: () => process.env.DECK_PI_CHILD_SESSION} };
    handlers.session_start({}, ctx);
    const ac = new AbortController();
    const keep = setInterval(() => {}, 1000);
    const pending = tool.execute("call", {snapshotId:"snapshot",components:["retired-testing-policy"]}, ac.signal, undefined, ctx);
    setTimeout(() => ac.abort(), 150);
    try { await pending; } catch {}
    setTimeout(() => { handlers.session_shutdown(); clearInterval(keep); }, 300);
  `);
  let checked = false;
  const owned = runner({ packageRoot, piInvocation: args => ({ command: process.execPath, args: [child, ...args] }),
    repair: async binding => {
      expect(binding.current()).toBe(true);
      await Bun.sleep(250);
      expect(binding.current()).toBe(false);
      checked = true;
      throw new Error("cancelled");
    },
  });
  const result = await owned.run({ agent, task: "repair", cwd: dir, parentId: "parent", taskId: "task", attempt: 1, sessionFile });
  expect(result.failed).toBe(false); expect(checked).toBe(true);
});
