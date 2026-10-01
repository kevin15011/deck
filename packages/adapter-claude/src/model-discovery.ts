import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, isAbsolute } from "node:path";
import { StringDecoder } from "node:string_decoder";

export type ClaudeModelInfo = { value: string; resolvedModel?: string; displayName: string; description: string; supportsEffort?: boolean; supportedEffortLevels?: readonly string[] };
export const safeClaudeModelId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:/@+\[\]-]{0,255}$/.test(value) && !value.endsWith(":");
// Inert selector/display keys from the installed SDK schema, not auth, endpoints,
// helper commands, remote catalogs, feature overrides or provider credentials.
const modelEnvKey = /^(ANTHROPIC_MODEL|ANTHROPIC_SMALL_FAST_MODEL|ANTHROPIC_DEFAULT_MODEL|ANTHROPIC_DEFAULT_(OPUS|SONNET|HAIKU|FABLE)_MODEL(_NAME|_DESCRIPTION)?|ANTHROPIC_CUSTOM_MODEL_OPTION(_NAME|_DESCRIPTION)?|CLAUDE_CODE_USE_(BEDROCK|VERTEX|FOUNDRY))$/;

export function parseClaudeModelInfo(value: unknown): readonly ClaudeModelInfo[] {
  if (!Array.isArray(value) || value.length > 256) throw new Error("Claude model metadata is malformed.");
  const seen = new Set<string>();
  return value.map((entry) => {
    if (!entry || typeof entry !== "object" || !safeClaudeModelId(entry.value) || seen.has(entry.value) || typeof entry.displayName !== "string" || typeof entry.description !== "string" || /[\x00-\x1f\x7f]/.test(entry.displayName) || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(entry.description) || entry.displayName.length > 512 || entry.description.length > 8192 || entry.resolvedModel !== undefined && !safeClaudeModelId(entry.resolvedModel)) throw new Error("Claude model metadata is malformed.");
    seen.add(entry.value);
    if (entry.supportedEffortLevels !== undefined && (!Array.isArray(entry.supportedEffortLevels) || entry.supportedEffortLevels.some((level: unknown) => typeof level !== "string" || !["low", "medium", "high", "xhigh", "max"].includes(level)))) throw new Error("Claude effort metadata is malformed.");
    return { value: entry.value, displayName: entry.displayName, description: entry.description, ...(entry.resolvedModel ? { resolvedModel: entry.resolvedModel } : {}), ...(entry.supportsEffort === true ? { supportsEffort: true, supportedEffortLevels: entry.supportedEffortLevels ?? [] } : {}) };
  });
}

/** Copy only inert model-selection settings. Never copy tokens, helpers, hooks,
 * plugins, MCP registrations, or executable configuration into the probe. */
export function claudeModelSettings(home: string, projectRoot: string, configDir = join(home, ".claude")): Record<string, unknown> {
  const settings: Record<string, unknown> = {};
  if (!isAbsolute(configDir)) throw new Error("Claude model settings directory must be absolute.");
  for (const path of [join(configDir, "settings.json"), join(projectRoot, ".claude", "settings.json"), join(projectRoot, ".claude", "settings.local.json"), join(configDir, "managed-settings.json")]) {
    let stat;
    try { stat = lstatSync(path); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw new Error("Claude model settings cannot be inspected safely."); }
    if (!stat.isFile() || stat.size > 256 * 1024 || (stat.mode & 0o022) !== 0) throw new Error("Claude model settings cannot be inspected safely.");
    let raw: Record<string, unknown>;
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const opened = fstatSync(fd);
      if (!opened.isFile() || opened.ino !== stat.ino || opened.dev !== stat.dev || opened.size > 256 * 1024) throw new Error("invalid");
      const buffer = Buffer.alloc(256 * 1024 + 1); let count = 0;
      while (count < buffer.length) { const next = readSync(fd, buffer, count, buffer.length - count, null); if (!next) break; count += next; }
      const after = fstatSync(fd);
      if (count > 256 * 1024 || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs) throw new Error("invalid");
      raw = JSON.parse(buffer.subarray(0, count).toString("utf8")); if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("invalid");
    } catch { throw new Error("Claude model settings are malformed or changed during inspection."); }
    finally { closeSync(fd); }
    for (const key of ["model", "modelOverrides"]) if (raw?.[key] !== undefined) settings[key] = raw[key];
    if (raw.availableModels !== undefined) {
      if (!Array.isArray(raw.availableModels) || raw.availableModels.some((model) => !safeClaudeModelId(model))) throw new Error("Claude availableModels metadata is malformed.");
      settings.availableModels = path === join(configDir, "managed-settings.json")
        ? [...new Set(raw.availableModels)]
        : [...new Set([...(settings.availableModels as string[] ?? []), ...raw.availableModels])];
    }
    // Native modelPicker is deliberately not honored from project/local sources.
    if ([join(configDir, "settings.json"), join(configDir, "managed-settings.json")].includes(path) && raw.modelPicker !== undefined) settings.modelPicker = raw.modelPicker;
    if (raw?.env && typeof raw.env === "object") {
      const inert = Object.fromEntries(Object.entries(raw.env).filter(([key, value]) => modelEnvKey.test(key) && typeof value === "string" && value.length <= 1024 && !/[\x00-\x1f\x7f]/.test(value)));
      settings.env = { ...(settings.env as object ?? {}), ...inert };
    }
  }
  return settings;
}

