import { createHash, randomBytes } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";

import type { RunnerId } from "../runner-adapter";
import {
  SKILL_DISCOVERY_V1_BOUNDS,
  type SkillDiscoveryDiagnosticV1,
  type SkillDiscoveryDigestV1,
  type SkillRegistryWriteActionV1,
  type SkillRegistryWriteAuthorityV1,
  type SkillRegistryWritePlanV1,
  type SkillRegistryWriteTargetsV1,
  type SkillRegistryWriterV1,
} from "./contracts";
import {
  parseSkillRegistryDocument,
} from "./registry";

export type { SkillRegistryWritePlanV1 } from "./contracts";

const execFile = promisify(execFileCallback);
const AUTHORITY_STATES = new WeakMap<object, AuthorityStateV1>();
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const SAFE_RUNNER_ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/;
const REGISTRY_TARGET = ".atl/skill-registry.md" as const;
const GITIGNORE_TARGET = ".gitignore" as const;
const NARROW_IGNORE_RULE = "/.atl/skill-registry.md";
const REJECTED_OUTCOME = "rejected" as const;

/** Stages that may be fault-injected by persistence tests and callers. */
export type SkillRegistryWriteFailpointV1 =
  | "before_candidate_validation"
  | "after_candidate_validation"
  | "before_ignore_update"
  | "after_ignore_update"
  | "before_temp_write"
  | "after_temp_write"
  | "before_fsync"
  | "after_fsync"
  | "before_reparse"
  | "after_reparse"
  | "before_replace"
  | "after_replace"
  | "before_directory_sync"
  | "after_directory_sync";

/** Replace-without-delete and directory durability operations used by the writer. */
export interface AtomicReplacePortV1 {
  replace(tempPath: string, targetPath: string): Promise<void>;
  syncDirectory(directoryPath: string): Promise<void>;
}

/** Explicit caller evidence used to mint an opaque, one-use write authority. */
export interface SkillRegistryWriteAuthorityMintInputV1 {
  readonly projectRoot: string;
  readonly projectRootDigest: SkillDiscoveryDigestV1;
  readonly action: SkillRegistryWriteActionV1;
  readonly activeRunnerId: RunnerId;
  readonly allowedTargets: SkillRegistryWriteTargetsV1;
}

export interface SkillRegistryWriterOptionsV1 {
  readonly projectRoot: string;
  readonly atomicReplace?: AtomicReplacePortV1;
  readonly isTracked?: (registryPath: string) => Promise<boolean> | boolean;
  readonly failpoint?: (
    stage: SkillRegistryWriteFailpointV1,
  ) => Promise<void> | void;
}

interface AuthorityStateV1 {
  readonly projectRoot: string;
  readonly projectRootDigest: SkillDiscoveryDigestV1;
  readonly action: SkillRegistryWriteActionV1;
  readonly activeRunnerId: RunnerId;
  readonly allowedTargets: SkillRegistryWriteTargetsV1;
  used: boolean;
}

interface WriterStateV1 {
  readonly projectRoot: string;
  readonly atomicReplace: AtomicReplacePortV1;
  readonly isTracked: (registryPath: string) => Promise<boolean> | boolean;
  readonly failpoint?: (
    stage: SkillRegistryWriteFailpointV1,
  ) => Promise<void> | void;
}

interface FileSnapshotV1 {
  readonly exists: boolean;
  readonly bytes?: Buffer;
  readonly digest: SkillDiscoveryDigestV1 | "missing";
}

interface CandidateV1 {
  readonly document: string;
  readonly digest: SkillDiscoveryDigestV1;
}

interface IgnoreSnapshotV1 {
  readonly bytes: Buffer;
  readonly source: string;
  readonly digest: SkillDiscoveryDigestV1;
  readonly coversRegistry: boolean;
}

type ReplacementTargetLabelV1 = "registry" | "gitignore";

interface ReplacementStateV1 {
  readonly targetPath: string;
  readonly directoryPath: string;
  readonly targetLabel: ReplacementTargetLabelV1;
  readonly oldBytes?: Buffer;
  readonly oldDigest: SkillDiscoveryDigestV1 | "missing";
  readonly candidateDigest: SkillDiscoveryDigestV1;
  readonly backupPath?: string;
  replaced: boolean;
}

