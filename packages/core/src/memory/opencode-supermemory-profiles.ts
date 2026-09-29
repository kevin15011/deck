import type { DeckSecretStore } from "../config/secret-store";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import type { Stats } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

export const OPENCODE_SUPERMEMORY_PROFILE_SECRET = "opencode-supermemory-profiles";

const PROFILE_SCHEMA = "deck-opencode-supermemory-profiles-v1";
const MAX_STORE_BYTES = 64 * 1024;
const MAX_SSH_CONFIG_BYTES = 256 * 1024;
const MAX_SSH_CONFIG_FILES = 32;
const MAX_SSH_INCLUDE_DEPTH = 8;
const SSH_ALIAS = /^[A-Za-z0-9][A-Za-z0-9._-]{0,252}$/;

type StoredProfiles = {
  schema: typeof PROFILE_SCHEMA;
  defaultToken?: string;
  profiles: Record<string, string>;
};

export type LiteralSshHostDiscovery = Readonly<{
  status: "trusted" | "uncertain";
  aliases: readonly string[];
  ambiguousAliases: readonly string[];
}>;

export type OpenCodeSupermemoryCredentialResolution =
  | Readonly<{ ok: true; profile: string; token: string; source: "alias" | "default" }>
  | Readonly<{ ok: false; reason: "missing-default" | "invalid-store"; message: string }>;

/** Validate the protected profile payload without exposing any stored credential. */
export function hasUsableOpenCodeSupermemoryProfileCredential(raw: string | undefined): boolean {
  try {
    const profiles = parseProfilesRaw(raw, false);
    return Boolean(profiles.defaultToken) || Object.keys(profiles.profiles).length > 0;
  } catch {
    return false;
  }
}

/**
 * Returns only non-secret profile identifiers for status UIs. Invalid stores
 * throw so callers can fail closed instead of presenting stale readiness.
 */
export function listConfiguredOpenCodeSupermemoryProfiles(raw: string | undefined): readonly string[] {
  try {
    const stored = parseProfilesRaw(raw, true);
    return [
      ...(stored.defaultToken ? ["default"] : []),
      ...Object.keys(stored.profiles).sort(),
    ];
  } catch {
    throw new Error("invalid-store");
  }
}

export type OpenCodeSupermemoryProfileConfiguration = {
  fallbackDefaultConfigured: boolean;
  configuredAliases: readonly string[];
};

/** Non-secret configuration evidence with fallback and SSH-alias identities kept distinct. */
export function inspectOpenCodeSupermemoryProfileConfiguration(raw: string | undefined): OpenCodeSupermemoryProfileConfiguration {
  try {
    const stored = parseProfilesRaw(raw, true);
    return {
      fallbackDefaultConfigured: Boolean(stored.defaultToken),
      configuredAliases: Object.keys(stored.profiles).sort(),
    };
  } catch {
    throw new Error("invalid-store");
  }
}

export function discoverLiteralSshHostAliases(config: string): LiteralSshHostDiscovery {
  const counts = new Map<string, { display: string; count: number }>();
  for (const rawLine of config.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+#.*$/, "").trim();
    if (!line) continue;
    const match = line.match(/^Host(?:\s*=\s*|\s+)(.+)$/i);
    if (!match) continue;
    for (const candidate of match[1]!.trim().split(/\s+/)) {
      if (!SSH_ALIAS.test(candidate) || candidate.startsWith("!") || /[*?%]/.test(candidate)) continue;
      const normalized = candidate.toLowerCase();
      const previous = counts.get(normalized);
      counts.set(normalized, { display: previous?.display ?? candidate, count: (previous?.count ?? 0) + 1 });
    }
  }
  const aliases: string[] = [];
  const ambiguousAliases: string[] = [];
  for (const { display, count } of counts.values()) {
    (count === 1 ? aliases : ambiguousAliases).push(display);
  }
  return Object.freeze({
    status: "trusted",
    aliases: Object.freeze(aliases.sort((a, b) => a.localeCompare(b))),
    ambiguousAliases: Object.freeze(ambiguousAliases.sort((a, b) => a.localeCompare(b))),
  });
}

export function discoverLiteralSshHostAliasesFromHome(homeDir: string): LiteralSshHostDiscovery {
  try {
    const sshDirectory = join(homeDir, ".ssh");
    validateTrustedSshDirectory(sshDirectory);
    const state = { files: 0, bytes: 0, visited: new Set<string>() };
    const contents = readTrustedSshConfig(join(sshDirectory, "config"), sshDirectory, state, 0);
    return discoverLiteralSshHostAliases(contents.join("\n"));
  } catch {
    return { status: "uncertain", aliases: [], ambiguousAliases: [] };
  }
}

