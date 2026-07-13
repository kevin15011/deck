import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import type { RunnerModelDiscoveryError, RunnerModelInventory, RunnerModelEntry, RunnerModelProvider } from "@deck/core";

export const OPENCODE_DISCOVERY_TIMEOUT_MS = 15_000;
export const OPENCODE_MAX_STDOUT_BYTES = 8 * 1024 * 1024;
export const OPENCODE_MAX_STDERR_BYTES = 256 * 1024;
const MAX_MODELS = 10_000;
const MAX_ID_BYTES = 512;
const MAX_BLOCK_BYTES = 256 * 1024;
const MAX_VARIANT_BYTES = 128;
const MAX_VARIANTS = 64;

export type OpenCodeCommandRequest = { file: string; args: readonly string[]; cwd: string; timeoutMs: number; maxStdoutBytes: number; maxStderrBytes: number; signal?: AbortSignal };
export type OpenCodeCommandResult = { exitCode: number | null; signal: string | null; stdout: string; stderr: string; terminationReason?: "timeout" | "output-limit" };
export interface OpenCodeCommandRunner { run(request: OpenCodeCommandRequest): Promise<OpenCodeCommandResult>; }
export interface ModelDiscoveryFileSystem {
  readFile(path: string): Promise<string>;
  stat(path: string): Promise<{ size: number; mtimeMs: number; mode: number; ctimeMs?: number; dev?: number; ino?: number; isFile?: () => boolean; isDirectory?: () => boolean }>;
  realpath(path: string): Promise<string>;
  mkdir(path: string, mode: number): Promise<void>;
  writeFile(path: string, body: string, mode: number): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  chmod?(path: string, mode: number): Promise<void>;
  lstat?(path: string): Promise<{ mode: number; isSymbolicLink(): boolean }>;
  unlink?(path: string): Promise<void>;
  readdir?(path: string): Promise<string[]>;
}
export type OpenCodeModelDiscoveryDependencies = {
  commandRunner: OpenCodeCommandRunner; fs: ModelDiscoveryFileSystem; now: () => number;
  env: Readonly<Record<string, string | undefined>>;
  resolveExecutable: (command: string, env: Readonly<Record<string, string | undefined>>) => Promise<string>;
};

export type OpenCodeDiscoverySuccess = { ok: true; inventory: RunnerModelInventory };
export type OpenCodeDiscoveryFailure = { ok: false; error: RunnerModelDiscoveryError };
export type OpenCodeDiscoveryResult = OpenCodeDiscoverySuccess | OpenCodeDiscoveryFailure;

function error(code: RunnerModelDiscoveryError["code"], message: string): OpenCodeDiscoveryFailure {
  return { ok: false, error: { code, message, retryable: true } };
}
function byteLength(value: string): number { return Buffer.byteLength(value, "utf8"); }
function validToken(value: unknown, maxBytes: number): value is string {
  return typeof value === "string" && value.length > 0 && value.trim() === value && byteLength(value) <= maxBytes && !/[\x00-\x1f\x7f]/.test(value);
}

/** Scans one top-level JSON object without treating braces in strings as structure. */
function scanJsonObject(source: string, start: number): { body: string; end: number } | undefined {
  if (source[start] !== "{") return undefined;
  let depth = 0, quoted = false, escaped = false;
  for (let index = start; index < source.length; index++) {
    const char = source[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === "{") depth++;
    else if (char === "}" && --depth === 0) return { body: source.slice(start, index + 1), end: index + 1 };
  }
  return undefined;
}