/**
 * Hash raw persisted bytes.  These digests are compare-and-swap values, not
 * registry freshness fingerprints, so no domain prefix is added to the bytes.
 */
export function computeSkillRegistryPersistenceDigest(
  value: string | Uint8Array,
): SkillDiscoveryDigestV1 {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

/**
 * Mint an opaque authority only from an explicit, exact write authorization.
 * The token has no serializable state; the process-local WeakMap is the only
 * source of its project/action/runner/target binding and one-use state.
 */
export function createSkillRegistryWriteAuthority(
  input: SkillRegistryWriteAuthorityMintInputV1,
): SkillRegistryWriteAuthorityV1 {
  if (!isAuthorityMintInput(input)) {
    throw new TypeError("Invalid skill registry write authorization.");
  }

  const token = Object.freeze(Object.create(null)) as SkillRegistryWriteAuthorityV1;
  AUTHORITY_STATES.set(token as object, {
    projectRoot: path.resolve(input.projectRoot),
    projectRootDigest: input.projectRootDigest,
    action: input.action,
    activeRunnerId: input.activeRunnerId,
    allowedTargets: copyTargets(input.allowedTargets),
    used: false,
  });
  return token;
}

/** Alias used by callers that describe the operation as minting. */
export const mintSkillRegistryWriteAuthority = createSkillRegistryWriteAuthority;

/** Create a writer whose only filesystem target is the project-local registry. */
export function createSkillRegistryWriter(
  options: SkillRegistryWriterOptionsV1,
): SkillRegistryWriterV1 {
  const projectRoot = requireAbsolutePath(options?.projectRoot, "project root");
  const state: WriterStateV1 = {
    projectRoot,
    atomicReplace: options.atomicReplace ?? POSIX_ATOMIC_REPLACE_PORT_V1,
    isTracked: options.isTracked ?? ((registryPath) => isTrackedByGit(projectRoot, registryPath)),
    failpoint: options.failpoint,
  };

  return {
    commit: (plan, authority) => commitWrite(state, plan, authority),
  };
}

/** Default same-directory POSIX replace port. It never removes the target first. */
export const POSIX_ATOMIC_REPLACE_PORT_V1: AtomicReplacePortV1 = Object.freeze({
  async replace(tempPath: string, targetPath: string): Promise<void> {
    await fs.rename(tempPath, targetPath);
  },

  async syncDirectory(directoryPath: string): Promise<void> {
    let handle: fs.FileHandle | undefined;
    try {
      handle = await fs.open(directoryPath, "r");
      await handle.sync();
    } catch (error) {
      if (!isUnsupportedDirectorySyncError(error)) throw error;
    } finally {
      await handle?.close().catch(() => undefined);
    }
  },
});

async function commitWrite(
  state: WriterStateV1,
  plan: SkillRegistryWritePlanV1,
  authority: SkillRegistryWriteAuthorityV1,
): Promise<Awaited<ReturnType<SkillRegistryWriterV1["commit"]>>> {
  const authorityResult = takeAuthority(authority);
  if ("error" in authorityResult) return rejected(authorityResult.error);
  const authorityState = authorityResult.state;

  const planError = validatePlan(plan, authorityState);
  if (planError) return rejected(planError);

  let root: string;
  let registryPath = "";
  let registryDirectory: string;
  let tempPath: string | undefined;
  let ignoreChanged = false;
  let replacement: ReplacementStateV1 | undefined;

  try {
    await hit(state, "before_candidate_validation");
    const candidateResult = validateCandidate(plan);
    if ("error" in candidateResult) return rejected(candidateResult.error);
    const candidate = candidateResult.candidate;
    await hit(state, "after_candidate_validation");

    root = await resolveProjectRoot(state.projectRoot, authorityState.projectRoot);
    registryPath = containedPath(root, REGISTRY_TARGET);
    registryDirectory = path.dirname(registryPath);
    await assertContainedTarget(root, registryPath);

    const existingRegistry = await readRegularFile(registryPath, "registry");
    const expectedRegistryError = compareExpectedDigest(
      plan.expected_registry_digest,
      existingRegistry.digest,
      "stale_registry",
    );
    if (expectedRegistryError) return rejected(expectedRegistryError);

    if (await state.isTracked(registryPath)) {
      return rejected("tracked_registry");
    }

    const ignorePath = containedPath(root, GITIGNORE_TARGET);
    const ignore = await readIgnoreFile(ignorePath);
    if ("error" in ignore) return rejected(ignore.error);

    const expectedIgnoreError = compareExpectedDigest(
      plan.expected_gitignore_digest,
      ignore.snapshot.digest,
      "stale_gitignore",
    );
    if (expectedIgnoreError) return rejected(expectedIgnoreError);

    if (!ignore.snapshot.coversRegistry) {
      if (!targetsInclude(plan.allowed_targets, GITIGNORE_TARGET)) {
        return rejected("gitignore_unauthorized");
      }
      await hit(state, "before_ignore_update");
      const currentIgnore = await readIgnoreFile(ignorePath);
      if ("error" in currentIgnore) return rejected(currentIgnore.error);
      const currentIgnoreError = compareExpectedDigest(
        plan.expected_gitignore_digest,
        currentIgnore.snapshot.digest,
        "stale_gitignore",
      );
      if (currentIgnoreError) return rejected(currentIgnoreError);
      if (currentIgnore.snapshot.coversRegistry) return rejected("ignore_changed");
      await appendNarrowIgnoreRule(
        ignorePath,
        currentIgnore.snapshot.source,
        currentIgnore.snapshot.bytes,
        state.atomicReplace,
      );
      ignoreChanged = true;
      await hit(state, "after_ignore_update");
    }

    // The ignore check is deliberately repeated immediately before a missing
    // registry can cause the .atl directory to be created.
    const verifiedIgnore = await readIgnoreFile(ignorePath);
    if ("error" in verifiedIgnore || !verifiedIgnore.snapshot.coversRegistry) {
      return rejected("error" in verifiedIgnore ? verifiedIgnore.error : "gitignore_unavailable");
    }

    await assertContainedTarget(root, registryPath);
    await ensureRegistryDirectory(root, registryDirectory);

    if (existingRegistry.bytes && Buffer.compare(existingRegistry.bytes, Buffer.from(candidate.document)) === 0) {
      return {
        outcome: "unchanged",
        registry_digest: candidate.digest,
        gitignore_changed: ignoreChanged,
        diagnostics: [],
      };
    }

    await hit(state, "before_temp_write");
    tempPath = await writePrivateTemporaryFile(registryDirectory, candidate.document);
    await hit(state, "after_temp_write");

    await hit(state, "before_fsync");
    await fsyncFile(tempPath);
    await hit(state, "after_fsync");

    await hit(state, "before_reparse");
    const reparsed = await independentlyValidateTemporaryFile(tempPath, candidate);
    if ("error" in reparsed) return rejected(reparsed.error);
    await hit(state, "after_reparse");

    // Compare-and-swap and containment are repeated after all candidate I/O.
    await assertContainedTarget(root, registryPath);
    const latestRegistry = await readRegularFile(registryPath, "registry");
    const latestRegistryError = compareExpectedDigest(
      plan.expected_registry_digest,
      latestRegistry.digest,
      "stale_registry",
    );
    if (latestRegistryError) return rejected(latestRegistryError);
    const latestIgnore = await readIgnoreFile(ignorePath);
    if ("error" in latestIgnore || !latestIgnore.snapshot.coversRegistry) {
      return rejected("error" in latestIgnore ? latestIgnore.error : "gitignore_unavailable");
    }

    replacement = await prepareReplacement(
      registryDirectory,
      registryPath,
      latestRegistry,
      candidate.digest,
      "registry",
    );

    await hit(state, "before_replace");
    try {
      await state.atomicReplace.replace(tempPath, registryPath);
    } catch {
      throw new PersistenceError("atomic_replace_failed");
    }
    replacement.replaced = true;
    tempPath = undefined;
    await hit(state, "after_replace");

    await hit(state, "before_directory_sync");
    try {
      await state.atomicReplace.syncDirectory(registryDirectory);
    } catch {
      throw new PersistenceError("directory_sync_failed");
    }
    await hit(state, "after_directory_sync");

    await removeOwnedFile(replacement.backupPath);
    replacement = undefined;
    return {
      outcome: "committed",
      registry_digest: candidate.digest,
      gitignore_changed: ignoreChanged,
      diagnostics: [],
    };
  } catch (error) {
    // A port is allowed to throw after replacing. Detect the candidate bytes
    // before deciding whether the old file must be restored.
    if (replacement && !replacement.replaced) {
      replacement.replaced = await targetDiffersFromDigest(replacement.targetPath, replacement.oldDigest, replacement.targetLabel);
    }
    const primaryReason = errorReason(error);
    if (replacement?.replaced) {
      try {
        await restorePriorRegistry(replacement, state.atomicReplace);
      } catch (restoreError) {
        await removeOwnedFile(tempPath);
        await removeOwnedFile(replacement.backupPath);
        return rejected("recovery_required", [
          ...(error instanceof PersistenceError ? error.relatedReasons : []),
          primaryReason,
          errorReason(restoreError),
        ]);
      }
    }
    await removeOwnedFile(tempPath);
    await removeOwnedFile(replacement?.backupPath);
    return rejected(primaryReason, error instanceof PersistenceError ? error.relatedReasons : []);
  } finally {
    await removeOwnedFile(tempPath);
    await removeOwnedFile(replacement?.backupPath);
  }
}

function validatePlan(
  plan: SkillRegistryWritePlanV1,
  authority: AuthorityStateV1,
): string | undefined {
  if (!isRecord(plan) || plan.schema !== "skill-registry-write-plan-v1") return "plan_invalid";
  if (!isWriteAction(plan.action)) return "plan_invalid";
  if (!isSafeRunnerId(plan.active_runner_id)) return "plan_invalid";
  if (!isDigest(plan.project_root_digest)) return "plan_invalid";
  if (!isTargetTuple(plan.allowed_targets)) return "plan_invalid";
  if (!isDigestOrMissing(plan.expected_registry_digest)) return "plan_invalid";
  if (!isDigest(plan.candidate_digest) || typeof plan.candidate_document !== "string") return "plan_invalid";

  if (plan.project_root_digest !== authority.projectRootDigest) return "wrong_project";
  if (plan.action !== authority.action) return "wrong_action";
  if (plan.active_runner_id !== authority.activeRunnerId) return "wrong_runner";
  if (!sameTargets(plan.allowed_targets, authority.allowedTargets)) return "wrong_target";

  const includesIgnore = targetsInclude(plan.allowed_targets, GITIGNORE_TARGET);
  if (includesIgnore !== (plan.expected_gitignore_digest !== undefined)) return "wrong_target";
  if (plan.expected_gitignore_digest !== undefined && !isDigestOrMissing(plan.expected_gitignore_digest)) {
    return "plan_invalid";
  }
  return undefined;
}

function validateCandidate(
  plan: SkillRegistryWritePlanV1,
): { candidate: CandidateV1 } | { error: string } {
  if (Buffer.byteLength(plan.candidate_document, "utf8") > SKILL_DISCOVERY_V1_BOUNDS.maxFileBytes) {
    return { error: "candidate_invalid" };
  }
  const computedDigest = computeSkillRegistryPersistenceDigest(plan.candidate_document);
  if (computedDigest !== plan.candidate_digest) return { error: "candidate_digest_mismatch" };

  const parsed = parseSkillRegistryDocument(plan.candidate_document);
  if (!parsed.ok || !parsed.frontmatter) return { error: "candidate_invalid" };
  if (parsed.frontmatter.completeness !== "complete") return { error: "candidate_partial" };
  return { candidate: { document: plan.candidate_document, digest: computedDigest } };
}

function takeAuthority(
  authority: SkillRegistryWriteAuthorityV1,
): { state: AuthorityStateV1 } | { error: string } {
  if (!authority || (typeof authority !== "object" && typeof authority !== "function")) {
    return { error: "authority_invalid" };
  }
  const state = AUTHORITY_STATES.get(authority as object);
  if (!state) return { error: "authority_invalid" };
  if (state.used) return { error: "authority_replayed" };
  state.used = true;
  return { state };
}

async function resolveProjectRoot(
  configuredRoot: string,
  authorityRoot: string,
): Promise<string> {
  const resolvedConfigured = await fs.realpath(configuredRoot);
  const resolvedAuthority = await fs.realpath(authorityRoot);
  if (resolvedConfigured !== resolvedAuthority) throw new PersistenceError("path_containment");
  const stats = await fs.stat(resolvedConfigured);
  if (!stats.isDirectory()) throw new PersistenceError("path_containment");
  return resolvedConfigured;
}

function containedPath(root: string, relativePath: string): string {
  const target = path.resolve(root, relativePath);
  if (!isWithinRoot(root, target)) throw new PersistenceError("path_containment");
  return target;
}

async function assertContainedTarget(root: string, targetPath: string): Promise<void> {
  if (!isWithinRoot(root, targetPath)) throw new PersistenceError("path_containment");
  const parent = path.dirname(targetPath);
  const existingParent = await existingRealPath(parent);
  if (existingParent && !isWithinRoot(root, existingParent)) {
    throw new PersistenceError("path_containment");
  }
  const entry = await lstatOrMissing(targetPath);
  if (entry?.isSymbolicLink()) throw new PersistenceError("path_containment");
  if (entry && !entry.isFile()) throw new PersistenceError("path_containment");
}

async function ensureRegistryDirectory(root: string, directoryPath: string): Promise<void> {
  if (!isWithinRoot(root, directoryPath)) throw new PersistenceError("path_containment");
  await fs.mkdir(directoryPath, { recursive: true });
  const actual = await fs.realpath(directoryPath);
  if (!isWithinRoot(root, actual)) throw new PersistenceError("path_containment");
}

async function readRegularFile(
  filePath: string,
  label: "registry" | "gitignore",
): Promise<FileSnapshotV1> {
  const entry = await lstatOrMissing(filePath);
  if (!entry) return { exists: false, digest: "missing" };
  if (entry.isSymbolicLink() || !entry.isFile()) {
    throw new PersistenceError(label === "gitignore" ? "gitignore_unavailable" : "path_containment");
  }
  let bytes: Buffer;
  try {
    bytes = await fs.readFile(filePath);
  } catch {
    throw new PersistenceError(label === "gitignore" ? "gitignore_unavailable" : "registry_unreadable");
  }
  return {
    exists: true,
    bytes,
    digest: computeSkillRegistryPersistenceDigest(bytes),
  };
}

async function readIgnoreFile(
  ignorePath: string,
): Promise<{ snapshot: IgnoreSnapshotV1 } | { error: string }> {
  let entry: import("node:fs").Stats | undefined;
  try {
    entry = await lstatOrMissing(ignorePath);
  } catch {
    return { error: "gitignore_unavailable" };
  }
  if (!entry || entry.isSymbolicLink() || !entry.isFile()) return { error: "gitignore_unavailable" };
  let bytes: Buffer;
  try {
    bytes = await fs.readFile(ignorePath);
  } catch {
    return { error: "gitignore_unavailable" };
  }
  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return { error: "gitignore_unavailable" };
  }
  return {
    snapshot: {
      bytes,
      source,
      digest: computeSkillRegistryPersistenceDigest(bytes),
      coversRegistry: ignoreRulesCoverRegistry(source),
    },
  };
}

