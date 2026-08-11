import {
  chmodSync,
  closeSync,
  constants,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeSync,
  type Stats,
} from "node:fs";
import { randomBytes } from "node:crypto";
import { basename, dirname, isAbsolute, resolve } from "node:path";

export const DECK_WEB_SEARCH_PROFILE_START = "# >>> Deck Web Search (Tavily) >>>";
export const DECK_WEB_SEARCH_PROFILE_END = "# <<< Deck Web Search (Tavily) <<<";

const MAX_CREDENTIAL_BYTES = 4096;
const PROFILE_FILE_BY_SHELL = Object.freeze({ bash: ".bashrc", zsh: ".zshrc" } as const);

export type ShellProfileDiagnosticCode =
  | "invalid-credential"
  | "invalid-home"
  | "unsupported-shell"
  | "profile-path-escape"
  | "profile-symlink-target"
  | "profile-unsafe-target"
  | "profile-ownership-refused"
  | "profile-read-failed"
  | "profile-marker-duplicate"
  | "profile-marker-malformed"
  | "profile-concurrent-change"
  | "profile-post-rename-rollback-conflict"
  | "profile-post-rename-rollback-failed"
  | "profile-write-failed";

export type ShellProfileWriteResult = Readonly<{
  ok: boolean;
  status: "created" | "updated" | "unchanged" | "refused" | "failed" | "manual-cleanup-required";
  credentialPresent: boolean;
  path?: string;
  /** Redacted status detail; never contains profile content or credentials. */
  message?: string;
  /** Redacted recovery instruction for an unresolved post-rename rollback. */
  guidance?: string;
  diagnosticCodes: readonly ShellProfileDiagnosticCode[];
}>;

type ShellProfileFileEffects = Readonly<{
  beforeRename?: (targetPath: string) => void;
  rename?: (sourcePath: string, targetPath: string) => void;
  /** Test seam that runs after the credential rename and before verification. */
  afterRename?: (targetPath: string) => void;
  /** Test seam for target ownership and safe-file inspection. */
  lstat?: (path: string) => Stats;
  /** Test seam for platforms that expose a POSIX effective user ID. */
  getEffectiveUserId?: () => number | undefined;
  /** Test-only deterministic observation of the generated same-directory temp path. */
  tempPath?: (generatedPath: string) => string;
}>;

export type ShellProfileWriterOptions = Readonly<{
  home?: string;
  shell?: string;
  /** Test seam. The path remains required to be the exact selected profile inside HOME. */
  profilePath?: string;
  effects?: ShellProfileFileEffects;
}>;

type TargetSnapshot = Readonly<{
  exists: boolean;
  mode?: number;
  dev?: number;
  ino?: number;
  size?: number;
  mtimeMs?: number;
  ctimeMs?: number;
}>;

type OwnedBlock =
  | Readonly<{ kind: "absent" }>
  | Readonly<{ kind: "present"; start: number; end: number }>
  | Readonly<{ kind: "duplicate" | "malformed" }>;

export type ShellProfileRollbackResult = Readonly<{
  ok: boolean;
  status: "restored" | "removed" | "unchanged" | "conflict" | "failed";
  diagnosticCodes: readonly ("profile-rollback-conflict" | "profile-rollback-failed")[];
}>;

/**
 * An opaque rollback capability. It deliberately exposes no profile bytes,
 * metadata, or credentials; those preimages remain captured in its closure.
 */
export type ShellProfileWriteTransaction = Readonly<{
  result: ShellProfileWriteResult;
  rollback: () => ShellProfileRollbackResult;
}>;

type ProfileImage = Readonly<{
  snapshot: TargetSnapshot;
  content: Buffer;
}>;

/**
 * Persist an explicitly entered Tavily key in the selected user's active shell
 * profile. The returned value intentionally contains only status, path, and
 * diagnostic codes; it never carries file content or the credential.
 */
export function writeTavilyCredentialToActiveShellProfile(
  credential: string,
  options: ShellProfileWriterOptions = {},
): ShellProfileWriteResult {
  return writeTavilyCredentialToActiveShellProfileTransaction(credential, options).result;
}

/**
 * Write the credential and retain a redaction-safe rollback capability for the
 * enclosing setup transaction. Callers cannot inspect the captured preimage.
 */
