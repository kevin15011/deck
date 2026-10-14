/** Read-only, bounded artifact access beneath a session's trusted project root. */
import { closeSync, constants, fstatSync, lstatSync, openSync, opendirSync, readSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import type { CommandOutcome } from "./protocol";

export type OpenSpecArtifactSummary = { path: string; sizeBytes: number; updatedAt: string };
export type OpenSpecArtifactCatalog = {
  boundChangeId?: string;
  changes: Array<{ changeId: string; artifacts: OpenSpecArtifactSummary[] }>;
};
export type OpenSpecArtifactDocument = { changeId: string; path: string; markdown: string; updatedAt: string };
type Scope = { projectRoot: string; changeId?: string };
const MAX_BYTES = 1024 * 1024;
const MAX_ENTRIES = 500;
const MAX_DEPTH = 8;
const MESSAGES = {
  "openspec-invalid": "Invalid OpenSpec artifact selection.",
  "openspec-forbidden": "OpenSpec artifact access is not allowed.",
  "openspec-not-found": "The OpenSpec artifact is no longer available.",
  "openspec-too-large": "The OpenSpec artifact exceeds the 1 MiB limit.",
  "openspec-limit": "The OpenSpec artifact catalog exceeds the entry limit.",
  "openspec-unavailable": "OpenSpec artifacts are unavailable.",
} as const;
type FailureCode = keyof typeof MESSAGES;
class ArtifactError extends Error {
  constructor(readonly code: FailureCode) { super(MESSAGES[code]); }
}
function failure(error: unknown): CommandOutcome {
  const fsCode = (error as NodeJS.ErrnoException)?.code;
  const code = error instanceof ArtifactError ? error.code
    : fsCode === "ENOENT" || fsCode === "ENOTDIR" ? "openspec-not-found"
    : fsCode === "EACCES" || fsCode === "EPERM" || fsCode === "ELOOP" ? "openspec-forbidden"
    : "openspec-unavailable";
  return { ok: false, code, message: MESSAGES[code] };
}
function safeSegment(value: string): boolean {
  return value.length > 0 && !value.startsWith(".") && !/[\\/%\0]/.test(value);
}
function validChange(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)
    && !value.includes("..") && value.toLowerCase() !== "archive";
}
function validateSelection(scope: Scope, changeId: unknown, path: unknown): asserts changeId is string {
  if (!validChange(changeId) || typeof path !== "string" || path.length > 1024
    || !path.endsWith(".md") || path.split("/").length > MAX_DEPTH || !path.split("/").every(safeSegment)) {
    throw new ArtifactError("openspec-invalid");
  }
  if (scope.changeId !== undefined && changeId !== scope.changeId) throw new ArtifactError("openspec-forbidden");
}
/** Check every component separately; realpath alone would silently follow links. */
function directory(path: string): string {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) throw new ArtifactError("openspec-forbidden");
  if (!stat.isDirectory()) throw new ArtifactError("openspec-not-found");
  if (realpathSync(path) !== path) throw new ArtifactError("openspec-forbidden");
  return path;
}
function changesRoot(scope: Scope): string {
  const root = directory(resolve(scope.projectRoot));
  return directory(join(directory(join(root, "openspec")), "changes"));
}
function artifactDirectory(scope: Scope, changeId: string, parts: string[]): string {
  let path = directory(join(changesRoot(scope), changeId));
  for (const part of parts) path = directory(join(path, part));
  return path;
}

export function listOpenSpecArtifacts(scope: Scope): CommandOutcome {
  const data: OpenSpecArtifactCatalog = { ...(scope.changeId !== undefined ? { boundChangeId: scope.changeId } : {}), changes: [] };
  try {
    if (scope.changeId !== undefined && !validChange(scope.changeId)) throw new ArtifactError("openspec-invalid");
    const root = changesRoot(scope);
    let entries = 0;
    const visit = (path: string, callback: (name: string) => void) => {
      const dir = opendirSync(directory(path));
      try {
        for (let entry = dir.readSync(); entry !== null; entry = dir.readSync()) {
          if (++entries > MAX_ENTRIES) throw new ArtifactError("openspec-limit");
          callback(entry.name);
        }
      } finally { dir.closeSync(); }
    };
    const catalogChange = (changeId: string) => {
      const path = join(root, changeId), stat = lstatSync(path);
      if (stat.isSymbolicLink() || !stat.isDirectory()) return;
      const artifacts: OpenSpecArtifactSummary[] = [];
      const walk = (dir: string, prefix: string[], depth: number) => {
        visit(dir, (name) => {
          if (!safeSegment(name)) return;
          const full = join(dir, name), stat = lstatSync(full);
          if (stat.isSymbolicLink()) return;
          if (stat.isDirectory()) {
            if (depth + 1 < MAX_DEPTH) walk(full, [...prefix, name], depth + 1);
          } else if (stat.isFile() && name.endsWith(".md")) {
            artifacts.push({ path: [...prefix, name].join("/"), sizeBytes: stat.size, updatedAt: stat.mtime.toISOString() });
          }
        });
      };
      walk(directory(path), [], 0);
      artifacts.sort((a, b) => a.path.localeCompare(b.path));
      data.changes.push({ changeId, artifacts });
    };
    if (scope.changeId !== undefined) catalogChange(scope.changeId);
    else visit(root, (name) => { if (validChange(name)) catalogChange(name); });
    data.changes.sort((a, b) => a.changeId.localeCompare(b.changeId));
    return { ok: true, data };
  } catch (error) {
    const result = failure(error);
    if (!result.ok && result.code === "openspec-not-found") return { ok: true, data: { ...data, changes: [] } };
    return result;
  }
}

export function readOpenSpecArtifact(scope: Scope, changeId: unknown, path: unknown): CommandOutcome {
  let fd: number | undefined;
  try {
    validateSelection(scope, changeId, path);
    const relativePath = path as string, parts = relativePath.split("/"), file = parts.pop()!;
    const parent = artifactDirectory(scope, changeId, parts), full = join(parent, file);
    const before = lstatSync(full);
    if (before.isSymbolicLink()) throw new ArtifactError("openspec-forbidden");
    if (!before.isFile()) throw new ArtifactError("openspec-not-found");
    fd = openSync(full, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const opened = fstatSync(fd);
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino) throw new ArtifactError("openspec-forbidden");
    if (opened.size > MAX_BYTES) throw new ArtifactError("openspec-too-large");
    // Recheck containment after opening. O_NOFOLLOW protects the leaf; component checks
    // reject existing ancestor links, without promising an atomic filesystem sandbox.
    artifactDirectory(scope, changeId, parts);
    if (realpathSync(full) !== full) throw new ArtifactError("openspec-forbidden");
    const buffer = Buffer.alloc(MAX_BYTES + 1);
    let size = 0, read = 0;
    while (size < buffer.length && (read = readSync(fd, buffer, size, buffer.length - size, null)) > 0) size += read;
    if (size > MAX_BYTES) throw new ArtifactError("openspec-too-large");
    const data: OpenSpecArtifactDocument = {
      changeId, path: relativePath, markdown: buffer.subarray(0, size).toString("utf8"), updatedAt: fstatSync(fd).mtime.toISOString(),
    };
    return { ok: true, data };
  } catch (error) { return failure(error); }
  finally { if (fd !== undefined) closeSync(fd); }
}
