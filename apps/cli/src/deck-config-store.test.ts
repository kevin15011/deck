import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createDeckConfigStore } from "./deck-config-store";
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

  test("ignores retired config locations without importing or modifying them", () => {
    const home = root();
    const xdg = join(home, "xdg");
    const legacy = join(home, ".deck", "config.json");
    writeJson(legacy, { webSearch: { enabled: true, provider: "tavily" } });
    const before = readFileSync(legacy, "utf8");
    const store = createDeckConfigStore({ homeDir: home, xdgConfigHome: xdg });
    expect(store.read().webSearch.enabled).toBe(false);
    expect(store.discover().canonicalExists).toBe(false);
    expect(readFileSync(legacy, "utf8")).toBe(before);
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
    expect(updated.adaptiveMemory.supermemory).toEqual({ mcpServerName: "custom-sm", searchMode: "documents" });
  });

  test("reports invalid config values without echoing attacker-controlled values", () => {
    const home = root();
    const xdg = join(home, "xdg");
    writeJson(join(xdg, "deck", "config.json"), { version: "not-secret-version", adaptiveMemory: { activeProvider: "supermemory", supermemory: { searchMode: "secret-mode" } } });
    const store = createDeckConfigStore({ homeDir: home, xdgConfigHome: xdg });
    expect(() => store.read()).toThrow("version");
  });
});
