#!/usr/bin/env bun
/**
 * Opt-in LIVE contract check for a runner session driver (design 11, tasks 1.13/1.14, XR-11.3).
 * NOT a CI gate and never run by `bun test`: it calls the real, signed-in native CLI with a
 * few trivial prompts (`--model haiku --tools ""`) in a temp directory. It never reads
 * credential files.
 *
 *   bun run scripts/session-contract-live.ts claude [--model haiku] [--keep]
 *
 * Checks (Claude): probe; per-turn isolation (init MCP list equals the Deck-computed set);
 * hooks are NOT executed (a project marker hook must not fire); `--session-id` then `--resume`
 * keep context; SIGINT yields a clean `interrupted` outcome. Exit code 1 when any check fails.
 */
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createClaudeSessionDriver } from "../packages/adapter-claude/src/session-driver/driver";
import { Supervisor } from "../packages/session-host/src/supervisor";
import { createDriverSpawn } from "../packages/session-host/src/driver-spawn";
import type { DriverEvent, DriverTaskInput } from "../packages/core/src/session/driver";

const root = resolve(import.meta.dir, "..");
const args = process.argv.slice(2);
const runner = args[0];
const model = args.includes("--model") ? args[args.indexOf("--model") + 1]! : "haiku";
const keep = args.includes("--keep");
if (runner !== "claude") {
  console.error("usage: bun run scripts/session-contract-live.ts claude [--model haiku] [--keep]");
  process.exit(2);
}

/** Minimal stdio MCP server standing in for the Deck bridge: enough for the CLI to list it as `deck`. */
const STUB_MCP = `
const rl = require("node:readline").createInterface({ input: process.stdin });
const send = (m) => process.stdout.write(JSON.stringify(m) + "\\n");
rl.on("line", (l) => { let m; try { m = JSON.parse(l); } catch { return; }
  if (m.method === "initialize") return send({ jsonrpc: "2.0", id: m.id, result: { protocolVersion: m.params?.protocolVersion || "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "deck", version: "0.0.0" } } });
  if (m.method === "tools/list") return send({ jsonrpc: "2.0", id: m.id, result: { tools: [{ name: "deck_status", description: "status", inputSchema: { type: "object", properties: {} } }] } });
  if (m.id !== undefined) send({ jsonrpc: "2.0", id: m.id, result: {} }); });
`;

const base = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), "deck-live-")));
const project = join(base, "project");
const task = join(base, "task");
mkdirSync(join(project, ".claude"), { recursive: true });
mkdirSync(task, { recursive: true, mode: 0o700 });
const marker = join(base, "hook-marker");
writeFileSync(join(project, ".claude", "settings.json"), JSON.stringify({ hooks: {
  SessionStart: [{ hooks: [{ type: "command", command: `touch ${marker}-start` }] }],
  UserPromptSubmit: [{ hooks: [{ type: "command", command: `touch ${marker}-prompt` }] }],
} }));
writeFileSync(join(task, "stub-mcp.cjs"), STUB_MCP);

const checks: Array<{ name: string; ok: boolean; detail?: unknown }> = [];
const check = (name: string, ok: boolean, detail?: unknown) => { checks.push({ name, ok, ...(detail === undefined ? {} : { detail }) }); };

const supervisor = new Supervisor({ anchorCommand: [process.execPath, join(root, "apps/cli/src/main.tsx"), "internal", "child-anchor"] });
const driver = createClaudeSessionDriver({ tosAcknowledged: () => true, extraArgs: ["--tools", ""] });
const events: DriverEvent[] = [];
const io = {
  spawn: createDriverSpawn(supervisor),
  emit: (e: DriverEvent) => { events.push(e); },
  approval: async () => ({ decision: "deny" as const }),
  writePrivateFile: (name: string, content: string) => { const f = join(task, name); writeFileSync(f, content, { mode: 0o600 }); chmodSync(f, 0o600); return f; },
};
const nativeSessionId = driver.newNativeSessionId!();
const input = (prompt: string): DriverTaskInput => ({
  taskId: "live", memberId: "lead", cwd: project, assignment: { runnerId: "claude", modelId: model },
  rolePrompt: "You are a terse test assistant.", prompt, nativeSessionId,
  mcp: { servers: ["deck"], sessionTools: ["deck_status"] },
  mcpServerSpecs: { deck: { command: process.execPath, args: [join(task, "stub-mcp.cjs")], env: {} } },
  approvals: "relay", credentialFile: join(task, "credential"), disableNativeDelegation: true,
});

try {
  const probe = await driver.probe({ cwd: project });
  check("probe ready (version in the tested range)", probe.status === "ready", probe);

  const t1 = await driver.startTask(input("Reply with exactly: pong"), io);
  const o1 = await t1.done;
  check("turn 1 completed", o1.status === "completed", o1);
  const init = events.find((e) => e.kind === "turn.started");
  check("init MCP set equals the Deck-computed set", JSON.stringify(init?.data.mcpServers) === JSON.stringify(["deck"]), init?.data);
  check("native session id honored (--session-id)", init?.data.nativeSessionId === nativeSessionId, init?.data.nativeSessionId);
  check("hooks not executed (marker absent, no hook diagnostic)", !existsSync(`${marker}-start`) && !existsSync(`${marker}-prompt`) && !events.some((e) => e.data.code === "claude-hook-executed"));
  check("assistant text mapped", events.some((e) => e.kind === "message.completed" && /pong/i.test(String(e.data.text))));

  events.length = 0;
  const o2 = await t1.send("What single word did I ask you to reply with? One word only.");
  check("turn 2 resumed the same session and completed", o2.status === "completed" && events.some((e) => e.kind === "message.completed" && /pong/i.test(String(e.data.text))), { o2, nativeSession: events.find((e) => e.kind === "turn.started")?.data.nativeSessionId });

  events.length = 0;
  const interrupted = await driver.startTask({ ...input("Write a very long essay of 3000 words about the history of computing."), nativeSessionId: driver.newNativeSessionId!() }, io);
  await new Promise((r) => setTimeout(r, 4000));
  await interrupted.interrupt();
  const o3 = await interrupted.done;
  check("SIGINT yields a clean `interrupted` outcome (error_during_execution)", o3.status === "interrupted", o3);
} catch (error) {
  check("script completed without exceptions", false, (error as Error).message);
} finally {
  await supervisor.shutdown(500);
  if (!keep) rmSync(base, { recursive: true, force: true });
}

console.log(JSON.stringify({ runner, model, tempDir: keep ? base : undefined, checks }, null, 2));
process.exit(checks.every((c) => c.ok) ? 0 : 1);
