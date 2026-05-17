import { existsSync, readFileSync } from "node:fs";
import { join, dirname, parse as parsePath } from "node:path";

/**
 * Resolves the project root directory by walking up from `startDir`
 * looking for workspace markers characteristic of a Deck project.
 *
 * Markers checked (any ONE of these qualifies a directory as project root):
 * 1. `package.json` containing a `"workspaces"` field
 * 2. `definition.md` present alongside both `apps/` and `packages/` directories
 *
 * Falls back to `startDir` if no ancestor qualifies.
 */
export function resolveProjectRoot(startDir: string = process.cwd()): string {
  let current = startDir;
  const { root: fsRoot } = parsePath(current);

  while (true) {
    if (isDeckProjectRoot(current)) {
      return current;
    }

    const parent = dirname(current);
    if (parent === current || parent === fsRoot) {
      // Reached filesystem root without finding markers
      break;
    }
    current = parent;
  }

  // Check filesystem root as last resort
  if (isDeckProjectRoot(fsRoot)) {
    return fsRoot;
  }

  return startDir;
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