async function appendNarrowIgnoreRule(
  ignorePath: string,
  source: string,
  oldBytes: Buffer,
  atomicReplace: AtomicReplacePortV1,
): Promise<void> {
  const suffix = source.length === 0 || source.endsWith("\n") || source.endsWith("\r") ? "" : "\n";
  const candidateSource = `${source}${suffix}${NARROW_IGNORE_RULE}\n`;
  const replacement = await prepareReplacement(
    path.dirname(ignorePath),
    ignorePath,
    {
      exists: true,
      bytes: oldBytes,
      digest: computeSkillRegistryPersistenceDigest(oldBytes),
    },
    computeSkillRegistryPersistenceDigest(candidateSource),
    "gitignore",
  );
  let tempPath: string | undefined;

  try {
    tempPath = await writePrivateTemporaryFile(path.dirname(ignorePath), candidateSource, "gitignore");
    await fsyncFile(tempPath);
    try {
      await atomicReplace.replace(tempPath, ignorePath);
    } catch {
      throw new PersistenceError("gitignore_replace_failed");
    }
    replacement.replaced = true;
    tempPath = undefined;

    try {
      await atomicReplace.syncDirectory(path.dirname(ignorePath));
    } catch {
      throw new PersistenceError("gitignore_directory_sync_failed");
    }

    await removeOwnedFile(replacement.backupPath);
  } catch (error) {
    if (!replacement.replaced) {
      replacement.replaced = await targetDiffersFromDigest(
        replacement.targetPath,
        replacement.oldDigest,
        replacement.targetLabel,
      );
    }
    if (replacement.replaced) {
      try {
        await restorePriorRegistry(replacement, atomicReplace);
      } catch (restoreError) {
        throw new PersistenceError("recovery_required", [
          errorReason(error),
          errorReason(restoreError),
        ]);
      }
    }
    throw error;
  } finally {
    await removeOwnedFile(tempPath);
    await removeOwnedFile(replacement.backupPath);
  }
}

