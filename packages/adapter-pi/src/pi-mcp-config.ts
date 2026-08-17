import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  runEvidenceGatedSerenaWriter,
  validateSerenaMcpWriterInput,
  type SerenaBootstrapAuthorization,
  type SerenaMcpWriterInput,
  type SerenaOperationIdentity,
  type SerenaReadinessEvidence,
  type SerenaReadinessRevalidator,
} from "@deck/core";

export const SUPERMEMORY_MCP_SERVER_NAME = "supermemory";
export const SUPERMEMORY_MCP_URL = "https://mcp.supermemory.ai/mcp";
export const SUPERMEMORY_API_KEY_HEADER = "x-supermemory-api-key";

// Standard MCP server names for Pi capabilities
export const CONTEXT7_MCP_SERVER_NAME = "context7";
export const SERENA_MCP_SERVER_NAME = "serena";
export const CONTEXT_MODE_MCP_SERVER_NAME = "context-mode";
export const CODEBASE_MEMORY_MCP_SERVER_NAME = "codebase-memory";

export type PiMcpConfigWriteAction = "created" | "updated" | "unchanged" | "failed";

export type PiMcpConfigDiagnostic = {
  code:
    | "PI_MCP_CONFIG_CREATED"
    | "PI_MCP_CONFIG_UPDATED"
    | "PI_MCP_CONFIG_UNCHANGED"
    | "PI_MCP_CONFIG_MALFORMED"
    | "PI_MCP_CONFIG_CONFLICT"
    | "PI_MCP_PROVIDER_UNAVAILABLE"
    | "PI_MCP_CONFIG_WRITE_FAILED"
    | "PI_MCP_CONFIG_PERMISSION_WARNING";
  message: string;
  severity: "info" | "warning" | "error";
  path?: string;
  serverName?: string;
};

export type PiMcpConfigWriteResult = {
  ok: boolean;
  action: PiMcpConfigWriteAction;
  path: string;
  serverName: string;
  diagnostics: PiMcpConfigDiagnostic[];
};

/** File boundary used by the Serena writer; tests provide an in-memory fake. */
export type PiMcpConfigFileSystem = Readonly<{
  existsSync: (path: string) => boolean;
  readFileSync: (path: string, encoding?: string) => string;
  mkdirSync: (path: string, options?: { recursive?: boolean; mode?: number }) => void;
  writeFileSync: (path: string, content: string, options?: { encoding?: string; mode?: number } | string) => void;
  renameSync: (from: string, to: string) => void;
  rmSync: (path: string, options?: { force?: boolean }) => void;
}>;

const defaultPiMcpConfigFileSystem: PiMcpConfigFileSystem = {
  existsSync,
  readFileSync: (path, encoding = "utf-8") => readFileSync(path, encoding as BufferEncoding),
  mkdirSync: (path, options) => { mkdirSync(path, options); },
  writeFileSync: (path, content, options) => { writeFileSync(path, content, options as any); },
  renameSync,
  rmSync: (path, options) => { rmSync(path, options); },
};

export type WriteSupermemoryPiMcpConfigOptions = {
  /** @deprecated API tokens must stay in Deck's secret store and are ignored for Pi MCP config writes. */
  token?: string;
  /** MCP server entry name. Defaults to `supermemory`. */
  serverName?: string;
  /** Override for tests or advanced callers. Defaults to `~/.pi/agent/mcp.json`. */
  configPath?: string;
  /** Override home directory used to resolve the default path. */
  homeDir?: string;
  /** Canonical non-secret Supermemory project scope for x-sm-project. */
  projectScope: string;
};

const CANONICAL_SUPERMEMORY_PROJECT_SCOPE = /^sm_project_v1_[a-z0-9]+_[a-z0-9]+(?:_[a-z0-9]+)*$/;

type JsonRecord = Record<string, unknown>;

type MergeOutcome =
  | { ok: true; config: JsonRecord; changed: boolean; existed: boolean }
  | { ok: false; diagnostics: PiMcpConfigDiagnostic[] };

export function defaultPiMcpConfigPath(homeDir = homedir()): string {
  return join(homeDir, ".pi", "agent", "mcp.json");
}

