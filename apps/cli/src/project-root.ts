import { existsSync, readFileSync } from "node:fs";
import { join, dirname, parse as parsePath } from "node:path";

/**
 * Resolve project root with optional backward compatibility.
 *
 * @param startDirOrOptions - Directory to start searching from, or options object
 * @returns Project root, null, or fallback based on options
 */
export function resolveProjectRoot(startDirOrOptions?: string | { fallback?: string | null; require?: boolean }): string | null {
  const startDir = typeof startDirOrOptions === "string" ? startDirOrOptions : (typeof startDirOrOptions === "undefined" ? process.cwd() : undefined);
  const options = typeof startDirOrOptions === "object" ? startDirOrOptions : undefined;

  const root = startDir ? resolveProjectRootInternal(startDir) : resolveProjectRootInternal();
  if (root) return root;
  if (options?.require) return options.fallback ?? process.cwd();
  // When called with a string argument (no options), fall back to the start directory
  // rather than null, so callers that pass a path always get a usable directory.
  return startDir ?? options?.fallback ?? null;
}

/**
 * Internal implementation - actual monorepo detection.
 */
function resolveProjectRootInternal(startDir: string = process.cwd()): string | null {
  let current = startDir;
  const { root: fsRoot } = parsePath(current);

  while (true) {
    if (isDeckProjectRoot(current)) {
      return current;
    }

    const parent = dirname(current);
    if (parent === current || parent === fsRoot) {
      break;
    }
    current = parent;
  }

  if (isDeckProjectRoot(fsRoot)) {
    return fsRoot;
  }

  return null;
}

/**
 * @deprecated Use resolveProjectRoot() instead. This alias maintains backward compatibility.
 * @param startDir - Directory to start searching from
 * @returns Project root or startDir fallback (never null)
 */
export function resolveProjectRootWithFallback(startDir: string = process.cwd()): string {
  return resolveProjectRoot(startDir) ?? startDir;
}

function isDeckProjectRoot(dir: string): boolean {
  // Marker 1: package.json with workspaces
  const pkgPath = join(dir, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const raw = readFileSync(pkgPath, "utf-8");
      const pkg = JSON.parse(raw);
      if (pkg && typeof pkg === "object" && "workspaces" in pkg) {
        return true;
      }
    } catch {
      // Invalid JSON — skip
    }
  }

  // Marker 2: definition.md + apps/ + packages/
  if (
    existsSync(join(dir, "definition.md")) &&
    existsSync(join(dir, "apps")) &&
    existsSync(join(dir, "packages"))
  ) {
    return true;
  }

  return false;
}
