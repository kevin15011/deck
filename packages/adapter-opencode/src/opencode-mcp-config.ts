import { randomUUID } from "node:crypto";
import { jsonRanges } from "../../core/src/jsonc-ranges";
import { setField } from "./content-refresh";
import { assertNoContributionSymlink, classifyManagedSlot, readRunnerContributions, type ContributionTarget, type ManagedArtifactPolicy, beginRunnerContributions, canonicalContributionJson, contributionHash, hasRunnerContributionProof } from "@deck/core";
import { chmodSync, existsSync, readFileSync, statSync, writeFileSync, appendFileSync, renameSync, unlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  SERENA_MCP_ARGS,
  validateSerenaReadinessEvidence,
  type SerenaReadinessEvidence,
  type SerenaMcpWriteStatus,
} from "@deck/core";
import { execSync } from "node:child_process";

export type OpenCodeMcpConfigValidationResult = {
  ok: boolean;
  path: string;
  serverName: string;
  projectScope?: string;
  diagnostics: string[];
};

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// Generic MCP server config writer
// ---------------------------------------------------------------------------

export type OpenCodeMcpServerType = "local" | "remote";

export type WriteOpenCodeMcpConfigOptions = {
  /** Exact shared candidates discovered for this reviewed operation, including rejected builds. */
  codebasePreviousCommands?: readonly string[];
  /** Name of the MCP server (e.g., "context7", "web-search") */
  serverName: string;
  /** Whether the server is local (npx command) or remote (URL) */
  type: OpenCodeMcpServerType;
  /** For local servers: the command to run (e.g., ["npx", "-y", "@upstash/context7-mcp"]) */
  command?: string[];
  /** For remote servers: the URL of the MCP server */
  url?: string;
  /** For remote servers: optional headers (e.g., Authorization) */
  headers?: Record<string, string>;
  /** Plugins to remove from the `plugin` array when writing MCP config (used for migration from plugin to MCP) */
  pluginsToRemove?: string[];
  /** Path to opencode.json (defaults to ~/.config/opencode/opencode.json) */
  configPath?: string;
  /** Home directory for default path resolution */
  homeDir?: string;
  /** Serena-only validated readiness handoff. Generic MCP callers do not use this. */
  serenaReadiness?: SerenaReadinessEvidence;
  /** Serena-only Deck-owned root used for containment validation. */
  ownedRoot?: string;
  /** Serena-only injectable atomic file boundary. */
  fileSystem?: OpenCodeMcpConfigFileSystem;
};

export type WriteOpenCodeMcpConfigResult = {
  ok: boolean;
  path: string;
  serverName: string;
  code?: string;
  diagnostics: string[];
  status?: SerenaMcpWriteStatus;
};

export type OpenCodeMcpConfigFileSystem = {
  exists: (path: string) => boolean;
  readFile: (path: string) => string;
  writeFile: (path: string, content: string, options?: { mode?: number }) => void;
  rename: (from: string, to: string) => void;
  unlink?: (path: string) => void;
  temporaryPath?: (configPath: string) => string;
  statMode?: (path: string) => number;
  chmod?: (path: string, mode: number) => void;
};

export type WriteSerenaOpenCodeMcpConfigOptions = {
  configPath?: string;
  homeDir?: string;
  serverName?: string;
  ownedRoot: string;
  readiness: SerenaReadinessEvidence;
  command: readonly string[];
  fileSystem?: OpenCodeMcpConfigFileSystem;
};

/**
 * Writes or updates a generic MCP server entry in OpenCode's opencode.json.
 *
 * Supports both local MCP servers (using command) and remote MCP servers (using url).
 *
 * Local example (context7):
 *   {
 *     "mcp": {
 *       "context7": {
 *         "type": "local",
 *         "command": ["npx", "-y", "@upstash/context7-mcp"],
 *         "enabled": true
 *       }
 *     }
 *   }
 *
 * Remote example:
 *   {
 *     "mcp": {
 *       "my-remote": {
 *         "type": "remote",
 *         "url": "https://mcp.example.com",
 *         "headers": { "Authorization": "Bearer {env:MY_TOKEN}" },
 *         "enabled": true
 *       }
 *     }
 *   }
 */