export function writeTavilyCredentialToActiveShellProfileTransaction(
  credential: string,
  options: ShellProfileWriterOptions = {},
): ShellProfileWriteTransaction {
  if (!isValidCredential(credential)) return noRollback(failure("refused", false, "invalid-credential"));

  const resolvedProfile = resolveProfilePath(options);
  if (!resolvedProfile.ok) return noRollback(failure("refused", false, resolvedProfile.code));
  const targetPath = resolvedProfile.path;

  let before: ProfileImage;
  try {
    const targetState = inspectTarget(targetPath, options.effects);
    if (targetState.kind !== "safe") {
      return noRollback(failure(
        "refused",
        false,
        targetState.kind === "symlink"
          ? "profile-symlink-target"
          : targetState.kind === "ownership"
            ? "profile-ownership-refused"
            : "profile-unsafe-target",
        targetPath,
      ));
    }
    const original = targetState.snapshot.exists ? readFileSync(targetPath) : Buffer.alloc(0);
    if (!sameSafeSnapshot(targetPath, targetState.snapshot, options.effects)) {
      return noRollback(failure("refused", false, "profile-concurrent-change", targetPath));
    }
    before = { snapshot: targetState.snapshot, content: original };
  } catch {
    return noRollback(failure("failed", false, "profile-read-failed", targetPath));
  }

  const block = locateOwnedBlock(before.content);
  if (block.kind !== "absent" && block.kind !== "present") {
    return noRollback(failure("refused", false, block.kind === "duplicate" ? "profile-marker-duplicate" : "profile-marker-malformed", targetPath));
  }

  const next = materializeProfile(before.content, block, credential);
  const desiredMode = 0o600;
  if (next.equals(before.content) && (before.snapshot.mode! & 0o777) === desiredMode) {
    return noRollback(success("unchanged", targetPath));
  }

  try {
    const afterSnapshot = atomicallyReplaceProfile(targetPath, next, desiredMode, before.snapshot, options.effects);
    options.effects?.afterRename?.(targetPath);
    const after = readSafeProfileImage(targetPath, options.effects);
    if (!after || !sameSnapshot(after.snapshot, afterSnapshot) || !after.content.equals(next)) {
      // A post-rename reinspection failure must not silently leave a reported
      // failure with a new credential. This rollback remains CAS-protected and
      // deliberately emits no preimage or credential information.
      const rollback = rollbackProfileMutation(targetPath, before, { snapshot: afterSnapshot, content: next }, options.effects);
      if (!rollback.ok) return noRollback(manualCleanupRequired(targetPath, rollback));
      return noRollback(failure("failed", false, "profile-write-failed", targetPath));
    }
    const result = success(before.snapshot.exists ? "updated" : "created", targetPath);
    return {
      result,
      rollback: () => rollbackProfileMutation(targetPath, before, after, options.effects),
    };
  } catch (error) {
    return noRollback(failure(
      error instanceof ProfileConcurrentChange ? "refused" : "failed",
      false,
      error instanceof ProfileConcurrentChange ? "profile-concurrent-change" : "profile-write-failed",
      targetPath,
    ));
  }
}

function isValidCredential(value: string): boolean {
  return typeof value === "string"
    && value.trim().length > 0
    && Buffer.byteLength(value, "utf8") <= MAX_CREDENTIAL_BYTES
    && !/[\u0000-\u001f\u007f-\u009f]/u.test(value);
}

function resolveProfilePath(options: ShellProfileWriterOptions):
  | Readonly<{ ok: true; path: string }>
  | Readonly<{ ok: false; code: "invalid-home" | "unsupported-shell" | "profile-path-escape" }> {
  const shell = options.shell ?? process.env.SHELL;
  if (typeof shell !== "string" || !isAbsolute(shell)) return { ok: false, code: "unsupported-shell" };
  const filename = PROFILE_FILE_BY_SHELL[basename(shell) as keyof typeof PROFILE_FILE_BY_SHELL];
  if (!filename) return { ok: false, code: "unsupported-shell" };

  const home = options.home ?? process.env.HOME;
  if (typeof home !== "string" || !isAbsolute(home) || /[\u0000-\u001f\u007f-\u009f]/u.test(home)) {
    return { ok: false, code: "invalid-home" };
  }

  let canonicalHome: string;
  try {
    canonicalHome = realpathSync(home);
    if (!lstatSync(canonicalHome).isDirectory()) return { ok: false, code: "invalid-home" };
  } catch {
    return { ok: false, code: "invalid-home" };
  }

  const expectedPath = resolve(canonicalHome, filename);
  const requestedPath = resolve(options.profilePath ?? expectedPath);
  if (requestedPath !== expectedPath || dirname(requestedPath) !== canonicalHome) {
    return { ok: false, code: "profile-path-escape" };
  }
  return { ok: true, path: expectedPath };
}

