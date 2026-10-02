import { isAbsolute } from "node:path";
import { isWebSearchProviderDescriptor, type WebSearchProviderDescriptorV1 } from "@deck/core";

import { DECK_PI_MCP_SERVER_IDS, mcpServerForCapability, type DeckPiMcpServerId } from "./pi-mcp-catalog";
import type { PiPlanDiagnostic } from "./pi-global-install";

/**
 * MCP stdio children inherit the Pi environment (verified against Pi 1.0.0). Deck blanks every memory variable in
 * each Deck entry's `env`, which Pi applies on top of the inherited environment (the child sees an empty value).
 */
export const DECK_PI_MEMORY_ENV_BLANKS: Readonly<Record<string, string>> = Object.freeze({
  DECK_RUNNER_MEMORY_ENDPOINT: "",
  DECK_RUNNER_MEMORY_TOKEN: "",
  DECK_RUNNER_MEMORY_TOKEN_FILE: "",
});

export type DeckPiMcpEntry = {
  command: string;
  args: string[];
  env: Record<string, string>;
  exposure: "direct";
};

export function buildDeckPiMcpEntry(input: { command: string; args: readonly string[] }): DeckPiMcpEntry {
  if (!isAbsolute(input.command) || /[\0\r\n]/.test(input.command)) throw new Error(`Deck MCP commands must be absolute executable paths (got "${input.command}").`);
  return { command: input.command, args: [...input.args], env: { ...DECK_PI_MEMORY_ENV_BLANKS }, exposure: "direct" };
}