export function writeOpenCodeMcpConfig(
  options: WriteOpenCodeMcpConfigOptions,
): WriteOpenCodeMcpConfigResult {
  const homeDir = options.homeDir ?? process.env.HOME ?? "/home/user";
  const configPath = options.configPath ?? join(homeDir, ".config", "opencode", "opencode.json");
  const serverName = options.serverName.trim();

  const diagnostics: string[] = [];
  if (serverName === "serena" || serverName === "context-mode") return { ok: false, path: configPath, serverName, diagnostics: ["Retired capability is disabled; no configuration written."] };

  if (!serverName) {
    diagnostics.push("MCP server name is required.");
    return { ok: false, path: configPath, serverName: options.serverName, diagnostics };
  }

  if (serverName === "serena") {
    return writeSerenaOpenCodeMcpConfigInternal({
      configPath,
      serverName,
      ownedRoot: options.ownedRoot,
      readiness: options.serenaReadiness,
      command: options.command,
      fileSystem: options.fileSystem,
    });
  }

  if (options.type === "local" && !options.command) {
    diagnostics.push("Local MCP server requires a command array.");
    return { ok: false, path: configPath, serverName, diagnostics };
  }

  if (options.type === "remote" && !options.url) {
    diagnostics.push("Remote MCP server requires a URL.");
    return { ok: false, path: configPath, serverName, diagnostics };
  }

  const root = resolve(dirname(configPath)), manifestPath = join(root, "deck/manifest.json");
  const fail = (code: string, message: string): WriteOpenCodeMcpConfigResult => ({ ok: false, path: configPath, serverName, code, diagnostics: [message] });
  try {
    assertNoContributionSymlink(configPath);
    const before = existsSync(configPath) ? readFileSync(configPath, "utf8") : undefined;
    const parsed = jsonRanges(before ?? "{}");
    if (!parsed.properties || parsed.properties.has("mcp") && !parsed.properties.get("mcp")!.node.properties) return fail("mcp-config-conflict", "MCP configuration is malformed; preserved without changes.");
    const previous = parsed.properties.get("mcp")?.node.properties?.get(serverName)?.node.value;
    const entry: Record<string, unknown> = options.type === "local"
      ? { type: "local", enabled: true, command: options.command }
      : { type: "remote", enabled: true, url: options.url, oauth: false, ...(options.headers ? { headers: options.headers } : {}) };
    const target: ContributionTarget = { path: resolve(configPath), selector: { kind: "json", keys: ["mcp", serverName] }, expectedHash: contributionHash(canonicalContributionJson(entry)), sourceItemId: `mcp:${serverName}` };
    const legacy = (content: string | Uint8Array): boolean => {
      const value = JSON.parse(String(content));
      if (!isPlainRecord(value) || value.type !== "local" || value.enabled === false || Object.keys(value).some(key => !["type", "enabled", "command"].includes(key))) return false;
      const command = value.command;
      if (!Array.isArray(command) || !command.every(part => typeof part === "string")) return false;
      if (serverName === "context7") return command.length === 3 && command[0] === "npx" && command[1] === "-y" && ["@upstash/context7-mcp", "@upstash/context7-mcp@4.1.1"].includes(command[2]);
      if (serverName === "codebase-memory") return command.length === 1 && ["codebase-memory-mcp", join(homeDir, ".local/bin/codebase-memory-mcp"), ...(options.codebasePreviousCommands ?? [])].includes(command[0]);
      return false;
    };
    const managed: ManagedArtifactPolicy = { stateRoot: join(root, "deck/recovery-state"), inventory: { runnerId: "opencode", root, generatedRoots: [], slots: [{ ...target, authority: "recognized", recognizeLegacy: legacy }] } };
    const receipt = readRunnerContributions(manifestPath);
    if (receipt && (receipt.runnerId !== "opencode" || resolve(receipt.root) !== root)) return fail("mcp-config-conflict", "MCP ownership identity differs; preserved without changes.");
    if (classifyManagedSlot({ inventory: managed.inventory, target, content: previous === undefined ? undefined : canonicalContributionJson(previous), receipts: receipt?.contributions }) === "ambiguous") return fail("mcp-config-conflict", "MCP entry is custom or ambiguous; preserved without changes.");
    let next = setField(before ?? "{}", ["mcp", serverName], entry);
    // Remove only separately proven legacy plugin selectors, preserving every other JSONC byte.
    const plugins = jsonRanges(next).properties?.get("plugin")?.node;
    if (plugins?.elements && options.pluginsToRemove?.length) {
      for (const element of [...plugins.elements].reverse()) {
        if (typeof element.node.value !== "string" || !options.pluginsToRemove.includes(element.node.value)) continue;
        if (!hasRunnerContributionProof(manifestPath, { path: configPath, selector: { kind: "json-array", keys: ["plugin"], identity: canonicalContributionJson(element.node.value) } })) continue;
        // Reparse after each removal to maintain comma ranges.
        const current = jsonRanges(next).properties!.get("plugin")!.node.elements!;
        const item = current.find(item => item.node.value === element.node.value)!;
        const index = current.indexOf(item), prior = current[index - 1];
        const start = item.comma === undefined && prior?.comma !== undefined ? prior.comma : item.node.start;
        const end = item.comma === undefined ? item.node.end : item.comma + 1;
        next = next.slice(0, start) + next.slice(end);
      }
    }
    const accounting = beginRunnerContributions({ runnerId: "opencode", root, manifestPath, deckVersion: "0.14.0", targets: [target], managed });
    const temporary = `${configPath}.deck-mcp-${randomUUID()}.tmp`;
    const current = () => { assertNoContributionSymlink(configPath); return existsSync(configPath) ? readFileSync(configPath, "utf8") : undefined; };
    let published = false;
    try {
      if (current() !== before) throw new Error("MCP configuration changed during preparation; preserved.");
      if (next !== before) {
        writeFileSync(temporary, next, { encoding: "utf8", mode: 0o600, flag: "wx" });
        if (current() !== before) throw new Error("MCP configuration changed before publication; preserved.");
        renameSync(temporary, configPath); published = true;
      }
      accounting.commit();
    } catch (error) {
      try {
        if (published) {
          if (current() !== next) throw new Error("MCP rollback conflict; preserved pending evidence.");
          if (before === undefined) unlinkSync(configPath);
          else { writeFileSync(temporary, before, { encoding: "utf8", mode: 0o600, flag: "wx" }); renameSync(temporary, configPath); }
        }
        accounting.abort();
      } catch { accounting.abandon(); }
      throw error;
    } finally { if (existsSync(temporary)) unlinkSync(temporary); }
    return { ok: true, path: configPath, serverName, status: next === before ? "unchanged" : "created", diagnostics: [] };
  } catch { return fail("mcp-config-conflict", "MCP configuration could not be reconciled; inspect retained configuration and pending evidence."); }

}

