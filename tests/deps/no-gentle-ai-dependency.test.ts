/**
 * No gentle-ai Dependency Guard Test
 *
 * EG-1 T3: Deterministic guard test that fails CI if any runtime or test code
 * references gentle-ai paths, packages, caches, or plugin outputs.
 *
 * This test runs WITHOUT network, provider, OAuth, or runner-service access.
 * It scans source and test files for forbidden references.
 */

import { describe, it, expect } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

const PROJECT_ROOT = path.resolve(__dirname, "../..");

/**
 * Forbidden patterns that indicate gentle-ai dependency.
 * These must NOT appear in any Deck source or test code.
 */
const FORBIDDEN_PATTERNS = [
  "gentle-ai", // package name
  "~/.gentle-ai", // cache directory
  "/gentle-ai/", // path reference
  "@gentle-ai", // package import
  "gentle_ai", // alternate package name
];

/**
 * Directories to scan for forbidden patterns.
 * Scans all source and test directories EXCLUDING this test's own directory.
 */
const SCAN_DIRECTORIES = [
  "packages",
  "apps",
  "scripts",
];

describe("no-gentle-ai dependency guard", () => {
  it("should not reference gentle-ai in any source or test file", () => {
    const violations: string[] = [];

    for (const dir of SCAN_DIRECTORIES) {
      const dirPath = path.join(PROJECT_ROOT, dir);
      if (!fs.existsSync(dirPath)) {
        continue;
      }

      const files = walkTypeScriptFiles(dirPath);
      for (const file of files) {
        const content = fs.readFileSync(file, "utf-8");
        for (const pattern of FORBIDDEN_PATTERNS) {
          if (content.includes(pattern)) {
            violations.push(
              `${path.relative(PROJECT_ROOT, file)}: contains "${pattern}"`
            );
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("should not have gentle-ai in package.json dependencies", () => {
    const pkgPath = path.join(PROJECT_ROOT, "package.json");
    if (!fs.existsSync(pkgPath)) {
      // Skip if no root package.json
      return;
    }

    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    const allDeps = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
      ...pkg.peerDependencies,
    };

    for (const dep of Object.keys(allDeps)) {
      expect(dep).not.toMatch(/gentle-ai/);
    }
  });

  it("should not import gentle-ai modules", () => {
    const violations: string[] = [];

    for (const dir of SCAN_DIRECTORIES) {
      const dirPath = path.join(PROJECT_ROOT, dir);
      if (!fs.existsSync(dirPath)) {
        continue;
      }

      const files = walkTypeScriptFiles(dirPath);
      for (const file of files) {
        const content = fs.readFileSync(file, "utf-8");
        // Check for import statements
        const importRegex = /import\s+.*\s+from\s+['"]gentle-ai['"]/g;
        let match;
        while ((match = importRegex.exec(content)) !== null) {
          violations.push(
            `${path.relative(PROJECT_ROOT, file)}: ${match[0]}`
          );
        }
        // Check for require calls
        const requireRegex = /require\s*\(\s*['"]gentle-ai['"]\s*\)/g;
        while ((match = requireRegex.exec(content)) !== null) {
          violations.push(
            `${path.relative(PROJECT_ROOT, file)}: ${match[0]}`
          );
        }
      }
    }

    expect(violations).toEqual([]);
  });
});

/**
 * Recursively walk directory, collecting .ts and .tsx files.
 * Excludes node_modules and hidden directories.
 */
function walkTypeScriptFiles(dirPath: string): string[] {
  const files: string[] = [];

  function walk(currentPath: string): void {
    const entries = fs.readdirSync(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) {
        continue;
      }

      const fullPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (
        entry.name.endsWith(".ts") ||
        entry.name.endsWith(".tsx") ||
        entry.name.endsWith(".js") ||
        entry.name.endsWith(".jsx")
      ) {
        files.push(fullPath);
      }
    }
  }

  walk(dirPath);
  return files;
}