const SECRET_ENV = /(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i;

/** Returns the list of contract violations for an entry (empty when it satisfies the Deck MCP contract). */
export function validateDeckPiMcpEntry(entry: unknown, executableExists: (path: string) => boolean): string[] {
  const problems: string[] = [];
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return ["MCP entry must be an object."];
  const record = entry as Record<string, unknown>;
  if (typeof record.command !== "string" || !isAbsolute(record.command)) problems.push("command must be an absolute executable path");
  else if (!executableExists(record.command)) problems.push(`command ${record.command} does not exist or is not executable`);
  if (record.exposure !== "direct") problems.push('exposure must be "direct"');
  const env = record.env && typeof record.env === "object" && !Array.isArray(record.env) ? (record.env as Record<string, unknown>) : {};
  for (const name of Object.keys(DECK_PI_MEMORY_ENV_BLANKS)) {
    if (env[name] !== "") problems.push(`env must blank ${name}`);
  }
  for (const [name, value] of Object.entries(env)) {
    if (name in DECK_PI_MEMORY_ENV_BLANKS) continue;
    if (SECRET_ENV.test(name) && typeof value === "string" && value.length > 0 && !/^\$[A-Z0-9_]+$/.test(value)) problems.push(`env ${name} embeds a credential`);
  }
  return problems;
}

export type SelectDeckPiMcpInput = {
  /** Explicit selection from the reviewed install (TUI). `undefined` for a launch-time plan. */
  capabilityIds: readonly string[] | undefined;
  /** Package ids of the enabled capability instruction fragments. */
  instructionPackageIds: readonly string[];
  webSearchEnabled: boolean;
  /** Servers Deck already owns according to its manifest. */
  ownedServers: readonly string[];
};

/**
 * Which Deck MCP servers should exist. An explicit TUI selection is exact (deselecting removes an owned server);
 * a launch-time plan adds the servers implied by enabled instruction packages / Web Search and keeps whatever Deck
 * already owns, so a TUI-only choice survives `deck pi developer`.
 */
export function selectDeckPiMcpServerIds(input: SelectDeckPiMcpInput): DeckPiMcpServerId[] {
  const selected = new Set<DeckPiMcpServerId>();
  if (input.capabilityIds !== undefined) {
    // The reviewed TUI selection is authoritative: nothing else adds a server, and an unselected one is removed.
    for (const id of input.capabilityIds) {
      const server = mcpServerForCapability(id);
      if (server) selected.add(server);
    }
  } else {
    for (const id of input.instructionPackageIds) {
      const server = mcpServerForCapability(id);
      if (server) selected.add(server);
    }
    if (input.webSearchEnabled) selected.add("web-search");
    for (const name of input.ownedServers) {
      const server = DECK_PI_MCP_SERVER_IDS.find((id) => id === name);
      if (server) selected.add(server);
    }
  }
  return DECK_PI_MCP_SERVER_IDS.filter((id) => selected.has(id));
}

export type DeckPiMcpToolResolver = {
  resolveExecutable(name: string): string | undefined;
  codebase: { command(): string | undefined };
};

export type ResolveDeckPiMcpInput = {
  selected: readonly DeckPiMcpServerId[];
  tools: DeckPiMcpToolResolver;
  /** Current `mcp.json` `mcpServers` (used to adopt Serena and to keep owned servers whose binary is unavailable). */
  existingServers: Readonly<Record<string, unknown>>;
  ownedServerNames: readonly string[];
  webSearchProvider: WebSearchProviderDescriptorV1 | undefined;
};

export type ResolvedDeckPiMcp = { servers: Record<string, DeckPiMcpEntry>; diagnostics: PiPlanDiagnostic[] };

export function resolveDeckPiMcpServers(input: ResolveDeckPiMcpInput): ResolvedDeckPiMcp {
  const servers: Record<string, DeckPiMcpEntry> = {};
  const diagnostics: PiPlanDiagnostic[] = [];

  const unavailable = (id: DeckPiMcpServerId, reason: string) => {
    const existing = input.existingServers[id];
    if (existing && typeof existing === "object" && input.ownedServerNames.includes(id)) {
      // Keep a server Deck already configured instead of silently dropping it because a binary moved.
      servers[id] = existing as DeckPiMcpEntry;
      diagnostics.push({ code: "PI_MCP_SERVER_UNAVAILABLE", severity: "warning", message: `${reason} The existing ${id} MCP entry was kept unchanged.` });
      return;
    }
    diagnostics.push({ code: "PI_MCP_SERVER_UNAVAILABLE", severity: "warning", message: `${reason} The ${id} MCP server was not configured.` });
  };

  for (const id of input.selected) {
    if (id === "context7") {
      const npx = input.tools.resolveExecutable("npx");
      if (!npx) unavailable(id, "Context7 needs `npx`, which was not found.");
      else servers[id] = buildDeckPiMcpEntry({ command: npx, args: ["-y", "@upstash/context7-mcp"] });
    } else if (id === "context-mode") {
      const command = input.tools.resolveExecutable("context-mode");
      if (!command) unavailable(id, "The context-mode binary was not found.");
      else servers[id] = buildDeckPiMcpEntry({ command, args: [] });
    } else if (id === "codebase-memory") {
      const command = input.tools.codebase.command();
      if (!command) unavailable(id, "No usable Codebase Memory binary is installed (shared or Deck-owned).");
      else servers[id] = buildDeckPiMcpEntry({ command, args: [] });
    } else if (id === "web-search") {
      const provider = input.webSearchProvider;
      if (!isWebSearchProviderDescriptor(provider)) {
        diagnostics.push({ code: "PI_MCP_SERVER_UNAVAILABLE", severity: "warning", message: "Web Search provider selection is unavailable; the web-search MCP server was not configured." });
        continue;
      }
      const command = input.tools.resolveExecutable(provider.command[0]!);
      if (!command) unavailable(id, `Web Search needs \`${provider.command[0]}\`, which was not found.`);
      else servers[provider.semanticServerId] = buildDeckPiMcpEntry({ command, args: provider.command.slice(1) });
    } else if (id === "serena") {
      const existing = input.existingServers.serena;
      const record = existing && typeof existing === "object" && !Array.isArray(existing) ? (existing as Record<string, unknown>) : undefined;
      if (!record || typeof record.command !== "string") {
        diagnostics.push({ code: "PI_MCP_SERVER_UNAVAILABLE", severity: "warning", message: "Serena is selected but its evidence-gated MCP entry is not configured yet; the serena MCP server was not configured." });
      } else if (!isAbsolute(record.command)) {
        diagnostics.push({ code: "PI_MCP_SERVER_UNAVAILABLE", severity: "warning", message: "The existing Serena MCP entry uses a non-absolute command; the serena MCP server was not configured." });
      } else {
        const args = Array.isArray(record.args) ? record.args.filter((arg): arg is string => typeof arg === "string") : [];
        servers.serena = buildDeckPiMcpEntry({ command: record.command, args });
      }
    }
  }
  return { servers, diagnostics };
}
