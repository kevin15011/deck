import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import {
  CODEX_SUPERMEMORY_FILES,
  CODEX_SUPERMEMORY_TARBALL,
  CODEX_SUPERMEMORY_TARBALL_URL,
  extractCodexSupermemoryFiles,
  inspectCodexSupermemoryArtifact,
  installCodexSupermemoryArtifact,
} from "./supermemory-artifact";

const sha = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");

function ustar(entries: readonly (readonly [string, string])[]): Buffer {
  const blocks: Buffer[] = [];
  for (const [name, content] of entries) {
    const header = Buffer.alloc(512);
    header.write(name);
    header.write(`${Buffer.byteLength(content).toString(8).padStart(11, "0")}\0`, 124);
    header[156] = 48;
    blocks.push(header, Buffer.from(content), Buffer.alloc((512 - Buffer.byteLength(content) % 512) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}

const RECALL = "console.log('recall');\n";
const FLUSH = "console.log('flush');\n";
const manifest = [["recall.js", "package/dist/hooks/recall.js", sha(RECALL), Buffer.byteLength(RECALL)], ["flush.js", "package/dist/hooks/flush.js", sha(FLUSH), Buffer.byteLength(FLUSH)]] as const;
const fixture = () => {
  const tarball = ustar([["package/package.json", "{}"], ["package/dist/hooks/recall.js", RECALL], ["package/dist/hooks/flush.js", FLUSH], ["package/dist/hooks/session-start.js", "unused"]]);
  return { tarball, pin: { bytes: tarball.length, sha256: sha(tarball) } };
};

describe("pinned official Codex Supermemory artifact", () => {
  test("pins one immutable npm release and only the two documented hooks", () => {
    expect(CODEX_SUPERMEMORY_TARBALL_URL).toBe("https://registry.npmjs.org/codex-supermemory/-/codex-supermemory-1.0.19.tgz");
    expect(CODEX_SUPERMEMORY_TARBALL.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(CODEX_SUPERMEMORY_FILES.map((entry) => entry[0])).toEqual(["recall.js", "flush.js"]);
    for (const entry of CODEX_SUPERMEMORY_FILES) expect(entry[2]).toMatch(/^[a-f0-9]{64}$/);
  });

  test("extracts only pinned hooks after verifying archive and per-file integrity", () => {
    const { tarball, pin } = fixture();
    const files = extractCodexSupermemoryFiles(tarball, manifest, pin);
    expect([...files.keys()]).toEqual(["recall.js", "flush.js"]);
    expect(files.get("recall.js")!.toString()).toBe(RECALL);
    expect(() => extractCodexSupermemoryFiles(tarball, manifest, { ...pin, sha256: "0".repeat(64) })).toThrow(/integrity/);
    const swapped = ustar([["package/dist/hooks/recall.js", "evil"], ["package/dist/hooks/flush.js", FLUSH]]);
    expect(() => extractCodexSupermemoryFiles(swapped, manifest, { bytes: swapped.length, sha256: sha(swapped) })).toThrow(/file integrity/);
    const missing = ustar([["package/dist/hooks/recall.js", RECALL]]);
    expect(() => extractCodexSupermemoryFiles(missing, manifest, { bytes: missing.length, sha256: sha(missing) })).toThrow(/missing/);
  });

  test("publishes owner-only files, reuses a ready root, and fails closed on foreign or tampered content", async () => {
    const parent = await mkdtemp(join(tmpdir(), "deck-codex-sm-artifact-"));
    await chmod(parent, 0o700);
    const root = join(parent, "official-supermemory-1.0.19");
    try {
      const { tarball, pin } = fixture();
      let fetches = 0;
      const effects = { fetchTarball: async () => { fetches += 1; return tarball; }, pin };
      expect(inspectCodexSupermemoryArtifact(root, manifest)).toBe("absent");
      expect(await installCodexSupermemoryArtifact(root, effects, manifest)).toBe("installed");
      expect(inspectCodexSupermemoryArtifact(root, manifest)).toBe("ready");
      expect((await readdir(root)).sort()).toEqual(["flush.js", "recall.js"]);
      expect(await readFile(join(root, "recall.js"), "utf8")).toBe(RECALL);
      expect(await installCodexSupermemoryArtifact(root, effects, manifest)).toBe("unchanged");
      expect(fetches).toBe(1);

      await writeFile(join(root, "extra.js"), "x", { mode: 0o600 });
      expect(inspectCodexSupermemoryArtifact(root, manifest)).toBe("conflict");
      await expect(installCodexSupermemoryArtifact(root, effects, manifest)).rejects.toThrow(/conflicts/);
      await rm(join(root, "extra.js"));
      await writeFile(join(root, "recall.js"), "tampered", { mode: 0o600 });
      expect(inspectCodexSupermemoryArtifact(root, manifest)).toBe("conflict");
      await writeFile(join(root, "recall.js"), RECALL, { mode: 0o600 });
      await chmod(join(root, "recall.js"), 0o644);
      expect(inspectCodexSupermemoryArtifact(root, manifest)).toBe("conflict");
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  test("a download that fails integrity publishes nothing", async () => {
    const parent = await mkdtemp(join(tmpdir(), "deck-codex-sm-artifact-bad-"));
    await chmod(parent, 0o700);
    const root = join(parent, "official-supermemory-1.0.19");
    try {
      const { tarball, pin } = fixture();
      await expect(installCodexSupermemoryArtifact(root, { fetchTarball: async () => tarball, pin: { ...pin, sha256: "1".repeat(64) } }, manifest)).rejects.toThrow(/integrity/);
      expect(inspectCodexSupermemoryArtifact(root, manifest)).toBe("absent");
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
});
