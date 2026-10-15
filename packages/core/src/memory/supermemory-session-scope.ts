import { spawnSync } from "node:child_process";
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync, type Stats } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import {
  resolveCanonicalSupermemoryProjectScope,
  resolveVerifiedGitSharedProjectBase,
  type CanonicalSupermemoryProjectScope,
  type SupermemoryProjectScopeDiagnostic,
} from "./canonical-supermemory-project";

export type SupermemorySessionScopeResult =
  | Readonly<{ kind: "canonical"; projectScope: CanonicalSupermemoryProjectScope; diagnostics: readonly SupermemoryProjectScopeDiagnostic[] }>
  | Readonly<{ kind: "global"; diagnostics: readonly SupermemoryProjectScopeDiagnostic[] }>
  | Readonly<{ kind: "invalid"; diagnostics: readonly SupermemoryProjectScopeDiagnostic[] }>;

/** Global scope requires proven absence of identity; an invalid identity never falls back. */
export function resolveSupermemorySessionScope(
  input: Parameters<typeof resolveCanonicalSupermemoryProjectScope>[0],
): SupermemorySessionScopeResult {
  try {
    if (!input.projectRoot.trim() || input.projectRoot.includes("\0")) return invalidScope();
    // Canonical identity retains the established resolver contract. Stronger metadata
    // inspection below authorizes only the new identity-absent global fallback.
    const canonical = resolveCanonicalSupermemoryProjectScope(input);
    if (canonical.ok) return { kind: "canonical", projectScope: canonical.scope, diagnostics: canonical.diagnostics };
    let cursor = realpathSync(input.projectRoot.trim());
    if (!lstatSync(cursor).isDirectory()) return invalidScope();
    while (true) {
      const marker = join(cursor, ".git");
      const stat = statIfPresent(marker);
      if (stat) {
        if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) return invalidScope();
        // Preserve canonical resolver's symlink and linked-worktree validation policies.
        if (!resolveVerifiedGitSharedProjectBase(input.projectRoot)) return invalidScope();
        const pointer = stat.isFile() ? readSafeText(marker, 1024)?.match(/^gitdir:\s*(.+?)\s*$/i)?.[1] : undefined;
        if (stat.isFile() && !pointer) return invalidScope();
        const gitDir = pointer ? resolve(cursor, pointer) : marker;
        const commonPointerPath = join(gitDir, "commondir");
        const commonPointer = statIfPresent(commonPointerPath) ? readSafeText(commonPointerPath, 1024)?.trim() : undefined;
        if (statIfPresent(commonPointerPath) && (!commonPointer || isAbsolute(commonPointer))) return invalidScope();
        const commonDir = commonPointer ? resolve(gitDir, commonPointer) : gitDir;
        const configPaths = [join(commonDir, "config")];
        if (gitDir !== commonDir && statIfPresent(join(gitDir, "config"))) configPaths.push(join(gitDir, "config"));
        const entries: [string, string][] = [];
        let originSectionDeclared = false;
        for (const configPath of configPaths) {
          const snapshot = readSafeText(configPath, 256 * 1024);
          if (snapshot === undefined) return invalidScope();
          originSectionDeclared ||= /\[remote(?:\s+"origin"|\.origin)\]/i.test(snapshot);
          const parsed = parseGitConfigSnapshot(snapshot);
          if (!parsed) return invalidScope();
          entries.push(...parsed);
        }
        // Includes and alternate worktree config make absence of an origin unproven.
        if (entries.some(([key]) => /^(?:include|includeif)\./i.test(key) || /^extensions\.worktreeconfig$/i.test(key))) return invalidScope();
        const origins = entries.filter(([key]) => key === "remote.origin.url");
        const originDeclared = entries.some(([key]) => key.startsWith("remote.origin."));
        if (origins.length === 0) {
          // Empty origin sections produce no entries, but still express an unresolved identity.
          return originDeclared || originSectionDeclared ? invalidScope() : { kind: "global", diagnostics: [] };
        }
        if (origins.length !== 1 || !origins[0]![1].trim()) return invalidScope();
        const canonical = resolveCanonicalSupermemoryProjectScope(input);
        return canonical.ok
          ? { kind: "canonical", projectScope: canonical.scope, diagnostics: canonical.diagnostics }
          : { kind: "invalid", diagnostics: canonical.diagnostics };
      }
      const parent = dirname(cursor);
      if (parent === cursor) return { kind: "global", diagnostics: [] };
      cursor = parent;
    }
  } catch {
    return invalidScope();
  }
}

function invalidScope(): SupermemorySessionScopeResult {
  return {
    kind: "invalid",
    diagnostics: [{
      code: "SUPERMEMORY_PROJECT_GIT_ROOT_INVALID",
      severity: "error",
      message: "Git identity could not be safely verified; global Supermemory fallback is disabled for invalid identity metadata.",
    }],
  };
}

/** Only ENOENT proves absence; access failures must not look like missing Git. */
function statIfPresent(path: string): Stats | undefined {
  try { return lstatSync(path); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function readSafeText(path: string, limit: number): string | undefined {
  let fd: number | undefined;
  try {
    if (constants.O_NOFOLLOW === undefined || constants.O_NONBLOCK === undefined) return undefined;
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = fstatSync(fd);
    if (!stat.isFile() || (stat.mode & 0o444) === 0 || stat.size > limit) return undefined;
    const buffer = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < buffer.length) {
      const count = readSync(fd, buffer, offset, buffer.length - offset, offset);
      if (count === 0) return undefined;
      offset += count;
    }
    const after = fstatSync(fd);
    if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs) return undefined;
    const content = buffer.toString("utf8");
    if (!Buffer.from(content, "utf8").equals(buffer) || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(content)) return undefined;
    return content;
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function parseGitConfigSnapshot(snapshot: string): [string, string][] | undefined {
  // Let Git validate its own grammar without includes, ambient Git config, or reopening the file.
  const parsed = spawnSync("/usr/bin/git", ["config", "--file", "-", "--null", "--list", "--no-includes"], {
    cwd: "/",
    env: { PATH: "/usr/bin:/bin", LC_ALL: "C", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
    input: snapshot,
    encoding: "utf8",
    shell: false,
    timeout: 1000,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
  });
  if (parsed.error || parsed.status !== 0 || parsed.signal !== null) return undefined;
  const entries: [string, string][] = parsed.stdout.split("\0").filter(Boolean).map((entry) => {
    const separator = entry.indexOf("\n");
    return separator < 0 ? [entry, ""] : [entry.slice(0, separator), entry.slice(separator + 1)];
  });
  return entries.every(([key]) => key.includes(".")) ? entries : undefined;
}
