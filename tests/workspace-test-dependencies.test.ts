import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("workspace test dependencies", () => {
  test.each([
    ["core", "@deck/adapter-codex"],
    ["core", "@deck/adapter-opencode"],
    ["core", "@deck/adapter-pi"],
  ])("%s explicitly declares %s for tests only", (workspace, dependency) => {
    const manifest = JSON.parse(readFileSync(
      join(import.meta.dir, "..", "packages", workspace, "package.json"), "utf-8",
    )) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    // A hoisted local node_modules must not hide a missing workspace declaration.
    expect(manifest.devDependencies?.[dependency]).toBe("workspace:*");
    expect(manifest.dependencies?.[dependency]).toBeUndefined();
  });
});
