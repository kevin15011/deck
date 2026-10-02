import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { CodexToolOptions } from "./tools";

/**
 * Hermetic tool seams for adapter tests: a throwaway HOME/Deck data root, no PATH lookups and no
 * executable probes, so tests never read the real home directory or spawn rtk/context-mode/node.
 */
export function testTools(overrides: Partial<CodexToolOptions> = {}): CodexToolOptions {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "deck-codex-tools-home-")));
  return {
    homeDir: home,
    dataRoot: join(home, ".local", "share", "deck"),
    resolveCommand: () => undefined,
    verifyRtkCommand: () => true,
    verifyCodebaseNative: () => true,
    verifyExistingCodebase: () => true,
    verifyContextMode: () => true,
    verifyNodeRuntime: () => true,
    nodeCommand: process.execPath,
    ...overrides,
  };
}

/**
 * Fully provisioned fixture tools: a fake owned RTK, an owned Codebase Memory, a shared Context Mode and (optionally)
 * the official Supermemory hook artifact, each registered through the same inspection code production uses.
 */
export function readyTestTools(overrides: Partial<CodexToolOptions> & { supermemory?: boolean } = {}): CodexToolOptions {
  const { supermemory = false, ...rest } = overrides;
  const base = testTools(rest);
  const toolRoot = join(base.dataRoot!, "codex", "tools");
  const platform = `${process.platform}-${process.arch}`;
  const put = (directory: string, name: string, content: string, mode: number) => {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    for (let current = directory; current.length > base.homeDir!.length; current = dirname(current)) chmodSync(current, 0o700);
    writeFileSync(join(directory, name), content, { mode });
    chmodSync(join(directory, name), mode);
  };
  const sha = (content: string) => createHash("sha256").update(content).digest("hex");
  const rtk = "rtk fixture binary";
  put(join(toolRoot, "rtk-v0.50.0", platform), "rtk", rtk, 0o700);
  const codebase = "codebase fixture binary";
  put(join(toolRoot, "codebase-native-v0.11.0", platform), "codebase-memory-mcp", codebase, 0o700);
  const manifest = supermemory ? [["recall.js", "x", sha("recall"), 6], ["flush.js", "y", sha("flush"), 5]] as const : undefined;
  if (manifest) {
    put(join(toolRoot, "official-supermemory-1.0.19"), "recall.js", "recall", 0o600);
    put(join(toolRoot, "official-supermemory-1.0.19"), "flush.js", "flush", 0o600);
  }
  return {
    ...base,
    resolveCommand: (name) => name === "context-mode" ? process.execPath : undefined,
    rtkReleaseOverride: { asset: "fixture", archiveSha256: "0".repeat(64), archiveBytes: 1, binarySha256: sha(rtk), binaryBytes: rtk.length },
    codebaseReleaseOverride: { asset: "fixture", archiveSha256: "0".repeat(64), archiveBytes: 1, binarySha256: sha(codebase), binaryBytes: codebase.length },
    ...(manifest ? { supermemoryManifest: manifest } : {}),
    ...rest,
  };
}

/**
 * Test-only install layout that reproduces the former per-project paths (`<root>/.codex/**`, `<root>/.agents/skills/**`)
 * under a throwaway directory, so assertions can read files where they used to be. Production never does this: the
 * real roots are CODEX_HOME (default ~/.codex) and the user's home.
 */
export function layout(root: string): { codexHome: string; userHome: string } {
  return { codexHome: join(root, ".codex"), userHome: root };
}

/** A throwaway install layout for tests that never read the written files back. */
export function freshLayout(): { codexHome: string; userHome: string } {
  return layout(realpathSync(mkdtempSync(join(tmpdir(), "deck-codex-layout-"))));
}
