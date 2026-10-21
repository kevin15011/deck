import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { copyFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildCodebaseGuardEntry, createCodebaseGuardInvocation } from "../../pi-codebase-guard-command";
import { hashJsonValue } from "../../pi-manifest";
import { createPiHarness, type PiHarness } from "../../pi-cli-harness";

const ECHO_SERVER = fileURLToPath(new URL("../../__fixtures__/tiny-mcp-echo-server.mjs", import.meta.url));
const node = Bun.which("node");
const nativeCommand = [node!, join(dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"))), "cli.js")];
const realTest = node ? test : test.skip;
const nativeHarness = (options: Parameters<typeof createPiHarness>[0] = {}) => createPiHarness(options, { command: nativeCommand });

let harness: PiHarness | undefined;
afterEach(() => { harness?.cleanup(); harness = undefined; });

const lead = { DECK_PI_SESSION: "1", DECK_PI_ROLE: "lead" };
const child = (role: string) => ({ DECK_PI_SESSION: "1", DECK_PI_CHILD: "1", DECK_PI_ROLE: role });
const toolEnv = (tool: string, input: Record<string, unknown>, extra: Record<string, string> = {}) => ({ FAUX_SCRIPT: "tool", FAUX_TOOL: tool, FAUX_TOOL_INPUT: JSON.stringify(input), ...extra });
const endOf = (events: Array<Record<string, any>>, tool: string) => events.find((event) => event.type === "tool_execution_end" && event.toolName === tool);
const resultText = (end: Record<string, any> | undefined) => (end?.result?.content ?? []).map((part: { text?: string }) => part.text ?? "").join("");
const probeLog = (path: string) => (existsSync(path) ? readFileSync(path, "utf8").trim().split("\n").map((line) => JSON.parse(line)) : []);

/** Real production classifier/guard, with exact fixture receipts replacing only the reviewed release metadata. */
function reviewedGraphHarness(): PiHarness {
  const h = nativeHarness({ availableMcpServers: { "codebase-memory": {} } });
  const binary = join(h.root, "codebase-memory-mcp"), guardScript = join(h.root, "guard-main.ts");
  const bytes = readFileSync(fileURLToPath(new URL("../../__fixtures__/tiny-mcp-graph-server.mjs", import.meta.url)));
  writeFileSync(binary, bytes, { mode: 0o700 });
  const digest = createHash("sha256").update(bytes).digest("hex");
  const release = { asset: "fixture", archiveBytes: 1, archiveSha256: "0".repeat(64), binaryBytes: bytes.length, binarySha256: digest };
  writeFileSync(guardScript, `import {runPiCodebaseGuard} from ${JSON.stringify(fileURLToPath(new URL("../../pi-codebase-guard.ts",import.meta.url)))};import {parseCodebaseGuardArgs} from ${JSON.stringify(fileURLToPath(new URL("../../pi-codebase-guard-command.ts",import.meta.url)))};const args=parseCodebaseGuardArgs(process.argv.slice(4));if(!args)process.exit(64);process.exit(await runPiCodebaseGuard(args,{release:${JSON.stringify(release)}}));`);
  const entry = buildCodebaseGuardEntry(createCodebaseGuardInvocation(process.execPath,guardScript),h.agentDir,binary);
  writeFileSync(join(h.agentDir,"mcp.json"),JSON.stringify({mcpServers:{"codebase-memory":entry}}));
  const manifestPath=join(h.agentDir,"deck/manifest.json"),manifest=JSON.parse(readFileSync(manifestPath,"utf8"));
  manifest.mcp.servers["codebase-memory"]=hashJsonValue(entry);writeFileSync(manifestPath,JSON.stringify(manifest));
  const policyDir=join(h.agentDir,"deck/package/extensions/deck-tool-policy");
  copyFileSync(join(policyDir,"impl.js"),join(policyDir,"reviewed-fixture.mjs"));
  writeFileSync(join(policyDir,"impl.js"),`import {createDeckToolPolicyEntry} from './reviewed-fixture.mjs';import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';export default createDeckToolPolicyEntry({compatible:command=>{const bytes=readFileSync(command);return command===${JSON.stringify(binary)}&&bytes.length===${bytes.length}&&createHash('sha256').update(bytes).digest('hex')===${JSON.stringify(digest)};}});`);
  return h;
}

/** Fake RTK speaking the `rtk hook claude` protocol; executed as `rtk <args>` it prints a marker. */
function writeFakeRtk(path: string): void {
  writeFileSync(path, `#!/bin/sh
if [ "$1" = "hook" ]; then
  input=$(cat)
  case "$input" in
    *'"git status"'*) printf '%s' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","updatedInput":{"command":"rtk git status"}}}' ;;
  esac
  exit 0
fi
echo "RTK_WRAPPED $*"
`);
  chmodSync(path, 0o755);
}

describe("deck-tool-policy in the real Pi 1.0 runtime (faux provider)", () => {
  realTest("6.1 a read-only child's write is blocked: the model gets an error result with the reason, nothing is written, and no tool_result is emitted", async () => {
    harness = nativeHarness();
    const probe = join(harness.root, "probe.jsonl");
    const target = join(harness.project, "should-not-exist.txt");
    const run = await harness.run(["go"], { ...child("quality"), PROBE_LOG: probe, ...toolEnv("write", { path: target, content: "x" }) });
    const end = endOf(run.events, "write");
    expect(end?.isError).toBe(true);
    expect(resultText(end)).toContain("read-only");
    expect(existsSync(target)).toBe(false);
    const log = probeLog(probe);
    expect(log.some((entry) => entry.ev === "tool_call" && entry.tool === "write")).toBe(true);
    expect(log.some((entry) => entry.ev === "tool_result" && entry.tool === "write")).toBe(false);
  }, 120_000);

  realTest("6.1 the lead is unaffected by the role policy", async () => {
    harness = nativeHarness();
    const target = join(harness.project, "lead-wrote.txt");
    const run = await harness.run(["go"], { ...lead, ...toolEnv("write", { path: target, content: "x" }) });
    expect(endOf(run.events, "write")?.isError).toBe(false);
    expect(existsSync(target)).toBe(true);
  }, 120_000);

  realTest("6.2 an eligible bash command is rewritten to the owned RTK binary before execution, and the runtime reports the mutated input", async () => {
    // The binary must exist before materialization so the configuration can pin its absolute path.
    const binDir = mkdtempSync(join(tmpdir(), "deck-fake-rtk-"));
    const rtk = join(binDir, "rtk");
    writeFakeRtk(rtk);
    harness = nativeHarness({ rtkBinary: rtk });
    const probe = join(harness.root, "probe.jsonl");
    const rewritten = await harness.run(["go"], { ...lead, PROBE_LOG: probe, ...toolEnv("bash", { command: "git status" }) });
    expect(resultText(endOf(rewritten.events, "bash"))).toContain("RTK_WRAPPED git status");
    expect(probeLog(probe).find((entry) => entry.ev === "tool_result" && entry.tool === "bash")?.command).toBe(`'${rtk}' git status`);

    const unchanged = await harness.run(["go"], { ...lead, ...toolEnv("bash", { command: "echo hi" }) });
    expect(resultText(endOf(unchanged.events, "bash"))).toContain("hi");
    expect(resultText(endOf(unchanged.events, "bash"))).not.toContain("RTK_WRAPPED");
  }, 180_000);

  realTest("6.2 a missing RTK binary leaves commands unchanged and reports once", async () => {
    harness = nativeHarness({ rtkBinary: "/nonexistent/deck/rtk" });
    const run = await harness.run(["go"], { ...lead, ...toolEnv("bash", { command: "echo still-works" }) });
    expect(resultText(endOf(run.events, "bash"))).toContain("still-works");
    expect(run.stderr.split("owned RTK binary is unavailable").length - 1).toBe(1);
  }, 120_000);

  realTest("6.3 a code-structure search runs and gains a graph advisory (never blocked); a config-file search runs untouched", async () => {
    harness = reviewedGraphHarness();
    expect(Bun.spawnSync([...nativeCommand, "--version"]).stdout.toString().trim()).toBe("1.0.0");
    mkdirSync(join(harness.project, "src"), { recursive: true });
    writeFileSync(join(harness.project, "src", "user.ts"), "export function createUser() {}\n");
    const guided = await harness.run(["go"], { ...lead, ...toolEnv("bash", { command: "grep -rn createUser src/" }) });
    const end = endOf(guided.events, "bash");
    expect(end?.isError).toBe(false);
    expect(resultText(end)).toContain("createUser");
    expect(resultText(end)).toContain("mcp__codebase_memory__search_graph");

    const graph = await harness.run(["go"], { ...lead, ...toolEnv("mcp__codebase_memory__search_graph", {}) });
    expect(endOf(graph.events,"mcp__codebase_memory__search_graph")?.isError).toBe(false);
    expect(resultText(endOf(graph.events,"mcp__codebase_memory__search_graph"))).toContain("FIXTURE_GRAPH:search_graph");

    writeFileSync(join(harness.project, "settings.yaml"), "timeout: 30\n");
    const config = await harness.run(["go"], { ...lead, ...toolEnv("bash", { command: "grep -n timeout settings.yaml" }) });
    expect(endOf(config.events, "bash")?.isError).toBe(false);
    expect(resultText(endOf(config.events, "bash"))).toContain("timeout: 30");
  }, 180_000);

  for (const kind of ["absent", "non-graph-custom"] as const) realTest(`6.3 ${kind} Codebase keeps file search usable without invented graph advice`, async () => {
    harness = nativeHarness(kind === "absent" ? {} : { availableMcpServers: {}, mcpServers: { "codebase-memory": { command: node!, args: [ECHO_SERVER], env: {}, exposure: "direct" } } });
    mkdirSync(join(harness.project,"src"));writeFileSync(join(harness.project,"src/user.ts"),"export function createUser() {}\n");
    const run=await harness.run(["go"],{...lead,...toolEnv("bash",{command:"grep -rn createUser src/"})});
    expect(run.code).toBe(0);expect(endOf(run.events,"bash")?.isError).toBe(false);
    expect(resultText(endOf(run.events,"bash"))).toContain("createUser");
    expect(resultText(endOf(run.events,"bash"))).not.toContain("mcp__codebase_memory__search_graph");
    expect(resultText(endOf(run.events,"bash"))).not.toContain("Prefer the codebase graph");
  },120000);

  realTest("6.4 coexists with the execution extension: delegation to an apply role is not blocked and evidence hooks stay inert", async () => {
    harness = nativeHarness();
    const run = await harness.run(["go"], { ...lead, FAUX_SCRIPT: "delegate", FAUX_DELEGATE: JSON.stringify({ agent: "deck-apply-fast", task: "do the change" }), FAUX_PARENT_DELAY_MS: "1500" }, { persistSession: true });
    const end = endOf(run.events, "subagent");
    expect(end?.isError).toBe(false);
    expect(resultText(end)).toContain("Background delegation accepted");
    expect(JSON.stringify(run.events)).toContain("CHILD_OK apply-fast");
  }, 120_000);
});
