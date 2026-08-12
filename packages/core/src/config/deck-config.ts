import { createHash } from "node:crypto";
import { chmodSync, closeSync, existsSync, fsyncSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, parse, relative, resolve } from "node:path";

import type { AdapterRegistry } from "../adapter-registry";

export const DECK_CONFIG_VERSION = 1;
export const DECK_CONFIG_RELATIVE_PATH = join(".deck", "config.json");

export type AdaptiveMemoryActiveProvider = "none" | (string & {});

export const SUPERMEMORY_SEARCH_MODES = ["memories", "documents", "hybrid"] as const;
export type SupermemorySearchMode = (typeof SUPERMEMORY_SEARCH_MODES)[number];

export type DeckSupermemoryConfig = {
  /** Non-secret MCP server label used by Pi/MCP config. Defaults to "supermemory". */
  mcpServerName?: string;
  /** @deprecated - user identity derived from token automatically */
  userId?: never;
  /** @deprecated - project scoping via x-sm-project header */
  projectId?: never;
  /** @deprecated - project scoping via x-sm-project header */
  teamId?: never;
  /** @deprecated - no longer used */
  orgId?: never;
  searchMode?: SupermemorySearchMode;
  maxMemoriesPerSession?: number;
};

export type DeckAdaptiveMemoryConfig = {
  activeProvider?: AdaptiveMemoryActiveProvider;
  supermemory?: DeckSupermemoryConfig;
};

/** Provider-opaque project selection for the optional Web Search capability. */
export type DeckWebSearchConfig = {
  enabled?: boolean;
  provider?: string;
};

// ---------------------------------------------------------------------------
// Orchestrator Personality Config
// ---------------------------------------------------------------------------

export const ORCHESTRATOR_PERSONALITIES = ["guia", "pragmatica"] as const;
export type OrchestratorPersonality = (typeof ORCHESTRATOR_PERSONALITIES)[number];
export const DEFAULT_ORCHESTRATOR_PERSONALITY: OrchestratorPersonality = "pragmatica";

// ---------------------------------------------------------------------------
// Package Instruction Config
// ---------------------------------------------------------------------------

/** Dynamic runner ID for package instructions — validated at runtime against AdapterRegistry. */
export type PackageInstructionRunnerId = string & {};

export const PACKAGE_INSTRUCTION_PACKAGE_IDS = ["codebase-memory", "code-economy", "context-mode", "rtk", "adaptive-memory", "serena"] as const;
export type PackageInstructionPackageId = (typeof PACKAGE_INSTRUCTION_PACKAGE_IDS)[number];

export type PackageInstructionConfigurationMetadata = {
  id: PackageInstructionPackageId;
  label: string;
  description: string;
  configurable: boolean;
  defaultEnabled: boolean;
};

/** Canonical package-instruction configuration order and toggle policy. */
export const PACKAGE_INSTRUCTION_CONFIGURATION_METADATA = Object.freeze([
  { id: "codebase-memory", label: "Codebase Memory", description: "Inject Codebase Memory usage guidance.", configurable: true, defaultEnabled: false },
  { id: "code-economy", label: "Code Economy", description: "Always-on concise implementation guidance.", configurable: false, defaultEnabled: true },
  { id: "context-mode", label: "Context Mode", description: "Inject Context Mode usage guidance.", configurable: true, defaultEnabled: false },
  { id: "rtk", label: "RTK", description: "Inject RTK command guidance.", configurable: true, defaultEnabled: false },
  { id: "adaptive-memory", label: "Adaptive Memory", description: "Inject adaptive-memory provider guidance.", configurable: true, defaultEnabled: false },
  { id: "serena", label: "Serena", description: "Inject Serena symbolic-editing guidance.", configurable: true, defaultEnabled: false },
] as const satisfies readonly PackageInstructionConfigurationMetadata[]);

export function getConfigurablePackageInstructionMetadata(
  supportedIds: readonly string[] = [],
): readonly PackageInstructionConfigurationMetadata[] {
  const supported = new Set(supportedIds);
  return PACKAGE_INSTRUCTION_CONFIGURATION_METADATA.filter((entry) => entry.configurable && supported.has(entry.id));
}

export function normalizeSupportedPackageInstructionSelection(
  selection: Readonly<Record<string, boolean>> | undefined,
  supportedIds: readonly string[],
): Record<PackageInstructionPackageId, boolean> {
  const supported = new Set(supportedIds);
  return Object.fromEntries(PACKAGE_INSTRUCTION_CONFIGURATION_METADATA.map((entry) => [
    entry.id,
    entry.configurable ? supported.has(entry.id) && selection?.[entry.id] === true : entry.defaultEnabled,
  ])) as Record<PackageInstructionPackageId, boolean>;
}

/**
 * Validate runner keys against registered adapters.
 *
 * @param keys - Runner keys found in packageInstructions config
 * @param registry - Adapter registry to validate against
 * @throws DeckConfigError if any key is not registered
 */
export function validateRunnerKeys(keys: string[], registry: AdapterRegistry): void {
  for (const key of keys) {
    if (!registry.has(key)) {
      const registered = registry.list().map((a) => a.runnerId);
      throw new DeckConfigError(
        "DECK_CONFIG_UNKNOWN_FIELD",
        `Unknown runner key in packageInstructions. Registered runners: [${registered.join(", ")}].`,
        { fieldPath: `packageInstructions.${key}` },
      );
    }
  }
}

// ---------------------------------------------------------------------------
// SDD Phase / Profile types
// ---------------------------------------------------------------------------

export const SDD_PHASES = [
  "explore",
  "proposal",
  "spec",
  "design",
  "tasks",
  "apply",
  "verify",
  "review",
  "archive",
  "onboard",
] as const;
export type SDDPhase = (typeof SDD_PHASES)[number];

export type ProfileStrategy = "generated-multi" | "external-single-active";

export type PhaseOverrides = Partial<Record<SDDPhase, Record<string, unknown>>>;

export interface Profile {
  name: string;
  description?: string;
  phaseOverrides?: PhaseOverrides;
  strategy?: ProfileStrategy;
}

export interface DeveloperTeamExecutionConfigV1 {
  readonly schema: "developer-team-execution-config-v1";
  readonly executionContracts: "off" | "observe" | "enforce";
  readonly decisionKernel: "legacy" | "shadow" | "active";
  readonly invocationAuthorization: {
    readonly default: "static-compatible" | "invocation-required";
    readonly opencode?: "static-compatible" | "invocation-required";
    readonly pi?: "static-compatible" | "invocation-required";
  };
  readonly registryWriter: "distributed-compatible" | "centralized";
  readonly routePolicy: "legacy-triage" | "shadow-risk-lanes" | "risk-lanes";
  readonly promptProfile: "legacy" | "compact";
  readonly telemetry: "off" | "local-safe";
  readonly cohortPercent: number;
}

// ---------------------------------------------------------------------------
// DeckConfig / NormalizedDeckConfig
// ---------------------------------------------------------------------------

export type DeckPackageInstructionRunnerConfig = Partial<
  Record<PackageInstructionPackageId, boolean>
>;