function inspectTarget(path: string, effects?: ShellProfileFileEffects):
  | Readonly<{ kind: "safe"; snapshot: TargetSnapshot }>
  | Readonly<{ kind: "symlink" | "unsafe" | "ownership" }> {
  try {
    const stat = (effects?.lstat ?? lstatSync)(path);
    if (stat.isSymbolicLink()) return { kind: "symlink" };
    if (!stat.isFile()) return { kind: "unsafe" };
    if (!isOwnedByCurrentEffectiveUser(stat, effects)) return { kind: "ownership" };
    return { kind: "safe", snapshot: snapshotFor(stat) };
  } catch (error) {
    if (isNotFound(error)) return { kind: "safe", snapshot: { exists: false } };
    throw error;
  }
}

function isOwnedByCurrentEffectiveUser(stat: Stats, effects?: ShellProfileFileEffects): boolean {
  const effectiveUserId = effects?.getEffectiveUserId ?? (typeof process.geteuid === "function" ? process.geteuid.bind(process) : undefined);
  // Windows does not expose POSIX ownership through process.geteuid(); when it
  // is unavailable, there is no ownership API to verify against.
  if (!effectiveUserId) return true;
  try {
    const current = effectiveUserId();
    return Number.isSafeInteger(current) && Number.isSafeInteger(stat.uid) && current === stat.uid;
  } catch {
    // A partially available ownership API is ambiguous and therefore unsafe.
    return false;
  }
}

function sameSafeSnapshot(path: string, snapshot: TargetSnapshot, effects?: ShellProfileFileEffects): boolean {
  const target = inspectTarget(path, effects);
  return target.kind === "safe" && sameSnapshot(snapshot, target.snapshot);
}

function readSafeProfileImage(path: string, effects?: ShellProfileFileEffects): ProfileImage | undefined {
  const target = inspectTarget(path, effects);
  if (target.kind !== "safe") return undefined;
  const content = target.snapshot.exists ? readFileSync(path) : Buffer.alloc(0);
  return sameSafeSnapshot(path, target.snapshot, effects) ? { snapshot: target.snapshot, content } : undefined;
}

function snapshotFor(stat: Stats): TargetSnapshot {
  return {
    exists: true,
    mode: stat.mode,
    dev: stat.dev,
    ino: stat.ino,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    ctimeMs: stat.ctimeMs,
  };
}

function sameSnapshot(left: TargetSnapshot, right: TargetSnapshot): boolean {
  return left.exists === right.exists
    && left.mode === right.mode
    && left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs;
}

function locateOwnedBlock(content: Buffer): OwnedBlock {
  const startMarker = Buffer.from(DECK_WEB_SEARCH_PROFILE_START, "utf8");
  const endMarker = Buffer.from(DECK_WEB_SEARCH_PROFILE_END, "utf8");
  const starts = allOccurrences(content, startMarker);
  const ends = allOccurrences(content, endMarker);
  const markersAreLines = [...starts.map((start) => [start, startMarker] as const), ...ends.map((end) => [end, endMarker] as const)]
    .every(([offset, marker]) => isExactLineMarker(content, offset, marker));

  if (starts.length === 0 && ends.length === 0) return { kind: "absent" };
  if (!markersAreLines) return { kind: "malformed" };
  if (starts.length > 1 || ends.length > 1) return { kind: "duplicate" };
  if (starts.length !== 1 || ends.length !== 1 || starts[0]! >= ends[0]!) return { kind: "malformed" };

  const bodyStart = lineEndAfter(content, starts[0]! + startMarker.length);
  const bodyEnd = startsAtLine(content, ends[0]!);
  const body = content.subarray(bodyStart, bodyEnd).toString("utf8");
  if (!/^export TAVILY_API_KEY=.+$/u.test(body) || /[\r\n]/u.test(body)) return { kind: "malformed" };

  return { kind: "present", start: starts[0]!, end: ends[0]! + endMarker.length };
}

