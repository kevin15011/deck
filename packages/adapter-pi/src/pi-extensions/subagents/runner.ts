import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { PI_READ_ONLY_BUILTIN_TOOLS, PI_READ_ONLY_MEMORY_TOOLS } from "../../pi-mcp-catalog";
import { isThinkingLevel, PI_THINKING_LEVEL_NAMES } from "../shared/thinking";
import type { DeckAgent } from "./agents";

const DEFAULT_KILL_GRACE_MS = 5_000;
const DEFAULT_TIMEOUT_MS = 30 * 60_000;
const STDERR_EXCERPT_CHARS = 1_500;
const READ_ONLY_FALLBACK_TOOLS = [...PI_READ_ONLY_BUILTIN_TOOLS, ...PI_READ_ONLY_MEMORY_TOOLS] as const;

export type PiInvocation = Readonly<{ command: string; args: readonly string[] }>;
export type { MemoryHandoff } from "../shared/memory-handoff";
import type { MemoryHandoff } from "../shared/memory-handoff";

export type ChildRunnerOptions = {
  /** Resolves the `pi` executable. Default: the running Pi (`process.execPath`), else `pi`. */
  piInvocation?: (args: readonly string[]) => PiInvocation;
  /** Parent environment the child inherits. Default: `process.env`. */
  env?: Readonly<Record<string, string | undefined>>;
  /** Memory loopback handoff to forward explicitly (endpoint + token-file path, never the bearer token). */
  memory?: () => MemoryHandoff | undefined;
  /**
   * Deck package root passed to children as a CLI package source (`--extension`). Pi keeps the first skill per
   * name and CLI package sources precede auto-discovered `<agentDir>/skills` and `~/.agents/skills`, so this makes
   * the Deck package skills win collisions inside role processes, matching the lead launch.
   */
  packageRoot?: string;
  killGraceMs?: number;
  timeoutMs?: number;
};

export type ChildUsage = { input: number; output: number; cacheRead: number; cacheWrite: number; cost: number; turns: number };

export type ChildResult = Readonly<{
  agent: string;
  task: string;
  model: string | undefined;
  thinking: string | undefined;
  /** `--tools` allowlist given to the child, if any. */
  tools: readonly string[] | undefined;
  exitCode: number;
  /** Final assistant text parsed from the JSONL `message_end` events. */
  text: string;
  stderr: string;
  stopReason: string | undefined;
  errorMessage: string | undefined;
  aborted: boolean;
  timedOut: boolean;
  failed: boolean;
  usage: ChildUsage;
}>;

export type ChildRunRequest = {
  agent: DeckAgent;
  task: string;
  cwd: string;
  signal?: AbortSignal;
  onUpdate?: (partial: { text: string; usage: ChildUsage }) => void;
};

export type ChildRunner = {
  run(request: ChildRunRequest): Promise<ChildResult>;
  /** SIGTERM every in-flight child, SIGKILL after the grace period. */
  killAll(): void;
};

/** The running Pi binary, so children use the same Pi version and install as the lead. */
export function defaultPiInvocation(args: readonly string[]): PiInvocation {
  // Entry script of the running Pi (not a Deck config input).
  const { argv } = process;
  const script = argv[1];
  const isBunVirtual = script?.startsWith("/$bunfs/root/") === true;
  if (script && !isBunVirtual && existsSync(script)) return { command: process.execPath, args: [script, ...args] };
  const execName = basename(process.execPath).toLowerCase();
  if (!/^(node|bun)(\.exe)?$/.test(execName)) return { command: process.execPath, args };
  return { command: "pi", args };
}

function emptyUsage(): ChildUsage {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 };
}

function textOf(message: { content?: unknown } | undefined): string {
  const content = message?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block): block is { type: "text"; text: string } => Boolean(block) && typeof block === "object" && (block as { type?: unknown }).type === "text" && typeof (block as { text?: unknown }).text === "string")
    .map((block) => block.text)
    .join("");
}

function failure(agent: DeckAgent, task: string, errorMessage: string, extra: Partial<ChildResult> = {}): ChildResult {
  return { agent: agent.id, task, model: agent.model, thinking: agent.thinking, tools: undefined, exitCode: 1, text: "", stderr: "", stopReason: undefined, errorMessage, aborted: false, timedOut: false, failed: true, usage: emptyUsage(), ...extra };
}

/** Role-specific child environment: parent env + Deck markers + explicit memory handoff (never the token). */
function childEnv(parent: Readonly<Record<string, string | undefined>>, role: string, memory: MemoryHandoff | undefined): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(parent)) {
    if (value === undefined) continue;
    if (key.startsWith("DECK_RUNNER_MEMORY_")) continue;
    env[key] = value;
  }
  env.DECK_PI_SESSION = "1";
  env.DECK_PI_CHILD = "1";
  env.DECK_PI_ROLE = role;
  if (memory?.endpoint && memory.tokenFile) {
    env.DECK_RUNNER_MEMORY_ENDPOINT = memory.endpoint;
    env.DECK_RUNNER_MEMORY_TOKEN_FILE = memory.tokenFile;
  }
  return env;
}

