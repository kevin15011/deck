import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  patchDeckConfigFile,
  readDeckConfigFilePreimage,
  readDeckConfigFile,
  validateDeckConfig,
  writeDeckConfigFileAtomicWithReceipt,
  writeDeckConfigFileAtomic,
} from "./deck-config";
import { installGlobalConfigRealEnvSentinel } from "./global-config-real-env-sentinel.test-helper";

installGlobalConfigRealEnvSentinel();

const roots: string[] = [];

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "deck-config-file-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("path-parameterized Deck config file primitives", () => {
  test("read validates a caller-provided path without resolving project or XDG roots", () => {
    const root = tempRoot();
    const configPath = join(root, "custom", "config.json");
    mkdirSync(join(root, "custom"), { recursive: true });
    writeFileSync(configPath, JSON.stringify({ webSearch: { enabled: true, provider: "tavily" } }), { encoding: "utf8", flag: "w" });

    expect(readDeckConfigFile(configPath).webSearch).toEqual({ enabled: true, provider: "tavily" });
  });

  test("atomic write creates a private same-dir temp file and preserves no temp residue", () => {
    const root = tempRoot();
    const configPath = join(root, "deck", "config.json");

    const written = writeDeckConfigFileAtomic(configPath, {
      adaptiveMemory: { activeProvider: "supermemory", supermemory: { mcpServerName: "custom-sm", searchMode: "documents", maxMemoriesPerSession: 5 } },
      profiles: [{ name: "legacy-local", strategy: "generated-multi" }],
      activeProfile: "legacy-local",
    });

    expect(written.adaptiveMemory.supermemory).toEqual({ mcpServerName: "custom-sm", searchMode: "documents", maxMemoriesPerSession: 5 });
    expect(readDeckConfigFile(configPath).activeProfile).toBe("legacy-local");
    expect(readFileSync(configPath, "utf8")).toContain('"mcpServerName": "custom-sm"');
    expect(existsSync(join(root, "deck", ".config.json.tmp"))).toBe(false);
  });

  test("patch preserves unrelated global fields, project-local legacy profiles, and custom Supermemory settings", () => {
    const root = tempRoot();
    const configPath = join(root, "config.json");
    writeDeckConfigFileAtomic(configPath, validateDeckConfig({
      adaptiveMemory: { activeProvider: "supermemory", supermemory: { mcpServerName: "custom-sm", searchMode: "documents", maxMemoriesPerSession: 4 } },
      packageInstructions: { opencode: { "context-mode": true, serena: true } },
      orchestratorPersonality: "guia",
      profiles: [{ name: "legacy-local", strategy: "external-single-active" }],
      activeProfile: "legacy-local",
    }));

    const patched = patchDeckConfigFile(configPath, (existing) => ({
      ...existing,
      webSearch: { enabled: true, provider: "tavily" },
    }));

    expect(patched.webSearch).toEqual({ enabled: true, provider: "tavily" });
    expect(patched.adaptiveMemory.supermemory).toEqual({ mcpServerName: "custom-sm", searchMode: "documents", maxMemoriesPerSession: 4 });
    expect(patched.packageInstructions.opencode["context-mode"]).toBe(true);
    expect(patched.orchestratorPersonality).toBe("guia");
    expect(patched.activeProfile).toBe("legacy-local");
  });

  test("rejects symlink targets and parents inside the injected containment root", () => {
    const root = tempRoot();
    const xdg = join(root, "xdg");
    mkdirSync(xdg, { recursive: true });
    writeFileSync(join(root, "outside.json"), "{}\n");
    mkdirSync(join(xdg, "bad-parent"), { recursive: true });
    symlinkSync(join(root, "outside.json"), join(xdg, "deck-link"));

    expect(() => writeDeckConfigFileAtomic(join(xdg, "deck-link", "config.json"), {}, { containmentRoot: xdg })).toThrow("real directories");

    mkdirSync(join(xdg, "deck"), { recursive: true });
    symlinkSync(join(root, "outside.json"), join(xdg, "deck", "config.json"));
    expect(() => writeDeckConfigFileAtomic(join(xdg, "deck", "config.json"), {}, { containmentRoot: xdg })).toThrow("symbolic link");
  });

  test("enforces containment, target mode 0600, temp cleanup, and CAS conflicts", () => {
    const root = tempRoot();
    const xdg = join(root, "xdg");
    const configPath = join(xdg, "deck", "config.json");
    const written = writeDeckConfigFileAtomic(configPath, { webSearch: { enabled: true, provider: "tavily" } }, { containmentRoot: xdg, expectedDigest: null });
    expect(written.webSearch.enabled).toBe(true);
    expect(lstatSync(configPath).mode & 0o777).toBe(0o600);
    const initial = readDeckConfigFilePreimage(configPath);
    expect(initial.digest).toBeTruthy();

    writeDeckConfigFileAtomic(configPath, { webSearch: { enabled: false } }, { containmentRoot: xdg, expectedDigest: initial.digest });
    expect(() => writeDeckConfigFileAtomic(configPath, { orchestratorPersonality: "guia" }, { containmentRoot: xdg, expectedDigest: initial.digest })).toThrow("changed before write");
    expect(() => writeDeckConfigFileAtomic(join(root, "outside", "config.json"), {}, { containmentRoot: xdg })).toThrow("inside the configured XDG root");
    expect(require("node:fs").readdirSync(join(xdg, "deck")).filter((name: string) => name.endsWith(".tmp"))).toEqual([]);
  });

  test("read path validation rejects symlink ancestors before reading candidates", () => {
    const root = tempRoot();
    const xdg = join(root, "xdg");
    const outside = join(root, "outside");
    mkdirSync(outside, { recursive: true });
    symlinkSync(outside, xdg);
    expect(() => readDeckConfigFile(join(xdg, "deck", "config.json"), { containmentRoot: xdg })).toThrow("symbolic links");
  });

  test("exclusive lock serializes patch updates and preserves both writers", async () => {
    const root = tempRoot();
    const xdg = join(root, "xdg");
    const configPath = join(xdg, "deck", "config.json");
    writeDeckConfigFileAtomic(configPath, {}, { containmentRoot: xdg, expectedDigest: null });

    await Promise.all([
      Promise.resolve().then(() => patchDeckConfigFile(configPath, (existing) => ({ ...existing, webSearch: { enabled: true, provider: "tavily" } }), { containmentRoot: xdg })),
      Promise.resolve().then(() => patchDeckConfigFile(configPath, (existing) => ({ ...existing, orchestratorPersonality: "guia" }), { containmentRoot: xdg })),
    ]);

    const config = readDeckConfigFile(configPath, { containmentRoot: xdg });
    expect(config.webSearch).toEqual({ enabled: true, provider: "tavily" });
    expect(config.orchestratorPersonality).toBe("guia");
  });

  test("lock files carry owner metadata and release only the acquired inode/nonce", () => {
    const root = tempRoot();
    const xdg = join(root, "xdg");
    const configPath = join(xdg, "deck", "config.json");
    const lockPath = join(xdg, "deck", ".config.json.lock");
    let observedLock: unknown;

    writeDeckConfigFileAtomic(configPath, { webSearch: { enabled: true, provider: "tavily" } }, {
      containmentRoot: xdg,
      expectedDigest: null,
      afterRenameForTest: () => {
        observedLock = JSON.parse(readFileSync(lockPath, "utf8"));
        rmSync(lockPath, { force: true });
        writeFileSync(lockPath, `${JSON.stringify({ version: 1, pid: 999_999_999, nonce: "replacement", createdAtMs: Date.now() })}\n`, { mode: 0o600 });
      },
    });

    expect(observedLock).toMatchObject({ version: 1, pid: process.pid, nonce: expect.any(String), createdAtMs: expect.any(Number) });
    expect(readFileSync(lockPath, "utf8")).toContain("replacement");
  });

  test("stale abandoned locks are recovered before writing", () => {
    const root = tempRoot();
    const xdg = join(root, "xdg");
    const configPath = join(xdg, "deck", "config.json");
    const lockPath = join(xdg, "deck", ".config.json.lock");
    mkdirSync(join(xdg, "deck"), { recursive: true });
    writeFileSync(lockPath, `${JSON.stringify({ version: 1, pid: 999_999_999, nonce: "abandoned", createdAtMs: Date.now() - 60_000 })}\n`, { mode: 0o600 });

    const written = writeDeckConfigFileAtomic(configPath, { orchestratorPersonality: "guia" }, { containmentRoot: xdg, expectedDigest: null });

    expect(written.orchestratorPersonality).toBe("guia");
    expect(existsSync(lockPath)).toBe(false);
  });

  test("operation receipt rolls back injected post-rename failure without exposing preimage", () => {
    const root = tempRoot();
    const xdg = join(root, "xdg");
    const configPath = join(xdg, "deck", "config.json");
    writeDeckConfigFileAtomic(configPath, { webSearch: { enabled: false } }, { containmentRoot: xdg, expectedDigest: null });
    const before = readFileSync(configPath, "utf8");
    expect(() => writeDeckConfigFileAtomicWithReceipt(configPath, { webSearch: { enabled: true, provider: "tavily" } }, { containmentRoot: xdg, expectedDigest: readDeckConfigFilePreimage(configPath, { containmentRoot: xdg }).digest, afterRenameForTest: () => { throw new Error("injected"); } })).toThrow("injected");
    expect(readFileSync(configPath, "utf8")).toBe(before);

    const written = writeDeckConfigFileAtomicWithReceipt(configPath, { webSearch: { enabled: true, provider: "tavily" } }, { containmentRoot: xdg, expectedDigest: readDeckConfigFilePreimage(configPath, { containmentRoot: xdg }).digest });
    expect(JSON.stringify(written.receipt)).not.toContain(before.trim());
    written.receipt.rollback();
    expect(readFileSync(configPath, "utf8")).toBe(before);
  });

  test("receipt rollback does not clobber a later committed config", () => {
    const root = tempRoot();
    const xdg = join(root, "xdg");
    const configPath = join(xdg, "deck", "config.json");
    writeDeckConfigFileAtomic(configPath, { webSearch: { enabled: false } }, { containmentRoot: xdg, expectedDigest: null });
    const written = writeDeckConfigFileAtomicWithReceipt(configPath, { webSearch: { enabled: true, provider: "tavily" } }, { containmentRoot: xdg, expectedDigest: readDeckConfigFilePreimage(configPath, { containmentRoot: xdg }).digest });
    const later = writeDeckConfigFileAtomic(configPath, { orchestratorPersonality: "guia" }, { containmentRoot: xdg, expectedDigest: written.receipt.postimageDigest });

    written.receipt.rollback();

    expect(readDeckConfigFile(configPath, { containmentRoot: xdg })).toEqual(later);
  });
});