function materializeProfile(content: Buffer, owned: Extract<OwnedBlock, { kind: "absent" | "present" }>, credential: string): Buffer {
  const newline = detectNewline(content);
  const block = Buffer.from([
    DECK_WEB_SEARCH_PROFILE_START,
    `export TAVILY_API_KEY=${quoteForPosixShell(credential)}`,
    DECK_WEB_SEARCH_PROFILE_END,
  ].join(newline), "utf8");

  if (owned.kind === "present") {
    return Buffer.concat([content.subarray(0, owned.start), block, content.subarray(owned.end)]);
  }

  if (content.length === 0) return Buffer.concat([block, Buffer.from(newline, "utf8")]);
  const separator = content.at(-1) === 0x0a ? Buffer.alloc(0) : Buffer.from(newline, "utf8");
  return Buffer.concat([content, separator, block, Buffer.from(newline, "utf8")]);
}

function quoteForPosixShell(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function detectNewline(content: Buffer): string {
  const firstLf = content.indexOf(0x0a);
  return firstLf > 0 && content[firstLf - 1] === 0x0d ? "\r\n" : "\n";
}

function allOccurrences(content: Buffer, needle: Buffer): number[] {
  const matches: number[] = [];
  for (let offset = content.indexOf(needle); offset !== -1; offset = content.indexOf(needle, offset + needle.length)) {
    matches.push(offset);
  }
  return matches;
}

function isExactLineMarker(content: Buffer, start: number, marker: Buffer): boolean {
  const beforeIsLineBoundary = start === 0 || content[start - 1] === 0x0a;
  const after = start + marker.length;
  const afterIsLineBoundary = after === content.length || content[after] === 0x0a || (content[after] === 0x0d && content[after + 1] === 0x0a);
  return beforeIsLineBoundary && afterIsLineBoundary;
}

function lineEndAfter(content: Buffer, offset: number): number {
  if (content[offset] === 0x0d && content[offset + 1] === 0x0a) return offset + 2;
  if (content[offset] === 0x0a) return offset + 1;
  return offset;
}

function startsAtLine(content: Buffer, offset: number): number {
  if (offset >= 2 && content[offset - 2] === 0x0d && content[offset - 1] === 0x0a) return offset - 2;
  if (offset >= 1 && content[offset - 1] === 0x0a) return offset - 1;
  return offset;
}

function createExclusiveTempPath(targetPath: string, override?: (generatedPath: string) => string): string {
  const generated = resolve(dirname(targetPath), `.deck-web-search-${process.pid}-${randomBytes(12).toString("hex")}.tmp`);
  const candidate = override ? override(generated) : generated;
  if (dirname(candidate) !== dirname(targetPath) || !basename(candidate).startsWith(".deck-web-search-")) {
    throw new Error("unsafe temporary path");
  }
  return candidate;
}

class ProfileConcurrentChange extends Error {}

/**
 * Atomically replace a profile after confirming the current safe target still
 * matches the caller's observed snapshot. The temporary is always owner-only;
 * callers explicitly choose the final mode for either a credential write or a
 * rollback to a preimage.
 */
function atomicallyReplaceProfile(
  targetPath: string,
  content: Buffer,
  mode: number,
  expectedSnapshot: TargetSnapshot,
  effects?: ShellProfileFileEffects,
): TargetSnapshot {
  let temporaryPath: string | undefined;
  let temporaryFd: number | undefined;
  try {
    temporaryPath = createExclusiveTempPath(targetPath, effects?.tempPath);
    temporaryFd = openSync(temporaryPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
    chmodSync(temporaryPath, mode & 0o777);
    writeFully(temporaryFd, content);
    fsyncSync(temporaryFd);
    closeSync(temporaryFd);
    temporaryFd = undefined;

    effects?.beforeRename?.(targetPath);
    if (!sameSafeSnapshot(targetPath, expectedSnapshot, effects)) throw new ProfileConcurrentChange();

    (effects?.rename ?? renameSync)(temporaryPath, targetPath);
    temporaryPath = undefined;

    const after = inspectTarget(targetPath, effects);
    if (after.kind !== "safe") throw new Error("profile target became unsafe");
    return after.snapshot;
  } finally {
    if (temporaryFd !== undefined) {
      try {
        closeSync(temporaryFd);
      } catch {
        // The only safe response is still to attempt removing the private temp.
      }
    }
    if (temporaryPath !== undefined) {
      try {
        unlinkSync(temporaryPath);
      } catch {
        // No credential or preimage bytes are ever exposed through cleanup diagnostics.
      }
    }
  }
}

function rollbackProfileMutation(
  targetPath: string,
  before: ProfileImage,
  after: ProfileImage,
  effects?: ShellProfileFileEffects,
): ShellProfileRollbackResult {
  try {
    if (!matchesProfileImage(targetPath, after, effects)) return rollbackFailure("conflict", "profile-rollback-conflict");

    if (!before.snapshot.exists) {
      // The postimage was created by this transaction. The pre-delete CAS check
      // refuses to delete a profile changed by another process.
      if (!matchesProfileImage(targetPath, after, effects)) return rollbackFailure("conflict", "profile-rollback-conflict");
      unlinkSync(targetPath);
      return { ok: true, status: "removed", diagnosticCodes: [] };
    }

    const restoredSnapshot = atomicallyReplaceProfile(
      targetPath,
      before.content,
      before.snapshot.mode! & 0o777,
      after.snapshot,
      effects,
    );
    const restored = readSafeProfileImage(targetPath, effects);
    if (!restored || !sameSnapshot(restored.snapshot, restoredSnapshot) || !restored.content.equals(before.content)) {
      return rollbackFailure("failed", "profile-rollback-failed");
    }
    return { ok: true, status: "restored", diagnosticCodes: [] };
  } catch (error) {
    return rollbackFailure(
      error instanceof ProfileConcurrentChange ? "conflict" : "failed",
      error instanceof ProfileConcurrentChange ? "profile-rollback-conflict" : "profile-rollback-failed",
    );
  }
}

function matchesProfileImage(path: string, expected: ProfileImage, effects?: ShellProfileFileEffects): boolean {
  const current = readSafeProfileImage(path, effects);
  return current !== undefined
    && sameSnapshot(current.snapshot, expected.snapshot)
    && current.content.equals(expected.content);
}

function noRollback(result: ShellProfileWriteResult): ShellProfileWriteTransaction {
  return {
    result,
    rollback: () => ({ ok: true, status: "unchanged", diagnosticCodes: [] }),
  };
}

function rollbackFailure(
  status: "conflict" | "failed",
  code: "profile-rollback-conflict" | "profile-rollback-failed",
): ShellProfileRollbackResult {
  return { ok: false, status, diagnosticCodes: [code] };
}

function writeFully(fileDescriptor: number, content: Buffer): void {
  let offset = 0;
  while (offset < content.length) {
    const written = writeSync(fileDescriptor, content, offset, content.length - offset);
    if (written <= 0) throw new Error("short write");
    offset += written;
  }
}

function success(status: "created" | "updated" | "unchanged", path: string): ShellProfileWriteResult {
  return { ok: true, status, credentialPresent: true, path, diagnosticCodes: [] };
}

function failure(
  status: "refused" | "failed",
  credentialPresent: boolean,
  code: ShellProfileDiagnosticCode,
  path?: string,
): ShellProfileWriteResult {
  return { ok: false, status, credentialPresent, ...(path ? { path } : {}), diagnosticCodes: [code] };
}

function manualCleanupRequired(
  path: string,
  rollback: ShellProfileRollbackResult,
): ShellProfileWriteResult {
  return {
    ok: false,
    status: "manual-cleanup-required",
    // The failed CAS means we cannot prove the credential was removed.
    credentialPresent: true,
    path,
    message: "Credential may remain because safe profile rollback could not be confirmed.",
    guidance: "Inspect the reported profile path and, if necessary, remove only the exact Deck-owned Web Search block before retrying.",
    diagnosticCodes: [
      rollback.status === "conflict"
        ? "profile-post-rename-rollback-conflict"
        : "profile-post-rename-rollback-failed",
    ],
  };
}

function isNotFound(error: unknown): boolean {
  return Boolean(error) && typeof error === "object" && (error as { code?: unknown }).code === "ENOENT";
}
