import { randomUUID } from "node:crypto";
import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { PI_READ_ONLY_BUILTIN_TOOLS, PI_READ_ONLY_MEMORY_TOOLS } from "../../pi-mcp-catalog";
import { isThinkingLevel, PI_THINKING_LEVEL_NAMES } from "../shared/thinking";
import type { DeckAgent } from "./agents";
import { claimExecution, executionGroupSettled } from "./execution-lease";
import { validateClarification, MAX_CLARIFICATIONS, type Clarify } from "./clarification";

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

export type FailureKind = "spawn_error" | "shell_timeout" | "shell_cancelled" | "timeout" | "cancelled" | "model_error" | "exit_error" | "containment_unverified" | "ownership_unsettled" | "runner_error";
export type ChildResult = Readonly<{
  agent: string;
  task: string;
  model: string | undefined;
  thinking: string | undefined;
  /** `--tools` allowlist given to the child, if any. */
  tools: readonly string[] | undefined;
  exitCode: number;
  signal?: NodeJS.Signals;
  failureKind?: FailureKind;
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
  /** Exact private child session, created and validated by the background controller. */
  sessionFile?: string;
  parentId?: string;
  taskId?: string;
  attempt?: number;
  onClarifyReady?: (deliver: Clarify | undefined) => void;
  onActivity?: (event: { kind: "tool" | "report" | "retry" | "lifecycle"; text: string }) => void;
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
  return { agent: agent.id, task, model: agent.model, thinking: agent.thinking, tools: undefined, exitCode: 1, text: "", stderr: "", stopReason: undefined, errorMessage, aborted: false, timedOut: false, failed: true, failureKind: "runner_error", usage: emptyUsage(), ...extra };
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
    if (request.signal?.aborted) return failure(agent, task, "Subagent cancelled before spawn", { aborted: true });
    if (agent.thinking !== undefined && !isThinkingLevel(agent.thinking)) {
      return failure(agent, task, `Invalid thinking level "${agent.thinking}" for ${agent.id}. Expected one of: ${PI_THINKING_LEVEL_NAMES.join(", ")}.`);
    }
    const tools = agent.readOnly ? (agent.tools.length > 0 ? [...agent.tools] : [...READ_ONLY_FALLBACK_TOOLS]) : undefined;
    const args: string[] = ["--mode", "json", "-p", ...(request.sessionFile ? ["--session", request.sessionFile] : ["--no-session"])];
    if (agent.model) args.push("--model", agent.model);
    if (agent.thinking) args.push("--thinking", agent.thinking);
    if (tools) args.push("--tools", tools.join(","));
    if (options.packageRoot) args.push("--extension", options.packageRoot);

    let promptDir: string | undefined;
    let lease: ReturnType<typeof claimExecution> | undefined;
    try {
      if (agent.body.trim()) {
        promptDir = mkdtempSync(join(tmpdir(), "deck-pi-subagent-"));
        const promptFile = join(promptDir, `prompt-${agent.id.replace(/[^\w.-]+/g, "_")}.md`);
        writeFileSync(promptFile, agent.body, { encoding: "utf-8", mode: 0o600 });
        args.push("--append-system-prompt", promptFile);
      }
      args.push(`Task: ${task}`);

      const usage = emptyUsage();
      const state = { text: "", stderr: "", stopReason: undefined as string | undefined, errorMessage: undefined as string | undefined, signal: undefined as NodeJS.Signals | undefined, spawnError: false, aborted: false, timedOut: false };
      const invocation = resolvePi(args);
      const needsContainment = !agent.readOnly || Boolean(tools?.some(tool => ["bash", "powershell", "codemode"].includes(tool)));
      const containmentNonce = needsContainment ? randomUUID() : undefined;
      const clarificationNonce = request.sessionFile && request.parentId && request.taskId ? randomUUID() : undefined;
      const clarificationIdentity = { version: 1, nonce: clarificationNonce, parentId: request.parentId, taskId: request.taskId, sessionFile: request.sessionFile, attempt: request.attempt ?? 1 };
      let contained = !needsContainment;
      if (request.sessionFile) lease = claimExecution(request.sessionFile, request.parentId, request.taskId, needsContainment);

      const exitCode = await new Promise<number>((resolve) => {
        let proc: ChildProcess;
        try {
          proc = nodeSpawn(invocation.command, [...invocation.args], {
            cwd: request.cwd,
            shell: false,
            // Own the delegated Pi group, including the child-scoped native shell backend.
            detached: process.platform !== "win32",
            // Use supported JSON IPC rather than managing an extra pipe's lifetime
            // across Node and Bun; retain the nonce/PID-bound startup proof.
            stdio: ["ignore", "pipe", "pipe", "ipc"],
            serialization: "json",
            env: { ...childEnv(options.env ?? process.env, agent.role, options.memory?.()), DECK_PI_CONTAINMENT: containmentNonce ?? "", DECK_PI_CLARIFICATION_NONCE: clarificationNonce ?? "", DECK_PI_CHILD_SESSION: request.sessionFile ?? "", DECK_PI_ATTEMPT: String(request.attempt ?? 1), ...(request.parentId ? { DECK_PI_PARENT_SESSION: request.parentId } : {}), ...(request.taskId ? { DECK_PI_TASK_ID: request.taskId } : {}) },
          });
        } catch (error) {
          state.spawnError = true;
          state.stderr = error instanceof Error ? error.message : String(error);
          resolve(1);
          return;
        }

        try { if (proc.pid) lease?.spawned(proc.pid); }
        catch (e) {
          // Claim metadata could not be committed. Stop only the just-spawned owned group.
          try { if (proc.pid && process.platform !== "win32") process.kill(-proc.pid, "SIGKILL"); else proc.kill("SIGKILL"); } catch {}
          state.errorMessage = String(e);
        }
        let transportClosed = false;
        let sent = 0;
        const pending = new Map<string, { resolve: (value: { delivery: "accepted"; clarificationId: string }) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
        const closeTransport = () => {
          if (transportClosed) return;
          transportClosed = true; request.onClarifyReady?.(undefined);
          for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error("Child clarification transport closed; consumption is not confirmed")); }
          pending.clear();
        };
        const deliver: Clarify = async message => {
          validateClarification(message);
          if (transportClosed || !proc.connected || proc.exitCode !== null || proc.signalCode !== null || request.signal?.aborted) throw new Error("Child is no longer running");
          if (sent >= MAX_CLARIFICATIONS) throw new Error("Clarification limit reached (8 per child attempt)");
          sent++;
          const id = randomUUID();
          return new Promise((resolve, reject) => {
            const timer = setTimeout(() => { pending.delete(id); reject(new Error("Clarification acknowledgement timed out; delivery is unknown, do not blindly retry")); }, 2000);
            pending.set(id, { resolve, reject, timer });
            try { proc.send({ ...clarificationIdentity, type: "clarify", id, message }, error => {
              if (!error) return;
              const p = pending.get(id); if (!p) return;
              clearTimeout(p.timer); pending.delete(id); p.reject(new Error("Clarification transport failed; delivery is unknown"));
            }); } catch { const p = pending.get(id); if (p) { clearTimeout(p.timer); pending.delete(id); p.reject(new Error("Clarification transport unavailable")); } }
          });
        };
        proc.on("disconnect", closeTransport);
        proc.on("message", (value: unknown) => {
          if (!value || typeof value !== "object") return;
          const control = value as Record<string, unknown>;
          if (clarificationNonce && !transportClosed && Object.entries(clarificationIdentity).every(([key, v]) => control[key] === v)) {
            if (control.type === "clarification_ready") request.onClarifyReady?.(deliver);
            if (control.type === "clarification_ack" && typeof control.id === "string" && ["accepted", "rejected"].includes(String(control.delivery))) {
              const p = pending.get(control.id);
              if (p) { clearTimeout(p.timer); pending.delete(control.id);
                if (control.delivery === "accepted") p.resolve({ delivery: "accepted", clarificationId: control.id });
                else p.reject(new Error("Child rejected clarification at its current boundary"));
              }
            }
            return;
          }
          if (contained) return;
          const message = value as { version?: unknown; nonce?: unknown; pid?: unknown };
          try {
            if (process.platform !== "linux" || message.version !== 1 || message.nonce !== containmentNonce || message.pid !== proc.pid) return;
            lease?.contained(); contained = true;
          } catch { /* Missing/invalid startup proof keeps the lease fenced. */ }
        });
        let buffer = "";
        const processLine = (line: string) => {
          if (!line.trim()) return;
          let event: { type?: string; message?: { role?: string; content?: unknown; usage?: Record<string, any>; stopReason?: string; errorMessage?: string } };
          try { event = JSON.parse(line); } catch { return; }
          const observed = event as Record<string, any>;
          if (["tool_execution_start", "tool_execution_end"].includes(event.type ?? "")) {
            const tool = String(observed.toolName ?? "tool").slice(0, 100);
            const command = typeof observed.args?.command === "string" ? observed.args.command.slice(0, 4096) : "";
            const stage = /^(read|grep|find|ls|.*get_code_snippet|.*find_symbol)$/.test(tool) ? "reading"
              : /^(edit|write|.*replace_symbol_body|.*insert_after_symbol|.*insert_before_symbol)$/.test(tool) ? "editing"
              : tool === "bash" && /\b(?:bun|npm|pnpm|yarn|cargo|pytest|go)\s+(?:run\s+)?test\b/.test(command) ? "testing" : "running";
            request.onActivity?.({ kind: "tool", text: `${stage}: ${tool} ${event.type === "tool_execution_start" ? "started" : observed.isError ? "ended with error" : "ended (not task verification)"}` });
          } else if (["auto_retry_start", "auto_retry_end"].includes(event.type ?? "")) {
            request.onActivity?.({ kind: "retry", text: `${event.type}: attempt ${Number(observed.attempt) || "unknown"}` });
          } else if (event.type === "agent_start") request.onActivity?.({ kind: "lifecycle", text: "Child agent started" });
          if (event.type !== "message_end" || !event.message || event.message.role !== "assistant") return;
          const message = event.message;
          usage.turns += 1;
          usage.input += message.usage?.input ?? 0;
          usage.output += message.usage?.output ?? 0;
          usage.cacheRead += message.usage?.cacheRead ?? 0;
          usage.cacheWrite += message.usage?.cacheWrite ?? 0;
          usage.cost += message.usage?.cost?.total ?? 0;
          const text = textOf(message);
          if (text) { state.text = text.slice(0, 50 * 1024); request.onActivity?.({ kind: "report", text: state.text }); }
          if (message.stopReason) state.stopReason = message.stopReason;
          if (message.errorMessage) state.errorMessage = message.errorMessage;
          request.onUpdate?.({ text: state.text, usage: { ...usage } });
        };
        proc.stdout?.on("data", (data: Buffer) => {
          buffer += data.toString();
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          // Discard oversized non-JSON/unfinished frames instead of retaining unbounded pipe data.
          if (buffer.length > 1024 * 1024) buffer = "";
          for (const line of lines) processLine(line);
        });
        proc.stderr?.on("data", (data: Buffer) => {
          if (state.stderr.length < 64 * 1024) state.stderr += data.toString();
        });

        let killTimer: ReturnType<typeof setTimeout> | undefined;
        let ownsLiveGroup = true;
        const kill = (signal: NodeJS.Signals) => {
          if (!ownsLiveGroup) return;
          try {
            if (process.platform !== "win32" && proc.pid) process.kill(-proc.pid, signal);
            else if (proc.exitCode === null && proc.signalCode === null) proc.kill(signal);
          } catch { /* Owned process group already exited; never use a persisted PID. */ }
        };
        const terminate = () => {
          closeTransport();
          // Pipe-owning descendants may survive the leader: do not gate group cleanup on its exitCode.
          kill("SIGTERM");
          killTimer ??= setTimeout(() => kill("SIGKILL"), graceMs);
        };
        const handle = { terminate };
        active.add(handle);
        const timeout = setTimeout(() => { state.timedOut = true; terminate(); }, timeoutMs);
        const onAbort = () => { state.aborted = true; terminate(); };
        if (request.signal?.aborted) onAbort();
        else request.signal?.addEventListener("abort", onAbort, { once: true });

        let finished = false;
        // Leader exit must clean even ignored-stdio descendants (close alone is insufficient).
        proc.once("exit", () => {
          closeTransport();
          kill("SIGKILL");
          // The terminal cleanup signal is sent once while this child exit is observed.
          // Do not signal this numeric group again from timers/cancel after leader reaping.
          ownsLiveGroup = false;
          if (killTimer) clearTimeout(killTimer);
        });
        const finish = async (code: number) => {
          if (finished) return; finished = true;
          closeTransport();
          clearTimeout(timeout);
          if (killTimer) clearTimeout(killTimer);
          if (proc.pid && process.platform !== "win32") {
            const deadline = Date.now() + Math.max(1000, graceMs);
            while (!executionGroupSettled(proc.pid) && Date.now() < deadline) await new Promise(r => setTimeout(r, 10));
            if (!executionGroupSettled(proc.pid)) { state.errorMessage = "Owned child group is not proven settled"; code = 1; }
          }
          active.delete(handle);
          request.signal?.removeEventListener("abort", onAbort);
          resolve(code);
        };
        proc.on("close", (code, signal) => {
          state.signal = signal ?? undefined;
          if (buffer.trim()) processLine(buffer);
          finish(code ?? (signal ? 1 : 0));
        });
        proc.on("error", (error) => {
          state.spawnError = true;
          state.stderr += `${error.message}\n`;
          finish(1);
        });
      });

      if (!contained) state.errorMessage ??= "Child shell containment startup was not verified; effects ownership is uncertain";
      const stderrExcerpt = state.stderr.trim().slice(-STDERR_EXCERPT_CHARS);
      const failed = Boolean(state.errorMessage) || exitCode !== 0 || state.aborted || state.timedOut || state.stopReason === "error" || state.stopReason === "aborted";
      const failureKind: FailureKind | undefined = !failed ? undefined : state.spawnError ? "spawn_error"
        : !contained ? "containment_unverified" : state.errorMessage === "Owned child group is not proven settled" ? "ownership_unsettled"
        : state.timedOut ? "timeout" : state.aborted ? "cancelled"
        : state.stderr.includes("Deck delegated job interrupted: shell command timeout") ? "shell_timeout"
        : state.stderr.includes("Deck delegated job interrupted: shell command cancelled") ? "shell_cancelled"
        : state.stopReason === "error" ? "model_error" : state.stopReason === "aborted" ? "cancelled" : "exit_error";
      let errorMessage = state.errorMessage;
      if (state.timedOut) errorMessage = `Subagent ${agent.id} timed out after ${Math.round(timeoutMs / 1000)}s.`;
      else if (state.aborted) errorMessage = `Subagent ${agent.id} was aborted.`;
      else if (failed && !errorMessage) errorMessage = stderrExcerpt || `Subagent ${agent.id}: ${failureKind} (exit ${exitCode}${state.signal ? `, ${state.signal}` : ""}). The last progress report is not a successful result.`;
      else if (failed && stderrExcerpt && !errorMessage?.includes(stderrExcerpt)) errorMessage = `${errorMessage}\n${stderrExcerpt}`;
      return {
        agent: agent.id, task, model: agent.model, thinking: agent.thinking, tools, exitCode, signal: state.signal, failureKind, text: state.text, stderr: stderrExcerpt,
        stopReason: state.stopReason, errorMessage: failed ? errorMessage : undefined, aborted: state.aborted, timedOut: state.timedOut, failed, usage,
      };
    } catch (error) {
      return failure(agent, task, error instanceof Error ? error.message : String(error));
    } finally {
      try { lease?.release(); } catch { /* Keep uncertain ownership locked; never blindly reclaim. */ }
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