function ignoreRulesCoverRegistry(source: string): boolean {
  let ignored = false;
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const negated = line.startsWith("!");
    const pattern = (negated ? line.slice(1) : line).trim();
    if (!pattern || pattern.startsWith("#")) continue;
    if (ignorePatternMatchesRegistry(pattern)) ignored = !negated;
  }
  return ignored;
}

function ignorePatternMatchesRegistry(pattern: string): boolean {
  const normalized = pattern.replaceAll("\\", "/");
  if (normalized === REGISTRY_TARGET || normalized === `/${REGISTRY_TARGET}`) return true;
  if (normalized === ".atl/" || normalized === "/.atl/" || normalized === ".atl" || normalized === "/.atl") return true;
  if (normalized === ".atl/*" || normalized === "/.atl/*" || normalized === ".atl/**" || normalized === "/.atl/**") return true;
  if (normalized === "**/skill-registry.md" || normalized === "skill-registry.md") return true;
  if (normalized === "*.md" || normalized === "**/*.md" || normalized === "*") return true;
  return false;
}

async function writePrivateTemporaryFile(
  directoryPath: string,
  source: string,
  targetLabel: ReplacementTargetLabelV1 = "registry",
): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const nonce = randomBytes(16).toString("hex");
    const targetName = targetLabel === "gitignore" ? ".gitignore" : ".skill-registry.md";
    const tempPath = path.join(directoryPath, `${targetName}.${nonce}.tmp`);
    try {
      const handle = await fs.open(tempPath, "wx", 0o600);
      try {
        await handle.writeFile(source, "utf8");
      } finally {
        await handle.close();
      }
      return tempPath;
    } catch (error) {
      await removeOwnedFile(tempPath);
      if (isAlreadyExistsError(error)) continue;
      throw new PersistenceError("temp_write_failed");
    }
  }
  throw new PersistenceError("temp_write_failed");
}

