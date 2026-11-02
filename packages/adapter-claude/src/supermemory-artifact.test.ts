import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmod, link, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { isBuiltin } from "node:module";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { CLAUDE_SUPERMEMORY_COMMIT, CLAUDE_SUPERMEMORY_FILES, inspectClaudeSupermemoryArtifact, installClaudeSupermemoryArtifact } from "./supermemory-artifact";
import { writeGeneratedPluginTypes } from "./fixtures/generated-plugin-types";

const pinnedHooks = readFileSync(new URL("./fixtures/official-supermemory-hooks.json", import.meta.url));
const sha = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");

// Protects: only the complete immutable upstream plugin is admitted; corrupt or foreign files cannot become executable.
describe("official Claude Supermemory immutable artifact", () => {
  test("complete published fixture verifies and closes native hook, module and SDK dependencies", async () => {
    const home = await mkdtemp(join(tmpdir(), "deck-claude-closure-"));
    try {
      const source = join(home, "source");
      await mkdir(source);
      const archive = new URL(`./fixtures/claude-supermemory-${CLAUDE_SUPERMEMORY_COMMIT.slice(0, 12)}.tgz`, import.meta.url).pathname;
      expect(Bun.spawnSync(["tar", "-xzf", archive, "-C", source]).exitCode).toBe(0);
      const root = join(home, "plugin");
      await installClaudeSupermemoryArtifact(root, { fetchFile: async path => readFile(join(source, path)) });
      expect(inspectClaudeSupermemoryArtifact(root)).toBe("ready");
      const paths = new Set(CLAUDE_SUPERMEMORY_FILES.map(([path]) => resolve(root, path)));
      for (const [path] of CLAUDE_SUPERMEMORY_FILES) {
        if (!/\.(?:c?js)$/.test(path)) continue;
        const code = readFileSync(join(root, path), "utf8");
        for (const [, dependency] of code.matchAll(/require\(['"]([^'"]+)['"]\)/g)) {
          if (isBuiltin(dependency!)) continue;
          expect(dependency!.startsWith(".")).toBe(true);
          const target = resolve(dirname(join(root, path)), dependency!);
          expect(paths.has(target) || paths.has(`${target}.js`)).toBe(true);
        }
      }
      const manifest = JSON.parse(pinnedHooks.toString());
      for (const module of manifest.modules) expect(paths.has(resolve(root, "hooks", module))).toBe(true);
      for (const groups of Object.values(manifest.hooks) as any[]) for (const group of groups) for (const hook of group.hooks) {
        const path = hook.command.match(/\$\{CLAUDE_PLUGIN_ROOT\}\/([^" ]+)/)?.[1];
        expect(paths.has(resolve(root, path))).toBe(true);
      }
      expect(manifest.hooks.Stop[0].hooks[0].async).toBe(true);
      // Protects repeat installation/preparation while Claude owns generated types.
      // Oracle: these editor artifacts may change; every pinned byte must still match.
      writeGeneratedPluginTypes(root);
      expect(inspectClaudeSupermemoryArtifact(root)).toBe("ready");
      expect(await installClaudeSupermemoryArtifact(root, { fetchFile: async () => { throw Error("must reuse"); } })).toBe("unchanged");
      await writeFile(join(root, ".claude-plugin/types/claude-code/index.d.ts"), "");
      expect(inspectClaudeSupermemoryArtifact(root)).toBe("ready");
      const hook = join(root, "hooks/capture.js");
      const original = await readFile(hook);
      await writeFile(hook, Buffer.alloc(original.length));
      expect(inspectClaudeSupermemoryArtifact(root)).toBe("conflict");
      await writeFile(hook, original);
      for (const path of [".claude-plugin/types/foreign.js", ".claude-plugin/types/claude-code/package.json", ".claude-plugin/foreign.d.ts", "foreign.d.ts"]) {
        const target = join(root, path);
        await writeFile(target, "{}");
        expect(inspectClaudeSupermemoryArtifact(root)).toBe("conflict");
        await rm(target);
      }
      const generated = join(root, ".claude-plugin/types/claude-code/index.d.ts");
      await chmod(generated, 0o666);
      expect(inspectClaudeSupermemoryArtifact(root)).toBe("conflict");
      await chmod(generated, 0o644);
      const extra = join(root, ".claude-plugin/types/linked.d.ts");
      await link(generated, extra);
      expect(inspectClaudeSupermemoryArtifact(root)).toBe("conflict");
      await rm(extra);
      expect(Bun.spawnSync(["mkfifo", extra]).exitCode).toBe(0);
      expect(inspectClaudeSupermemoryArtifact(root)).toBe("conflict");
      await rm(extra);
      await chmod(join(root, ".claude-plugin/types"), 0o777);
      expect(inspectClaudeSupermemoryArtifact(root)).toBe("conflict");
      await chmod(join(root, ".claude-plugin/types"), 0o755);
      for (const path of ["tsconfig.json", ".claude-plugin/types/claude-code/index.d.ts", ".claude-plugin/types/claude-code", ".claude-plugin/types"]) {
        const target = join(root, path);
        await rm(target, { recursive: true });
        await symlink(source, target);
        expect(inspectClaudeSupermemoryArtifact(root)).toBe("conflict");
        await rm(target);
        expect(inspectClaudeSupermemoryArtifact(root)).toBe("ready");
      }
    } finally { await rm(home, { recursive: true, force: true }); }
  });
  test("pins the official hook entrypoints and authentic published hook bytes", () => {
    expect(CLAUDE_SUPERMEMORY_COMMIT).toMatch(/^[a-f0-9]{40}$/);
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