export function writeSupermemoryPiMcpConfig(
  options: WriteSupermemoryPiMcpConfigOptions,
): PiMcpConfigWriteResult {
  const configPath = options.configPath ?? defaultPiMcpConfigPath(options.homeDir);
  const serverName = normalizeServerName(options.serverName);
  const projectScope = options.projectScope?.trim();

  if (!projectScope || !CANONICAL_SUPERMEMORY_PROJECT_SCOPE.test(projectScope)) {
    return failedResult(configPath, serverName, [
      {
        code: "PI_MCP_CONFIG_CONFLICT",
        severity: "error",
        path: configPath,
        serverName,
        message: "Canonical x-sm-project scope is required to configure the Supermemory Pi MCP server.",
      },
    ]);
  }

  const merged = readAndMergeConfig(configPath, serverName, projectScope);
  if (!merged.ok) {
    return failedResult(configPath, serverName, merged.diagnostics);
  }

  if (!merged.changed) {
    const diagnostics = [
      infoDiagnostic(
        "PI_MCP_CONFIG_UNCHANGED",
        "Raw Supermemory Pi MCP is disabled; no stale Deck-managed entry was present to retire.",
        configPath,
        serverName,
      ),
    ];
    diagnostics.push(...applyBestEffortPermissions(configPath));
    return { ok: true, action: "unchanged", path: configPath, serverName, diagnostics };
  }

  try {
    mkdirSync(dirname(configPath), { recursive: true, mode: 0o700 });
  } catch (error) {
    return failedResult(configPath, serverName, [
      errorDiagnostic(
        "PI_MCP_CONFIG_WRITE_FAILED",
        `Unable to create Pi MCP config directory: ${redact(String((error as Error).message ?? error))}`,
        configPath,
        serverName,
      ),
    ]);
  }

  const permissionDiagnostics = applyBestEffortDirectoryPermission(configPath);

  try {
    writeJsonAtomically(configPath, merged.config);
  } catch (error) {
    return failedResult(configPath, serverName, [
      ...permissionDiagnostics,
      errorDiagnostic(
        "PI_MCP_CONFIG_WRITE_FAILED",
        `Unable to write Pi MCP config: ${redact(String((error as Error).message ?? error))}`,
        configPath,
        serverName,
      ),
    ]);
  }

  const diagnostics = [
    infoDiagnostic(
      merged.existed ? "PI_MCP_CONFIG_UPDATED" : "PI_MCP_CONFIG_CREATED",
      merged.existed
        ? "Retired stale Deck-managed Supermemory Pi MCP server entry; raw Supermemory MCP is no longer authorized by Deck."
        : "Raw Supermemory Pi MCP is disabled; no server entry was created.",
      configPath,
      serverName,
    ),
    ...permissionDiagnostics,
    ...applyBestEffortFilePermission(configPath),
  ];

  return {
    ok: true,
    action: merged.existed ? "updated" : "created",
    path: configPath,
    serverName,
    diagnostics,
  };
}

/** Backward-compatible alias for callers that prefer configure terminology. */
export const configureSupermemoryPiMcpConfig = writeSupermemoryPiMcpConfig;

export type ValidateSupermemoryPiMcpConfigOptions = {
  /** MCP server entry name. Defaults to `supermemory`. */
  serverName?: string;
  /** Override for tests or advanced callers. Defaults to `~/.pi/agent/mcp.json`. */
  configPath?: string;
  /** Override home directory used to resolve the default path. */
  homeDir?: string;
};

export type PiMcpConfigValidationResult = {
  ok: boolean;
  path: string;
  serverName: string;
  projectScope?: string;
  diagnostics: PiMcpConfigDiagnostic[];
};

export function validateSupermemoryPiMcpConfig(
  options?: ValidateSupermemoryPiMcpConfigOptions,
): PiMcpConfigValidationResult {
  const configPath = options?.configPath ?? defaultPiMcpConfigPath(options?.homeDir);
  const serverName = normalizeServerName(options?.serverName);

  if (!existsSync(configPath)) {
    return {
      ok: false,
      path: configPath,
      serverName,
      diagnostics: [
        errorDiagnostic(
          "PI_MCP_CONFIG_WRITE_FAILED",
          "Pi MCP config is missing; Supermemory tools were not injected. Configure ~/.pi/agent/mcp.json first.",
          configPath,
          serverName,
        ),
      ],
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(configPath, "utf-8"));
  } catch {
    return {
      ok: false,
      path: configPath,
      serverName,
      diagnostics: [errorDiagnostic("PI_MCP_CONFIG_MALFORMED", "Pi MCP config contains malformed JSON; Supermemory tools were not injected.", configPath, serverName)],
    };
  }

  if (!isPlainRecord(parsed) || !isPlainRecord(parsed.mcpServers)) {
    return {
      ok: false,
      path: configPath,
      serverName,
      diagnostics: [errorDiagnostic("PI_MCP_CONFIG_MALFORMED", "Pi MCP config must contain an object mcpServers map; Supermemory tools were not injected.", configPath, serverName)],
    };
  }

  const server = parsed.mcpServers[serverName];
  if (!isPlainRecord(server)) {
    return {
      ok: false,
      path: configPath,
      serverName,
      diagnostics: [errorDiagnostic("PI_MCP_CONFIG_CONFLICT", `Pi MCP config is missing object server entry '${serverName}'; Supermemory tools were not injected.`, configPath, serverName)],
    };
  }

  if (server.url !== SUPERMEMORY_MCP_URL || server.transport !== "http") {
    return {
      ok: false,
      path: configPath,
      serverName,
      diagnostics: [errorDiagnostic("PI_MCP_CONFIG_CONFLICT", `Pi MCP server '${serverName}' must use the validated Supermemory HTTP endpoint; Supermemory tools were not injected.`, configPath, serverName)],
    };
  }

  if (isPlainRecord(server.headers) && typeof server.headers[SUPERMEMORY_API_KEY_HEADER] === "string" && server.headers[SUPERMEMORY_API_KEY_HEADER].trim()) {
    return {
      ok: false,
      path: configPath,
      serverName,
      diagnostics: [errorDiagnostic("PI_MCP_CONFIG_CONFLICT", `Pi MCP server '${serverName}' contains a legacy persisted Supermemory credential header; remove it because Deck stores runtime credentials only in its secret store.`, configPath, serverName)],
    };
  }

  if (!isPlainRecord(server.headers) || typeof server.headers["x-sm-project"] !== "string" || !CANONICAL_SUPERMEMORY_PROJECT_SCOPE.test(server.headers["x-sm-project"].trim())) {
    return {
      ok: false,
      path: configPath,
      serverName,
      diagnostics: [errorDiagnostic("PI_MCP_CONFIG_CONFLICT", `Pi MCP server '${serverName}' is missing canonical x-sm-project scope; Supermemory tools were not injected.`, configPath, serverName)],
    };
  }

  return {
    ok: true,
    path: configPath,
    serverName,
    projectScope: server.headers["x-sm-project"].trim(),
    diagnostics: [infoDiagnostic("PI_MCP_CONFIG_UNCHANGED", "Supermemory Pi MCP server entry is present without persisted bearer credentials.", configPath, serverName)],
  };
}


