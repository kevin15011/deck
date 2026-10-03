/**
 * Production-composition contract for Pi adaptive memory: runRunnerLaunch -> real Pi adapter (global install) ->
 * Supermemory runtime host + loopback bridge -> token-file handoff -> the REAL Pi 1.0 binary with the faux provider.
 * Hermetic: isolated HOME and PI_CODING_AGENT_DIR, fake Supermemory transport, stdin ignored, no network.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

import { getDefaultDeckConfig, type RunnerAdapter } from "@deck/core";
import { createPiRunnerAdapter } from "@deck/adapter-pi";
import { runRunnerLaunch } from "./runner-launch-command";

const FAUX_EXTENSION = fileURLToPath(new URL("../../../packages/adapter-pi/src/__fixtures__/faux-cli-extension.js", import.meta.url));
const realPi = [Bun.which("pi"), join(homedir(), ".bun", "bin", "pi")].find((candidate): candidate is string => Boolean(candidate) && existsSync(candidate!));
const realTest = realPi ? test : test.skip;

let root: string;
let home: string;
let agentDir: string;
let projectRoot: string;
let stateHome: string;
const saved = { HOME: process.env.HOME, PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR, DECK_PI_CHILD: process.env.DECK_PI_CHILD };

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "deck-pi-memory-launch-"));
  home = join(root, "home");
  agentDir = join(root, "agent");
  projectRoot = join(root, "project");
  stateHome = join(root, "state");
  for (const dir of [home, join(agentDir, "extensions"), projectRoot]) mkdirSync(dir, { recursive: true });
  copyFileSync(FAUX_EXTENSION, join(agentDir, "extensions", "faux.js"));
  execFileSync("git", ["init"], { cwd: projectRoot, stdio: "ignore" });
  execFileSync("git", ["remote", "add", "origin", "git@github.com:kevin15011/deck.git"], { cwd: projectRoot, stdio: "ignore" });
  process.env.HOME = home;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  delete process.env.DECK_PI_CHILD;
});
afterEach(() => {
  for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  rmSync(root, { recursive: true, force: true });
});

const tools = {
  resolveExecutable: () => undefined,
  codebase: { command: () => undefined, existing: () => undefined, state: () => "absent", supported: () => false, install: async () => "unchanged" as const },
  rtk: { command: () => undefined, state: () => "absent", supported: () => false, install: async () => "unchanged" as const },
};

function piAdapter(): RunnerAdapter {
  return createPiRunnerAdapter({ homeDirectory: home, env: { PI_CODING_AGENT_DIR: agentDir }, piTools: tools as never, piCommand: realPi }) as RunnerAdapter;
}

function memoryConfig() {
  const config = getDefaultDeckConfig();
  return { ...config, adaptiveMemory: { enabled: true, activeProvider: "supermemory" as const, supermemory: { mcpServerName: "supermemory" } } };
}

function fakeTransport(calls: Array<{ operation: string; payload: any }>) {
  return {
    async add(payload: unknown) { calls.push({ operation: "add", payload }); return { id: "capture" }; },
    async search(payload: unknown) { calls.push({ operation: "search", payload }); return { results: [{ id: "m1", memory: "PRIOR_MEMORY_FACT" }] }; },
    async profile(payload: unknown) { calls.push({ operation: "profile", payload }); return { profile: { static: ["Static profile."], dynamic: [] } }; },
    async health() { calls.push({ operation: "health", payload: {} }); return { ok: true }; },
  };
}

describe("deck pi developer adaptive memory through the production launch path", () => {
  realTest("a clean install (no Supermemory MCP entry) launches with memory: recall reaches the model and the turn is captured through the host", async () => {
    const calls: Array<{ operation: string; payload: any }> = [];
    const fauxLog = join(root, "faux.jsonl");
    let childEnv: Record<string, string> = {};
    let tokenFileSeen: { mode: number; content: string } | undefined;
    let piStdout = "";
    const result = await runRunnerLaunch({
      adapter: piAdapter(),
      launch: { projectRoot, teamId: "developer-team", mode: "interactive", prompt: [], deckConfig: memoryConfig() } as never,
      yes: true,
      interactive: false,
      presentPreview: async () => {},
      processEffects: {
        spawn: async (command: string, args: string[], options: { cwd: string; env: Record<string, string> }) => {
          childEnv = options.env;
          const file = options.env.DECK_RUNNER_MEMORY_TOKEN_FILE;
          if (file) tokenFileSeen = { mode: statSync(file).mode & 0o777, content: readFileSync(file, "utf8").trim() };
          const child = Bun.spawn([command, ...args, "--mode", "json", "-p", "--model", "faux/faux-1", "Decision: capture the supervised runtime boundary with focused verification."], {
            cwd: options.cwd, stdin: "ignore", stdout: "pipe", stderr: "pipe", env: { ...options.env, FAUX_LOG: fauxLog, FAUX_REPLY: "FINAL_ASSISTANT_REPLY: implemented and verified the loopback token handoff file for Pi." },
          });
          const [stdout, stderr] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
          piStdout = stdout;
          return { exitCode: await child.exited, stdout: "", stderr };
        },
      } as never,
      supermemoryRuntime: { stateHome, transport: fakeTransport(calls) },
    } as never);
    expect(result.status).toBe("launched");
    const diagnostics = result.status === "launched" ? result.launch.diagnostics.map((entry) => entry.message).join("\n") : "";
    expect(diagnostics).not.toContain("without adaptive-memory injection");

    // Credential isolation: endpoint and token-file path only; the bearer token and Codex bridge vars never reach Pi.
    expect(childEnv.DECK_RUNNER_MEMORY_ENDPOINT).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/deck-runner-memory\/v1$/);
    expect(childEnv.DECK_RUNNER_MEMORY_TOKEN_FILE).toContain("pi-memory-");
    expect(childEnv).not.toHaveProperty("DECK_RUNNER_MEMORY_TOKEN");
    expect(childEnv).not.toHaveProperty("DECK_CODEX_BRIDGE_TOKEN");
    expect(childEnv.DECK_PI_SESSION).toBe("1");
    expect(JSON.stringify(childEnv)).not.toContain("SUPERMEMORY_API_KEY");
    expect(tokenFileSeen?.mode).toBe(0o600);
    expect(tokenFileSeen?.content).toMatch(/^deck-loopback-/);
    expect(JSON.stringify(childEnv)).not.toContain(tokenFileSeen!.content);

    // Recall (profile + focused search) happened through the host and reached the model request exactly once.
    expect(calls.map((call) => call.operation)).toContain("search");
    const requests = readFileSync(fauxLog, "utf8").trim().split("\n").map((line) => JSON.parse(line)).filter((entry) => !entry.child);
    expect(requests[0].text).toContain("PRIOR_MEMORY_FACT");
    expect(requests[0].text.split("<DECK_ADAPTIVE_CONTEXT_JSON_V1>").length - 1).toBe(1);

    // Capture: the user prompt and the final assistant text were stored through the host's runtime.
    const adds = calls.filter((call) => call.operation === "add").map((call) => JSON.stringify(call.payload));
    expect(adds.some((payload) => payload.includes("supervised runtime boundary"))).toBe(true);
    expect(adds.some((payload) => payload.includes("implemented and verified the loopback token handoff"))).toBe(true);
    expect(piStdout).toContain("FINAL_ASSISTANT_REPLY");

    // The token handoff file is deleted when the host closes.
    expect(existsSync(childEnv.DECK_RUNNER_MEMORY_TOKEN_FILE!)).toBe(false);
    const runtimeDir = join(stateHome, "runtime");
    expect(existsSync(runtimeDir) ? readdirSync(runtimeDir).filter((entry) => entry.startsWith("pi-memory-")) : []).toEqual([]);
  }, 180_000);

  test("with adaptive memory disabled Pi gets neither endpoint nor token file and the extension is told to stay silent", async () => {
    let childEnv: Record<string, string> = {};
    const config = { ...getDefaultDeckConfig(), adaptiveMemory: { ...getDefaultDeckConfig().adaptiveMemory, enabled: false, activeProvider: "none" as const } };
    const result = await runRunnerLaunch({
      adapter: createPiRunnerAdapter({ homeDirectory: home, env: { PI_CODING_AGENT_DIR: agentDir }, piTools: tools as never, piVersionProbe: () => ({ exitCode: 0, stdout: "1.0.0\n", stderr: "" }) } as never) as RunnerAdapter,
      launch: { projectRoot, teamId: "developer-team", mode: "interactive", prompt: [], deckConfig: config } as never,
      yes: true,
      interactive: false,
      presentPreview: async () => {},
      processEffects: { spawn: async (_command: string, _args: string[], options: { env: Record<string, string> }) => { childEnv = options.env; return { exitCode: 0, stdout: "", stderr: "" }; } } as never,
      supermemoryRuntime: { stateHome, transport: fakeTransport([]) },
    } as never);
    expect(result.status).toBe("launched");
    expect(Object.keys(childEnv).filter((key) => key.startsWith("DECK_RUNNER_MEMORY"))).toEqual([]);
    expect(childEnv.DECK_PI_MEMORY).toBe("disabled");
  }, 120_000);
});
