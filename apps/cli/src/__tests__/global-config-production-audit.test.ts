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

function hasPreferenceArgv(rel: string, text: string): boolean {
  // This embedded process anchor forwards its explicit child command, not preferences.
  // Exempt only that exact expression; additional argv reads remain forbidden.
  if (rel === "packages/adapter-pi/src/pi-extensions/subagents/supervisor.ts") {
    text = text.replace("const [command, ...args] = process.argv.slice(2);", "");
  }
  // This exact read compares the executing development script to its reviewed guard
  // receipt. It fails closed on provenance drift and does not select preferences.
  // Strip only one expression; every other argv read in this file still fails audit.
  if (rel === "packages/adapter-pi/src/pi-codebase-guard.ts") {
    text = text.replace("realpathSync(process.argv[1]!)", "");
  }
  return /process\.argv/.test(text);
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
    // The opt-in source proof is a standalone import.meta.main entrypoint.
    // Its reusable runPiClientProof function receives launch.deckConfig from callers.
    const entrypoints = ["apps/cli/src/main.tsx", "apps/cli/src/upgrade-command/orchestrator.ts", "apps/cli/src/pi-client-proof.ts"];
    const offenders = files(repoRoot).filter((rel) => {
      if ([...entrypoints, ...Array.from(allowed)].includes(rel) || rel.endsWith(".test.ts") || rel.endsWith(".test.tsx")) return false;
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
      let text = readFileSync(join(repoRoot, rel), "utf8");
      return hasPreferenceArgv(rel, text);
    });
    expect(offenders).toEqual([]);
  });

  test("the provenance exception cannot hide extra argv reads or preference selection", () => {
    const path = "packages/adapter-pi/src/pi-codebase-guard.ts";
    const source = readFileSync(join(repoRoot, path), "utf8");
    expect(hasPreferenceArgv(path, source)).toBe(false);
    expect(hasPreferenceArgv(path, `${source}\nconst preferences = process.argv[2];`)).toBe(true);
    expect(hasPreferenceArgv(path, `${source}\nrealpathSync(process.argv[1]!)`)).toBe(true);
    expect(hasPreferenceArgv("packages/adapter-pi/src/runner-adapter.ts", source)).toBe(true);
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