async function fsyncFile(filePath: string): Promise<void> {
  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(filePath, "r+");
    await handle.sync();
  } catch {
    throw new PersistenceError("fsync_failed");
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function independentlyValidateTemporaryFile(
  tempPath: string,
  candidate: CandidateV1,
): Promise<{ ok: true } | { error: string }> {
  let bytes: Buffer;
  try {
    bytes = await fs.readFile(tempPath);
  } catch {
    return { error: "temp_read_failed" };
  }
  if (computeSkillRegistryPersistenceDigest(bytes) !== candidate.digest) return { error: "candidate_digest_mismatch" };
  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return { error: "candidate_invalid" };
  }
  const parsed = parseSkillRegistryDocument(source);
  if (!parsed.ok || !parsed.frontmatter) return { error: "candidate_invalid" };
  if (parsed.frontmatter.completeness !== "complete") return { error: "candidate_partial" };
  return { ok: true };
}

async function prepareReplacement(
  directoryPath: string,
  targetPath: string,
  existingTarget: FileSnapshotV1,
  candidateDigest: SkillDiscoveryDigestV1,
  targetLabel: ReplacementTargetLabelV1,
): Promise<ReplacementStateV1> {
  let backupPath: string | undefined;
  if (existingTarget.bytes !== undefined) {
    const targetName = targetLabel === "gitignore" ? ".gitignore" : ".skill-registry.md";
    backupPath = path.join(directoryPath, `${targetName}.backup-${randomBytes(16).toString("hex")}.tmp`);
    try {
      const handle = await fs.open(backupPath, "wx", 0o600);
      try {
        await handle.writeFile(existingTarget.bytes);
        await handle.sync();
      } finally {
        await handle.close();
      }
    } catch {
      await removeOwnedFile(backupPath);
      throw new PersistenceError("backup_failed");
    }
  }
  return {
    targetPath,
    directoryPath,
    targetLabel,
    oldBytes: existingTarget.bytes,
    oldDigest: existingTarget.digest,
    candidateDigest,
    backupPath,
    replaced: false,
  };
}

