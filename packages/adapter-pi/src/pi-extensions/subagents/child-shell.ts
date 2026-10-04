import { spawn } from "node:child_process";
import { readFileSync, realpathSync, writeSync } from "node:fs";
import { constants } from "node:os";
import type { BashOperations, ExtensionAPI } from "@earendil-works/pi-coding-agent";
export type NativeShellAPI = Pick<typeof import("@earendil-works/pi-coding-agent"), "createBashToolDefinition" | "createPowerShellToolDefinition" | "getShellConfig">;

/** Child-only supported tool override. The parent owns the live Pi process group. */
export async function installChildShell(pi: ExtensionAPI, env: Readonly<Record<string, string | undefined>>, supplied?: NativeShellAPI) {
  if (!env.DECK_PI_CONTAINMENT) return;
  const role = env.DECK_PI_ROLE;
  const readOnly = role === "investigate" || role === "quality";
  if (readOnly) {
    pi.on("tool_call", async event => {
      if (["bash", "powershell"].includes(event.toolName)) return { block: true, reason: "Read-only delegated role has no shell" };
    });
    return;
  }
  const { createBashToolDefinition, createPowerShellToolDefinition, getShellConfig } = supplied ?? await import("@earendil-works/pi-coding-agent");
  const supported = process.platform === "linux" && Number(readFileSync(`/proc/${process.pid}/stat`, "utf8").split(") ").at(-1)!.split(" ")[2]) === process.pid;
  const supportedShell = () => {
    try { return realpathSync(getShellConfig(pi.getSettings().shellPath).shell) === realpathSync("/bin/bash"); } catch { return false; }
  };
  const refuse = async () => { throw new Error("Delegated shell unavailable: requires owned Linux Bash job; PowerShell is unsupported"); };
  const operations: BashOperations = { exec: supported && !readOnly ? async (command, cwd, options) => {
    if (!supportedShell()) return refuse();
    const endJob = (reason: string): never => {
      // Synchronous bounded diagnostic survives process termination; no command or credentials.
      try { writeSync(2, `Deck delegated job interrupted: ${reason}. Inspect effects before explicit continuation.\n`); } catch { /* Diagnostics cannot prevent containment. */ }
      process.kill(process.pid, "SIGKILL");
      throw new Error(reason);
    };
    if (options.signal?.aborted) return endJob("shell command cancelled");
    const timeoutMs = options.timeout === undefined ? undefined : options.timeout * 1000;
    if (timeoutMs !== undefined && (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2147483647)) throw new Error("Invalid timeout: must be finite, positive and at most 2147483647ms");
    const settings = pi.getSettings();
    const shell = getShellConfig(settings.shellPath);
    if (settings.shellCommandPrefix) command = `${settings.shellCommandPrefix}\n${command}`;
    const shellEnv = { ...options.env };
    delete shellEnv.DECK_PI_CONTAINMENT;
    return await new Promise<{ exitCode: number | null }>((resolve, reject) => {
      const child = spawn(shell.shell, [...shell.args, command], { cwd, env: shellEnv, detached: false, stdio: ["ignore", "pipe", "pipe"] });
      // Per-tool abort/timeout cannot safely distinguish background descendants.
      // End the entire delegated job; its parent settles the still-owned group.
      const terminate = () => endJob("shell command cancelled");
      const timer = timeoutMs === undefined ? undefined : setTimeout(() => endJob(`shell command timeout after ${options.timeout}s`), timeoutMs);
      let exited = false, settled = false, exitCode: number | null = null;
      let idle: ReturnType<typeof setTimeout> | undefined;
      const cleanup = () => { if (timer) clearTimeout(timer); if (idle) clearTimeout(idle); options.signal?.removeEventListener("abort", terminate); child.stdout?.destroy(); child.stderr?.destroy(); };
      const finish = () => { if (settled) return; settled = true; cleanup(); resolve({ exitCode }); };
      const armIdle = () => { if (idle) clearTimeout(idle); idle = setTimeout(finish, 100); };
      const onData = (data: Buffer) => { options.onData(data); if (exited) armIdle(); };
      child.stdout?.on("data", onData); child.stderr?.on("data", onData);
      child.once("error", error => { if (settled) return; settled = true; cleanup(); reject(error); });
      child.once("exit", (code, signal) => { exited = true; exitCode = code ?? (signal ? 128 + (constants.signals[signal] ?? 0) : 1); armIdle(); });
      child.once("close", finish);
      if (options.signal?.aborted) terminate();
      else options.signal?.addEventListener("abort", terminate, { once: true });
    });
  } : refuse };
  const bash = createBashToolDefinition(process.cwd(), { operations });
  pi.registerTool({ ...bash, description: `${bash.description}\nDeck delegated-job safety: shell timeout or abort ends this entire child job so its parent can settle all descendants. Choose a realistic timeout for builds/tests, not a short diagnostic deadline. Recovery requires inspecting effects before explicit same-history continuation.` });
  // Do not leave a reachable native detached-shell alternative, even if a model calls it directly.
  pi.registerTool(createPowerShellToolDefinition(process.cwd(), { operations: { exec: refuse } }));
  pi.on("tool_call", async event => {
    if (event.toolName === "powershell" || (readOnly && event.toolName === "bash") || (!supported && event.toolName === "bash")) return { block: true, reason: "Delegated shell is unsupported for this role/platform" };
  });
  pi.on("user_bash", async () => { throw new Error("Interactive shell unavailable in delegated job"); });
  pi.on("session_start", async () => {
    if (!supported || !supportedShell()) return;
    // Dedicated IPC, not stdout. Shell tools never inherit this channel.
    if (!process.send || !process.connected) return;
    await new Promise<void>((resolve, reject) => process.send!({ version: 1, nonce: env.DECK_PI_CONTAINMENT, pid: process.pid }, error => error ? reject(error) : resolve()));
    // Clarification IPC stays open but unreferenced; it must not keep print mode alive.
    if (!env.DECK_PI_CLARIFICATION_NONCE) process.disconnect?.();
    else process.channel?.unref();
  });
}