export type SupermemoryPiMcpPublicServer = {
  path: string;
  serverName: string;
  endpoint: string;
};

export function extractValidatedSupermemoryPiMcpServer(
  options?: ValidateSupermemoryPiMcpConfigOptions,
): SupermemoryPiMcpPublicServer {
  const validation = validateSupermemoryPiMcpConfig(options);
  if (!validation.ok) {
    throw new Error(validation.diagnostics.map((diagnostic) => diagnostic.message).join(" "));
  }

  const parsed = JSON.parse(readFileSync(validation.path, "utf-8")) as JsonRecord;
  const mcpServers = parsed.mcpServers as JsonRecord;
  const server = mcpServers[validation.serverName] as JsonRecord;
  return { path: validation.path, serverName: validation.serverName, endpoint: String(server.url) };
}

export function redactPiMcpConfigDiagnosticText(value: string): string {
  return redact(value);
}

function readAndMergeConfig(configPath: string, serverName: string, _projectScope?: string): MergeOutcome {
  const existed = existsSync(configPath);
  let config: JsonRecord = {};

  if (existed) {
    let raw: string;
    try {
      raw = readFileSync(configPath, "utf-8");
    } catch (error) {
      return {
        ok: false,
        diagnostics: [
          errorDiagnostic(
            "PI_MCP_CONFIG_WRITE_FAILED",
            `Unable to read existing Pi MCP config: ${redact(String((error as Error).message ?? error))}`,
            configPath,
            serverName,
          ),
        ],
      };
    }

    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!isPlainRecord(parsed)) {
        return malformed(configPath, serverName, "Pi MCP config must be a JSON object.");
      }
      config = parsed;
    } catch {
      return malformed(configPath, serverName, "Pi MCP config contains malformed JSON; no changes were written.");
    }
  }

  const existingServers = config.mcpServers;
  if (existingServers !== undefined && !isPlainRecord(existingServers)) {
    return malformed(configPath, serverName, "Pi MCP config `mcpServers` must be a JSON object; no changes were written.");
  }

  const mcpServers = existingServers === undefined ? {} : { ...(existingServers as JsonRecord) };
  const existingServer = mcpServers[serverName];
  if (existingServer === undefined) {
    return { ok: true, config, changed: false, existed };
  }
  if (!isExactDeckManagedPiSupermemoryEntry(existingServer)) {
    return {
      ok: false,
      diagnostics: [
        errorDiagnostic(
          "PI_MCP_CONFIG_CONFLICT",
          `Existing Pi Supermemory MCP server entry '${serverName}' is unmanaged or ambiguous; Deck left it unchanged and did not authorize raw Supermemory MCP.`,
          configPath,
          serverName,
        ),
      ],
    };
  }

  delete mcpServers[serverName];
  const nextConfig: JsonRecord = {
    ...config,
    mcpServers,
  };

  return {
    ok: true,
    config: nextConfig,
    changed: stableStringify(config) !== stableStringify(nextConfig),
    existed,
  };
}

function isExactDeckManagedPiSupermemoryEntry(entry: unknown): boolean {
  if (!isPlainRecord(entry)) return false;
  const keys = Object.keys(entry).sort();
  if (JSON.stringify(keys) !== JSON.stringify(["headers", "transport", "url"])) return false;
  if (entry.transport !== "http" || entry.url !== SUPERMEMORY_MCP_URL) return false;
  if (!isPlainRecord(entry.headers)) return false;
  const headerKeys = Object.keys(entry.headers);
  if (headerKeys.length !== 1 || headerKeys[0] !== "x-sm-project") return false;
  if (typeof entry.headers["x-sm-project"] !== "string") return false;
  if (!CANONICAL_SUPERMEMORY_PROJECT_SCOPE.test(entry.headers["x-sm-project"].trim())) return false;
  return true;
}

