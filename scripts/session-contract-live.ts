#!/usr/bin/env bun
/**
 * Opt-in LIVE contract check for a runner session driver (design 11, tasks 1.13/1.14, XR-11.3).
 * NOT a CI gate and never run by `bun test`: it calls the real, signed-in native CLI with a
 * few trivial prompts (`--model haiku --tools ""`) in a temp directory. It never reads
 * credential files.
 *
 *   bun run scripts/session-contract-live.ts claude|codex|opencode [--model id] [--keep] [--propose-shapes]
 *
 * Checks (Claude): probe; per-turn isolation (init MCP list equals the Deck-computed set);
 * hooks are NOT executed (a project marker hook must not fire); `--session-id` then `--resume`
 * keep context; SIGINT yields a clean `interrupted` outcome. Exit code 1 when any check fails.
 */
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createCodexSessionDriver } from "../packages/adapter-codex/src/session-driver/driver";
import { createOpenCodeSessionDriver } from "../packages/adapter-opencode/src/session-driver/driver";
import { createClaudeSessionDriver } from "../packages/adapter-claude/src/session-driver/driver";
import { collectContractShapes, compareContractShapes, type ContractShapes } from "./session-contract-shapes";
import { Supervisor } from "../packages/session-host/src/supervisor";
import { createDriverSpawn } from "../packages/session-host/src/driver-spawn";
import type { DriverEvent, DriverTaskInput } from "../packages/core/src/session/driver";

