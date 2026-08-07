import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { StringDecoder } from "node:string_decoder";

import type {
  RunnerModelDiscoveryError,
  RunnerModelEntry,
  RunnerModelInventory,
  RunnerModelInventoryResult,
  RunnerModelProvider,
} from "@deck/core";

export const CODEX_MODEL_DISCOVERY_TIMEOUT_MS = 15_000;
export const CODEX_MODEL_DISCOVERY_MAX_STDOUT_BYTES = 4 * 1024 * 1024;
export const CODEX_MODEL_DISCOVERY_MAX_STDERR_BYTES = 256 * 1024;
const MAX_MODELS = 10_000;
const MAX_TOKEN_BYTES = 512;
const MAX_DISPLAY_BYTES = 4_096;
const MAX_DESCRIPTION_BYTES = 16 * 1024;
const MAX_VARIANTS = 64;
const MAX_METADATA_VALUES = 256;

export type CodexModelCommandRequest = {
  file: string;
  args: readonly string[];
  cwd: string;
  timeoutMs: number;
  maxStdoutBytes: number;
  maxStderrBytes: number;
};

export type CodexModelCommandResult = {
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  terminationReason?: "timeout" | "output-limit";
};

export interface CodexModelCommandRunner {
  run(request: CodexModelCommandRequest): Promise<CodexModelCommandResult>;
}

type ParsedCodexModels = { ok: true; inventory: RunnerModelInventory } | { ok: false; error: RunnerModelDiscoveryError };
type CacheEntry = { inventory: RunnerModelInventory; discoveredAt: number };

/** In-process cache for only successful authenticated catalogs. */
export class CodexModelInventoryCache {
  #entries = new Map<string, CacheEntry>();
  #inFlight = new Map<string, Promise<CacheEntry>>();
  #now: () => number;

  constructor(options?: { now?: () => number }) {
    this.#now = options?.now ?? Date.now;
  }

