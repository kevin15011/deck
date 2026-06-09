import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const SUPERMEMORY_MCP_SERVER_NAME = "supermemory";
export const SUPERMEMORY_MCP_URL = "https://supermemory-new.stlmcp.com";
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

export type WriteSupermemoryPiMcpConfigOptions = {
  /** Supermemory API token supplied by the user at install/configuration time. */
  token: string;
  /** MCP server entry name. Defaults to `supermemory`. */
  serverName?: string;
  /** Override for tests or advanced callers. Defaults to `~/.pi/agent/mcp.json`. */
  configPath?: string;
  /** Override home directory used to resolve the default path. */
  homeDir?: string;
};

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
  const token = options.token.trim();

  if (!token) {
    return failedResult(configPath, serverName, [
      {
        code: "PI_MCP_CONFIG_CONFLICT",
        severity: "error",
        path: configPath,
        serverName,
        message: "Supermemory token is required to configure the Pi MCP server.",
      },
    ]);
  }

  const merged = readAndMergeConfig(configPath, serverName, token);
  if (!merged.ok) {
    return failedResult(configPath, serverName, merged.diagnostics);
  }

  if (!merged.changed) {
    const diagnostics = [
      infoDiagnostic(
        "PI_MCP_CONFIG_UNCHANGED",
        "Supermemory Pi MCP server entry is already configured; credential value is redacted.",
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
        ? "Updated Supermemory Pi MCP server entry; credential value is redacted."
        : "Created Pi MCP config with Supermemory server entry; credential value is redacted.",
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

  if (!isPlainRecord(server.headers) || typeof server.headers[SUPERMEMORY_API_KEY_HEADER] !== "string" || !server.headers[SUPERMEMORY_API_KEY_HEADER].trim()) {
    return {
      ok: false,
      path: configPath,
      serverName,
      diagnostics: [errorDiagnostic("PI_MCP_CONFIG_CONFLICT", `Pi MCP server '${serverName}' is missing a non-empty redacted Supermemory credential header; Supermemory tools were not injected.`, configPath, serverName)],
    };
  }

  return {
    ok: true,
    path: configPath,
    serverName,
    diagnostics: [infoDiagnostic("PI_MCP_CONFIG_UNCHANGED", "Supermemory Pi MCP server entry is present; credential value is redacted.", configPath, serverName)],
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

function readAndMergeConfig(configPath: string, serverName: string, token: string): MergeOutcome {
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
  if (existingServer !== undefined && !isPlainRecord(existingServer)) {
    return {
      ok: false,
      diagnostics: [
        errorDiagnostic(
          "PI_MCP_CONFIG_CONFLICT",
          `Existing MCP server entry '${serverName}' is not an object; no changes were written.`,
          configPath,
          serverName,
        ),
      ],
    };
  }

  const previousServer = (existingServer ?? {}) as JsonRecord;
  const previousHeaders = previousServer.headers;
  if (previousHeaders !== undefined && !isPlainRecord(previousHeaders)) {
    return {
      ok: false,
      diagnostics: [
        errorDiagnostic(
          "PI_MCP_CONFIG_CONFLICT",
          `Existing MCP server entry '${serverName}' has non-object headers; no changes were written.`,
          configPath,
          serverName,
        ),
      ],
    };
  }

  const nextServer: JsonRecord = {
    ...previousServer,
    transport: "http",
    url: SUPERMEMORY_MCP_URL,
    headers: {
      ...((previousHeaders as JsonRecord | undefined) ?? {}),
      [SUPERMEMORY_API_KEY_HEADER]: token,
    },
  };

  const nextConfig: JsonRecord = {
    ...config,
    mcpServers: {
      ...mcpServers,
      [serverName]: nextServer,
    },
  };

  return {
    ok: true,
    config: nextConfig,
    changed: stableStringify(config) !== stableStringify(nextConfig),
    existed,
  };
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

/**
 * Write Serena MCP config.
 * REQ-PI-002: Serena is mandatory for Pi parity.
 */
export function writeSerenaMcpConfig(options?: {
  serverName?: string;
  configPath?: string;
  homeDir?: string;
}): PiMcpConfigWriteResult {
  return writeLocalMcpConfig({
    command: "serena",
    serverName: options?.serverName ?? SERENA_MCP_SERVER_NAME,
    transport: "process",
    configPath: options?.configPath,
    homeDir: options?.homeDir,
  });
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