async function restorePriorRegistry(
  replacement: ReplacementStateV1,
  atomicReplace: AtomicReplacePortV1,
): Promise<void> {
  try {
    if (replacement.oldBytes !== undefined && replacement.backupPath) {
      await atomicReplace.replace(replacement.backupPath, replacement.targetPath);
    } else {
      const current = await readRegularFile(replacement.targetPath, replacement.targetLabel);
      if (current.digest !== replacement.oldDigest) {
        // This path restores an originally absent target only after a successful
        // replacement. It is never used before the atomic replacement attempt.
        await fs.rm(replacement.targetPath, { force: true });
      }
    }
    const restored = await readRegularFile(replacement.targetPath, replacement.targetLabel);
    if (restored.digest !== replacement.oldDigest) throw new PersistenceError("restore_failed");
    replacement.replaced = false;
  } catch {
    throw new PersistenceError("restore_failed");
  }
}

async function targetDiffersFromDigest(
  targetPath: string,
  expected: SkillDiscoveryDigestV1 | "missing",
  targetLabel: ReplacementTargetLabelV1,
): Promise<boolean> {
  try {
    const snapshot = await readRegularFile(targetPath, targetLabel);
    return snapshot.digest !== expected;
  } catch {
    return true;
  }
}

async function removeOwnedFile(filePath: string | undefined): Promise<void> {
  if (!filePath || !path.basename(filePath).match(/^(?:\.skill-registry\.md|\.gitignore)\.(?:backup-)?[a-f0-9]+\.tmp$/)) return;
  await fs.rm(filePath, { force: true }).catch(() => undefined);
}

