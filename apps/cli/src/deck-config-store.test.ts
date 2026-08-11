import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createDeckConfigStore, DeckConfigMigrationConflictError } from "./deck-config-store";
import { installGlobalConfigRealEnvSentinel } from "../../../packages/core/src/config/global-config-real-env-sentinel.test-helper";

installGlobalConfigRealEnvSentinel();

const roots: string[] = [];
function root(): string {
  const dir = mkdtempSync(join(tmpdir(), "deck-global-store-"));
  roots.push(dir);
  return dir;
}
function writeJson(path: string, value: unknown): void {
  require("node:fs").mkdirSync(require("node:path").dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("DeckConfigStore", () => {
  test("requires injected HOME and XDG roots in tests and production-capable call sites", () => {
    expect(() => createDeckConfigStore()).toThrow("requires caller-resolved homeDir and xdgConfigHome");
    expect(() => createDeckConfigStore({ projectRoot: root() })).toThrow("requires caller-resolved homeDir and xdgConfigHome");
  });

  test("resolves canonical XDG config as the active path", () => {
    const home = root();
    const xdg = join(home, "xdg");
    const projectRoot = join(home, "repo");
    const store = createDeckConfigStore({ homeDir: home, xdgConfigHome: xdg, projectRoot });
    expect(store.paths.canonicalPath).toBe(join(xdg, "deck", "config.json"));
  });

  test("imports one unique valid global-field projection and preserves legacy sources", () => {
    const home = root();
    const xdg = join(home, "xdg");
    const projectRoot = join(home, "repo");
    const legacy = join(home, ".deck", "config.json");
    writeJson(legacy, { adaptiveMemory: { activeProvider: "supermemory", supermemory: { mcpServerName: "custom-sm", searchMode: "documents" } }, webSearch: { enabled: true, provider: "tavily" } });

    const store = createDeckConfigStore({ homeDir: home, xdgConfigHome: xdg, projectRoot });
    const config = store.read();

    expect(config.webSearch).toEqual({ enabled: true, provider: "tavily" });
    expect(config.adaptiveMemory.supermemory?.mcpServerName).toBe("custom-sm");
    expect(existsSync(legacy)).toBe(true);
    expect(existsSync(store.paths.canonicalPath)).toBe(true);
  });

  test("deduplicates identical valid projections across legacy candidates", () => {
    const home = root();
    const xdg = join(home, "xdg");
    const value = { packageInstructions: { opencode: { serena: true } } };
    writeJson(join(xdg, ".deck", "config.json"), value);
    writeJson(join(home, ".config", ".deck", "config.json"), value);

    const store = createDeckConfigStore({ homeDir: home, xdgConfigHome: xdg });
    expect(store.read().packageInstructions.opencode.serena).toBe(true);
  });

  test("blocks mutation on distinct valid projections with redacted candidate metadata", () => {
    const home = root();
    const xdg = join(home, "xdg");
    writeJson(join(xdg, ".deck", "config.json"), { webSearch: { enabled: true, provider: "tavily" } });
    writeJson(join(home, ".deck", "config.json"), { orchestratorPersonality: "guia" });

    const store = createDeckConfigStore({ homeDir: home, xdgConfigHome: xdg });
    expect(() => store.patch((existing) => ({ ...existing, webSearch: { enabled: false } }))).toThrow(DeckConfigMigrationConflictError);
    try {
      store.read();
    } catch (error) {
      expect(error).toBeInstanceOf(DeckConfigMigrationConflictError);
      const conflict = error as DeckConfigMigrationConflictError;
      expect(conflict.conflict.candidates).toHaveLength(2);
      expect(JSON.stringify(conflict.conflict)).not.toContain("tavily");
      expect(JSON.stringify(conflict.conflict)).not.toContain("guia");
    }
  });

  test("reports invalid sources by path and code only and imports the remaining unique valid projection", () => {
    const home = root();
    const xdg = join(home, "xdg");
    writeJson(join(home, ".deck", "config.json"), { webSearch: { enabled: true, provider: "tavily" } });
    writeJson(join(xdg, ".deck", "config.json"), { webSearch: { apiKey: "not-persisted" } });

    const store = createDeckConfigStore({ homeDir: home, xdgConfigHome: xdg });
    const discovery = store.discover();
    expect(discovery.invalidCandidates[0]).toMatchObject({ code: "DECK_CONFIG_SECRET_FIELD" });
    expect(JSON.stringify(discovery.invalidCandidates)).not.toContain("not-persisted");
    expect(store.read().webSearch.enabled).toBe(true);
  });

  test("canonical existence wins and reports differing legacy candidates without merging", () => {
    const home = root();
    const xdg = join(home, "xdg");
    writeJson(join(xdg, "deck", "config.json"), { webSearch: { enabled: false }, adaptiveMemory: { activeProvider: "none" } });
    writeJson(join(home, ".deck", "config.json"), { webSearch: { enabled: true, provider: "tavily" } });

    const store = createDeckConfigStore({ homeDir: home, xdgConfigHome: xdg });
    expect(store.read().webSearch.enabled).toBe(false);
    expect(store.discover().differingLegacyCandidates).toHaveLength(1);
  });

  test("keep/adopt migration selection writes canonical without exposing candidate values", () => {
    const home = root();
    const xdg = join(home, "xdg");
    const candidate = join(home, ".deck", "config.json");
    writeJson(join(xdg, ".deck", "config.json"), { webSearch: { enabled: true, provider: "tavily" } });
    writeJson(candidate, { orchestratorPersonality: "guia" });
    const store = createDeckConfigStore({ homeDir: home, xdgConfigHome: xdg });

    const result = store.selectMigration({ action: "adopt", candidatePath: candidate });

    expect(result.orchestratorPersonality).toBe("guia");
    expect(readFileSync(store.paths.canonicalPath, "utf8")).toContain("orchestratorPersonality");
  });

  test("ordinary repo, workspace, and nested cwd preference writes share one global config and create no local config", () => {
    const home = root();
    const xdg = join(home, "xdg");
    const repo = join(home, "repo");
    const workspace = join(home, "workspace", "packages", "app");
    const nested = join(repo, "nested", "child");
    require("node:fs").mkdirSync(workspace, { recursive: true });
    require("node:fs").mkdirSync(nested, { recursive: true });

    const first = createDeckConfigStore({ homeDir: home, xdgConfigHome: xdg, projectRoot: repo });
    first.write({ webSearch: { enabled: true, provider: "tavily" } });
    for (const projectRoot of [workspace, nested]) {
      const store = createDeckConfigStore({ homeDir: home, xdgConfigHome: xdg, projectRoot });
      expect(store.read().webSearch).toEqual({ enabled: true, provider: "tavily" });
      store.patch((existing) => ({ ...existing, orchestratorPersonality: "guia" }));
      expect(existsSync(join(projectRoot, ".deck", "config.json"))).toBe(false);
    }
    expect(first.read().orchestratorPersonality).toBe("guia");
    expect(existsSync(join(repo, ".deck", "config.json"))).toBe(false);
  });

  test("hardens canonical root ancestry and keeps writes contained under injected XDG", () => {
    const home = root();
    const xdg = join(home, "xdg");
    const outside = join(home, "outside");
    require("node:fs").mkdirSync(xdg, { recursive: true });
    require("node:fs").mkdirSync(outside, { recursive: true });
    symlinkSync(outside, join(xdg, "deck"));
    const store = createDeckConfigStore({ homeDir: home, xdgConfigHome: xdg });
    expect(() => store.write({ webSearch: { enabled: true, provider: "tavily" } })).toThrow("real directories");
    expect(existsSync(join(outside, "config.json"))).toBe(false);
  });

  test("merges full preference writes so stale partial writers preserve custom Supermemory settings", () => {
    const home = root();
    const xdg = join(home, "xdg");
    const store = createDeckConfigStore({ homeDir: home, xdgConfigHome: xdg });
    store.write({ adaptiveMemory: { activeProvider: "supermemory", supermemory: { mcpServerName: "custom-sm", searchMode: "documents", maxMemoriesPerSession: 6 } } });

    const updated = store.write({ webSearch: { enabled: true, provider: "tavily" } });

    expect(updated.webSearch).toEqual({ enabled: true, provider: "tavily" });
    expect(updated.adaptiveMemory.supermemory).toEqual({ mcpServerName: "custom-sm", searchMode: "documents", maxMemoriesPerSession: 6 });
  });

  test("reports invalid config values without echoing attacker-controlled values", () => {
    const home = root();
    const xdg = join(home, "xdg");
    writeJson(join(xdg, ".deck", "config.json"), { version: "not-secret-version", adaptiveMemory: { activeProvider: "supermemory", supermemory: { searchMode: "secret-mode" } } });
    const store = createDeckConfigStore({ homeDir: home, xdgConfigHome: xdg });
    const discovery = store.discover();
    expect(discovery.invalidCandidates[0]?.code).toBe("DECK_CONFIG_UNSUPPORTED_VERSION");
    expect(JSON.stringify(discovery)).not.toContain("not-secret-version");
    expect(JSON.stringify(discovery)).not.toContain("secret-mode");
  });
});