export async function discoverClaudeModels(input: { command?: string; home: string; projectRoot: string; configDir?: string; timeoutMs?: number; signal?: AbortSignal }): Promise<readonly ClaudeModelInfo[]> {
  if (input.signal?.aborted) throw new Error("Claude model discovery was cancelled.");
  const command = input.command ?? Bun.which("claude");
  if (!command || !isAbsolute(command)) throw new Error("Installed Claude executable was not found.");
  const settings = claudeModelSettings(input.home, input.projectRoot, input.configDir);
  const root = await mkdtemp(join(tmpdir(), "deck-claude-model-metadata-"));
  try {
    const configDir = join(root, "config"); await mkdir(configDir, { mode: 0o700 });
    await writeFile(join(configDir, "settings.json"), JSON.stringify(settings), { mode: 0o600 });
    // SDK 0.3.286: supportedModels() reads initialize.models; no user message
    // is needed. Safe/bare mode suppress customization execution and prefetch.
    const args = ["--print", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--safe-mode", "--bare", "--no-session-persistence", "--setting-sources=user", "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}', "--tools", ""];
    const env: Record<string, string> = { HOME: root, CLAUDE_CONFIG_DIR: configDir, PATH: process.env.PATH ?? "/usr/bin:/bin", DISABLE_AUTOUPDATER: "1", CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1", AWS_EC2_METADATA_DISABLED: "true" };
    for (const [key, value] of Object.entries(process.env)) if (modelEnvKey.test(key) && value && value.length <= 1024 && !/[\x00-\x1f\x7f]/.test(value)) env[key] = value;
    return await new Promise((resolve, reject) => {
      const child = spawn(command, args, { cwd: root, env, stdio: ["pipe", "pipe", "pipe"], detached: process.platform !== "win32" });
      const id = randomUUID(); const decoder = new StringDecoder("utf8");
      let pending = "", bytes = 0, result: readonly ClaudeModelInfo[] | undefined, failure: Error | undefined, stopped = false;
      const kill = (signal: NodeJS.Signals) => {
        try { if (child.pid && process.platform !== "win32") process.kill(-child.pid, signal); else child.kill(signal); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") failure = new Error("Claude model discovery subprocess cleanup failed."); }
      };
      let groupCleanup: Promise<void> | undefined;
      const stop = (error?: Error) => {
        if (stopped) return; stopped = true; failure = error; child.stdin.destroy(); kill("SIGTERM");
        // A direct child can close its pipes while descendants are still alive.
        // Always complete group escalation before settling or removing the cwd.
        groupCleanup = new Promise((done) => { setTimeout(() => { kill("SIGKILL"); child.stdout.destroy(); child.stderr.destroy(); setTimeout(done, 10); }, 100); });
      };
      const abort = () => stop(new Error("Claude model discovery was cancelled."));
      const timer = setTimeout(() => stop(new Error("Claude model discovery timed out.")), Math.min(input.timeoutMs ?? 8000, 15000));
      input.signal?.addEventListener("abort", abort, { once: true });
      child.stdout.on("data", (chunk: Buffer) => {
        if (stopped) return;
        bytes += chunk.length; if (bytes > 1024 * 1024) { stop(new Error("Claude model metadata exceeded its output bound.")); return; }
        pending += decoder.write(chunk);
        while (pending.includes("\n") && !stopped) {
          const boundary = pending.indexOf("\n"); const line = pending.slice(0, boundary); pending = pending.slice(boundary + 1);
          if (!line.trim()) continue;
          try {
            const frame = JSON.parse(line);
            if (frame.type !== "control_response" || frame.response?.request_id !== id) continue;
            if (frame.response.subtype !== "success") { stop(new Error("Claude metadata control request failed.")); return; }
            result = parseClaudeModelInfo(frame.response.response?.models); stop();
          } catch { stop(new Error("Claude model metadata control framing is malformed.")); }
        }
      });
      child.stderr.on("data", (chunk: Buffer) => { bytes += chunk.length; if (bytes > 1024 * 1024) stop(new Error("Claude model metadata exceeded its output bound.")); });
      child.on("error", () => stop(new Error("Claude model discovery command failed.")));
      child.stdin.on("error", () => { if (!stopped) stop(new Error("Claude metadata control request failed.")); });
      child.on("close", async () => { clearTimeout(timer); if (!stopped) stop(new Error("Claude model discovery command failed.")); await groupCleanup; input.signal?.removeEventListener("abort", abort); if (input.signal?.aborted) failure = new Error("Claude model discovery was cancelled."); if (result && !failure) resolve(result); else reject(failure ?? new Error("Claude model discovery command failed.")); });
      child.stdin.write(JSON.stringify({ type: "control_request", request_id: id, request: { subtype: "initialize", hooks: {} } }) + "\n");
      if (input.signal?.aborted) abort();
    });
  } finally { await rm(root, { recursive: true, force: true }); }
}
