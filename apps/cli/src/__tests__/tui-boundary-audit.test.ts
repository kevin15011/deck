import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

type ImportViolation = {
  file: string;
  line: number;
  moduleName: string;
};

const sourceExtensions = new Set([".ts", ".tsx"]);
const forbiddenAdapterImports = new Set([
  "@deck/adapter-pi",
  "@deck/adapter-opencode",
  "@deck/adapter-engram",
  "@deck/adapter-supermemory",
]);

const testDir = dirname(fileURLToPath(import.meta.url));
const tuiSourceDir = join(testDir, "../tui");

// TODO(hexagonal-architecture-memory-refactor): app.tsx is temporarily allowed
// to keep adapter imports as runtime glue until orchestration moves out of TUI.
const temporarilyAllowedFiles = new Set(["app.tsx"]);

function collectSourceFiles(directory: string, files: string[] = []): string[] {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = join(directory, entry.name);

    if (entry.isDirectory()) {
      collectSourceFiles(entryPath, files);
      continue;
    }

    if (sourceExtensions.has(extname(entry.name))) {
      files.push(entryPath);
    }
  }

  return files;
}

function getLineNumber(source: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (source.charCodeAt(i) === 10) {
      line += 1;
    }
  }

  return line;
}

function findForbiddenImports(): ImportViolation[] {
  const violations: ImportViolation[] = [];
  const importPattern = /import\s+(?:type\s+)?[\s\S]*?\s+from\s+["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)/g;

  for (const file of collectSourceFiles(tuiSourceDir)) {
    const relativeFile = relative(tuiSourceDir, file);

    if (temporarilyAllowedFiles.has(relativeFile)) {
      continue;
    }

    const source = readFileSync(file, "utf8");

    for (const match of source.matchAll(importPattern)) {
      const moduleName = match[1] ?? match[2] ?? "";
      if (forbiddenAdapterImports.has(moduleName)) {
        violations.push({
          file: relativeFile,
          line: getLineNumber(source, match.index ?? 0),
          moduleName,
        });
      }
    }
  }

  return violations;
}

describe("TUI adapter import boundary audit", () => {
  test("TUI files other than known runtime glue do not import adapter packages", () => {
    const violations = findForbiddenImports();

    expect(
      violations.map((violation) => `${violation.file}:${violation.line} imports ${violation.moduleName}`),
    ).toEqual([]);
  });
});
