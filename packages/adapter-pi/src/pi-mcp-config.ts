import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const SUPERMEMORY_MCP_SERVER_NAME = "supermemory";
export const SUPERMEMORY_MCP_URL = "https://supermemory-new.stlmcp.com";
export const SUPERMEMORY_API_KEY_HEADER = "x-supermemory-api-key";

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

function redactDiagnostic(diagnostic: PiMcpConfigDiagnostic): PiMcpConfigDiagnostic {
  return { ...diagnostic, message: redact(diagnostic.message) };
}

function redact(value: string): string {
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
