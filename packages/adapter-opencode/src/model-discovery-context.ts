import { createHash } from "node:crypto";
import { basename, dirname, join, normalize } from "node:path";
import type { ModelDiscoveryFileSystem } from "./opencode-models-cli";

export type SafeFileState = {
  logicalPath: string;
  realPath: string | null;
  exists: boolean;
  kind: "file" | "directory" | "missing" | "unsafe";
  size: number | null;
  mtimeMs: number | null;
  ctimeMs: number | null;
  mode: number | null;
  dev: number | null;
  ino: number | null;
  safeDigest: string | null;
  digestDisposition: "sanitized" | "not-applicable" | "unavailable";
};

export type OpenCodeDiscoveryContext = {
  schema: 2;
  runner: { realPath: string; stat: SafeFileState; version: string | null };
  scope: { projectRoot: string; workspaceRoot: string };
  configCandidates: readonly SafeFileState[];
  authFile: Omit<SafeFileState, "safeDigest" | "digestDisposition">;
  pluginFiles: readonly SafeFileState[];
  controlEnvironment: Readonly<Record<string, boolean | string | null>>;
  credentialEnvironment: readonly { name: string; present: boolean }[];
};

export type CollectOpenCodeDiscoveryContextInput = {
  projectRoot: string;
  executable: string;
  version: string | null;
  env: Readonly<Record<string, string | undefined>>;
  homeDir: string;
  xdgConfigHome: string;
  xdgDataHome: string;
  fs: ModelDiscoveryFileSystem;
  resolveWorkspaceRoot: (projectRoot: string) => Promise<string>;
  resolvePluginEntry: (reference: string, fromDirectory: string) => Promise<string | null>;
};

const envName = /^[A-Z][A-Z0-9_]{1,127}$/;

/** Closed config projection: allowlisted fields retain values; every other field is presence-only. */

function projectConfig(value: unknown): { value: unknown; environmentNames: readonly string[]; pluginReferences: readonly string[] } {
  const references: ConfigReferences = { environmentNames: new Set<string>(), pluginReferences: [] };
  collectEmbeddedEnvironmentReferences(value, references);
  return {
    value: projectRootConfig(value, references),
    environmentNames: [...references.environmentNames].sort(),
    pluginReferences: references.pluginReferences,
  };
}


type ConfigReferences = { environmentNames: Set<string>; pluginReferences: string[] };


const embeddedEnvironmentReference = /\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g;

function normalizeEnvironmentName(value: string): string | null {
  const normalized = value.toUpperCase();
  return envName.test(normalized) ? normalized : null;
}

function collectEnvironmentReference(value: string, references: ConfigReferences): string | null {
  const name = normalizeEnvironmentName(value);
  if (name) references.environmentNames.add(name);
  return name;
}

/** Extracts only exact `{env:NAME}` tokens, retaining names but never source values. */
function collectEmbeddedEnvironmentReferences(value: unknown, references: ConfigReferences): void {
  if (typeof value === "string") {
    for (const match of value.matchAll(embeddedEnvironmentReference)) collectEnvironmentReference(match[1]!, references);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectEmbeddedEnvironmentReferences(item, references);
    return;
  }
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) collectEmbeddedEnvironmentReferences(child, references);
  }
}

const providerContainerFields = new Set(["provider", "providers"]);
const pluginReferenceFields = new Set(["plugin", "plugins"]);
const environmentReferenceFields = new Set(["env", "environment", "environmentvariable", "environmentvariables"]);
const aliasFields = new Set(["alias", "aliases", "modelalias", "modelaliases"]);
const variantFields = new Set(["variant", "variants"]);
const approvedControlFields = new Set([
  "$schema", "id", "providerid", "modelid", "model", "endpoint", "baseurl", "base_url", "url", "path", "filepath",
  "configpath", "configfile", "directory", "workspace", "root", "command", "enabled",
  "timeout", "retries", "maxretries", "maxtokens", "contextwindow", "reasoningeffort",
]);
const approvedOptionFields = new Set([
  "id", "providerid", "modelid", "model", "endpoint", "baseurl", "base_url", "url", "path", "filepath", "configpath",
  "configfile", "directory", "workspace", "root", "command", "enabled", "timeout", "retries",
  "maxretries", "maxtokens", "contextwindow", "reasoningeffort",
]);

