import { createHash } from "node:crypto";

/**
 * Deck-owned state under the Pi agent directory, recorded with content hashes so Deck only replaces or removes
 * what it wrote and never touches user-owned files, `settings.json` values or `mcp.json` servers.
 */
export const PI_MANIFEST_SCHEMA = "deck-pi-manifest-v1" as const;

export type PiManifestV1 = {
  schema: typeof PI_MANIFEST_SCHEMA;
  /** Files written by Deck, keyed by POSIX path relative to the agent directory. Value: sha256 hex. */
  files: Record<string, string>;
  settings: {
    /** `settings.json` `packages` entries Deck owns (the Deck package). */
    packages: string[];
    /** Foreign package sources Deck itself added in `packages` (candidates for mandatory removal). */
    addedPackages: string[];
  };
  mcp: {
    /** `mcp.json` server names Deck owns. Value: sha256 of the canonical entry JSON. */
    servers: Record<string, string>;
  };
};

export type ParsedPiManifest = { ok: true; manifest: PiManifestV1 } | { ok: false; reason: string };

export function hashContent(content: string | Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, item]) => [key, sortKeys(item)]),
    );
  }
  return value;
}

export function hashJsonValue(value: unknown): string {
  return hashContent(canonicalJson(value));
}

export function createEmptyPiManifest(): PiManifestV1 {
  return { schema: PI_MANIFEST_SCHEMA, files: {}, settings: { packages: [], addedPackages: [] }, mcp: { servers: {} } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringRecord(value: unknown): Record<string, string> | undefined {
  if (value === undefined) return {};
  if (!isRecord(value)) return undefined;
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== "string") return undefined;
    result[key] = item;
  }
  return result;
}

function stringArray(value: unknown): string[] | undefined {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) return undefined;
  return [...(value as string[])];
}

export function parsePiManifest(text: string): ParsedPiManifest {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reason: "Deck Pi manifest is not valid JSON." };
  }
  if (!isRecord(raw) || raw.schema !== PI_MANIFEST_SCHEMA) return { ok: false, reason: "Deck Pi manifest has an unknown schema." };
  const files = stringRecord(raw.files);
  if (!files || Array.isArray(raw.files)) return { ok: false, reason: "Deck Pi manifest `files` must be an object of hashes." };
  const settings = raw.settings === undefined ? {} : raw.settings;
  if (!isRecord(settings)) return { ok: false, reason: "Deck Pi manifest `settings` must be an object." };
  const packages = stringArray(settings.packages);
  const addedPackages = stringArray(settings.addedPackages);
  if (!packages || !addedPackages) return { ok: false, reason: "Deck Pi manifest package lists must be string arrays." };
  const mcp = raw.mcp === undefined ? {} : raw.mcp;
  if (!isRecord(mcp)) return { ok: false, reason: "Deck Pi manifest `mcp` must be an object." };
  const servers = stringRecord(mcp.servers);
  if (!servers) return { ok: false, reason: "Deck Pi manifest MCP servers must map names to hashes." };
  return { ok: true, manifest: { schema: PI_MANIFEST_SCHEMA, files, settings: { packages, addedPackages }, mcp: { servers } } };
}

export function serializePiManifest(manifest: PiManifestV1): string {
  const sortedFiles = Object.fromEntries(Object.entries(manifest.files).sort(([left], [right]) => (left < right ? -1 : 1)));
  const sortedServers = Object.fromEntries(Object.entries(manifest.mcp.servers).sort(([left], [right]) => (left < right ? -1 : 1)));
  return `${JSON.stringify({
    schema: PI_MANIFEST_SCHEMA,
    files: sortedFiles,
    settings: { packages: [...manifest.settings.packages], addedPackages: [...manifest.settings.addedPackages] },
    mcp: { servers: sortedServers },
  }, null, 2)}\n`;
}

/**
 * Normalizes a `settings.json` `packages` entry (string or `{ source }` object) to a comparable package name:
 * strips `npm:` and a trailing `@version`, keeps scopes and local paths.
 */
export function normalizePackageSource(entry: unknown): string | undefined {
  const source = typeof entry === "string" ? entry : isRecord(entry) && typeof entry.source === "string" ? entry.source : undefined;
  if (source === undefined) return undefined;
  const trimmed = source.trim();
  if (trimmed.length === 0) return undefined;
  const withoutPrefix = trimmed.replace(/^npm:/, "");
  const atVersion = withoutPrefix.lastIndexOf("@");
  return atVersion > 0 ? withoutPrefix.slice(0, atVersion) : withoutPrefix;
}
