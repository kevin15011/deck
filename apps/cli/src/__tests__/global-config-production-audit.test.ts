import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { installGlobalConfigRealEnvSentinel } from "../../../../packages/core/src/config/global-config-real-env-sentinel.test-helper";

installGlobalConfigRealEnvSentinel();

const repoRoot = join(import.meta.dir, "..", "..", "..", "..");
const allowed = new Set([
  "apps/cli/src/deck-config-store.ts",
  "apps/cli/src/deck-config-store.test.ts",
  "apps/cli/src/pi-launch-command-legacy-compatibility.test-support.ts",
  "apps/cli/src/__tests__/global-config-production-audit.test.ts",
  "packages/core/src/config/deck-config.ts",
  "packages/core/src/config/deck-config.test.ts",
  "packages/core/src/config/deck-config-file-primitives.test.ts",
]);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    const rel = relative(repoRoot, path);
    if (["node_modules", ".git", "dist"].includes(name) || rel.startsWith("openspec/")) return [];
    const stat = statSync(path);
    if (stat.isDirectory()) return files(path);
    return /\.(ts|tsx)$/.test(name) ? [rel] : [];
  });
}

describe("production Deck preference source audit", () => {
  test("forbids production use of project-local Deck config APIs outside compatibility and tests", () => {
    const offenders = files(repoRoot).filter((rel) => {
      if (allowed.has(rel) || rel.endsWith(".test.ts") || rel.endsWith(".test.tsx")) return false;
      const text = readFileSync(join(repoRoot, rel), "utf8");
      return /import\s+[^;]*(readDeckConfig|writeDeckConfig|getDeckConfigPath)|(?<![.\w])(readDeckConfig|writeDeckConfig|getDeckConfigPath)\s*\(/.test(text);
    });
    expect(offenders).toEqual([]);
  });

  test("forbids production-capable paths from constructing global stores without injected roots", () => {
    const offenders = files(repoRoot).filter((rel) => {
      if (allowed.has(rel) || rel.endsWith(".test.ts") || rel.endsWith(".test.tsx")) return false;
      const text = readFileSync(join(repoRoot, rel), "utf8");
      return /createDeckConfigStore\(\s*\{\s*projectRoot|createDeckConfigStore\(\s*\)/.test(text);
    });
    expect(offenders).toEqual([]);
  });

  test("documents the narrow production environment entrypoint for global config", () => {
    const offenders = files(repoRoot).filter((rel) => {
      if (["apps/cli/src/main.tsx", "apps/cli/src/upgrade-command/orchestrator.ts", ...Array.from(allowed)].includes(rel) || rel.endsWith(".test.ts") || rel.endsWith(".test.tsx")) return false;
      const text = readFileSync(join(repoRoot, rel), "utf8");
      return /createDeckConfigStoreFromEnvironment/.test(text);
    });
    expect(offenders).toEqual([]);
  });

  test("forbids legacy compatibility launch/config APIs from production call sites", () => {
    const offenders = files(repoRoot).filter((rel) => {
      if (allowed.has(rel) || rel.endsWith(".test.ts") || rel.endsWith(".test.tsx")) return false;
      const text = readFileSync(join(repoRoot, rel), "utf8");
      return /LegacyCompatibility|legacy-compatibility\.test-support|readDeckConfig\(/.test(text);
    });
    expect(offenders).toEqual([]);
  });

  test("forbids argv-dependent config behavior in runner adapters", () => {
    const adapterFiles = files(join(repoRoot, "packages")).filter((rel) => /packages\/adapter-[^/]+\/src\/.*\.ts$/.test(rel));
    const offenders = adapterFiles.filter((rel) => {
      if (rel.endsWith(".test.ts") || rel.endsWith(".test.tsx")) return false;
      const text = readFileSync(join(repoRoot, rel), "utf8");
      return /process\.argv/.test(text);
    });
    expect(offenders).toEqual([]);
  });

  test("requires explicit Deck config on preference-sensitive Core contracts", () => {
    const offenders = ["packages/core/src/runner-adapter.ts", "packages/core/src/runner-capability.ts"].filter((rel) => {
      const text = readFileSync(join(repoRoot, rel), "utf8");
      return /deckConfig\?:/.test(text);
    });
    expect(offenders).toEqual([]);
  });

  test("forbids production preference writes that ignore the locked current config", () => {
    const offenders = files(repoRoot).filter((rel) => {
      if (rel.endsWith(".test.ts") || rel.endsWith(".test.tsx")) return false;
      const text = readFileSync(join(repoRoot, rel), "utf8");
      return /\.patch\(\s*\(\s*\)\s*=>/.test(text);
    });
    expect(offenders).toEqual([]);
  });

  test("forbids migration-candidate config resolvers outside migration modules", () => {
    const permitted = new Set([
      "apps/cli/src/runtime/paths.ts",
      "apps/cli/src/upgrade-command/xdg-migration.ts",
      "apps/cli/src/__tests__/global-config-production-audit.test.ts",
    ]);
    const offenders = files(repoRoot).filter((rel) => {
      if (permitted.has(rel) || rel.endsWith(".test.ts") || rel.endsWith(".test.tsx")) return false;
      const text = readFileSync(join(repoRoot, rel), "utf8");
      return /DeckConfigMigrationCandidate|getDeckConfigMigrationCandidate|resolveExistingDeckConfigMigrationCandidate/.test(text);
    });
    expect(offenders).toEqual([]);
  });

  test("keeps the repository-local Deck config absent and ignored", () => {
    expect(existsSync(join(repoRoot, ".deck", "config.json"))).toBe(false);
    const ignore = readFileSync(join(repoRoot, ".gitignore"), "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim());
    expect(ignore).toContain(".deck/config.json");
  });
});