export function storeOpenCodeSupermemoryCredential(input: {
  store: DeckSecretStore;
  token: string;
  alias?: string;
  makeDefault?: boolean;
  eligibleAliases: readonly string[];
}): void {
  const token = input.token.trim();
  if (!token || token.length > 16 * 1024 || /[\r\n\0]/.test(token)) throw new Error("Supermemory credential is invalid.");
  if (!input.makeDefault && !input.alias) throw new Error("Choose an eligible literal SSH Host alias or the explicit default profile.");

  const eligible = new Map(input.eligibleAliases.map((alias) => [alias.toLowerCase(), alias]));
  const alias = input.alias?.trim();
  if (alias && (!SSH_ALIAS.test(alias) || !eligible.has(alias.toLowerCase()))) {
    throw new Error("Supermemory profile must use an eligible literal SSH Host alias.");
  }

  const update = (raw: string | undefined): string => {
    const current = parseProfilesRaw(raw, true);
    const profiles = Object.assign(Object.create(null) as Record<string, string>, current.profiles);
    const next: StoredProfiles = {
      schema: PROFILE_SCHEMA,
      profiles,
      ...(current.defaultToken ? { defaultToken: current.defaultToken } : {}),
    };
    if (alias) next.profiles[alias.toLowerCase()] = token;
    if (input.makeDefault) next.defaultToken = token;
    return JSON.stringify(next);
  };
  if (input.store.update) input.store.update(OPENCODE_SUPERMEMORY_PROFILE_SECRET, update);
  else input.store.write(OPENCODE_SUPERMEMORY_PROFILE_SECRET, update(input.store.read(OPENCODE_SUPERMEMORY_PROFILE_SECRET)));
}

export function resolveOpenCodeSupermemoryCredential(input: {
  store: Pick<DeckSecretStore, "read">;
  origin?: string;
  ambiguousAliases?: readonly string[];
  sshDiscoveryStatus?: LiteralSshHostDiscovery["status"];
}): OpenCodeSupermemoryCredentialResolution {
  let profiles: StoredProfiles;
  try {
    profiles = readProfiles(input.store, true);
  } catch {
    return { ok: false, reason: "invalid-store", message: "The protected OpenCode Supermemory profile store is invalid." };
  }

  const alias = logicalSshAlias(input.origin);
  const ambiguous = new Set((input.ambiguousAliases ?? []).map((value) => value.toLowerCase()));
  if (input.sshDiscoveryStatus === "trusted" && alias && !ambiguous.has(alias)) {
    const token = Object.hasOwn(profiles.profiles, alias) ? profiles.profiles[alias] : undefined;
    if (token) return { ok: true, profile: alias, token, source: "alias" };
  }
  if (profiles.defaultToken) return { ok: true, profile: "default", token: profiles.defaultToken, source: "default" };
  return {
    ok: false,
    reason: "missing-default",
    message: "No OpenCode Supermemory credential is configured for the resolved profile and no explicit default credential is available.",
  };
}