function sortedEntries(value: unknown): [string, unknown][] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right));
}

function marker(value: unknown): { type: string; present: boolean } {
  if (value === null || value === undefined) return { type: "null", present: false };
  return { type: Array.isArray(value) ? "array" : typeof value, present: true };
}

function projectSemanticValue(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map(projectSemanticValue);
  return marker(value);
}

function projectEndpoint(value: unknown): unknown {
  if (typeof value !== "string") return projectSemanticValue(value);
  try {
    const endpoint = new URL(value);
    return endpoint.username || endpoint.password || endpoint.search || endpoint.hash
      ? `${endpoint.protocol}//${endpoint.host}${endpoint.pathname}`
      : value;
  } catch {
    return value;
  }
}

function projectEnvironmentReferences(value: unknown, references: ConfigReferences): unknown {
  if (typeof value === "string") {
    const name = collectEnvironmentReference(value, references);
    return name ?? marker(value);
  }
  if (Array.isArray(value)) return value.map((item) => projectEnvironmentReferences(item, references));
  return marker(value);
}

function projectPluginReferences(value: unknown, references: ConfigReferences): unknown {
  if (typeof value === "string") {
    references.pluginReferences.push(value);
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => projectPluginReferences(item, references));
  return marker(value);
}

function projectNamedSemanticValues(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(projectSemanticValue);
  if (!value || typeof value !== "object") return projectSemanticValue(value);
  return Object.fromEntries(sortedEntries(value).map(([key, child]) => [key, projectSemanticValue(child)]));
}

function projectProviderOptions(value: unknown, references: ConfigReferences): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return marker(value);
  return Object.fromEntries(sortedEntries(value).map(([key, child]) => {
    const field = key.toLowerCase();
    if (field === "headers") return [key, marker(child)];
    if (environmentReferenceFields.has(field)) return [key, projectEnvironmentReferences(child, references)];
    if (pluginReferenceFields.has(field)) return [key, projectPluginReferences(child, references)];
    if (!approvedOptionFields.has(field)) return [key, marker(child)];
    return [key, field === "endpoint" || field === "baseurl" || field === "base_url" || field === "url" ? projectEndpoint(child) : projectSemanticValue(child)];
  }));
}

function projectProviderConfig(value: unknown, references: ConfigReferences): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return marker(value);
  return Object.fromEntries(sortedEntries(value).map(([key, child]) => {
    const field = key.toLowerCase();
    if (environmentReferenceFields.has(field)) return [key, projectEnvironmentReferences(child, references)];
    if (pluginReferenceFields.has(field)) return [key, projectPluginReferences(child, references)];
    if (field === "models") return [key, projectModels(child, references)];
    if (field === "options") return [key, projectProviderOptions(child, references)];
    if (field === "headers") return [key, marker(child)];
    if (aliasFields.has(field) || variantFields.has(field)) return [key, projectNamedSemanticValues(child)];
    if (!approvedControlFields.has(field)) return [key, marker(child)];
    return [key, field === "endpoint" || field === "baseurl" || field === "base_url" || field === "url" ? projectEndpoint(child) : projectSemanticValue(child)];
  }));
}

function projectModels(value: unknown, references: ConfigReferences): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return marker(value);
  return Object.fromEntries(sortedEntries(value).map(([modelId, config]) => [modelId, projectProviderConfig(config, references)]));
}

function projectProviders(value: unknown, references: ConfigReferences): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return marker(value);
  return Object.fromEntries(sortedEntries(value).map(([providerId, config]) => [providerId, projectProviderConfig(config, references)]));
}

function projectRootConfig(value: unknown, references: ConfigReferences): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return marker(value);
  return Object.fromEntries(sortedEntries(value).map(([key, child]) => {
    const field = key.toLowerCase();
    if (providerContainerFields.has(field)) return [key, projectProviders(child, references)];
    if (pluginReferenceFields.has(field)) return [key, projectPluginReferences(child, references)];
    if (environmentReferenceFields.has(field)) return [key, projectEnvironmentReferences(child, references)];
    if (field === "models") return [key, projectModels(child, references)];
    if (field === "options") return [key, projectProviderOptions(child, references)];
    if (field === "headers") return [key, marker(child)];
    if (aliasFields.has(field) || variantFields.has(field)) return [key, projectNamedSemanticValues(child)];
    if (!approvedControlFields.has(field)) return [key, marker(child)];
    return [key, field === "endpoint" || field === "baseurl" || field === "base_url" || field === "url" ? projectEndpoint(child) : projectSemanticValue(child)];
  }));
}