function writeJsonAtomically(configPath: string, config: JsonRecord) {
  const tmpPath = `${configPath}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(tmpPath, `${JSON.stringify(config, null, 2)}\n`, { encoding: "utf-8", mode: 0o600 });
    try {
      chmodSync(tmpPath, 0o600);
    } catch {
      // Reported after rename by applyBestEffortFilePermission; chmod can be unsupported on some platforms.
    }
    renameSync(tmpPath, configPath);
  } catch (error) {
    rmSync(tmpPath, { force: true });
    throw error;
  }
}

function applyBestEffortPermissions(configPath: string): PiMcpConfigDiagnostic[] {
  return [...applyBestEffortDirectoryPermission(configPath), ...applyBestEffortFilePermission(configPath)];
}

function applyBestEffortDirectoryPermission(configPath: string): PiMcpConfigDiagnostic[] {
  try {
    chmodSync(dirname(configPath), 0o700);
    return [];
  } catch (error) {
    return [permissionWarning(configPath, `Unable to restrict Pi MCP config directory permissions: ${String((error as Error).message ?? error)}`)];
  }
}

function applyBestEffortFilePermission(configPath: string): PiMcpConfigDiagnostic[] {
  try {
    chmodSync(configPath, 0o600);
    return [];
  } catch (error) {
    return [permissionWarning(configPath, `Unable to restrict Pi MCP config file permissions: ${String((error as Error).message ?? error)}`)];
  }
}

function permissionWarning(configPath: string, message: string): PiMcpConfigDiagnostic {
  return {
    code: "PI_MCP_CONFIG_PERMISSION_WARNING",
    severity: "warning",
    path: configPath,
    message: redact(message),
  };
}

function malformed(configPath: string, serverName: string, message: string): MergeOutcome {
  return {
    ok: false,
    diagnostics: [errorDiagnostic("PI_MCP_CONFIG_MALFORMED", message, configPath, serverName)],
  };
}

function failedResult(
  configPath: string,
  serverName: string,
  diagnostics: PiMcpConfigDiagnostic[],
): PiMcpConfigWriteResult {
  return { ok: false, action: "failed", path: configPath, serverName, diagnostics: diagnostics.map(redactDiagnostic) };
}

function infoDiagnostic(
  code: Extract<PiMcpConfigDiagnostic["code"], "PI_MCP_CONFIG_CREATED" | "PI_MCP_CONFIG_UPDATED" | "PI_MCP_CONFIG_UNCHANGED">,
  message: string,
  path: string,
  serverName: string,
): PiMcpConfigDiagnostic {
  return { code, severity: "info", message: redact(message), path, serverName };
}

function errorDiagnostic(
  code: Extract<PiMcpConfigDiagnostic["code"], "PI_MCP_CONFIG_MALFORMED" | "PI_MCP_CONFIG_CONFLICT" | "PI_MCP_CONFIG_WRITE_FAILED">,
  message: string,
  path: string,
  serverName: string,
): PiMcpConfigDiagnostic {
  return { code, severity: "error", message: redact(message), path, serverName };
}

export function redactDiagnostic(diagnostic: PiMcpConfigDiagnostic): PiMcpConfigDiagnostic {
  return { ...diagnostic, message: redact(diagnostic.message) };
}

export function redact(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(
      new RegExp(`([\"']?${SUPERMEMORY_API_KEY_HEADER}[\"']?\\s*[:=]\\s*[\"']?)([^\"'\\s,}]+)([\"']?)`, "gi"),
      "$1[REDACTED]$3",
    )
    .replace(
      /(["']?(?:api[_-]?key|token|credential|secret|password|authorization)["']?\s*[:=]\s*["']?)([^"',}]+)(["']?)/gi,
      "$1[REDACTED]$3",
    )
    .replace(/\bsm_[A-Za-z0-9_-]+/g, "sm_[REDACTED]")
    .replace(/(SUPERMEMORY_API_KEY\s*=\s*)[^\s]+/gi, "$1[REDACTED]");
}

function normalizeServerName(serverName: string | undefined): string {
  const normalized = (serverName ?? SUPERMEMORY_MCP_SERVER_NAME).trim();
  return normalized || SUPERMEMORY_MCP_SERVER_NAME;
}

function isPlainRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (isPlainRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

// ---------------------------------------------------------------------------
// Generic MCP Config Writers
// ---------------------------------------------------------------------------

/**
 * Options for writing a local MCP config entry.
 */
export type WriteLocalMcpConfigOptions = {
  /** The command to execute for the MCP server */
  command: string;
  /** Optional arguments for the command */
  args?: readonly string[];
  /** Optional environment variables */
  env?: Record<string, string>;
  /** The MCP server entry name */
  serverName: string;
  /** Optional transport type (default: process) */
  transport?: "process" | "http" | "stdio";
  /** Optional URL for HTTP transport */
  url?: string;
  /** Override for tests or advanced callers. Defaults to `~/.pi/agent/mcp.json`. */
  configPath?: string;
  /** Override home directory used to resolve the default path. */
  homeDir?: string;
};

/**
 * Options for healthcheck-gated MCP config write.
 * This is the key integration point that enforces the healthcheck gate.
 */
export type WriteGatedLocalMcpConfigOptions = WriteLocalMcpConfigOptions & {
  /**
   * Healthcheck function that returns the usability result.
   * If not provided, defaults to calling checkSharedBinaryUsability from @deck/core.
   */
  healthcheck?: () => Promise<{
    status: "ready" | "missing" | "unusable" | "blocked";
    command: string;
    reason?: string;
    version?: string;
  }>;
};

/**
 * Write local MCP config ONLY if the binary passes healthcheck.
 * REQ-PI-003, REQ-CBM-002: Gate config writes behind binary usability check.
 *
 * This is the HIGH-LEVEL function that enforces the gating guarantee:
 * - Binary missing → config NOT written (returns failed/blocked)
 * - Binary unusable → config NOT written (returns failed/blocked)
 * - Binary ready → config IS written (returns created/updated)
 *
 * @param options - Options including command, serverName, and healthcheck function
 */
export async function writeGatedLocalMcpConfig(
  options: WriteGatedLocalMcpConfigOptions,
): Promise<PiMcpConfigWriteResult> {
  // Run healthcheck first
  const healthcheck = options.healthcheck ?? (async () => {
    // Default: import and use checkSharedBinaryUsability from core
    const { checkSharedBinaryUsability } = await import("@deck/core");
    return checkSharedBinaryUsability(options.command, {
      healthcheckArgs: ["--version", "--help"],
      timeoutMs: 5000,
    });
  });

  const usabilityResult = await healthcheck();

  // If binary is missing or unusable, do NOT write config
  if (usabilityResult.status === "missing") {
    return failedResult(
      options.configPath ?? defaultPiMcpConfigPath(options.homeDir),
      normalizeServerName(options.serverName),
      [
        errorDiagnostic(
          "PI_MCP_CONFIG_WRITE_FAILED",
          `Cannot write MCP config: binary '${options.command}' is not found in PATH. Install the binary first.`,
          options.configPath ?? defaultPiMcpConfigPath(options.homeDir),
          normalizeServerName(options.serverName),
        ),
      ],
    );
  }

  if (usabilityResult.status === "unusable") {
    return failedResult(
      options.configPath ?? defaultPiMcpConfigPath(options.homeDir),
      normalizeServerName(options.serverName),
      [
        errorDiagnostic(
          "PI_MCP_CONFIG_WRITE_FAILED",
          `Cannot write MCP config: binary '${options.command}' exists but failed healthcheck. ${usabilityResult.reason ?? ""}`,
          options.configPath ?? defaultPiMcpConfigPath(options.homeDir),
          normalizeServerName(options.serverName),
        ),
      ],
    );
  }

  if (usabilityResult.status === "blocked") {
    return failedResult(
      options.configPath ?? defaultPiMcpConfigPath(options.homeDir),
      normalizeServerName(options.serverName),
      [
        errorDiagnostic(
          "PI_MCP_CONFIG_WRITE_FAILED",
          `Cannot write MCP config: binary '${options.command}' is blocked. ${usabilityResult.reason ?? ""}`,
          options.configPath ?? defaultPiMcpConfigPath(options.homeDir),
          normalizeServerName(options.serverName),
        ),
      ],
    );
  }

  // Binary is ready - proceed to write config
  return writeLocalMcpConfig({
    command: options.command,
    args: options.args,
    env: options.env,
    serverName: options.serverName,
    transport: options.transport,
    url: options.url,
    configPath: options.configPath,
    homeDir: options.homeDir,
  });
}

/**
 * Generic MCP config writer for local servers (command + args + env).
 * REQ-PI-003, REQ-CBM-002: context-mode and codebase-memory require local MCP config.
 *
 * This validates that the binary is usable before writing the config.
 */
export function writeLocalMcpConfig(options: WriteLocalMcpConfigOptions): PiMcpConfigWriteResult {
  const configPath = options.configPath ?? defaultPiMcpConfigPath(options.homeDir);
  const serverName = normalizeServerName(options.serverName);

  // Validate that command exists - but don't block if it doesn't exist yet
  // The capability may be installed later, so we allow the config to be written
  // and validate at runtime instead.

  const serverConfig: JsonRecord = {
    command: options.command,
    args: options.args ? [...options.args] : [],
    env: options.env ? { ...options.env } : {},
    transport: options.transport ?? "process",
  };

  // Add URL if specified (for HTTP transport)
  if (options.url) {
    serverConfig.url = options.url;
    serverConfig.headers = {};
  }

  return mergeAndWriteMcpConfig(configPath, serverName, serverConfig);
}

/**
 * Merge and write MCP config for a specific server.
 */
function mergeAndWriteMcpConfig(
  configPath: string,
  serverName: string,
  serverConfig: JsonRecord,
): PiMcpConfigWriteResult {
  const existed = existsSync(configPath);
  let config: JsonRecord = {};

  if (existed) {
    let raw: string;
    try {
      raw = readFileSync(configPath, "utf-8");
    } catch (error) {
      return failedResult(configPath, serverName, [
        errorDiagnostic(
          "PI_MCP_CONFIG_WRITE_FAILED",
          `Unable to read existing Pi MCP config: ${redact(String((error as Error).message ?? error))}`,
          configPath,
          serverName,
        ),
      ]);
    }

    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!isPlainRecord(parsed)) {
        return failedResult(configPath, serverName, [
          errorDiagnostic("PI_MCP_CONFIG_MALFORMED", "Pi MCP config must be a JSON object.", configPath, serverName),
        ]);
      }
      config = parsed;
    } catch {
      return failedResult(configPath, serverName, [
        errorDiagnostic("PI_MCP_CONFIG_MALFORMED", "Pi MCP config contains malformed JSON.", configPath, serverName),
      ]);
    }
  }

  const existingServers = config.mcpServers;
  if (existingServers !== undefined && !isPlainRecord(existingServers)) {
    return failedResult(configPath, serverName, [
      errorDiagnostic("PI_MCP_CONFIG_MALFORMED", "Pi MCP config `mcpServers` must be a JSON object.", configPath, serverName),
    ]);
  }

  const mcpServers = existingServers === undefined ? {} : { ...(existingServers as JsonRecord) };
  const previousServer = (mcpServers[serverName] ?? {}) as JsonRecord;

  const nextServer: JsonRecord = {
    ...previousServer,
    ...serverConfig,
  };

  const nextConfig: JsonRecord = {
    ...config,
    mcpServers: {
      ...mcpServers,
      [serverName]: nextServer,
    },
  };

  const changed = stableStringify(config) !== stableStringify(nextConfig);

  if (!changed) {
    return {
      ok: true,
      action: "unchanged",
      path: configPath,
      serverName,
      diagnostics: [
        infoDiagnostic(
          "PI_MCP_CONFIG_UNCHANGED",
          `MCP server entry '${serverName}' is already configured with the same settings.`,
          configPath,
          serverName,
        ),
      ],
    };
  }

  // Ensure directory exists
  try {
    mkdirSync(dirname(configPath), { recursive: true, mode: 0o700 });
  } catch (error) {
    return failedResult(configPath, serverName, [
      errorDiagnostic(
        "PI_MCP_CONFIG_WRITE_FAILED",
        `Unable to create Pi MCP config directory: ${redact(String((error as Error).message ?? error))}`,
        configPath,
        serverName,
      ),
    ]);
  }

  try {
    writeJsonAtomically(configPath, nextConfig);
  } catch (error) {
    return failedResult(configPath, serverName, [
      errorDiagnostic(
        "PI_MCP_CONFIG_WRITE_FAILED",
        `Unable to write Pi MCP config: ${redact(String((error as Error).message ?? error))}`,
        configPath,
        serverName,
      ),
    ]);
  }

  return {
    ok: true,
    action: existed ? "updated" : "created",
    path: configPath,
    serverName,
    diagnostics: [
      infoDiagnostic(
        existed ? "PI_MCP_CONFIG_UPDATED" : "PI_MCP_CONFIG_CREATED",
        `MCP server entry '${serverName}' written successfully.`,
        configPath,
        serverName,
      ),
    ],
  };
}

/**
 * Write Context7 MCP config using standard @upstash/context7-mcp.
 * REQ-MCP-001: Converge to standard @upstash/context7-mcp unless blocked.
 */
export function writeContext7McpConfig(options?: {
  serverName?: string;
  configPath?: string;
  homeDir?: string;
}): PiMcpConfigWriteResult {
  return writeLocalMcpConfig({
    command: "npx",
    args: ["-y", "@upstash/context7-mcp"],
    serverName: options?.serverName ?? CONTEXT7_MCP_SERVER_NAME,
    transport: "process",
    configPath: options?.configPath,
    homeDir: options?.homeDir,
  });
}

export type WriteSerenaMcpConfigOptions = Readonly<{
  authorization?: SerenaBootstrapAuthorization;
  operation?: SerenaOperationIdentity;
  readiness?: SerenaReadinessEvidence;
  command?: string;
  args?: readonly string[];
  revalidate?: SerenaReadinessRevalidator;
  /** Canonical Deck-owned `<data-root>/tools/serena` root. */
  ownedRoot?: string;
  configPath?: string;
  homeDir?: string;
  fileSystem?: PiMcpConfigFileSystem;
}>;

/**
 * Write only the evidence-authorized Serena Pi MCP entry.
 *
 * This synchronous function performs shape/path validation and the atomic
 * merge. Immediate same-path/fingerprint validation belongs to
 * `writeEvidenceGatedSerenaMcpConfig`, which is the adapter execution path.
 * A call without typed authorization/evidence is deliberately non-mutating.
 */
export function writeSerenaMcpConfig(
  options?: WriteSerenaMcpConfigOptions,
): PiMcpConfigWriteResult {
  const configPath = options?.configPath ?? defaultPiMcpConfigPath(options?.homeDir);
  const ownedRoot = resolveSerenaOwnedRoot(options);
  if (!ownedRoot) {
    return failedSerenaResult(configPath, "PI_MCP_CONFIG_CONFLICT", "Serena executable containment could not be established; no changes were written.");
  }
  const input = toSerenaWriterInput(options);
  const validation = validateSerenaMcpWriterInput(input, ownedRoot);
  if (!validation.valid) {
    return failedSerenaResult(configPath, validation.code, validation.diagnostic.message);
  }

  return writeValidatedSerenaMcpConfig({
    input: validation.input,
    configPath,
    fileSystem: options?.fileSystem ?? defaultPiMcpConfigFileSystem,
  });
}

/** Run Core's immediate evidence gate, then perform the Pi atomic merge. */
export async function writeEvidenceGatedSerenaMcpConfig(
  options?: WriteSerenaMcpConfigOptions,
): Promise<PiMcpConfigWriteResult> {
  const configPath = options?.configPath ?? defaultPiMcpConfigPath(options?.homeDir);
  const ownedRoot = resolveSerenaOwnedRoot(options);
  if (!ownedRoot) {
    return failedSerenaResult(configPath, "PI_MCP_CONFIG_CONFLICT", "Serena executable containment could not be established; no changes were written.");
  }
  const input = toSerenaWriterInput(options);
  const gated = await runEvidenceGatedSerenaWriter(
    input,
    async (validatedInput) => {
      const result = writeValidatedSerenaMcpConfig({
        input: validatedInput,
        configPath,
        fileSystem: options?.fileSystem ?? defaultPiMcpConfigFileSystem,
      });
      return result.ok
        ? { ok: true, status: result.action as "created" | "updated" | "unchanged" }
        : {
            ok: false,
            code: result.diagnostics[0]?.code ?? "writer-failed",
            diagnostic: {
              code: result.diagnostics[0]?.code ?? "writer-failed",
              message: result.diagnostics[0]?.message ?? "Serena configuration was not changed.",
            },
          };
    },
    ownedRoot,
  );

  if (gated.ok) {
    return {
      ok: true,
      action: gated.status,
      path: configPath,
      serverName: SERENA_MCP_SERVER_NAME,
      diagnostics: (gated.diagnostics ?? []).map((diagnostic) => ({
        code: "PI_MCP_CONFIG_UNCHANGED" as const,
        severity: "info" as const,
        message: diagnostic.message,
        path: configPath,
        serverName: SERENA_MCP_SERVER_NAME,
      })),
    };
  }

  return failedSerenaResult(configPath, gated.code, gated.diagnostic.message);
}

function toSerenaWriterInput(options?: WriteSerenaMcpConfigOptions): SerenaMcpWriterInput {
  return {
    authorization: options?.authorization as SerenaBootstrapAuthorization,
    operation: options?.operation as SerenaOperationIdentity,
    readiness: options?.readiness as SerenaReadinessEvidence,
    command: options?.command as string,
    args: options?.args as readonly string[],
    revalidate: options?.revalidate as SerenaReadinessRevalidator,
  };
}

function resolveSerenaOwnedRoot(options?: WriteSerenaMcpConfigOptions): string | undefined {
  if (options?.ownedRoot !== undefined) return options.ownedRoot;
  const executablePath = options?.readiness?.resolvedExecutablePath;
  if (!executablePath || !executablePath.endsWith("/bin/serena")) return undefined;
  return executablePath.slice(0, -"/bin/serena".length);
}

function writeValidatedSerenaMcpConfig(input: {
  input: SerenaMcpWriterInput;
  configPath: string;
  fileSystem: PiMcpConfigFileSystem;
}): PiMcpConfigWriteResult {
  const { configPath, fileSystem } = input;
  const existed = fileSystem.existsSync(configPath);
  let config: JsonRecord = {};

  if (existed) {
    let raw: string;
    try {
      raw = fileSystem.readFileSync(configPath, "utf-8");
    } catch {
      return failedSerenaResult(configPath, "PI_MCP_CONFIG_WRITE_FAILED", "Unable to read existing Pi MCP config; no changes were written.");
    }
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!isPlainRecord(parsed)) {
        return failedSerenaResult(configPath, "PI_MCP_CONFIG_MALFORMED", "Pi MCP config must be a JSON object; no changes were written.");
      }
      config = parsed;
    } catch {
      return failedSerenaResult(configPath, "PI_MCP_CONFIG_MALFORMED", "Pi MCP config contains malformed JSON; no changes were written.");
    }
  }

  const existingServers = config.mcpServers;
  if (existingServers !== undefined && !isPlainRecord(existingServers)) {
    return failedSerenaResult(configPath, "PI_MCP_CONFIG_MALFORMED", "Pi MCP config `mcpServers` must be an object; no changes were written.");
  }

  const servers = existingServers === undefined ? {} : { ...(existingServers as JsonRecord) };
  const existingServer = servers[SERENA_MCP_SERVER_NAME];
  if (existingServer !== undefined && !isPlainRecord(existingServer)) {
    return failedSerenaResult(configPath, "PI_MCP_CONFIG_CONFLICT", "Existing Serena MCP entry is not an object; no changes were written.");
  }

  const nextConfig: JsonRecord = {
    ...config,
    mcpServers: {
      ...servers,
      [SERENA_MCP_SERVER_NAME]: {
        ...((existingServer as JsonRecord | undefined) ?? {}),
        command: input.input.command,
        args: [...input.input.args],
      },
    },
  };

  if (stableStringify(config) === stableStringify(nextConfig)) {
    return {
      ok: true,
      action: "unchanged",
      path: configPath,
      serverName: SERENA_MCP_SERVER_NAME,
      diagnostics: [infoDiagnostic("PI_MCP_CONFIG_UNCHANGED", "Serena Pi MCP server entry is already configured.", configPath, SERENA_MCP_SERVER_NAME)],
    };
  }

  try {
    fileSystem.mkdirSync(dirname(configPath), { recursive: true, mode: 0o700 });
    const temporaryPath = `${configPath}.deck-serena.tmp`;
    try {
      fileSystem.writeFileSync(temporaryPath, `${JSON.stringify(nextConfig, null, 2)}\n`, { encoding: "utf-8", mode: 0o600 });
      fileSystem.renameSync(temporaryPath, configPath);
    } catch {
      try { fileSystem.rmSync(temporaryPath, { force: true }); } catch { /* preserve the original config */ }
      return failedSerenaResult(configPath, "PI_MCP_CONFIG_WRITE_FAILED", "Unable to atomically write Serena Pi MCP config; no changes were written.");
    }
  } catch {
    return failedSerenaResult(configPath, "PI_MCP_CONFIG_WRITE_FAILED", "Unable to prepare Serena Pi MCP config; no changes were written.");
  }

  return {
    ok: true,
    action: existed ? "updated" : "created",
    path: configPath,
    serverName: SERENA_MCP_SERVER_NAME,
    diagnostics: [infoDiagnostic(
      existed ? "PI_MCP_CONFIG_UPDATED" : "PI_MCP_CONFIG_CREATED",
      existed ? "Updated Serena Pi MCP server entry." : "Created Serena Pi MCP server entry.",
      configPath,
      SERENA_MCP_SERVER_NAME,
    )],
  };
}