function compareExpectedDigest(
  expected: SkillDiscoveryDigestV1 | "missing" | undefined,
  actual: SkillDiscoveryDigestV1 | "missing",
  reason: string,
): string | undefined {
  if (expected === undefined) return undefined;
  return expected === actual ? undefined : reason;
}

async function hit(state: WriterStateV1, stage: SkillRegistryWriteFailpointV1): Promise<void> {
  await state.failpoint?.(stage);
}

function rejected(reason: string, relatedReasons: readonly string[] = []): {
  outcome: "rejected";
  reason_code: string;
  diagnostics: readonly SkillDiscoveryDiagnosticV1[];
} {
  const diagnosticReasons = [...new Set([reason, ...relatedReasons])];
  return {
    outcome: REJECTED_OUTCOME,
    reason_code: reason,
    diagnostics: diagnosticReasons.map((code) => ({ code, message: safeReasonMessage(code) })),
  };
}

function safeReasonMessage(reason: string): string {
  const messages: Record<string, string> = {
    authority_invalid: "Write authority is invalid.",
    authority_replayed: "Write authority has already been used.",
    candidate_invalid: "Candidate registry failed schema validation.",
    candidate_partial: "Candidate registry is not complete.",
    candidate_digest_mismatch: "Candidate registry digest does not match its bytes.",
    recovery_required: "Persistence failed and restoring the prior bytes also failed; manual recovery is required.",
    restore_failed: "Restoring the prior persisted bytes failed.",
    gitignore_replace_failed: "The authorized Git-ignore replacement failed.",
    gitignore_directory_sync_failed: "The Git-ignore directory could not be synchronized.",
    atomic_replace_failed: "The authorized registry replacement failed.",
    directory_sync_failed: "The registry directory could not be synchronized.",
    gitignore_unavailable: "Git-ignore coverage could not be established.",
    gitignore_unauthorized: "Git-ignore coverage requires an exact authorized target.",
    path_containment: "A write target escaped the project root.",
    tracked_registry: "Tracked registry files are not replaced.",
  };
  return messages[reason] ?? "Authorized registry persistence failed.";
}

function errorReason(error: unknown): string {
  if (error instanceof PersistenceError) return error.reason;
  if (error instanceof Error && error.message.startsWith("injected ")) return "injected_failure";
  return "persistence_failed";
}

class PersistenceError extends Error {
  constructor(readonly reason: string, readonly relatedReasons: readonly string[] = []) {
    super(reason);
    this.name = "PersistenceError";
  }
}