  async getOrDiscover(
    fingerprint: string,
    mode: "prefer-cache" | "rescan" | undefined,
    discover: () => Promise<RunnerModelInventory>,
  ): Promise<{ inventory: RunnerModelInventory; discoveredAt: number; source: "live" | "memory" }> {
    const cached = this.#entries.get(fingerprint);
    if (mode !== "rescan" && cached && this.#now() - cached.discoveredAt < 5 * 60_000) {
      this.#entries.delete(fingerprint);
      this.#entries.set(fingerprint, cached);
      return { ...cached, source: "memory" };
    }
    const existing = this.#inFlight.get(fingerprint);
    if (existing) {
      const entry = await existing;
      return { ...entry, source: "live" };
    }
    const pending = discover().then((inventory) => {
      const entry = { inventory, discoveredAt: this.#now() };
      this.#entries.delete(fingerprint);
      this.#entries.set(fingerprint, entry);
      while (this.#entries.size > 8) this.#entries.delete(this.#entries.keys().next().value!);
      return entry;
    }).finally(() => this.#inFlight.delete(fingerprint));
    this.#inFlight.set(fingerprint, pending);
    const entry = await pending;
    return { ...entry, source: "live" };
  }
}

function error(code: RunnerModelDiscoveryError["code"], message: string): ParsedCodexModels {
  return { ok: false, error: { code, message, retryable: true } };
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function validToken(value: unknown, maxBytes = MAX_TOKEN_BYTES): value is string {
  return typeof value === "string" && value.length > 0 && value.trim() === value
    && byteLength(value) <= maxBytes && !/[\x00-\x1f\x7f]/.test(value);
}

function optionalString(value: unknown, maxBytes: number): string | undefined | false {
  if (value === undefined) return undefined;
  return validToken(value, maxBytes) ? value : false;
}

function optionalText(value: unknown, maxBytes: number): string | undefined | false {
  if (value === undefined) return undefined;
  return typeof value === "string" && byteLength(value) <= maxBytes && !/\0/.test(value) ? value : false;
}

function optionalBoolean(value: unknown): boolean | undefined | "invalid" {
  return value === undefined ? undefined : typeof value === "boolean" ? value : "invalid";
}

function optionalTokens(value: unknown): readonly string[] | undefined | false {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > MAX_METADATA_VALUES || value.some((item) => !validToken(item))) return false;
  return [...value];
}

function parseUpgrade(value: unknown): RunnerModelEntry["upgrade"] | false {
  if (value === undefined || value === null) return value === null ? null : undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const model = optionalString(record.model, MAX_TOKEN_BYTES);
  const upgradeCopy = optionalText(record.upgrade_copy, MAX_DESCRIPTION_BYTES);
  const modelLink = optionalText(record.model_link, MAX_DESCRIPTION_BYTES);
  const migrationMarkdown = optionalText(record.migration_markdown, MAX_DESCRIPTION_BYTES);
  if (!model || upgradeCopy === false || modelLink === false || migrationMarkdown === false) return false;
  return {
    model,
    ...(upgradeCopy === undefined ? {} : { upgradeCopy }),
    ...(modelLink === undefined ? {} : { modelLink }),
    ...(migrationMarkdown === undefined ? {} : { migrationMarkdown }),
  };
}

/** Parses `codex debug models` JSON, retaining only entries shown in Codex's picker. */
export function parseCodexModels(stdout: string): ParsedCodexModels {
  if (byteLength(stdout) > CODEX_MODEL_DISCOVERY_MAX_STDOUT_BYTES) {
    return error("output-too-large", "Codex model discovery output was too large.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return error("malformed-output", "Codex model discovery returned invalid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return error("malformed-output", "Codex model discovery returned an invalid catalog.");
  }
  const rawModels = (parsed as Record<string, unknown>).models;
  if (!Array.isArray(rawModels) || rawModels.length > MAX_MODELS) {
    return error("malformed-output", "Codex model discovery returned an invalid catalog.");
  }

  const models: RunnerModelEntry[] = [];
  const modelIds = new Set<string>();
  for (const raw of rawModels) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return error("malformed-output", "Codex model discovery returned an invalid catalog.");
    }
    const record = raw as Record<string, unknown>;
    const visibility = record.visibility;
    if (typeof visibility !== "string") {
      return error("malformed-output", "Codex model discovery returned an invalid catalog.");
    }
    // Codex marks hidden and deprecated entries with `hide`; do not surface them.
    if (visibility !== "list") continue;

    const slug = record.slug;
    const displayName = record.display_name;
    const priority = record.priority;
    const rawLevels = record.supported_reasoning_levels;
    if (!validToken(slug) || !validToken(displayName, MAX_DISPLAY_BYTES) || typeof priority !== "number" || !Number.isSafeInteger(priority)
      || !Array.isArray(rawLevels) || rawLevels.length > MAX_VARIANTS) {
      return error("malformed-output", "Codex model discovery returned an invalid catalog.");
    }
    const variants: string[] = [];
    const variantDescriptions: Record<string, string> = Object.create(null) as Record<string, string>;
    for (const rawLevel of rawLevels) {
      if (!rawLevel || typeof rawLevel !== "object" || Array.isArray(rawLevel)) {
        return error("malformed-output", "Codex model discovery returned an invalid catalog.");
      }
      const level = rawLevel as Record<string, unknown>;
      if (!validToken(level.effort) || !validToken(level.description, MAX_DESCRIPTION_BYTES) || Object.hasOwn(variantDescriptions, level.effort)) {
        return error("malformed-output", "Codex model discovery returned an invalid catalog.");
      }
      variants.push(level.effort);
      variantDescriptions[level.effort] = level.description;
    }
    const defaultVariant = optionalString(record.default_reasoning_level, MAX_TOKEN_BYTES);
    const description = optionalText(record.description, MAX_DESCRIPTION_BYTES);
    const upgrade = parseUpgrade(record.upgrade);
    const inputModalities = optionalTokens(record.input_modalities);
    const experimentalSupportedTools = optionalTokens(record.experimental_supported_tools);
    const supportsParallelToolCalls = optionalBoolean(record.supports_parallel_tool_calls);
    const supportsReasoningSummaryParameter = optionalBoolean(record.supports_reasoning_summary_parameter);
    const supportsImageDetailOriginal = optionalBoolean(record.supports_image_detail_original);
    const supportsSearchTool = optionalBoolean(record.supports_search_tool);
    if (defaultVariant === false || (defaultVariant !== undefined && !variants.includes(defaultVariant))
      || description === false || upgrade === false || inputModalities === false || experimentalSupportedTools === false
      || supportsParallelToolCalls === "invalid" || supportsReasoningSummaryParameter === "invalid"
      || supportsImageDetailOriginal === "invalid" || supportsSearchTool === "invalid") {
      return error("malformed-output", "Codex model discovery returned an invalid catalog.");
    }
    const id = `openai-codex/${slug}`;
    if (modelIds.has(id)) return error("malformed-output", "Codex model discovery returned duplicate model slugs.");
    modelIds.add(id);
    models.push({
      id,
      providerId: "openai-codex",
      modelId: slug,
      displayName,
      ...(description === undefined ? {} : { description }),
      priority,
      supportsTools: (experimentalSupportedTools?.length ?? 0) > 0 || supportsParallelToolCalls === true,
      supportsReasoning: variants.length > 0,
      variants,
      variantDescriptions,
      ...(defaultVariant === undefined ? {} : { defaultVariant }),
      visibility,
      ...(upgrade === undefined ? {} : { upgrade }),
      ...(inputModalities === undefined ? {} : { inputModalities }),
      ...(experimentalSupportedTools === undefined ? {} : { experimentalSupportedTools }),
      ...(supportsParallelToolCalls === undefined ? {} : { supportsParallelToolCalls }),
      ...(supportsReasoningSummaryParameter === undefined ? {} : { supportsReasoningSummaryParameter }),
      ...(supportsImageDetailOriginal === undefined ? {} : { supportsImageDetailOriginal }),
      ...(supportsSearchTool === undefined ? {} : { supportsSearchTool }),
      metadataSource: "runner",
      source: "runner-resolved",
    });
  }
  models.sort((left, right) => (left.priority ?? 0) - (right.priority ?? 0)
    || left.displayName.localeCompare(right.displayName) || left.id.localeCompare(right.id));
  const provider: RunnerModelProvider = {
    id: "openai-codex",
    displayName: "OpenAI Subscription / Codex",
    source: "runner-resolved",
  };
  return {
    ok: true,
    inventory: {
      providers: models.length > 0 ? [provider] : [],
      modelsByProvider: models.length > 0 ? { "openai-codex": models } : {},
      ...(models.length === 0 ? { diagnostics: ["codex-runner-returned-no-picker-models"] } : {}),
    },
  };
}

function commandError(result: CodexModelCommandResult): RunnerModelDiscoveryError {
  if (result.terminationReason === "timeout") {
    return { code: "timeout", message: "Codex model discovery timed out. Try again.", retryable: true };
  }
  if (result.terminationReason === "output-limit" || byteLength(result.stdout) > CODEX_MODEL_DISCOVERY_MAX_STDOUT_BYTES || byteLength(result.stderr) > CODEX_MODEL_DISCOVERY_MAX_STDERR_BYTES) {
    return { code: "output-too-large", message: "Codex model discovery output was too large.", retryable: true };
  }
  return { code: "command-failed", message: "Codex model discovery failed. Run `codex debug models` to check the runner.", retryable: true };
}

async function runCatalog(
  commandRunner: CodexModelCommandRunner,
  projectRoot: string,
  args: readonly string[],
): Promise<ParsedCodexModels> {
  try {
    const result = await commandRunner.run({
      file: "codex",
      args,
      cwd: projectRoot,
      timeoutMs: CODEX_MODEL_DISCOVERY_TIMEOUT_MS,
      maxStdoutBytes: CODEX_MODEL_DISCOVERY_MAX_STDOUT_BYTES,
      maxStderrBytes: CODEX_MODEL_DISCOVERY_MAX_STDERR_BYTES,
    });
    if (result.exitCode !== 0 || result.terminationReason) return { ok: false, error: commandError(result) };
    return parseCodexModels(result.stdout);
  } catch {
    return { ok: false, error: { code: "command-failed", message: "Codex model discovery failed. Run `codex debug models` to check the runner.", retryable: true } };
  }
}

function deckFallbackInventory(): RunnerModelInventory {
  return {
    providers: [],
    modelsByProvider: {},
    diagnostics: ["Codex Deck fallback: neither authenticated nor bundled model discovery succeeded; no static model choices are shown and assignments remain unconfirmed."],
  };
}

function fingerprint(projectRoot: string, inventory: RunnerModelInventory): string {
  return createHash("sha256").update(JSON.stringify({ schema: 1, projectRoot, inventory })).digest("hex");
}

/** Authenticated catalog first; bundled and Deck fallbacks remain explicitly degraded. */
export async function discoverCodexModels(input: {
  projectRoot: string;
  mode?: "prefer-cache" | "rescan";
  cache?: CodexModelInventoryCache;
  commandRunner: CodexModelCommandRunner;
  now?: () => number;
}): Promise<RunnerModelInventoryResult> {
  const now = input.now ?? Date.now;
  const cache = input.cache ?? new CodexModelInventoryCache({ now });
  const cacheKey = createHash("sha256").update(JSON.stringify({ schema: 1, projectRoot: input.projectRoot })).digest("hex");
  let primaryError: RunnerModelDiscoveryError | undefined;
  try {
    const cached = await cache.getOrDiscover(cacheKey, input.mode, async () => {
      const primary = await runCatalog(input.commandRunner, input.projectRoot, ["debug", "models"]);
      if (!primary.ok) throw primary.error;
      return primary.inventory;
    });
    return {
      state: "ready",
      inventory: cached.inventory,
      source: cached.source,
      discoveredAt: cached.discoveredAt,
      fingerprint: fingerprint(input.projectRoot, cached.inventory),
    };
  } catch (reason) {
    primaryError = reason && typeof reason === "object" && "code" in reason
      ? reason as RunnerModelDiscoveryError
      : { code: "command-failed", message: "Codex model discovery failed. Run `codex debug models` to check the runner.", retryable: true };
  }
  const bundled = await runCatalog(input.commandRunner, input.projectRoot, ["debug", "models", "--bundled"]);
  if (bundled.ok) {
    const inventory: RunnerModelInventory = {
      ...bundled.inventory,
      providers: bundled.inventory.providers.map((provider) => ({ ...provider, source: "runner-bundled" as const })),
      modelsByProvider: Object.fromEntries(Object.entries(bundled.inventory.modelsByProvider).map(([providerId, models]) => [
        providerId,
        models.map((model) => ({ ...model, source: "runner-bundled" as const })),
      ])),
      diagnostics: [
        ...(bundled.inventory.diagnostics ?? []),
        "codex-bundled-fallback: authenticated Codex model discovery was unavailable; bundled models are not current account availability.",
      ],
    };
    return {
      state: "stale",
      inventory,
      source: "bundled",
      discoveredAt: now(),
      fingerprint: fingerprint(input.projectRoot, inventory),
      error: primaryError!,
    };
  }
  const inventory = deckFallbackInventory();
  return {
    state: "stale",
    inventory,
    source: "deck-fallback",
    discoveredAt: now(),
    fingerprint: fingerprint(input.projectRoot, inventory),
    error: {
      code: bundled.error.code,
      message: "Codex authenticated and bundled model discovery failed; Deck fallback models cannot confirm assignments.",
      retryable: true,
    },
  };
}

export type NodeCodexModelCommandRunnerDependencies = {
  spawn: (
    file: string,
    args: string[],
    options: { cwd: string; shell: false; stdio: ["ignore", "pipe", "pipe"]; env: NodeJS.ProcessEnv },
  ) => {
    stdout: { on(event: "data", listener: (chunk: Buffer | string) => void): unknown };
    stderr: { on(event: "data", listener: (chunk: Buffer | string) => void): unknown };
    on(event: "error", listener: () => void): unknown;
    on(event: "close", listener: (exitCode: number | null, signal: string | null) => void): unknown;
    kill(signal: "SIGTERM" | "SIGKILL"): unknown;
  };
  env?: NodeJS.ProcessEnv;
  setTimeout: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  clearTimeout: (timer: ReturnType<typeof setTimeout>) => void;
};

/** Production command boundary; tests inject the command runner above. */
export function createNodeCodexModelCommandRunner(
  dependencies: NodeCodexModelCommandRunnerDependencies = {
    spawn: (file, args, options) => spawn(file, args, options),
    setTimeout: (callback, delay) => setTimeout(callback, delay),
    clearTimeout: (timer) => clearTimeout(timer),
    env: process.env,
  },
): CodexModelCommandRunner {
  return {
    run(request) {
      return new Promise((resolve) => {
        const child = dependencies.spawn(request.file, [...request.args], {
          cwd: request.cwd,
          shell: false,
          stdio: ["ignore", "pipe", "pipe"],
          env: dependencies.env ?? process.env,
        });
        const stdoutDecoder = new StringDecoder("utf8");
        const stderrDecoder = new StringDecoder("utf8");
        let stdout = "", stderr = "", stdoutBytes = 0, stderrBytes = 0, settled = false, terminated = false, reaped = false;
        let terminationReason: CodexModelCommandResult["terminationReason"];
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
        const terminate = (reason: NonNullable<CodexModelCommandResult["terminationReason"]>) => {
          if (terminated) return;
          terminated = true;
          terminationReason = reason;
          settle(null, "SIGTERM");
          child.kill("SIGTERM");
          killTimer = dependencies.setTimeout(() => {
            if (!reaped) child.kill("SIGKILL");
          }, 250);
        };
        const deadline = dependencies.setTimeout(() => terminate("timeout"), request.timeoutMs);
        const append = (chunk: Buffer | string, stream: "stdout" | "stderr") => {
          if (settled || terminated) return;
          const bytes = Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk, "utf8");
          const limit = stream === "stdout" ? request.maxStdoutBytes : request.maxStderrBytes;
          const total = stream === "stdout" ? stdoutBytes : stderrBytes;
          if (total + bytes > limit) return terminate("output-limit");
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

export const nodeCodexModelCommandRunner = createNodeCodexModelCommandRunner();

export type CodexProductionModelDiscoveryDependencies = {
  commandRunner: CodexModelCommandRunner;
  now: () => number;
};

/** Builds the default adapter discovery service with only bounded runner effects. */
export function createDefaultCodexModelInventoryDiscovery(
  overrides: Partial<CodexProductionModelDiscoveryDependencies> = {},
): (request: { projectRoot: string; mode?: "prefer-cache" | "rescan" }) => Promise<RunnerModelInventoryResult> {
  const dependencies: CodexProductionModelDiscoveryDependencies = {
    commandRunner: overrides.commandRunner ?? nodeCodexModelCommandRunner,
    now: overrides.now ?? Date.now,
  };
  const cache = new CodexModelInventoryCache({ now: dependencies.now });
  return (request) => discoverCodexModels({ ...request, cache, ...dependencies });
}