function parseJsonc(raw: string): unknown {
  let withoutComments = "";
  let quote: "\"" | "'" | null = null;
  for (let index = 0; index < raw.length; index++) {
    const character = raw[index]!;
    if (quote) {
      withoutComments += character;
      if (character === "\\") withoutComments += raw[++index] ?? "";
      else if (character === quote) quote = null;
      continue;
    }
    if (character === "\"" || character === "'") { quote = character; withoutComments += character; continue; }
    if (character === "/" && raw[index + 1] === "/") {
      while (index < raw.length && raw[index] !== "\n") index++;
      withoutComments += "\n";
      continue;
    }
    if (character === "/" && raw[index + 1] === "*") {
      index += 2;
      while (index < raw.length && !(raw[index] === "*" && raw[index + 1] === "/")) index++;
      index++;
      continue;
    }
    withoutComments += character;
  }
  return JSON.parse(withoutComments.replace(/,(\s*[}\]])/g, "$1"));
}


async function safeFileState(fs: ModelDiscoveryFileSystem, logicalPath: string, digest?: "config" | "plugin"): Promise<SafeFileState> {
  try {
    const stat = await fs.stat(logicalPath);
    const realPath = await fs.realpath(logicalPath).catch(() => null);
    const kind = stat.isDirectory?.() ? "directory" : stat.isFile?.() === false ? "unsafe" : "file";
    let safeDigest: string | null = null;
    let digestDisposition: SafeFileState["digestDisposition"] = "not-applicable";
    if (kind === "file" && digest === "config") {
      try {
        const sanitized = JSON.stringify(projectConfig(parseJsonc(await fs.readFile(logicalPath))).value);
        safeDigest = createHash("sha256").update(sanitized.slice(0, 128_000)).digest("hex");
        digestDisposition = "sanitized";
      } catch {
        digestDisposition = "unavailable";
      }
    } else if (kind === "file" && digest === "plugin") {
      try { safeDigest = createHash("sha256").update((await fs.readFile(logicalPath)).replace(/(?:'[^']*'|"[^"]*"|`[^`]*`|\b\d+(?:\.\d+)?\b)/g, "<literal>").slice(0, 128_000)).digest("hex"); digestDisposition = "sanitized"; }
      catch { digestDisposition = "unavailable"; }
    }
    return { logicalPath, realPath, exists: true, kind, size: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs ?? null, mode: stat.mode, dev: stat.dev ?? null, ino: stat.ino ?? null, safeDigest, digestDisposition };
  } catch { return { logicalPath, realPath: null, exists: false, kind: "missing", size: null, mtimeMs: null, ctimeMs: null, mode: null, dev: null, ino: null, safeDigest: null, digestDisposition: "not-applicable" }; }
}

async function canonicalPath(fs: ModelDiscoveryFileSystem, path: string): Promise<string> { return fs.realpath(path).catch(() => normalize(path)); }

/** Collects a finite, secret-safe DTO; raw auth/config/plugin secrets never leave this boundary. */
export async function collectOpenCodeDiscoveryContext(input: CollectOpenCodeDiscoveryContextInput): Promise<OpenCodeDiscoveryContext> {
  const projectRoot = await canonicalPath(input.fs, input.projectRoot);
  const workspaceRoot = await canonicalPath(input.fs, await input.resolveWorkspaceRoot(projectRoot));
  const configHome = input.env.XDG_CONFIG_HOME || input.xdgConfigHome || join(input.homeDir, ".config");
  const configRoots = [join(configHome, "opencode"), input.env.OPENCODE_CONFIG_DIR, join(projectRoot, ".opencode")].filter((path): path is string => Boolean(path));
  const candidates = [join(configHome, "opencode", "opencode.json"), join(configHome, "opencode", "opencode.jsonc")];
  if (input.env.OPENCODE_CONFIG) candidates.push(input.env.OPENCODE_CONFIG);
  if (!input.env.OPENCODE_DISABLE_PROJECT_CONFIG) for (let cursor = projectRoot;; cursor = dirname(cursor)) {
    candidates.push(join(cursor, "opencode.json"), join(cursor, "opencode.jsonc"));
    if (cursor === workspaceRoot || dirname(cursor) === cursor) break;
  }
  for (const root of configRoots) candidates.push(join(root, "opencode.json"), join(root, "opencode.jsonc"));
  const uniqueCandidates = [...new Set(candidates.map(normalize))];
  const configCandidates = await Promise.all(uniqueCandidates.map((path) => safeFileState(input.fs, path, "config")));
  const parsedConfigs = await Promise.all(uniqueCandidates.map(async (path) => { try { return projectConfig(parseJsonc(await input.fs.readFile(path))); } catch { return undefined; } }));
  const virtualConfig = input.env.OPENCODE_CONFIG_CONTENT === undefined ? undefined : projectInlineConfig(input.env.OPENCODE_CONFIG_CONTENT);
  if (virtualConfig) configCandidates.push({ logicalPath: "virtual:OPENCODE_CONFIG_CONTENT", realPath: null, exists: true, kind: "file", size: input.env.OPENCODE_CONFIG_CONTENT!.length, mtimeMs: null, ctimeMs: null, mode: null, dev: null, ino: null, safeDigest: createHash("sha256").update(JSON.stringify(virtualConfig.value)).digest("hex"), digestDisposition: "sanitized" });
  const projectedConfigs = parsedConfigs.map((config, index) => config && { config, directory: dirname(uniqueCandidates[index]!) });
  if (virtualConfig) projectedConfigs.push({ config: virtualConfig, directory: projectRoot });
  const envNames = new Set<string>();
  const pluginPaths = new Set<string>();
  for (const projected of projectedConfigs) {
    if (!projected) continue;
    for (const name of projected.config.environmentNames) envNames.add(name);
    for (const reference of projected.config.pluginReferences) {
      const resolved = await input.resolvePluginEntry(reference, projected.directory);
      if (resolved) pluginPaths.add(await canonicalPath(input.fs, resolved));
    }
  }
  if (!input.env.OPENCODE_DISABLE_DEFAULT_PLUGINS) for (const root of configRoots) for (const directory of [join(root, "plugin"), join(root, "plugins")]) {
    for (const entry of await input.fs.readdir?.(directory).catch(() => []) ?? []) if (/\.(?:[cm]?js|ts)$/.test(entry)) pluginPaths.add(join(directory, entry));
  }
  const authState = await safeFileState(input.fs, join(input.env.XDG_DATA_HOME || input.xdgDataHome || join(input.homeDir, ".local", "share"), "opencode", "auth.json"));
  const { safeDigest: _digest, digestDisposition: _disposition, ...authFile } = authState;
  return {
    schema: 2,
    runner: { realPath: await canonicalPath(input.fs, input.executable), stat: await safeFileState(input.fs, input.executable), version: input.version },
    scope: { projectRoot, workspaceRoot }, configCandidates,
    authFile, pluginFiles: await Promise.all([...pluginPaths].sort().map((path) => safeFileState(input.fs, path, "plugin"))),
    controlEnvironment: { OPENCODE_CONFIG: input.env.OPENCODE_CONFIG ? normalize(input.env.OPENCODE_CONFIG) : null, OPENCODE_CONFIG_DIR: input.env.OPENCODE_CONFIG_DIR ? normalize(input.env.OPENCODE_CONFIG_DIR) : null, OPENCODE_DISABLE_PROJECT_CONFIG: Boolean(input.env.OPENCODE_DISABLE_PROJECT_CONFIG), OPENCODE_PURE: Boolean(input.env.OPENCODE_PURE), OPENCODE_DISABLE_DEFAULT_PLUGINS: Boolean(input.env.OPENCODE_DISABLE_DEFAULT_PLUGINS) },
    credentialEnvironment: [...envNames].sort().map((name) => ({ name, present: Boolean(input.env[name]) })),
  };
}

function projectInlineConfig(raw: string): { value: unknown; environmentNames: readonly string[]; pluginReferences: readonly string[] } {
  try { return projectConfig(parseJsonc(raw)); }
  catch { return { value: { present: true, parseable: false }, environmentNames: [], pluginReferences: [] }; }
}