async function lstatOrMissing(filePath: string): Promise<import("node:fs").Stats | undefined> {
  try {
    return await fs.lstat(filePath);
  } catch (error) {
    if (isMissingError(error)) return undefined;
    throw error;
  }
}

async function existingRealPath(filePath: string): Promise<string | undefined> {
  try {
    return await fs.realpath(filePath);
  } catch (error) {
    if (isMissingError(error)) return undefined;
    throw new PersistenceError("path_containment");
  }
}

async function isTrackedByGit(projectRoot: string, registryPath: string): Promise<boolean> {
  let gitMetadata: import("node:fs").Stats | undefined;
  try {
    gitMetadata = await lstatOrMissing(path.join(projectRoot, ".git"));
  } catch {
    throw new PersistenceError("git_status_unavailable");
  }
  if (!gitMetadata) return false;
  const relativePath = path.relative(projectRoot, registryPath).split(path.sep).join("/");
  try {
    await execFile("git", ["-C", projectRoot, "ls-files", "--error-unmatch", "--", relativePath], {
      maxBuffer: 16 * 1024,
    });
    return true;
  } catch (error) {
    if (isGitUntrackedExit(error)) return false;
    throw new PersistenceError("git_status_unavailable");
  }
}

function isAuthorityMintInput(value: unknown): value is SkillRegistryWriteAuthorityMintInputV1 {
  if (!isRecord(value)) return false;
  return (
    typeof value.projectRoot === "string" && path.isAbsolute(value.projectRoot) &&
    isDigest(value.projectRootDigest) &&
    isWriteAction(value.action) &&
    isSafeRunnerId(value.activeRunnerId) &&
    isTargetTuple(value.allowedTargets)
  );
}

function isWriteAction(value: unknown): value is SkillRegistryWriteActionV1 {
  return value === "initial_generation" || value === "migration" || value === "regeneration";
}

function isSafeRunnerId(value: unknown): value is RunnerId {
  return typeof value === "string" && SAFE_RUNNER_ID.test(value);
}

function isDigest(value: unknown): value is SkillDiscoveryDigestV1 {
  return typeof value === "string" && DIGEST_PATTERN.test(value);
}

function isDigestOrMissing(value: unknown): value is SkillDiscoveryDigestV1 | "missing" {
  return value === "missing" || isDigest(value);
}

function isTargetTuple(value: unknown): value is SkillRegistryWriteTargetsV1 {
  return (
    Array.isArray(value) &&
    (value.length === 1 && value[0] === REGISTRY_TARGET ||
      value.length === 2 && value[0] === GITIGNORE_TARGET && value[1] === REGISTRY_TARGET)
  );
}

function targetsInclude(
  targets: SkillRegistryWriteTargetsV1,
  target: typeof REGISTRY_TARGET | typeof GITIGNORE_TARGET,
): boolean {
  return (targets as readonly string[]).includes(target);
}

function sameTargets(a: SkillRegistryWriteTargetsV1, b: SkillRegistryWriteTargetsV1): boolean {
  return a.length === b.length && a.every((target, index) => target === b[index]);
}

function copyTargets(targets: SkillRegistryWriteTargetsV1): SkillRegistryWriteTargetsV1 {
  return (targets.length === 1 ? [REGISTRY_TARGET] : [GITIGNORE_TARGET, REGISTRY_TARGET]) as SkillRegistryWriteTargetsV1;
}

function requireAbsolutePath(value: unknown, label: string): string {
  if (typeof value !== "string" || !path.isAbsolute(value)) throw new TypeError(`Invalid ${label}.`);
  return path.resolve(value);
}

function isWithinRoot(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isMissingError(error: unknown): boolean {
  return isNodeError(error) && error.code === "ENOENT";
}

function isAlreadyExistsError(error: unknown): boolean {
  return isNodeError(error) && error.code === "EEXIST";
}

function isGitUntrackedExit(error: unknown): boolean {
  return isNodeError(error) && String(error.code) === "1";
}

function isUnsupportedDirectorySyncError(error: unknown): boolean {
  return isNodeError(error) && ["EINVAL", "ENOTSUP", "EOPNOTSUPP", "EPERM"].includes(error.code ?? "");
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