/** Parses the runner's identifier + JSON records all-or-nothing. */
export function parseOpenCodeModelsVerbose(stdout: string): OpenCodeDiscoveryResult {
  if (byteLength(stdout) > OPENCODE_MAX_STDOUT_BYTES) return error("output-too-large", "OpenCode model discovery output was too large.");
  const modelsByProvider: Record<string, RunnerModelEntry[]> = {};
  const providers = new Map<string, RunnerModelProvider>();
  const ids = new Set<string>();
  let cursor = 0;
  while (cursor < stdout.length) {
    while (cursor < stdout.length && /\s/.test(stdout[cursor]!)) cursor++;
    if (cursor === stdout.length) break;
    const lineEnd = stdout.indexOf("\n", cursor);
    const end = lineEnd < 0 ? stdout.length : lineEnd;
    const id = stdout.slice(cursor, end).replace(/\r$/, "");
    const slash = id.indexOf("/");
    if (!validToken(id, MAX_ID_BYTES) || slash <= 0 || slash === id.length - 1 || ids.has(id)) return error("malformed-output", "OpenCode model discovery returned invalid output.");
    const providerId = id.slice(0, slash);
    const modelId = id.slice(slash + 1);
    if (!validToken(providerId, MAX_ID_BYTES) || !validToken(modelId, MAX_ID_BYTES)) return error("malformed-output", "OpenCode model discovery returned invalid output.");
    cursor = lineEnd < 0 ? stdout.length : lineEnd + 1;
    while (cursor < stdout.length && /\s/.test(stdout[cursor]!)) cursor++;
    const block = scanJsonObject(stdout, cursor);
    if (!block || byteLength(block.body) > MAX_BLOCK_BYTES) return error("malformed-output", "OpenCode model discovery returned invalid output.");
    let data: unknown;
    try { data = JSON.parse(block.body); } catch { return error("malformed-output", "OpenCode model discovery returned invalid output."); }
    if (!data || typeof data !== "object" || Array.isArray(data)) return error("malformed-output", "OpenCode model discovery returned invalid output.");
    const record = data as Record<string, unknown>;
    if (record.providerID !== providerId || !record.variants || typeof record.variants !== "object" || Array.isArray(record.variants)) return error("malformed-output", "OpenCode model discovery returned invalid output.");
    const variants = Object.keys(record.variants);
    if (variants.length > MAX_VARIANTS || variants.some((variant) => !validToken(variant, MAX_VARIANT_BYTES))) return error("malformed-output", "OpenCode model discovery returned invalid output.");
    if (ids.size >= MAX_MODELS) return error("output-too-large", "OpenCode model discovery returned too many models.");
    ids.add(id);
    const entry: RunnerModelEntry = { id, providerId, modelId, displayName: typeof record.name === "string" && record.name.trim() ? record.name : modelId, supportsTools: typeof record.tool_call === "boolean" ? record.tool_call : undefined, supportsReasoning: typeof record.reasoning === "boolean" ? record.reasoning : undefined, variants, metadataSource: "runner", source: "runner-resolved" };
    (modelsByProvider[providerId] ??= []).push(entry);
    providers.set(providerId, { id: providerId, displayName: providerId, source: "runner-resolved" });
    cursor = block.end;
  }
  const providerList = [...providers.values()].sort((a, b) => a.displayName.localeCompare(b.displayName) || a.id.localeCompare(b.id));
  for (const provider of providerList) modelsByProvider[provider.id]!.sort((a, b) => a.displayName.localeCompare(b.displayName) || a.id.localeCompare(b.id));
  return { ok: true, inventory: { providers: providerList, modelsByProvider, diagnostics: ids.size === 0 ? ["runner-returned-no-models"] : undefined } };
}

export async function discoverOpenCodeModels(input: { projectRoot: string; timeoutMs?: number; signal?: AbortSignal; dependencies: Pick<OpenCodeModelDiscoveryDependencies, "commandRunner" | "resolveExecutable" | "env"> }): Promise<OpenCodeDiscoveryResult> {
  let executable: string;
  try { executable = await input.dependencies.resolveExecutable("opencode", input.dependencies.env); }
  catch { return error("runner-not-found", "OpenCode was not found. Check that the runner is installed."); }
  if (!executable.startsWith("/")) return error("runner-not-found", "OpenCode was not found. Check that the runner is installed.");
  try {
    const result = await input.dependencies.commandRunner.run({ file: executable, args: ["models", "--verbose"], cwd: input.projectRoot, timeoutMs: input.timeoutMs ?? OPENCODE_DISCOVERY_TIMEOUT_MS, maxStdoutBytes: OPENCODE_MAX_STDOUT_BYTES, maxStderrBytes: OPENCODE_MAX_STDERR_BYTES, ...(input.signal ? { signal: input.signal } : {}) });
    if (result.terminationReason === "output-limit" || byteLength(result.stdout) > OPENCODE_MAX_STDOUT_BYTES || byteLength(result.stderr) > OPENCODE_MAX_STDERR_BYTES) return error("output-too-large", "OpenCode model discovery output was too large.");
    if (result.terminationReason === "timeout") return error("timeout", "OpenCode model discovery timed out. Try again.");
    if (result.exitCode !== 0) return error("command-failed", "OpenCode model discovery failed. Run opencode models --verbose to check the runner.");
    return parseOpenCodeModelsVerbose(result.stdout);
  } catch { return error("command-failed", "OpenCode model discovery failed. Run opencode models --verbose to check the runner."); }
}