export type DeckPackageInstructionConfig = Partial<Record<PackageInstructionRunnerId, DeckPackageInstructionRunnerConfig>>;

export type DeckConfig = {
  version?: typeof DECK_CONFIG_VERSION;
  adaptiveMemory?: DeckAdaptiveMemoryConfig;
  webSearch?: DeckWebSearchConfig;
  packageInstructions?: DeckPackageInstructionConfig;
  orchestratorPersonality?: OrchestratorPersonality;
  developerTeamExecution?: Partial<Omit<DeveloperTeamExecutionConfigV1, "schema" | "invocationAuthorization">> & {
    schema?: "developer-team-execution-config-v1";
    invocationAuthorization?: Partial<DeveloperTeamExecutionConfigV1["invocationAuthorization"]>;
  };
  profiles?: Profile[];
  activeProfile?: string;
};

export type NormalizedDeckConfig = {
  version: typeof DECK_CONFIG_VERSION;
  adaptiveMemory: {
    activeProvider: AdaptiveMemoryActiveProvider;
    supermemory?: DeckSupermemoryConfig;
  };
  webSearch: {
    enabled: boolean;
    provider?: string;
  };
  packageInstructions: Record<PackageInstructionRunnerId, Record<PackageInstructionPackageId, boolean>>;
  orchestratorPersonality: OrchestratorPersonality;
  developerTeamExecution: DeveloperTeamExecutionConfigV1;
  profiles: Profile[];
  activeProfile: string;
};

export type DeckConfigDiagnostic = Readonly<{
  code: "SUPERMEMORY_CONFIG_DEPRECATED";
  severity: "warning";
  message: string;
  fieldPath: string;
}>;

export type DeckConfigErrorCode =
  | "DECK_CONFIG_INVALID_JSON"
  | "DECK_CONFIG_INVALID_SHAPE"
  | "DECK_CONFIG_UNSUPPORTED_VERSION"
  | "DECK_CONFIG_UNKNOWN_FIELD"
  | "ADAPTIVE_MEMORY_UNSUPPORTED_PROVIDER"
  | "DECK_CONFIG_SECRET_FIELD"
  | "SUPERMEMORY_USER_ID_REQUIRED"
  | "SUPERMEMORY_CONFIG_INVALID"
  | "WEB_SEARCH_CONFIG_INVALID"
  | "DECK_CONFIG_UNSAFE_PATH"
  | "DECK_CONFIG_CONCURRENT_MODIFICATION";

export class DeckConfigError extends Error {
  readonly code: DeckConfigErrorCode;
  readonly configPath?: string;
  readonly fieldPath?: string;

  constructor(
    code: DeckConfigErrorCode,
    message: string,
    options?: { configPath?: string; fieldPath?: string },
  ) {
    super(message);
    this.name = "DeckConfigError";
    this.code = code;
    this.configPath = options?.configPath;
    this.fieldPath = options?.fieldPath;
  }
}

export type ActiveMemoryProviderSource = "cli" | "config" | "default";

export type ActiveMemoryProviderResolution = {
  activeProvider: AdaptiveMemoryActiveProvider;
  source: ActiveMemoryProviderSource;
  config: NormalizedDeckConfig;
  supermemory?: DeckSupermemoryConfig;
};

const SECRET_FIELD_PATTERN =
  /(?:token|secret|credential|credentials|api[-_]?key|password|private[-_]?key|access[-_]?key|auth(?:orization)?)/i;

const TOP_LEVEL_FIELDS = new Set(["version", "adaptiveMemory", "webSearch", "packageInstructions", "orchestratorPersonality", "developerTeamExecution", "profiles", "activeProfile"]);
const ADAPTIVE_MEMORY_FIELDS = new Set(["activeProvider", "supermemory"]);
const WEB_SEARCH_FIELDS = new Set(["enabled", "provider"]);
const SUPERMEMORY_FIELDS = new Set([
  "mcpServerName",
  "searchMode",
  "maxMemoriesPerSession",
]);
const PACKAGE_INSTRUCTION_PACKAGE_FIELDS = new Set(PACKAGE_INSTRUCTION_PACKAGE_IDS);
const DEVELOPER_TEAM_EXECUTION_FIELDS = new Set([
  "schema", "executionContracts", "decisionKernel", "invocationAuthorization", "registryWriter",
  "routePolicy", "promptProfile", "telemetry", "cohortPercent",
]);
const INVOCATION_AUTHORIZATION_FIELDS = new Set(["default", "opencode", "pi"]);
const SAFE_CONTROL_FIELD_KEYS = new Set(["invocationAuthorization"]);

export function getDeckConfigPath(projectRoot: string): string {
  return join(projectRoot, DECK_CONFIG_RELATIVE_PATH);
}

export function getDefaultDeckConfig(): NormalizedDeckConfig {
  return {
    version: DECK_CONFIG_VERSION,
    adaptiveMemory: {
      activeProvider: "none",
    },
    webSearch: {
      enabled: false,
    },
    packageInstructions: {
      pi: { "codebase-memory": false, "code-economy": true, "context-mode": false, rtk: false, "adaptive-memory": false, serena: false },
      opencode: { "codebase-memory": false, "code-economy": true, "context-mode": false, rtk: false, "adaptive-memory": false, serena: false },
      codex: { "codebase-memory": false, "code-economy": true, "context-mode": false, rtk: false, "adaptive-memory": false, serena: false },
    },
    orchestratorPersonality: DEFAULT_ORCHESTRATOR_PERSONALITY,
    developerTeamExecution: {
      schema: "developer-team-execution-config-v1",
      executionContracts: "observe",
      decisionKernel: "shadow",
      invocationAuthorization: { default: "static-compatible" },
      registryWriter: "distributed-compatible",
      routePolicy: "legacy-triage",
      promptProfile: "compact",
      telemetry: "off",
      cohortPercent: 0,
    },
    profiles: [],
    activeProfile: "default",
  };
}

export type DeckConfigFilePatch = (existing: NormalizedDeckConfig) => unknown;

export type DeckConfigFilePreimage = Readonly<{
  path: string;
  exists: boolean;
  digest: string | null;
}>;

type DeckConfigFilePreimageBytes = Readonly<{
  exists: boolean;
  bytes: Buffer | null;
  mode: number | null;
  digest: string | null;
}>;

export type DeckConfigWriteReceipt = Readonly<{
  path: string;
  preimageDigest: string | null;
  postimageDigest: string;
  rollback: () => void;
}>;

export type DeckConfigFileReadOptions = Readonly<{
  containmentRoot?: string;
}>;

export type DeckConfigFileWriteOptions = Readonly<{
  containmentRoot?: string;
  expectedDigest?: string | null;
  afterRenameForTest?: () => void;
}>;

export type DeckConfigFilePatchOptions = DeckConfigFileWriteOptions & Readonly<{
  maxRetries?: number;
}>;

type DeckConfigFileLockState = Readonly<{
  path: string;
  pid: number;
  nonce: string;
  dev: number;
  ino: number;
}>;

const DECK_CONFIG_LOCK_STALE_MS = 30_000;