function logicalSshAlias(origin: string | undefined): string | undefined {
  const value = origin?.trim();
  if (!value || /^https?:\/\//i.test(value)) return undefined;
  const scp = value.includes("://") ? null : value.match(/^(?:[^@\s/:]+@)?([^\s/:]+):[^\s]+$/);
  if (scp && SSH_ALIAS.test(scp[1]!)) return scp[1]!.toLowerCase();
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "ssh:" || !SSH_ALIAS.test(parsed.hostname)) return undefined;
    return parsed.hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

function readProfiles(store: Pick<DeckSecretStore, "read">, missingIsEmpty: boolean): StoredProfiles {
  return parseProfilesRaw(store.read(OPENCODE_SUPERMEMORY_PROFILE_SECRET), missingIsEmpty);
}

function parseProfilesRaw(raw: string | undefined, missingIsEmpty: boolean): StoredProfiles {
  if (raw === undefined && missingIsEmpty) return { schema: PROFILE_SCHEMA, profiles: {} };
  if (!raw || Buffer.byteLength(raw, "utf8") > MAX_STORE_BYTES) throw new Error("invalid-store");
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid-store");
  const record = parsed as Record<string, unknown>;
  if (record.schema !== PROFILE_SCHEMA || !record.profiles || typeof record.profiles !== "object" || Array.isArray(record.profiles)) throw new Error("invalid-store");
  if (record.defaultToken !== undefined && !validStoredToken(record.defaultToken)) throw new Error("invalid-store");
  const profiles = Object.create(null) as Record<string, string>;
  for (const [alias, token] of Object.entries(record.profiles as Record<string, unknown>)) {
    if (!SSH_ALIAS.test(alias) || alias !== alias.toLowerCase() || !validStoredToken(token)) throw new Error("invalid-store");
    profiles[alias] = token;
  }
  return {
    schema: PROFILE_SCHEMA,
    profiles,
    ...(typeof record.defaultToken === "string" ? { defaultToken: record.defaultToken } : {}),
  };
}

function readTrustedSshConfig(
  path: string,
  sshDirectory: string,
  state: { files: number; bytes: number; visited: Set<string> },
  depth: number,
): string[] {
  if (depth > MAX_SSH_INCLUDE_DEPTH || state.files >= MAX_SSH_CONFIG_FILES) throw new Error("SSH configuration exceeds bounded include limits.");
  assertInsideSshDirectory(sshDirectory, path);
  validateTrustedSshFile(path);
  const normalized = resolve(path);
  if (state.visited.has(normalized)) return [];
  state.visited.add(normalized);
  const content = readFileSync(path, "utf8");
  state.files += 1;
  state.bytes += Buffer.byteLength(content, "utf8");
  if (state.bytes > MAX_SSH_CONFIG_BYTES) throw new Error("SSH configuration exceeds bounded size limits.");

  const result = [content];
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+#.*$/, "").trim();
    const include = line.match(/^Include(?:\s*=\s*|\s+)(.+)$/i);
    if (!include) {
      if (/^Include(?:\s|=|$)/i.test(line)) throw new Error("SSH Include syntax is unsupported.");
      continue;
    }
    for (const pattern of include[1]!.trim().split(/\s+/)) {
      for (const included of expandTrustedInclude(pattern, dirname(path), sshDirectory)) {
        result.push(...readTrustedSshConfig(included, sshDirectory, state, depth + 1));
      }
    }
  }
  return result;
}

function expandTrustedInclude(pattern: string, relativeTo: string, sshDirectory: string): string[] {
  if (!pattern || pattern.includes("\0") || isAbsolute(pattern)) throw new Error("SSH Include must remain inside the SSH configuration directory.");
  const target = resolve(relativeTo, pattern);
  assertInsideSshDirectory(sshDirectory, target);
  if (!/[*?]/.test(pattern)) return [target];
  if (/[*?]/.test(dirname(target))) throw new Error("SSH Include directory wildcards are unsupported.");
  validateTrustedSshDirectory(dirname(target));
  const expression = globSegmentExpression(basename(target));
  return readdirSync(dirname(target))
    .filter((entry) => expression.test(entry))
    .sort((a, b) => a.localeCompare(b))
    .map((entry) => join(dirname(target), entry));
}

function globSegmentExpression(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`);
}

function assertInsideSshDirectory(sshDirectory: string, path: string): void {
  const relation = relative(resolve(sshDirectory), resolve(path));
  if (!relation || relation.startsWith("..") || isAbsolute(relation)) {
    if (resolve(path) !== resolve(sshDirectory)) throw new Error("SSH Include escaped the SSH configuration directory.");
  }
}

function validateTrustedSshDirectory(path: string): void {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("SSH configuration ancestry is untrusted.");
  validateTrustedSshOwnerAndMode(stat);
}

function validateTrustedSshFile(path: string): void {
  validateTrustedSshPathAncestry(dirname(path));
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("SSH configuration file is untrusted.");
  validateTrustedSshOwnerAndMode(stat);
  if (stat.size > MAX_SSH_CONFIG_BYTES) throw new Error("SSH configuration exceeds bounded size limits.");
}

function validateTrustedSshPathAncestry(path: string): void {
  const parts: string[] = [];
  let current = resolve(path);
  while (basename(current) !== ".ssh") {
    parts.push(current);
    const parent = dirname(current);
    if (parent === current) throw new Error("SSH configuration escaped its trusted ancestry.");
    current = parent;
  }
  validateTrustedSshDirectory(current);
  for (const part of parts.reverse()) validateTrustedSshDirectory(part);
}

function validateTrustedSshOwnerAndMode(stat: Stats): void {
  if (typeof process.getuid === "function" && stat.uid !== process.getuid()) throw new Error("SSH configuration is not owned by the current user.");
  if ((stat.mode & 0o022) !== 0) throw new Error("SSH configuration is writable by another user.");
}

function validStoredToken(value: unknown): value is string {
  return typeof value === "string" && value.trim() === value && value.length > 0 && value.length <= 16 * 1024 && !/[\r\n\0]/.test(value);
}