/**
 * Atomically creates or updates only the Serena entry in OpenCode's MCP map.
 * The validated resolved executable is serialized verbatim; a bare `serena`
 * token is never accepted by this boundary.
 */
export function writeSerenaOpenCodeMcpConfig(
  options: WriteSerenaOpenCodeMcpConfigOptions,
): WriteOpenCodeMcpConfigResult {
  const homeDir = options.homeDir ?? process.env.HOME ?? "/home/user";
  const configPath = options.configPath ?? join(homeDir, ".config", "opencode", "opencode.json");
  const serverName = (options.serverName ?? "serena").trim();
  return writeSerenaOpenCodeMcpConfigInternal({
    configPath,
    serverName,
    ownedRoot: options.ownedRoot,
    readiness: options.readiness,
    command: options.command,
    fileSystem: options.fileSystem,
  });
}

function writeSerenaOpenCodeMcpConfigInternal(options: {
  configPath: string;
  serverName: string;
  ownedRoot?: string;
  readiness?: SerenaReadinessEvidence;
  command?: readonly string[];
  fileSystem?: OpenCodeMcpConfigFileSystem;
}): WriteOpenCodeMcpConfigResult {
  const fail = (code: string, message: string): WriteOpenCodeMcpConfigResult => ({
    ok: false,
    path: options.configPath,
    serverName: options.serverName,
    code,
    diagnostics: [message],
  });

  if (options.serverName !== "serena") return fail("invalid-server", "Serena writer requires server name 'serena'.");
  if (!options.ownedRoot || !options.readiness || !Array.isArray(options.command)) {
    return fail("invalid-readiness-evidence", "Serena configuration requires validated readiness evidence and an exact command array.");
  }
  if (!isSafeOwnedRoot(options.ownedRoot)) return fail("root-invalid", "Serena configuration requires a contained Deck-owned root.");

  const evidence = validateSerenaReadinessEvidence(options.readiness, options.ownedRoot);
  if (!evidence.valid) return fail(evidence.code, evidence.diagnostic.message);

  const command = [...options.command];
  if (
    command.length !== SERENA_MCP_ARGS.length + 1
    || command[0] !== evidence.evidence.resolvedExecutablePath
    || command.slice(1).some((arg, index) => arg !== SERENA_MCP_ARGS[index])
  ) {
    return fail("invalid-command", "Serena configuration requires the resolved executable and fixed MCP arguments.");
  }

  const fileSystem = options.fileSystem ?? defaultOpenCodeMcpConfigFileSystem();
  let existed = false;
  let config: Record<string, unknown> = {};
  try {
    existed = fileSystem.exists(options.configPath);
    if (existed) {
      const parsed: unknown = JSON.parse(fileSystem.readFile(options.configPath));
      if (!isPlainRecord(parsed)) return fail("malformed-config", "OpenCode MCP config must be a JSON object.");
      config = parsed;
    }
  } catch {
    return fail("malformed-config", "OpenCode MCP config could not be read or parsed.");
  }

  let mcp: Record<string, unknown> = {};
  if (Object.prototype.hasOwnProperty.call(config, "mcp")) {
    if (!isPlainRecord(config.mcp)) return fail("malformed-config", "OpenCode MCP config must contain an object 'mcp' map.");
    mcp = config.mcp;
  }

  const existing = mcp.serena;
  if (isKnownGoodSerenaEntry(existing, command)) {
    return {
      ok: true,
      path: options.configPath,
      serverName: options.serverName,
      status: "unchanged",
      diagnostics: [],
    };
  }

  const nextConfig: Record<string, unknown> = {
    ...config,
    mcp: {
      ...mcp,
      serena: {
        type: "local",
        command,
        enabled: true,
      },
    },
  };
  const tempPath = fileSystem.temporaryPath?.(options.configPath) ?? `${options.configPath}.deck-serena.tmp`;
  if (resolve(dirname(tempPath)) !== resolve(dirname(options.configPath))) {
    return fail("temporary-path-invalid", "Serena configuration temporary storage must share the config directory.");
  }

  try {
    fileSystem.writeFile(tempPath, JSON.stringify(nextConfig, null, 2));
    fileSystem.rename(tempPath, options.configPath);
  } catch {
    try { fileSystem.unlink?.(tempPath); } catch { /* preserve the known-good config */ }
    return fail("config-write-failed", "Serena MCP configuration was not changed.");
  }

  return {
    ok: true,
    path: options.configPath,
    serverName: options.serverName,
    status: existed ? "updated" : "created",
    diagnostics: [],
  };
}

function defaultOpenCodeMcpConfigFileSystem(): OpenCodeMcpConfigFileSystem {
  return {
    exists: existsSync,
    readFile: (path) => readFileSync(path, "utf8"),
    writeFile: (path, content, options) => writeFileSync(path, content, { encoding: "utf8", mode: options?.mode }),
    rename: renameSync,
    unlink: unlinkSync,
    statMode: (path) => statSync(path).mode,
    chmod: chmodSync,
  };
}

function isKnownGoodSerenaEntry(value: unknown, command: readonly string[]): boolean {
  if (!isPlainRecord(value)) return false;
  if (value.type !== "local" || value.enabled === false) return false;
  return Array.isArray(value.command)
    && value.command.length === command.length
    && value.command.every((part, index) => part === command[index]);
}

function isSafeOwnedRoot(root: string): boolean {
  if (!root.startsWith("/") || root === "/" || root.includes("\0") || root.split("/").some((part) => part === "..")) return false;
  return !new Set(["/bin", "/sbin", "/usr", "/opt", "/etc", "/var", "/root"]).has(root.replace(/\/$/u, ""));
}