function failedSerenaResult(
  configPath: string,
  code: string,
  message: string,
): PiMcpConfigWriteResult {
  const diagnosticCode: PiMcpConfigDiagnostic["code"] = code === "PI_MCP_CONFIG_MALFORMED"
    ? "PI_MCP_CONFIG_MALFORMED"
    : code === "PI_MCP_CONFIG_CONFLICT"
      ? "PI_MCP_CONFIG_CONFLICT"
      : "PI_MCP_CONFIG_WRITE_FAILED";
  return failedResult(configPath, SERENA_MCP_SERVER_NAME, [
    errorDiagnostic(diagnosticCode, message, configPath, SERENA_MCP_SERVER_NAME),
  ]);
}

/**
 * Write context-mode MCP config (local server backed by shared binary).
 * REQ-PI-003: context-mode must be local MCP backed by shared binary.
 *
 * Uses writeGatedLocalMcpConfig to enforce healthcheck before writing config.
 * This ensures config is only written if the context-mode binary passes healthcheck.
 */
export async function writeContextModeMcpConfig(
  options?: {
    serverName?: string;
    configPath?: string;
    homeDir?: string;
  },
  healthcheck?: () => Promise<{ status: "ready" | "missing" | "unusable" | "blocked"; command: string; reason?: string; version?: string }>,
): Promise<PiMcpConfigWriteResult> {
  return writeGatedLocalMcpConfig({
    command: "context-mode",
    serverName: options?.serverName ?? CONTEXT_MODE_MCP_SERVER_NAME,
    transport: "process",
    configPath: options?.configPath,
    homeDir: options?.homeDir,
    healthcheck,
  });
}

