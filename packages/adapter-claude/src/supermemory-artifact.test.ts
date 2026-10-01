import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CLAUDE_SUPERMEMORY_COMMIT, CLAUDE_SUPERMEMORY_FILES, inspectClaudeSupermemoryArtifact, installClaudeSupermemoryArtifact } from "./supermemory-artifact";

const pinnedHooks = readFileSync(new URL("./fixtures/official-supermemory-hooks.json", import.meta.url));
const sha = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");

describe("official Claude Supermemory immutable artifact", () => {
  test("pins the official hook entrypoints and authentic published hook bytes", () => {
    expect(CLAUDE_SUPERMEMORY_COMMIT).toBe("915aba1b8056ddb3630fa833973032ba6b788fdb");
    expect(CLAUDE_SUPERMEMORY_FILES).toHaveLength(26);
    const hookEntry = CLAUDE_SUPERMEMORY_FILES.find(([path]) => path === "hooks/hooks.json");
    expect(hookEntry?.[1] === sha(pinnedHooks)).toBe(true);
    expect(hookEntry?.[2] === pinnedHooks.length).toBe(true);
    const hooks = JSON.parse(pinnedHooks.toString("utf8")).hooks;
    expect(Object.keys(hooks).sort()).toEqual(["PreToolUse", "SessionStart", "Stop", "UserPromptSubmit"]);
    expect(hooks.Stop[0].hooks[0].command).toContain("hooks/capture.js");
    expect(hooks.SessionStart[0].hooks[0].command).toContain("hooks/session-start.js");
    expect(hooks.UserPromptSubmit[0].hooks[0].command).toContain("hooks/recall-directive.js");
  });

  test("mocked download verifies every byte before publishing, reuses exact files and rejects unknown content", async () => {
    const home = await mkdtemp(join(tmpdir(), "deck-official-claude-plugin-"));
    const parent = join(home, "deck-owned");
    const root = join(parent, "official-supermemory");
    const plugin = Buffer.from('{"name":"supermemory"}\n');
    const entries = [[".claude-plugin/plugin.json", sha(plugin), plugin.length], ["hooks/hooks.json", sha(pinnedHooks), pinnedHooks.length]] as const;
    const bytes = new Map<string, Buffer>([[entries[0][0], plugin], [entries[1][0], pinnedHooks]]);
    try {
      await mkdir(parent, { mode: 0o700 });
      expect(inspectClaudeSupermemoryArtifact(root, entries)).toBe("absent");
      const effect = { fetchFile: async (path: string) => bytes.get(path)! };
      expect(await installClaudeSupermemoryArtifact(root, effect, entries)).toBe("installed");
      expect(await installClaudeSupermemoryArtifact(root, effect, entries)).toBe("unchanged");
      expect(await readFile(join(root, "hooks", "hooks.json"))).toEqual(pinnedHooks);
      await writeFile(join(root, "foreign.js"), "unrelated plugin");
      expect(inspectClaudeSupermemoryArtifact(root, entries)).toBe("conflict");
      await expect(installClaudeSupermemoryArtifact(root, effect, entries)).rejects.toThrow("conflicts");
    } finally { await rm(home, { recursive: true, force: true }); }
  });

  test("bad checksum, oversized bytes and a symlinked destination never publish an untrusted plugin", async () => {
    const home = await mkdtemp(join(tmpdir(), "deck-official-plugin-denial-"));
    const parent = join(home, "owned");
    const root = join(parent, "plugin");
    const entries = [["hooks/hooks.json", sha(pinnedHooks), pinnedHooks.length]] as const;
    try {
      await mkdir(parent, { mode: 0o700 });
      await expect(installClaudeSupermemoryArtifact(root, { fetchFile: async () => Buffer.from("corrupt") }, entries)).rejects.toThrow("integrity mismatch");
      expect(inspectClaudeSupermemoryArtifact(root, entries)).toBe("absent");
      await expect(installClaudeSupermemoryArtifact(root, { fetchFile: async () => Buffer.alloc(pinnedHooks.length + 1) }, entries)).rejects.toThrow("integrity mismatch");
      const outside = join(home, "outside");
      await mkdir(outside);
      await symlink(outside, root);
      expect(inspectClaudeSupermemoryArtifact(root, entries)).toBe("conflict");
    } finally { await rm(home, { recursive: true, force: true }); }
  });
});