export function createChildRunner(options: ChildRunnerOptions = {}): ChildRunner {
  const resolvePi = options.piInvocation ?? defaultPiInvocation;
  const graceMs = options.killGraceMs ?? DEFAULT_KILL_GRACE_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const active = new Set<{ terminate: () => void }>();

  async function run(request: ChildRunRequest): Promise<ChildResult> {
    const { agent, task } = request;
    if (agent.thinking !== undefined && !isThinkingLevel(agent.thinking)) {
      return failure(agent, task, `Invalid thinking level "${agent.thinking}" for ${agent.id}. Expected one of: ${PI_THINKING_LEVEL_NAMES.join(", ")}.`);
    }
    const tools = agent.readOnly ? (agent.tools.length > 0 ? [...agent.tools] : [...READ_ONLY_FALLBACK_TOOLS]) : undefined;
    const args: string[] = ["--mode", "json", "-p", "--no-session"];
    if (agent.model) args.push("--model", agent.model);
    if (agent.thinking) args.push("--thinking", agent.thinking);
    if (tools) args.push("--tools", tools.join(","));
    if (options.packageRoot) args.push("--extension", options.packageRoot);

    let promptDir: string | undefined;
    try {
      if (agent.body.trim()) {
        promptDir = mkdtempSync(join(tmpdir(), "deck-pi-subagent-"));
        const promptFile = join(promptDir, `prompt-${agent.id.replace(/[^\w.-]+/g, "_")}.md`);
        writeFileSync(promptFile, agent.body, { encoding: "utf-8", mode: 0o600 });
        args.push("--append-system-prompt", promptFile);
      }
      args.push(`Task: ${task}`);

      const usage = emptyUsage();
      const state = { text: "", stderr: "", stopReason: undefined as string | undefined, errorMessage: undefined as string | undefined, aborted: false, timedOut: false };
      const invocation = resolvePi(args);

      const exitCode = await new Promise<number>((resolve) => {
        let proc: ChildProcess;
        try {
          proc = nodeSpawn(invocation.command, [...invocation.args], {
            cwd: request.cwd,
            shell: false,
            stdio: ["ignore", "pipe", "pipe"],
            env: childEnv(options.env ?? process.env, agent.role, options.memory?.()),
          });
        } catch (error) {
          state.stderr = error instanceof Error ? error.message : String(error);
          resolve(1);
          return;
        }

        let buffer = "";
        const processLine = (line: string) => {
          if (!line.trim()) return;
          let event: { type?: string; message?: { role?: string; content?: unknown; usage?: Record<string, any>; stopReason?: string; errorMessage?: string } };
          try { event = JSON.parse(line); } catch { return; }
          if (event.type !== "message_end" || !event.message || event.message.role !== "assistant") return;
          const message = event.message;
          usage.turns += 1;
          usage.input += message.usage?.input ?? 0;
          usage.output += message.usage?.output ?? 0;
          usage.cacheRead += message.usage?.cacheRead ?? 0;
          usage.cacheWrite += message.usage?.cacheWrite ?? 0;
          usage.cost += message.usage?.cost?.total ?? 0;
          const text = textOf(message);
          if (text) state.text = text;
          if (message.stopReason) state.stopReason = message.stopReason;
          if (message.errorMessage) state.errorMessage = message.errorMessage;
          request.onUpdate?.({ text: state.text, usage: { ...usage } });
        };
        proc.stdout?.on("data", (data: Buffer) => {
          buffer += data.toString();
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) processLine(line);
        });
        proc.stderr?.on("data", (data: Buffer) => {
          if (state.stderr.length < 64 * 1024) state.stderr += data.toString();
        });

        let killTimer: ReturnType<typeof setTimeout> | undefined;
        const terminate = () => {
          if (proc.exitCode !== null || proc.signalCode !== null) return;
          proc.kill("SIGTERM");
          killTimer ??= setTimeout(() => {
            if (proc.exitCode === null && proc.signalCode === null) proc.kill("SIGKILL");
          }, graceMs);
        };
        const handle = { terminate };
        active.add(handle);
        const timeout = setTimeout(() => { state.timedOut = true; terminate(); }, timeoutMs);
        const onAbort = () => { state.aborted = true; terminate(); };
        if (request.signal?.aborted) onAbort();
        else request.signal?.addEventListener("abort", onAbort, { once: true });

        const finish = (code: number) => {
          clearTimeout(timeout);
          if (killTimer) clearTimeout(killTimer);
          active.delete(handle);
          request.signal?.removeEventListener("abort", onAbort);
          resolve(code);
        };
        proc.on("close", (code, signal) => {
          if (buffer.trim()) processLine(buffer);
          finish(code ?? (signal ? 1 : 0));
        });
        proc.on("error", (error) => {
          state.stderr += `${error.message}\n`;
          finish(1);
        });
      });

      const stderrExcerpt = state.stderr.trim().slice(-STDERR_EXCERPT_CHARS);
      const failed = exitCode !== 0 || state.aborted || state.timedOut || state.stopReason === "error" || state.stopReason === "aborted";
      let errorMessage = state.errorMessage;
      if (state.timedOut) errorMessage = `Subagent ${agent.id} timed out after ${Math.round(timeoutMs / 1000)}s.`;
      else if (state.aborted) errorMessage = `Subagent ${agent.id} was aborted.`;
      else if (failed && !errorMessage) errorMessage = stderrExcerpt || state.text || `Subagent ${agent.id} exited with code ${exitCode}.`;
      else if (failed && stderrExcerpt && !errorMessage?.includes(stderrExcerpt)) errorMessage = `${errorMessage}\n${stderrExcerpt}`;
      return {
        agent: agent.id, task, model: agent.model, thinking: agent.thinking, tools, exitCode, text: state.text, stderr: stderrExcerpt,
        stopReason: state.stopReason, errorMessage: failed ? errorMessage : undefined, aborted: state.aborted, timedOut: state.timedOut, failed, usage,
      };
    } catch (error) {
      return failure(agent, task, error instanceof Error ? error.message : String(error));
    } finally {
      if (promptDir) {
        try { rmSync(promptDir, { recursive: true, force: true }); } catch { /* best effort */ }
      }
    }
  }

  return {
    run,
    killAll() {
      for (const child of [...active]) child.terminate();
    },
  };
}