export function readDeckConfigFilePreimage(configPath: string, options: DeckConfigFileReadOptions = {}): DeckConfigFilePreimage {
  validateSafeConfigPathForRead(configPath, options.containmentRoot);
  if (!existsSync(configPath)) return { path: configPath, exists: false, digest: null };
  const stat = lstatSync(configPath);
  if (!stat.isFile() || stat.isSymbolicLink()) return { path: configPath, exists: true, digest: null };
  return {
    path: configPath,
    exists: true,
    digest: createHash("sha256").update(readFileSync(configPath)).digest("hex"),
  };
}

export function readDeckConfigFile(configPath: string, options: DeckConfigFileReadOptions = {}): NormalizedDeckConfig {
  validateSafeConfigPathForRead(configPath, options.containmentRoot);
  if (!existsSync(configPath)) {
    return getDefaultDeckConfig();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(configPath, "utf-8"));
  } catch (error) {
    throw new DeckConfigError(
      "DECK_CONFIG_INVALID_JSON",
      `Deck config is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      { configPath },
    );
  }

  return validateDeckConfig(parsed, { configPath });
}

function readPreimageBytes(configPath: string, containmentRoot?: string): DeckConfigFilePreimageBytes {
  validateSafeConfigPathForRead(configPath, containmentRoot);
  if (!existsSync(configPath)) return { exists: false, bytes: null, mode: null, digest: null };
  const stat = lstatSync(configPath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new DeckConfigError("DECK_CONFIG_UNSAFE_PATH", "Deck config target must be a real regular file.", { configPath });
  }
  const bytes = readFileSync(configPath);
  return { exists: true, bytes, mode: stat.mode & 0o777, digest: createHash("sha256").update(bytes).digest("hex") };
}

function assertOwnedByCurrentUser(path: string, owner: number | undefined, configPath: string): void {
  if (owner === undefined) return;
  const stat = lstatSync(path);
  if (stat.uid !== owner) {
    throw new DeckConfigError("DECK_CONFIG_UNSAFE_PATH", "Deck config path ancestry must be owned by the current user.", { configPath });
  }
}

function assertContained(child: string, root: string, configPath: string): void {
  const rel = relative(root, child);
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) return;
  throw new DeckConfigError("DECK_CONFIG_UNSAFE_PATH", "Deck config path must remain inside the configured XDG root.", { configPath });
}

function assertExistingAncestorChainSafe(path: string, configPath: string): void {
  const absolute = resolve(path);
  const parsed = parse(absolute);
  let cursor = parsed.root;
  const parts = relative(parsed.root, absolute).split(/[\\/]+/).filter(Boolean);
  for (const part of parts) {
    cursor = join(cursor, part);
    if (!existsSync(cursor)) return;
    const stat = lstatSync(cursor);
    if (stat.isSymbolicLink()) {
      throw new DeckConfigError("DECK_CONFIG_UNSAFE_PATH", "Deck config ancestry must not contain symbolic links.", { configPath });
    }
  }
}

function validateSafeConfigPathForRead(configPath: string, containmentRoot?: string): void {
  if (containmentRoot) {
    assertExistingAncestorChainSafe(containmentRoot, configPath);
    const uid = typeof process.getuid === "function" ? process.getuid() : undefined;
    if (existsSync(containmentRoot)) {
      const rootStat = lstatSync(containmentRoot);
      if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
        throw new DeckConfigError("DECK_CONFIG_UNSAFE_PATH", "Deck config XDG root must be a real directory.", { configPath });
      }
      assertOwnedByCurrentUser(containmentRoot, uid, configPath);
    }
    const rootReal = existsSync(containmentRoot) ? realpathSync(containmentRoot) : resolve(containmentRoot);
    assertContained(resolve(configPath), resolve(containmentRoot), configPath);
    const parent = dirname(resolve(configPath));
    if (existsSync(parent)) assertContained(realpathSync(parent), rootReal, configPath);
    const relParts = relative(resolve(containmentRoot), parent).split(/[\\/]+/).filter(Boolean);
    let cursor = resolve(containmentRoot);
    for (const part of relParts) {
      cursor = join(cursor, part);
      if (!existsSync(cursor)) break;
      const stat = lstatSync(cursor);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new DeckConfigError("DECK_CONFIG_UNSAFE_PATH", "Deck config parent ancestry must contain only real directories.", { configPath });
      assertOwnedByCurrentUser(cursor, uid, configPath);
    }
  }
  assertExistingAncestorChainSafe(dirname(configPath), configPath);
  if (!existsSync(configPath)) return;
  const stat = lstatSync(configPath);
  if (stat.isSymbolicLink()) {
    throw new DeckConfigError("DECK_CONFIG_UNSAFE_PATH", "Deck config target must not be a symbolic link.", { configPath });
  }
  if (!stat.isFile()) {
    throw new DeckConfigError("DECK_CONFIG_UNSAFE_PATH", "Deck config target must be a regular file.", { configPath });
  }
  const uid = typeof process.getuid === "function" ? process.getuid() : undefined;
  assertOwnedByCurrentUser(configPath, uid, configPath);
}

function ensureSafeParentAncestry(configPath: string, containmentRoot?: string): void {
  if (!containmentRoot) {
    mkdirSync(dirname(configPath), { recursive: true, mode: 0o700 });
    return;
  }
  const uid = typeof process.getuid === "function" ? process.getuid() : undefined;
  const root = resolve(containmentRoot);
  assertExistingAncestorChainSafe(dirname(root), configPath);
  if (!existsSync(root)) mkdirSync(root, { recursive: true, mode: 0o700 });
  const rootStat = lstatSync(root);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new DeckConfigError("DECK_CONFIG_UNSAFE_PATH", "Deck config XDG root must be a real directory.", { configPath });
  }
  assertOwnedByCurrentUser(root, uid, configPath);
  const rootReal = realpathSync(root);
  const parentParts = relative(root, dirname(resolve(configPath))).split(/[\\/]+/).filter(Boolean);
  if (parentParts[0] === "..") {
    throw new DeckConfigError("DECK_CONFIG_UNSAFE_PATH", "Deck config path must be inside the configured XDG root.", { configPath });
  }
  let cursor = root;
  for (const part of parentParts) {
    cursor = join(cursor, part);
    if (!existsSync(cursor)) mkdirSync(cursor, { mode: 0o700 });
    const stat = lstatSync(cursor);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new DeckConfigError("DECK_CONFIG_UNSAFE_PATH", "Deck config parent ancestry must contain only real directories.", { configPath });
    }
    assertOwnedByCurrentUser(cursor, uid, configPath);
  }
  assertContained(realpathSync(dirname(configPath)), rootReal, configPath);
}

function assertExpectedDigest(configPath: string, expectedDigest: string | null | undefined): void {
  if (expectedDigest === undefined) return;
  const actual = readDeckConfigFilePreimage(configPath).digest;
  if (actual !== expectedDigest) {
    throw new DeckConfigError("DECK_CONFIG_CONCURRENT_MODIFICATION", "Deck config changed before write; retry with a fresh preimage.", { configPath });
  }
}

function createDeckConfigLockContent(nonce: string): string {
  return `${JSON.stringify({ version: 1, pid: process.pid, nonce, createdAtMs: Date.now() })}\n`;
}

function parseDeckConfigLockContent(content: string): { version: number; pid: number; nonce: string; createdAtMs: number } | null {
  try {
    const parsed = JSON.parse(content) as { version?: unknown; pid?: unknown; nonce?: unknown; createdAtMs?: unknown };
    if (parsed.version !== 1 || typeof parsed.pid !== "number" || typeof parsed.nonce !== "string" || typeof parsed.createdAtMs !== "number") return null;
    return { version: parsed.version, pid: parsed.pid, nonce: parsed.nonce, createdAtMs: parsed.createdAtMs };
  } catch {
    return null;
  }
}

function processIsRunning(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? String((error as { code?: unknown }).code) : "";
    return code === "EPERM";
  }
}

function tryAcquireDeckConfigFileLock(lockPath: string): DeckConfigFileLockState | undefined {
  const nonce = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let fd: number | undefined;
  try {
    fd = openSync(lockPath, "wx", 0o600);
    writeFileSync(fd, createDeckConfigLockContent(nonce), "utf-8");
    fsyncSync(fd);
    const stat = fstatSync(fd);
    return { path: lockPath, pid: process.pid, nonce, dev: stat.dev, ino: stat.ino };
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? String((error as { code?: unknown }).code) : "";
    if (code === "EEXIST") return undefined;
    throw error;
  } finally {
    if (fd !== undefined) {
      try { closeSync(fd); } catch { /* best effort */ }
    }
  }
}

function releaseDeckConfigFileLock(lock: DeckConfigFileLockState): void {
  try {
    const stat = lstatSync(lock.path);
    if (stat.dev !== lock.dev || stat.ino !== lock.ino || !stat.isFile()) return;
    const parsed = parseDeckConfigLockContent(readFileSync(lock.path, "utf8"));
    if (!parsed || parsed.pid !== lock.pid || parsed.nonce !== lock.nonce) return;
    unlinkSync(lock.path);
  } catch {
    // Best effort: never delete a lock unless its inode and nonce match ours.
  }
}

function recoverStaleDeckConfigFileLock(lockPath: string): void {
  let stat;
  let content: string;
  try {
    stat = lstatSync(lockPath);
    if (!stat.isFile() || stat.isSymbolicLink()) return;
    content = readFileSync(lockPath, "utf8");
  } catch {
    return;
  }
  const parsed = parseDeckConfigLockContent(content);
  const ageMs = Date.now() - (parsed ? parsed.createdAtMs : stat.mtimeMs);
  if (ageMs < DECK_CONFIG_LOCK_STALE_MS) return;
  if (parsed && processIsRunning(parsed.pid)) return;
  try {
    const latestStat = lstatSync(lockPath);
    if (latestStat.dev !== stat.dev || latestStat.ino !== stat.ino || !latestStat.isFile()) return;
    if (readFileSync(lockPath, "utf8") !== content) return;
    unlinkSync(lockPath);
  } catch {
    // Another process may have acquired or removed the stale lock.
  }
}

function withDeckConfigFileLock<T>(configPath: string, containmentRoot: string | undefined, fn: () => T): T {
  ensureSafeParentAncestry(configPath, containmentRoot);
  const lockPath = join(dirname(configPath), ".config.json.lock");
  let lock: DeckConfigFileLockState | undefined;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    lock = tryAcquireDeckConfigFileLock(lockPath);
    if (lock) break;
    if (attempt % 10 === 9) recoverStaleDeckConfigFileLock(lockPath);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
  }
  if (!lock) {
    throw new DeckConfigError("DECK_CONFIG_CONCURRENT_MODIFICATION", "Deck config is locked by another process; retry later.", { configPath });
  }
  try {
    return fn();
  } finally {
    releaseDeckConfigFileLock(lock);
  }
}

function assertConfigPathIsSafeForWrite(configPath: string): void {
  if (!existsSync(configPath)) return;
  let stat: ReturnType<typeof lstatSync>;
  try {
    stat = lstatSync(configPath);
  } catch {
    return;
  }
  if (stat.isSymbolicLink()) {
    throw new DeckConfigError(
      "DECK_CONFIG_INVALID_SHAPE",
      "Deck config path must not be a symbolic link.",
      { configPath },
    );
  }
  if (!stat.isFile()) {
    throw new DeckConfigError(
      "DECK_CONFIG_INVALID_SHAPE",
      "Deck config path must be a regular file.",
      { configPath },
    );
  }
  const uid = typeof process.getuid === "function" ? process.getuid() : undefined;
  assertOwnedByCurrentUser(configPath, uid, configPath);
}

function writeFilePrivateAtomic(configPath: string, content: string, options: DeckConfigFileWriteOptions = {}): DeckConfigWriteReceipt {
  ensureSafeParentAncestry(configPath, options.containmentRoot);
  assertConfigPathIsSafeForWrite(configPath);
  assertExpectedDigest(configPath, options.expectedDigest);
  const preimage = readPreimageBytes(configPath, options.containmentRoot);
  const postimageDigest = createHash("sha256").update(content).digest("hex");
  const tmpPath = join(dirname(configPath), `.config.json.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`);
  let fd: number | undefined;
  let renamed = false;
  const rollback = () => {
    const current = readPreimageBytes(configPath, options.containmentRoot);
    if (current.digest !== postimageDigest) return;
    if (preimage.exists && preimage.bytes) {
      writeFilePrivateAtomic(configPath, preimage.bytes.toString("utf8"), { containmentRoot: options.containmentRoot, expectedDigest: postimageDigest });
      if (preimage.mode !== null) chmodSync(configPath, preimage.mode);
    } else {
      unlinkSync(configPath);
    }
  };
  try {
    fd = openSync(tmpPath, "wx", 0o600);
    writeFileSync(fd, content, "utf-8");
    chmodSync(tmpPath, 0o600);
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    ensureSafeParentAncestry(configPath, options.containmentRoot);
    assertConfigPathIsSafeForWrite(configPath);
    assertExpectedDigest(configPath, options.expectedDigest);
    renameSync(tmpPath, configPath);
    renamed = true;
    options.afterRenameForTest?.();
    try {
      const dirFd = openSync(dirname(configPath), "r");
      try { fsyncSync(dirFd); } finally { closeSync(dirFd); }
    } catch {
      // Directory fsync is best-effort across platforms/filesystems.
    }
    return { path: configPath, preimageDigest: preimage.digest, postimageDigest, rollback };
  } catch (error) {
    if (fd !== undefined) {
      try { closeSync(fd); } catch { /* best effort */ }
    }
    try { unlinkSync(tmpPath); } catch { /* best effort */ }
    if (renamed) {
      try { rollback(); } catch { /* best effort; caller still receives failure */ }
    }
    throw error;
  }
}

export function writeDeckConfigFileAtomic(configPath: string, config: unknown, options: DeckConfigFileWriteOptions = {}): NormalizedDeckConfig {
  return withDeckConfigFileLock(configPath, options.containmentRoot, () => writeDeckConfigFileAtomicUnlocked(configPath, config, options));
}

function writeDeckConfigFileAtomicUnlocked(configPath: string, config: unknown, options: DeckConfigFileWriteOptions = {}): NormalizedDeckConfig {
  const normalized = validateDeckConfig(config, { configPath });
  writeFilePrivateAtomic(configPath, `${JSON.stringify(normalized, null, 2)}\n`, options);
  return normalized;
}

export function writeDeckConfigFileAtomicWithReceipt(configPath: string, config: unknown, options: DeckConfigFileWriteOptions = {}): { config: NormalizedDeckConfig; receipt: DeckConfigWriteReceipt } {
  const normalized = validateDeckConfig(config, { configPath });
  const receipt = withDeckConfigFileLock(configPath, options.containmentRoot, () => writeFilePrivateAtomic(configPath, `${JSON.stringify(normalized, null, 2)}\n`, options));
  return {
    config: normalized,
    receipt: {
      ...receipt,
      rollback: () => withDeckConfigFileLock(configPath, options.containmentRoot, receipt.rollback),
    },
  };
}

export function patchDeckConfigFile(configPath: string, patch: DeckConfigFilePatch, options: DeckConfigFilePatchOptions = {}): NormalizedDeckConfig {
  return withDeckConfigFileLock(configPath, options.containmentRoot, () => {
    const retries = Math.max(0, Math.min(options.maxRetries ?? 3, 10));
    let lastConflict: DeckConfigError | undefined;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
    const preimage = readDeckConfigFilePreimage(configPath, { containmentRoot: options.containmentRoot });
    const existing = readDeckConfigFile(configPath, { containmentRoot: options.containmentRoot });
    try {
      return writeDeckConfigFileAtomicUnlocked(configPath, patch(existing), {
        containmentRoot: options.containmentRoot,
        expectedDigest: options.expectedDigest !== undefined ? options.expectedDigest : preimage.digest,
      });
    } catch (error) {
      if (error instanceof DeckConfigError && error.code === "DECK_CONFIG_CONCURRENT_MODIFICATION" && options.expectedDigest === undefined) {
        lastConflict = error;
        continue;
      }
      throw error;
    }
  }
    throw lastConflict ?? new DeckConfigError("DECK_CONFIG_CONCURRENT_MODIFICATION", "Deck config changed before write; retry with a fresh preimage.", { configPath });
  });
}

export function readDeckConfig(projectRoot: string): NormalizedDeckConfig {
  return readDeckConfigFile(getDeckConfigPath(projectRoot));
}

// ============================================================================
// Global Config APIs (Task 6)
// ============================================================================

/**
 * Error code for global config operations.
 */
export type GlobalConfigErrorCode =
  | "GLOBAL_CONFIG_PATH_RESOLUTION_FAILED"
  | "GLOBAL_CONFIG_READ_ERROR"
  | "GLOBAL_CONFIG_WRITE_ERROR";

/**
 * Error class for global config operations.
 */
export class GlobalConfigError extends Error {
  readonly code: GlobalConfigErrorCode;

  constructor(code: GlobalConfigErrorCode, message: string) {
    super(message);
    this.name = "GlobalConfigError";
    this.code = code;
  }
}

/**
 * Get the global Deck config file path.
 *
 * Core does not resolve process-global paths; callers provide the CLI-resolved
 * XDG config path.
 *
 * @returns Full path to global config.json
 * @throws {GlobalConfigError} If path resolution fails
 */
export async function getGlobalDeckConfigPath(configPath?: string): Promise<string> {
  if (configPath && configPath.trim().length > 0) return configPath;
  throw new GlobalConfigError(
    "GLOBAL_CONFIG_PATH_RESOLUTION_FAILED",
    "Core no longer resolves global Deck config paths. Pass a caller-resolved config path from the CLI composition root.",
  );
}

/**
 * Read the global Deck config.
 *
 * Reads from the caller-provided global config file path. Returns default config
 * if no path/global config exists.
 *
 * @returns Normalized global Deck config
 * @throws {GlobalConfigError} If read fails
 */
export async function readGlobalDeckConfig(configPath?: string): Promise<NormalizedDeckConfig> {
  if (!configPath) return getDefaultDeckConfig();
  try {
    return readDeckConfigFile(configPath);
  } catch (error) {
    if (error instanceof DeckConfigError) throw error;
    throw new GlobalConfigError(
      "GLOBAL_CONFIG_READ_ERROR",
      `Failed to read global config: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Write the global Deck config.
 *
 * Writes to the caller-provided global config file path. Creates directories as
 * needed.
 *
 * @param config - Config object to write
 * @returns Normalized config that was written
 * @throws {GlobalConfigError} If write fails
 */
export async function writeGlobalDeckConfig(config: unknown, configPath?: string): Promise<NormalizedDeckConfig> {
  if (!configPath) {
    throw new GlobalConfigError(
      "GLOBAL_CONFIG_WRITE_ERROR",
      "Core no longer resolves global Deck config paths. Pass a caller-resolved config path from the CLI composition root.",
    );
  }
  try {
    return writeDeckConfigFileAtomic(configPath, config);
  } catch (error) {
    if (error instanceof DeckConfigError) throw error;
    throw new GlobalConfigError(
      "GLOBAL_CONFIG_WRITE_ERROR",
      `Failed to write global config: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function writeDeckConfig(projectRoot: string, config: unknown): NormalizedDeckConfig {
  return writeDeckConfigFileAtomic(getDeckConfigPath(projectRoot), config);
}

export function validateDeckConfig(
  config: unknown,
  options?: { configPath?: string; registry?: AdapterRegistry },
): NormalizedDeckConfig {
  if (config === undefined || config === null) {
    return getDefaultDeckConfig();
  }

  assertPlainObject(config, "config", options?.configPath);
  rejectSecretFields(config, "config", options?.configPath);
  assertKnownFields(config, TOP_LEVEL_FIELDS, "config", options?.configPath);

  const version = config.version ?? DECK_CONFIG_VERSION;
  if (version !== DECK_CONFIG_VERSION) {
    throw new DeckConfigError(
      "DECK_CONFIG_UNSUPPORTED_VERSION",
      `Unsupported Deck config version. Expected ${DECK_CONFIG_VERSION}.`,
      { configPath: options?.configPath, fieldPath: "version" },
    );
  }

  const adaptiveMemory = normalizeAdaptiveMemoryConfig(
    config.adaptiveMemory,
    options?.configPath,
  );

  const webSearch = normalizeWebSearchConfig(config.webSearch, options?.configPath);

  const packageInstructions = normalizePackageInstructionConfig(
    config.packageInstructions,
    options?.configPath,
    options,
  );

  const orchestratorPersonality = normalizeOrchestratorPersonalityConfig(
    config.orchestratorPersonality,
    options?.configPath,
  );

  const developerTeamExecution = normalizeDeveloperTeamExecutionConfig(
    config.developerTeamExecution,
    options?.configPath,
  );

  const profiles = normalizeProfiles(config.profiles, config.activeProfile, options?.configPath);
  const activeProfile = profiles.length === 0 || config.activeProfile === undefined
    ? "default"
    : (config.activeProfile as string);

  assertValidActiveProfile(activeProfile, profiles, options?.configPath);

  return {
    version: DECK_CONFIG_VERSION,
    adaptiveMemory,
    webSearch,
    packageInstructions,
    orchestratorPersonality,
    developerTeamExecution,
    profiles,
    activeProfile,
  };
}

export function diagnoseDeckConfigDeprecations(config: unknown): readonly DeckConfigDiagnostic[] {
  if (!config || typeof config !== "object" || Array.isArray(config)) return [];
  const adaptiveMemory = (config as Record<string, unknown>).adaptiveMemory;
  if (!adaptiveMemory || typeof adaptiveMemory !== "object" || Array.isArray(adaptiveMemory)) return [];
  const supermemory = (adaptiveMemory as Record<string, unknown>).supermemory;
  if (!supermemory || typeof supermemory !== "object" || Array.isArray(supermemory)) return [];
  if (!Object.prototype.hasOwnProperty.call(supermemory, "maxMemoriesPerSession")) return [];
  return [{
    code: "SUPERMEMORY_CONFIG_DEPRECATED",
    severity: "warning",
    fieldPath: "adaptiveMemory.supermemory.maxMemoriesPerSession",
    message: "Deprecated Supermemory maxMemoriesPerSession is accepted for compatibility but ignored; conversation capture uses provider-native extraction instead.",
  }];
}

function normalizeWebSearchConfig(
  value: unknown,
  configPath?: string,
): NormalizedDeckConfig["webSearch"] {
  if (value === undefined || value === null) return { enabled: false };

  assertPlainObject(value, "webSearch", configPath);
  assertKnownFields(value, WEB_SEARCH_FIELDS, "webSearch", configPath);

  const enabled = value.enabled === undefined ? false : value.enabled;
  if (typeof enabled !== "boolean") {
    throw new DeckConfigError(
      "WEB_SEARCH_CONFIG_INVALID",
      "webSearch.enabled must be a boolean.",
      { configPath, fieldPath: "webSearch.enabled" },
    );
  }

  if (value.provider === undefined) return { enabled };
  if (typeof value.provider !== "string" || value.provider.trim().length === 0) {
    throw new DeckConfigError(
      "WEB_SEARCH_CONFIG_INVALID",
      "webSearch.provider must be a non-empty string when provided.",
      { configPath, fieldPath: "webSearch.provider" },
    );
  }

  return { enabled, provider: value.provider.trim() };
}

export function resolveActiveMemoryProvider(options?: {
  cliProvider?: string;
  config?: unknown;
  projectRoot?: string;
}): ActiveMemoryProviderResolution {
  // Cache configPath to avoid double resolution
  const configPath = options?.projectRoot ? getDeckConfigPath(options.projectRoot) : undefined;
  const hasConfigFile = configPath ? existsSync(configPath) : false;
  const config =
    options?.config !== undefined
      ? validateDeckConfig(options.config, { configPath })
      : configPath && options?.projectRoot
        ? readDeckConfig(options.projectRoot)
        : getDefaultDeckConfig();

  const cliProvider = options?.cliProvider;
  if (cliProvider !== undefined) {
    const activeProvider = parseActiveProvider(cliProvider, "cliProvider", configPath);
    return buildResolution(activeProvider, "cli", config, configPath);
  }

  const activeProvider = config.adaptiveMemory.activeProvider ?? "none";
  const source: ActiveMemoryProviderSource =
    options?.config !== undefined || hasConfigFile ? "config" : "default";
  return buildResolution(activeProvider, source, config, configPath);
}

function buildResolution(
  activeProvider: AdaptiveMemoryActiveProvider,
  source: ActiveMemoryProviderSource,
  config: NormalizedDeckConfig,
  configPath?: string,
): ActiveMemoryProviderResolution {
  if (activeProvider === "supermemory") {
    const supermemory = config.adaptiveMemory.supermemory;
    return { activeProvider, source, config, supermemory };
  }

  return { activeProvider, source, config };
}

function executionConfigEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
  fieldPath: string,
  configPath?: string,
): T {
  if (value === undefined) return fallback;
  if (!allowed.includes(value as T)) {
    throw new DeckConfigError("DECK_CONFIG_INVALID_SHAPE", `${fieldPath} has an unsupported value.`, { configPath, fieldPath });
  }
  return value as T;
}

function normalizeDeveloperTeamExecutionConfig(
  value: unknown,
  configPath?: string,
): DeveloperTeamExecutionConfigV1 {
  if (value === undefined || value === null) return getDefaultDeckConfig().developerTeamExecution;
  assertPlainObject(value, "developerTeamExecution", configPath);
  assertKnownFields(value, DEVELOPER_TEAM_EXECUTION_FIELDS, "developerTeamExecution", configPath);
  if (value.schema !== undefined && value.schema !== "developer-team-execution-config-v1") {
    throw new DeckConfigError("DECK_CONFIG_INVALID_SHAPE", "developerTeamExecution.schema is unsupported.", {
      configPath,
      fieldPath: "developerTeamExecution.schema",
    });
  }
  const authorization = value.invocationAuthorization;
  if (authorization !== undefined && authorization !== null) {
    assertPlainObject(authorization, "developerTeamExecution.invocationAuthorization", configPath);
    assertKnownFields(authorization, INVOCATION_AUTHORIZATION_FIELDS, "developerTeamExecution.invocationAuthorization", configPath);
  }
  const authorizationValue = authorization as Record<string, unknown> | undefined;
  const cohortPercent = value.cohortPercent ?? 0;
  if (typeof cohortPercent !== "number" || !Number.isFinite(cohortPercent) || cohortPercent < 0 || cohortPercent > 100) {
    throw new DeckConfigError("DECK_CONFIG_INVALID_SHAPE", "developerTeamExecution.cohortPercent must be between 0 and 100.", {
      configPath,
      fieldPath: "developerTeamExecution.cohortPercent",
    });
  }
  const authorizationModes = ["static-compatible", "invocation-required"] as const;
  return {
    schema: "developer-team-execution-config-v1",
    executionContracts: executionConfigEnum(value.executionContracts, ["off", "observe", "enforce"] as const, "observe", "developerTeamExecution.executionContracts", configPath),
    decisionKernel: executionConfigEnum(value.decisionKernel, ["legacy", "shadow", "active"] as const, "shadow", "developerTeamExecution.decisionKernel", configPath),
    invocationAuthorization: {
      default: executionConfigEnum(authorizationValue?.default, authorizationModes, "static-compatible", "developerTeamExecution.invocationAuthorization.default", configPath),
      ...(authorizationValue?.opencode === undefined ? {} : {
        opencode: executionConfigEnum(authorizationValue.opencode, authorizationModes, "static-compatible", "developerTeamExecution.invocationAuthorization.opencode", configPath),
      }),
      ...(authorizationValue?.pi === undefined ? {} : {
        pi: executionConfigEnum(authorizationValue.pi, authorizationModes, "static-compatible", "developerTeamExecution.invocationAuthorization.pi", configPath),
      }),
    },
    registryWriter: executionConfigEnum(value.registryWriter, ["distributed-compatible", "centralized"] as const, "distributed-compatible", "developerTeamExecution.registryWriter", configPath),
    routePolicy: executionConfigEnum(value.routePolicy, ["legacy-triage", "shadow-risk-lanes", "risk-lanes"] as const, "legacy-triage", "developerTeamExecution.routePolicy", configPath),
    promptProfile: executionConfigEnum(value.promptProfile, ["legacy", "compact"] as const, "compact", "developerTeamExecution.promptProfile", configPath),
    telemetry: executionConfigEnum(value.telemetry, ["off", "local-safe"] as const, "off", "developerTeamExecution.telemetry", configPath),
    cohortPercent,
  };
}

function normalizeAdaptiveMemoryConfig(
  value: unknown,
  configPath?: string,
): NormalizedDeckConfig["adaptiveMemory"] {
  if (value === undefined || value === null) {
    return { activeProvider: "none" };
  }

  assertPlainObject(value, "adaptiveMemory", configPath);
  assertKnownFields(value, ADAPTIVE_MEMORY_FIELDS, "adaptiveMemory", configPath);

  const activeProvider = value.activeProvider === undefined
    ? "none"
    : parseActiveProvider(value.activeProvider, "adaptiveMemory.activeProvider", configPath);

  const supermemory = normalizeSupermemoryConfig(
    value.supermemory,
    activeProvider,
    configPath,
  );

  return supermemory ? { activeProvider, supermemory } : { activeProvider };
}

const DEPRECATED_SUPERMEMORY_FIELDS = new Set(["userId", "teamId", "orgId", "projectId"]);

/**
 * Strip deprecated fields from a raw config object in place.
 * These fields are no longer stored in config (identity now derived from token automatically).
 */
function stripDeprecatedSupermemoryFields(value: Record<string, unknown>): void {
  for (const field of DEPRECATED_SUPERMEMORY_FIELDS) {
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete value[field];
  }
}

function normalizeSupermemoryConfig(
  value: unknown,
  activeProvider: AdaptiveMemoryActiveProvider,
  configPath?: string,
): DeckSupermemoryConfig | undefined {
  if (value === undefined || value === null) {
    if (activeProvider === "supermemory") {
      return {
        mcpServerName: "supermemory",
        searchMode: "documents",
      };
    }
    return undefined;
  }

  assertPlainObject(value, "adaptiveMemory.supermemory", configPath);

  stripDeprecatedSupermemoryFields(value);
  assertKnownFields(value, SUPERMEMORY_FIELDS, "adaptiveMemory.supermemory", configPath);

  // maxMemoriesPerSession is accepted for compatibility but ignored as a behavioral control.
  if (value.maxMemoriesPerSession !== undefined) {
    normalizeDeprecatedMaxMemoriesPerSession(value.maxMemoriesPerSession, configPath);
  }

  return {
    mcpServerName: normalizeOptionalString(
      value.mcpServerName,
      "adaptiveMemory.supermemory.mcpServerName",
      configPath,
      { defaultValue: "supermemory" },
    ),
    searchMode: normalizeSearchMode(value.searchMode, configPath),
  };
}

function normalizePackageInstructionConfig(
  value: unknown,
  configPath?: string,
  options?: { registry?: AdapterRegistry },
): NormalizedDeckConfig["packageInstructions"] {
  // Default: code-economy is active for every registered first-class runner.
  const defaultResult: NormalizedDeckConfig["packageInstructions"] = {
    pi: { "codebase-memory": false, "code-economy": true, "context-mode": false, rtk: false, "adaptive-memory": false, serena: false },
    opencode: { "codebase-memory": false, "code-economy": true, "context-mode": false, rtk: false, "adaptive-memory": false, serena: false },
    codex: { "codebase-memory": false, "code-economy": true, "context-mode": false, rtk: false, "adaptive-memory": false, serena: false },
  };

  if (value === undefined || value === null) {
    return defaultResult;
  }

  assertPlainObject(value, "packageInstructions", configPath);
  // If empty object, return defaults for backward compat
  if (Object.keys(value).length === 0) {
    return defaultResult;
  }

  // Validate each runner key against registry if provided
  if (options?.registry) {
    validateRunnerKeys(Object.keys(value), options.registry);
  }

  // Normalize from canonical defaults so omitted registered runners retain their baseline.
  const result: NormalizedDeckConfig["packageInstructions"] = structuredClone(defaultResult);

  for (const [runner, runnerValue] of Object.entries(value)) {
    if (runnerValue === undefined || runnerValue === null) {
      // Skip null/undefined runner entries
      continue;
    }

    assertPlainObject(runnerValue, `packageInstructions.${runner}`, configPath);

    // Initialize runner entry: code-economy is always the baseline.
    // Other packages default to false
    result[runner as PackageInstructionRunnerId] = {
      "codebase-memory": false,
      "code-economy": true,
      "context-mode": false,
      rtk: false,
      "adaptive-memory": false,
      serena: false,
    };

    // Validate each package key in this runner
    for (const pkgKey of Object.keys(runnerValue)) {
      if (!PACKAGE_INSTRUCTION_PACKAGE_FIELDS.has(pkgKey as PackageInstructionPackageId)) {
        throw new DeckConfigError(
          "DECK_CONFIG_UNKNOWN_FIELD",
          `Unknown Deck config field under packageInstructions.${runner}.`,
          { configPath, fieldPath: `packageInstructions.${runner}.${pkgKey}` },
        );
      }
    }

    // Normalize package booleans
    // IMPORTANT: code-economy is ALWAYS true for supported runners - cannot be disabled
    // Invalid values (non-boolean) are normalized to true for code-economy only
    for (const pkg of PACKAGE_INSTRUCTION_PACKAGE_IDS) {
      const pkgValue = (runnerValue as Record<string, unknown>)[pkg];
      if (pkgValue !== undefined) {
        // code-economy: force to true for ANY value (including invalid non-boolean)
        // This is a baseline, not a user toggle - invalid values are normalized, not rejected
        if (pkg === "code-economy") {
          result[runner as PackageInstructionRunnerId][pkg] = true;
        } else {
          // Other packages: reject non-boolean values
          if (typeof pkgValue !== "boolean") {
            throw new DeckConfigError(
              "DECK_CONFIG_INVALID_SHAPE",
              `packageInstructions.${runner}.${pkg} must be a boolean.`,
              { configPath, fieldPath: `packageInstructions.${runner}.${pkg}` },
            );
          }
          result[runner as PackageInstructionRunnerId][pkg] = pkgValue;
        }
      }
      // If undefined, keep default (code-economy: true, others: false)
    }
  }

  return result;
}

function normalizeOrchestratorPersonalityConfig(
  value: unknown,
  configPath?: string,
): OrchestratorPersonality {
  if (value === undefined || value === null) {
    return DEFAULT_ORCHESTRATOR_PERSONALITY;
  }

  if (typeof value !== "string") {
    throw new DeckConfigError(
      "DECK_CONFIG_INVALID_SHAPE",
      `orchestratorPersonality must be a string.`,
      { configPath, fieldPath: "orchestratorPersonality" },
    );
  }

  if (!ORCHESTRATOR_PERSONALITIES.includes(value as OrchestratorPersonality)) {
    throw new DeckConfigError(
      "DECK_CONFIG_INVALID_SHAPE",
      `orchestratorPersonality must be one of: ${ORCHESTRATOR_PERSONALITIES.join(", ")}`,
      { configPath, fieldPath: "orchestratorPersonality" },
    );
  }

  return value as OrchestratorPersonality;
}

function normalizeProfiles(
  profiles: unknown,
  activeProfile: unknown,
  configPath?: string,
): Profile[] {
  // Handle null/undefined → empty array
  if (profiles === undefined || profiles === null) {
    return [];
  }

  if (!Array.isArray(profiles)) {
    throw new DeckConfigError(
      "DECK_CONFIG_INVALID_SHAPE",
      `"profiles" must be an array.`,
      { configPath, fieldPath: "profiles" },
    );
  }

  // Check for duplicate names
  const seenNames = new Set<string>();
  for (const profile of profiles) {
    if (typeof profile !== "object" || profile === null) {
      throw new DeckConfigError(
        "DECK_CONFIG_INVALID_SHAPE",
        `"profiles" must contain only objects with a "name" field.`,
        { configPath, fieldPath: "profiles" },
      );
    }

    const p = profile as Record<string, unknown>;

    if (typeof p.name !== "string" || p.name.trim().length === 0) {
      throw new DeckConfigError(
        "DECK_CONFIG_INVALID_SHAPE",
        `"profiles" entries must have a non-empty "name" field.`,
        { configPath, fieldPath: "profiles" },
      );
    }

    if (seenNames.has(p.name)) {
      throw new DeckConfigError(
        "DECK_CONFIG_INVALID_SHAPE",
        "Duplicate profile name.",
        { configPath, fieldPath: "profiles" },
      );
    }
    seenNames.add(p.name);

    // Validate phaseOverrides keys
    if (p.phaseOverrides !== undefined && p.phaseOverrides !== null) {
      if (typeof p.phaseOverrides !== "object" || Array.isArray(p.phaseOverrides)) {
        throw new DeckConfigError(
          "DECK_CONFIG_INVALID_SHAPE",
          `"phaseOverrides" must be an object.`,
          { configPath, fieldPath: "profiles" },
        );
      }

      const phaseOverrides = p.phaseOverrides as Record<string, unknown>;
      for (const phaseKey of Object.keys(phaseOverrides)) {
        if (!SDD_PHASES.includes(phaseKey as SDDPhase)) {
          throw new DeckConfigError(
            "DECK_CONFIG_UNKNOWN_FIELD",
            `Unknown profile phase override. Valid phases: ${SDD_PHASES.join(", ")}.`,
            { configPath, fieldPath: `profiles.phaseOverrides.${phaseKey}` },
          );
        }
      }
    }

    // Validate strategy value
    if (p.strategy !== undefined && p.strategy !== null) {
      if (typeof p.strategy !== "string") {
        throw new DeckConfigError(
          "DECK_CONFIG_INVALID_SHAPE",
          `"strategy" must be a string.`,
          { configPath, fieldPath: "profiles" },
        );
      }

      const validStrategies: ProfileStrategy[] = ["generated-multi", "external-single-active"];
      if (!validStrategies.includes(p.strategy as ProfileStrategy)) {
        throw new DeckConfigError(
          "DECK_CONFIG_INVALID_SHAPE",
          `"strategy" must be one of: ${validStrategies.join(", ")}.`,
          { configPath, fieldPath: "profiles" },
        );
      }
    }
  }

  return profiles as Profile[];
}

function assertValidActiveProfile(activeProfile: string, profiles: Profile[], configPath?: string): void {
  if (activeProfile === "default") return; // implicit default is always valid
  const profileNames = profiles.map((p) => p.name);
  if (!profileNames.includes(activeProfile)) {
    throw new DeckConfigError(
      "DECK_CONFIG_INVALID_SHAPE",
      `Unknown active profile. Available profiles count: ${profileNames.length}`,
      { configPath, fieldPath: "activeProfile" },
    );
  }
}

function parseActiveProvider(
  value: unknown,
  fieldPath: string,
  configPath?: string,
): AdaptiveMemoryActiveProvider {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new DeckConfigError(
      "ADAPTIVE_MEMORY_UNSUPPORTED_PROVIDER",
      "Unsupported adaptive-memory provider value.",
      { configPath, fieldPath },
    );
  }
  return value as AdaptiveMemoryActiveProvider;
}

function normalizeSearchMode(value: unknown, configPath?: string): SupermemorySearchMode {
  if (value === undefined) return "hybrid";
  if (typeof value !== "string" || !SUPERMEMORY_SEARCH_MODES.includes(value as SupermemorySearchMode)) {
    throw new DeckConfigError(
      "SUPERMEMORY_CONFIG_INVALID",
      `Invalid Supermemory searchMode. Expected one of: ${SUPERMEMORY_SEARCH_MODES.join(", ")}.`,
      { configPath, fieldPath: "adaptiveMemory.supermemory.searchMode" },
    );
  }
  return value as SupermemorySearchMode;
}

function normalizeDeprecatedMaxMemoriesPerSession(value: unknown, configPath?: string): void {
  if (value === undefined) return;
  if (!Number.isInteger(value) || typeof value !== "number" || value < 1) {
    throw new DeckConfigError(
      "SUPERMEMORY_CONFIG_INVALID",
      "Deprecated Supermemory maxMemoriesPerSession must be a positive integer when present; it is ignored for behavior.",
      { configPath, fieldPath: "adaptiveMemory.supermemory.maxMemoriesPerSession" },
    );
  }
}

function normalizeOptionalString(
  value: unknown,
  fieldPath: string,
  configPath?: string,
  options?: { defaultValue?: string },
): string | undefined {
  if (value === undefined) return options?.defaultValue;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new DeckConfigError(
      fieldPath.endsWith("userId") ? "SUPERMEMORY_USER_ID_REQUIRED" : "SUPERMEMORY_CONFIG_INVALID",
      `${fieldPath} must be a non-empty string when provided.`,
      { configPath, fieldPath },
    );
  }
  return value.trim();
}

function hasNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function assertPlainObject(
  value: unknown,
  fieldPath: string,
  configPath?: string,
): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new DeckConfigError(
      "DECK_CONFIG_INVALID_SHAPE",
      `${fieldPath} must be an object.`,
      { configPath, fieldPath },
    );
  }
}

function assertKnownFields(
  value: Record<string, unknown>,
  allowedFields: Set<string>,
  fieldPath: string,
  configPath?: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowedFields.has(key)) {
      throw new DeckConfigError(
        "DECK_CONFIG_UNKNOWN_FIELD",
        `Unknown Deck config field under ${fieldPath}.`,
        { configPath, fieldPath: `${fieldPath}.${key}` },
      );
    }
  }
}

function rejectSecretFields(value: unknown, fieldPath: string, configPath?: string): void {
  if (typeof value !== "object" || value === null) return;

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const childPath = `${fieldPath}.${key}`;
    if (SECRET_FIELD_PATTERN.test(key) && !SAFE_CONTROL_FIELD_KEYS.has(key)) {
      throw new DeckConfigError(
        "DECK_CONFIG_SECRET_FIELD",
        "Deck config may not store credentials or secret-shaped fields.",
        { configPath, fieldPath: childPath },
      );
    }
    rejectSecretFields(child, childPath, configPath);
  }
}