/** Production-only command boundary. Tests must inject the command runner above. */
export type NodeOpenCodeCommandRunnerDependencies = {
  spawn: (
    file: string,
    args: string[],
    options: { cwd: string; shell: false; stdio: ["ignore", "pipe", "pipe"] },
  ) => {
    stdout: { on(event: "data", listener: (chunk: Buffer | string) => void): unknown };
    stderr: { on(event: "data", listener: (chunk: Buffer | string) => void): unknown };
    on(event: "error", listener: () => void): unknown;
    on(event: "close", listener: (exitCode: number | null, signal: string | null) => void): unknown;
    kill(signal: "SIGTERM" | "SIGKILL"): unknown;
  };
  setTimeout: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  clearTimeout: (timer: ReturnType<typeof setTimeout>) => void;
};

/**
 * Builds the production command boundary with injectable process and timer seams.
 * The default export uses Node primitives; tests provide hermetic fake children and clocks.
 */
export function createNodeOpenCodeCommandRunner(
  dependencies: NodeOpenCodeCommandRunnerDependencies = {
    spawn: (file, args, options) => spawn(file, args, options),
    setTimeout: (callback, delay) => setTimeout(callback, delay),
    clearTimeout: (timer) => clearTimeout(timer),
  },
): OpenCodeCommandRunner {
  return {
    run(request) {
      return new Promise((resolve) => {
        const child = dependencies.spawn(request.file, [...request.args], {
          cwd: request.cwd,
          shell: false,
          stdio: ["ignore", "pipe", "pipe"],
        });
        const stdoutDecoder = new StringDecoder("utf8");
        const stderrDecoder = new StringDecoder("utf8");
        let stdout = "", stderr = "", stdoutBytes = 0, stderrBytes = 0;
        let settled = false, terminated = false, reaped = false;
        let terminationReason: OpenCodeCommandResult["terminationReason"];
        let killTimer: ReturnType<typeof setTimeout> | undefined;
        const settle = (exitCode: number | null, signal: string | null) => {
          if (settled) return;
          settled = true;
          dependencies.clearTimeout(deadline);
          if (killTimer) dependencies.clearTimeout(killTimer);
          stdout += stdoutDecoder.end();
          stderr += stderrDecoder.end();
          resolve({ exitCode, signal, stdout, stderr, terminationReason });
        };
        const terminate = (reason: NonNullable<OpenCodeCommandResult["terminationReason"]>) => {
          if (terminated) return;
          terminated = true;
          terminationReason = reason;
          // The caller boundary is intentionally independent from process reaping.
          settle(null, "SIGTERM");
          child.kill("SIGTERM");
          killTimer = dependencies.setTimeout(() => {
            if (reaped) return;
            child.kill("SIGKILL");
          }, 250);
        };
        const deadline = dependencies.setTimeout(() => terminate("timeout"), request.timeoutMs);
        const abort = () => terminate("timeout");
        if (request.signal?.aborted) abort();
        else request.signal?.addEventListener("abort", abort, { once: true });
        const append = (chunk: Buffer | string, stream: "stdout" | "stderr") => {
          if (settled || terminated) return;
          const bytes = Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk, "utf8");
          const current = stream === "stdout" ? stdoutBytes : stderrBytes;
          const limit = stream === "stdout" ? request.maxStdoutBytes : request.maxStderrBytes;
          if (current + bytes > limit) {
            terminate("output-limit");
            return;
          }
          if (stream === "stdout") {
            stdoutBytes += bytes;
            stdout += stdoutDecoder.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          } else {
            stderrBytes += bytes;
            stderr += stderrDecoder.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          }
        };
        child.stdout.on("data", (chunk) => append(chunk, "stdout"));
        child.stderr.on("data", (chunk) => append(chunk, "stderr"));
        child.on("error", () => { reaped = true; if (killTimer) dependencies.clearTimeout(killTimer); settle(null, null); });
        child.on("close", (exitCode, signal) => { reaped = true; if (killTimer) dependencies.clearTimeout(killTimer); settle(exitCode, signal); });
      });
    },
  };
}

/** Production-only command boundary. Tests inject the factory seams above. */
export const nodeOpenCodeCommandRunner = createNodeOpenCodeCommandRunner();