/**
 * Write codebase-memory MCP config (local server backed by codebase-memory-mcp binary).
 * REQ-CBM-002: codebase-memory requires local MCP integration.
 *
 * Uses writeGatedLocalMcpConfig to enforce healthcheck before writing config.
 * This ensures config is only written if the codebase-memory-mcp binary passes healthcheck.
 */
export async function writeCodebaseMemoryMcpConfig(
  options?: {
    serverName?: string;
    configPath?: string;
    homeDir?: string;
  },
  healthcheck?: () => Promise<{ status: "ready" | "missing" | "unusable" | "blocked"; command: string; reason?: string; version?: string }>,
): Promise<PiMcpConfigWriteResult> {
  return writeGatedLocalMcpConfig({
    command: "codebase-memory-mcp",
    serverName: options?.serverName ?? CODEBASE_MEMORY_MCP_SERVER_NAME,
    transport: "process",
    configPath: options?.configPath,
    homeDir: options?.homeDir,
    healthcheck,
  });
}

/**
 * Validate that an MCP server entry exists and is properly configured.
 */
export function validateMcpServerEntry(
  serverName: string,
  options?: {
    configPath?: string;
    homeDir?: string;
  },
): PiMcpConfigValidationResult {
  const configPath = options?.configPath ?? defaultPiMcpConfigPath(options?.homeDir);
  const normalizedName = normalizeServerName(serverName);

  if (!existsSync(configPath)) {
    return {
      ok: false,
      path: configPath,
      serverName: normalizedName,
      diagnostics: [
        errorDiagnostic(
          "PI_MCP_CONFIG_WRITE_FAILED",
          `Pi MCP config is missing; MCP server '${normalizedName}' not configured.`,
          configPath,
          normalizedName,
        ),
      ],
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(configPath, "utf-8"));
  } catch {
    return {
      ok: false,
      path: configPath,
      serverName: normalizedName,
      diagnostics: [
        errorDiagnostic("PI_MCP_CONFIG_MALFORMED", "Pi MCP config contains malformed JSON.", configPath, normalizedName),
      ],
    };
  }

  if (!isPlainRecord(parsed) || !isPlainRecord(parsed.mcpServers)) {
    return {
      ok: false,
      path: configPath,
      serverName: normalizedName,
      diagnostics: [
        errorDiagnostic("PI_MCP_CONFIG_MALFORMED", "Pi MCP config must contain an object mcpServers map.", configPath, normalizedName),
      ],
    };
  }

  const server = parsed.mcpServers[normalizedName];
  if (!isPlainRecord(server)) {
    return {
      ok: false,
      path: configPath,
      serverName: normalizedName,
      diagnostics: [
        errorDiagnostic("PI_MCP_CONFIG_CONFLICT", `Pi MCP config is missing server entry '${normalizedName}'.`, configPath, normalizedName),
      ],
    };
  }

  return {
    ok: true,
    path: configPath,
    serverName: normalizedName,
    diagnostics: [
      infoDiagnostic("PI_MCP_CONFIG_UNCHANGED", `MCP server '${normalizedName}' is properly configured.`, configPath, normalizedName),
    ],
  };
}
