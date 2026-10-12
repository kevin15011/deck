import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * D-1 / design section 2: @deck/session-host owns daemon mechanics and must not
 * import runner adapters, the CLI app, or TUI/web frameworks. Drivers reach the
 * host through @deck/core contracts only.
 */
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const repoRoot = resolve(packageRoot, "../..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "__tests__" ? [] : sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

const IMPORT_RE = /(?:import|export)\s[^"']*?from\s*["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)|import\s*["']([^"']+)["']|require\(\s*["']([^"']+)["']\s*\)/g;

function specifiers(file: string): string[] {
  const text = readFileSync(file, "utf8");
  return [...text.matchAll(IMPORT_RE)].map((m) => m[1] ?? m[2] ?? m[3] ?? m[4]!).filter(Boolean);
}

const FORBIDDEN_PACKAGE = /^(?:@deck\/(?!core(?:\/|$))[^/]+|ink|react|react-dom|react-devtools-core)(?:\/|$)/;

describe("session-host import boundary", () => {
  const files = sourceFiles(join(packageRoot, "src"));

  test("has production sources to audit", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  test("never imports adapters, the CLI app, TUI or UI frameworks", () => {
    const violations: string[] = [];
    for (const file of files) {
      for (const spec of specifiers(file)) {
        if (FORBIDDEN_PACKAGE.test(spec)) violations.push(`${relative(repoRoot, file)} -> ${spec}`);
        if (spec.startsWith(".")) {
          const target = resolve(dirname(file), spec);
          if (!target.startsWith(`${packageRoot}/`)) violations.push(`${relative(repoRoot, file)} -> ${spec} (leaves the package)`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  test("package.json depends only on @deck/core among workspace packages", () => {
    const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>; devDependencies?: Record<string, string>;
    };
    const workspace = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies }).filter((n) => n.startsWith("@deck/"));
    expect(workspace).toEqual(["@deck/core"]);
  });

  test("does not reference adapter directories by path", () => {
    const offenders = files.filter((f) => /packages\/adapter-|apps\/cli/.test(readFileSync(f, "utf8")));
    expect(offenders.map((f) => relative(repoRoot, f))).toEqual([]);
  });
});