const root = resolve(import.meta.dir, "..");
const args = process.argv.slice(2);
const runner = args[0];
const model = args.includes("--model") ? args[args.indexOf("--model") + 1]! : runner === "opencode" ? "opencode/big-pickle" : runner === "codex" ? "gpt-6-luna" : "haiku";
const keep = args.includes("--keep");
const proposeShapes = args.includes("--propose-shapes");
if (!["claude", "codex", "opencode"].includes(runner!)) {
  console.error("usage: bun run scripts/session-contract-live.ts claude|codex|opencode [--model id] [--keep] [--propose-shapes]");
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
const driver = runner === "claude" ? createClaudeSessionDriver({ tosAcknowledged: () => true, extraArgs: ["--tools", ""] }) : runner === "codex" ? createCodexSessionDriver() : createOpenCodeSessionDriver();
const events: DriverEvent[] = [];
const contractEvents: DriverEvent[] = [];
let nativeVersion = driver.testedVersions.maxTested;
let approvalsDenied = 0;
let openCodeIsolation = false;
let openCodeNativeInspection: Promise<boolean> | undefined;
let openCodeInspectionDetail: Record<string, unknown> = {};
const spawn = createDriverSpawn(supervisor);
const io = {
  spawn: async (...parameters: Parameters<typeof spawn>) => {
    if (runner === "opencode") {
      const overlay = parameters[2]?.env;
      const config = JSON.parse(overlay?.OPENCODE_CONFIG_CONTENT ?? "{}");
      openCodeIsolation = overlay?.OPENCODE_DISABLE_PROJECT_CONFIG === "true"
        && overlay?.OPENCODE_DISABLE_CLAUDE_CODE === "true"
        && overlay?.OPENCODE_CONFIG_DIR === task && config.permission?.task === "deny"
        && JSON.stringify(Object.keys(config.mcp ?? {}).sort()) === JSON.stringify(["deck"])
        && typeof overlay?.OPENCODE_SERVER_PASSWORD === "string" && overlay.OPENCODE_SERVER_PASSWORD.length >= 32;
    }
    const child = await spawn(...parameters);
    if (runner === "opencode") {
      let inspected = false;
      let output = "";
      const overlay = parameters[2]?.env;
      openCodeNativeInspection = new Promise(resolveInspection => {
        const inspect = (chunk: string) => {
          output = (output + chunk).slice(-8192);
          const endpoint = /http:\/\/127\.0\.0\.1:\d+/.exec(output)?.[0];
          if (!endpoint || inspected) return;
          inspected = true;
          void (async () => {
            try {
              const headers = { authorization: `Basic ${Buffer.from(`opencode:${overlay?.OPENCODE_SERVER_PASSWORD}`).toString("base64")}` };
              const results = await Promise.all(["/mcp", "/config", "/experimental/tool/ids", "/doc"].map(async path => {
                const response = await fetch(endpoint + path, { headers, signal: AbortSignal.timeout(5000) });
                openCodeInspectionDetail[path] = { status: response.status, contentType: response.headers.get("content-type") };
                if (!response.ok) throw new Error(`OpenCode inspection failed: ${path}`);
                try { return await response.json(); } catch { throw new Error(`invalid-json:${path}`); }
              }));
              const [mcp, config, tools, doc] = results;
              const assertions = {
                exactMcp: JSON.stringify(Object.keys(mcp).sort()) === JSON.stringify(["deck"]),
                mcpConnected: mcp.deck?.status === "connected", taskDenied: config.permission?.task === "deny",
                noPlugins: Array.isArray(config.plugin) && config.plugin.length === 0,
                toolsArray: Array.isArray(tools), messageSchema: typeof doc.paths?.["/session/{sessionID}/message"] === "object",
              };
              openCodeInspectionDetail = { ...openCodeInspectionDetail, assertions, mcpStatuses: Object.fromEntries(Object.entries(mcp).map(([key, value]) => [key, (value as { status?: string }).status])), pluginShape: Array.isArray(config.plugin) ? "array" : typeof config.plugin, toolShape: Array.isArray(tools) ? "array" : typeof tools, messagePaths: Object.keys(doc.paths ?? {}).filter(path => path.includes("message")) };
              resolveInspection(Object.values(assertions).every(Boolean));
            } catch (error) { openCodeInspectionDetail.inspectionError = error instanceof Error && error.message.startsWith("invalid-json:") ? error.message : error instanceof Error ? error.name : "unknown"; resolveInspection(false); }
          })();
        };
        child.onStdout(inspect); child.onStderr(inspect);
        void child.exited.then(() => { if (!inspected) resolveInspection(false); });
      });
    }
    return child;
  },
  emit: (e: DriverEvent) => { events.push(e); contractEvents.push(e); },
  approval: async () => { approvalsDenied++; return { decision: "deny" as const }; },
  writePrivateFile: (name: string, content: string) => { const f = join(task, name); writeFileSync(f, content, { mode: 0o600 }); chmodSync(f, 0o600); return f; },
};
const nativeSessionId = driver.newNativeSessionId?.();
const input = (prompt: string): DriverTaskInput => ({
  taskId: "live", memberId: "lead", cwd: project, assignment: { runnerId: runner!, modelId: model },
  rolePrompt: "You are a terse test assistant.", prompt, nativeSessionId,
  mcp: { servers: ["deck"], sessionTools: ["deck_status"] },
  mcpServerSpecs: { deck: { command: process.execPath, args: [join(task, "stub-mcp.cjs")], env: {} } },
  approvals: "relay", credentialFile: join(task, "credential"), disableNativeDelegation: true,
});

try {
  const probe = await driver.probe({ cwd: project });
  nativeVersion = probe.version ?? nativeVersion;
  check("probe ready (version in the tested range)", probe.status === "ready", probe);

  const t1 = await driver.startTask(input("Reply with exactly: pong"), io);
  const o1 = await t1.done;
  check("turn 1 completed", o1.status === "completed", o1);
  const init = events.find((e) => e.kind === "turn.started");
  if (runner === "claude") {
  check("init MCP set equals the Deck-computed set", JSON.stringify(init?.data.mcpServers) === JSON.stringify(["deck"]), init?.data);
  check("native session id honored (--session-id)", init?.data.nativeSessionId === nativeSessionId, init?.data.nativeSessionId);
  check("hooks not executed (marker absent, no hook diagnostic)", !existsSync(`${marker}-start`) && !existsSync(`${marker}-prompt`) && !events.some((e) => e.data.code === "claude-hook-executed"));
  } else {
    // Non-Claude drivers reject unexpected MCP servers before starting a native turn.
    check("native MCP isolation accepted the explicit Deck set", o1.status === "completed", o1);
    check("native session identity captured", typeof await t1.nativeSessionId === "string" && (await t1.nativeSessionId).length > 0);
  }
  check("assistant text mapped", events.some((e) => e.kind === "message.completed" && /pong/i.test(String(e.data.text))));

  events.length = 0;
  const o2 = await t1.send("What single word did I ask you to reply with? One word only.");
  check("turn 2 resumed the same session and completed", o2.status === "completed" && events.some((e) => e.kind === "message.completed" && /pong/i.test(String(e.data.text))), { o2, nativeSession: events.find((e) => e.kind === "turn.started")?.data.nativeSessionId });

  if (runner === "opencode") {
    check("private OpenCode config disables project config and native delegation", openCodeIsolation);
    check("native OpenCode MCP/config/tool/schema endpoints confirm isolation", await openCodeNativeInspection === true, openCodeInspectionDetail);
  }
  if (runner === "codex") {
    const deniedMarker = join(project, "approval-must-not-exist");
    const deniedBefore = approvalsDenied;
    const outcome = await t1.send(`Use the shell command tool to run exactly: touch ${deniedMarker}. The session sandbox is read-only. Submit this command with sandbox_permissions=require_escalated and a short justification so the user can approve it. Do not replace this with a file edit. Do not retry after denial.`);
    check("Codex command approval decline reached the broker and prevented execution", approvalsDenied > deniedBefore && !existsSync(deniedMarker), { outcome, deniedRequests: approvalsDenied - deniedBefore, toolEvents: events.filter(event => event.kind === "tool.started" || event.kind === "tool.completed").map(event => ({ kind: event.kind, tool: event.data.tool })) });
  }
  await t1.close();

  events.length = 0;
  const interrupted = await driver.startTask({ ...input("Write a very long essay of 3000 words about the history of computing."), nativeSessionId: driver.newNativeSessionId?.() }, io);
  await new Promise((r) => setTimeout(r, 4000));
  await interrupted.interrupt();
  const o3 = await interrupted.done;
  check("native interrupt yields a clean interrupted outcome", o3.status === "interrupted", o3);
  await interrupted.close();
  const fixtureDir = join(root, `packages/adapter-${runner}/src/session-driver/__fixtures__`, nativeVersion);
  const baselinePath = join(fixtureDir, "live-shapes.json");
  const actual = collectContractShapes(contractEvents);
  if (proposeShapes) {
    mkdirSync(fixtureDir, { recursive: true });
    const proposalPath = join(fixtureDir, "live-shapes.proposed.json");
    writeFileSync(proposalPath, JSON.stringify({ schema: "deck-session-contract-shapes-v1", runner, version: nativeVersion, shapes: actual }, null, 2) + "\n", { mode: 0o600 });
    check("key/type-only shape proposal recorded (baseline unchanged)", true, { proposalPath });
  } else if (existsSync(baselinePath)) {
    const fixture = JSON.parse(readFileSync(baselinePath, "utf8")) as { shapes: ContractShapes };
    const differences = compareContractShapes(fixture.shapes, actual);
    check("native event shapes match the reviewed versioned fixture", differences.length === 0, { differences });
  } else check("native event shape fixture exists (record with --propose-shapes)", false, { baselinePath });
} catch (error) {
  check("script completed without exceptions", false, (error as Error).message);
} finally {
  await supervisor.shutdown(500);
  if (!keep) rmSync(base, { recursive: true, force: true });
}

console.log(JSON.stringify({ runner, model, tempDir: keep ? base : undefined, checks }, null, 2));
process.exit(checks.every((c) => c.ok) ? 0 : 1);
