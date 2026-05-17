import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { resolveProjectRoot } from "./project-root";

function createTempDir(prefix = "deck-test-"): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

describe("resolveProjectRoot", () => {
  test("returns cwd when cwd itself has workspace markers (package.json with workspaces + definition.md)", () => {
    const root = createTempDir();
    try {
      writeFileSync(
        join(root, "package.json"),
        JSON.stringify({ name: "deck", workspaces: ["apps/*", "packages/*"] }),
      );
      writeFileSync(join(root, "definition.md"), "# Deck");
      mkdirSync(join(root, "apps"));
      mkdirSync(join(root, "packages"));

      const result = resolveProjectRoot(root);

      expect(result).toBe(root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("walks up from nested cwd to find project root with workspace markers", () => {
    const root = createTempDir();
    try {
      // Root markers
      writeFileSync(
        join(root, "package.json"),
        JSON.stringify({ name: "deck", workspaces: ["apps/*", "packages/*"] }),
      );
      writeFileSync(join(root, "definition.md"), "# Deck");
      mkdirSync(join(root, "apps"));
      mkdirSync(join(root, "packages"));

      // Nested: root/apps/cli
      const nestedCwd = join(root, "apps", "cli");
      mkdirSync(nestedCwd, { recursive: true });

      const result = resolveProjectRoot(nestedCwd);

      expect(result).toBe(root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("finds root using package.json with workspaces even without definition.md", () => {
    const root = createTempDir();
    try {
      writeFileSync(
        join(root, "package.json"),
        JSON.stringify({ name: "deck", workspaces: ["apps/*"] }),
      );
      mkdirSync(join(root, "apps"));

      const nestedCwd = join(root, "apps", "myapp");
      mkdirSync(nestedCwd, { recursive: true });

      const result = resolveProjectRoot(nestedCwd);

      expect(result).toBe(root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("finds root using definition.md with packages/ and apps/ directories", () => {
    const root = createTempDir();
    try {
      writeFileSync(join(root, "definition.md"), "# Deck");
      mkdirSync(join(root, "apps"));
      mkdirSync(join(root, "packages"));

      const nestedCwd = join(root, "packages", "adapter-pi", "src");
      mkdirSync(nestedCwd, { recursive: true });

      const result = resolveProjectRoot(nestedCwd);

      expect(result).toBe(root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("returns cwd when no workspace markers found in any ancestor", () => {
    const isolated = createTempDir();
    try {
      // No markers at all
      const result = resolveProjectRoot(isolated);

      expect(result).toBe(isolated);
    } finally {
      rmSync(isolated, { recursive: true, force: true });
    }
  });

  test("prefers nearest ancestor with markers over farther ancestor", () => {
    const outerRoot = createTempDir("deck-outer-");
    try {
      // Outer has markers
      writeFileSync(
        join(outerRoot, "package.json"),
        JSON.stringify({ workspaces: ["*"] }),
      );

      // Inner project also has markers — closer
      const innerRoot = join(outerRoot, "inner-project");
      mkdirSync(innerRoot, { recursive: true });
      writeFileSync(
        join(innerRoot, "package.json"),
        JSON.stringify({ workspaces: ["apps/*"] }),
      );
      mkdirSync(join(innerRoot, "apps"));

      const nestedCwd = join(innerRoot, "apps", "cli");
      mkdirSync(nestedCwd, { recursive: true });

      const result = resolveProjectRoot(nestedCwd);

      expect(result).toBe(innerRoot);
    } finally {
      rmSync(outerRoot, { recursive: true, force: true });
    }
  });

  test("stops at filesystem root and returns start dir when nothing matches", () => {
    // Use a deeply nested temp path that has no markers
    const deep = createTempDir();
    try {
      const nested = join(deep, "a", "b", "c", "d");
      mkdirSync(nested, { recursive: true });

      const result = resolveProjectRoot(nested);

      // Should return the start dir since nothing matches up the tree
      // (the temp dir root /tmp won't have definition.md or workspaces)
      expect(result).toBe(nested);
    } finally {
      rmSync(deep, { recursive: true, force: true });
    }
  });
});
