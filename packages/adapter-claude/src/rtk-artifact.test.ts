import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { CLAUDE_RTK_RELEASES, extractPinnedClaudeRtk, inspectOwnedClaudeRtk, installOwnedClaudeRtk, pinnedClaudeRtkRelease } from "./rtk-artifact";

const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
function tarball(binary: Buffer, name = "rtk") {
  const header = Buffer.alloc(512);
  header.write(name);
  header.write(`${binary.length.toString(8).padStart(11, "0")}\0`, 124);
  header[156] = 48;
  return gzipSync(Buffer.concat([header, binary, Buffer.alloc((512 - binary.length % 512) % 512), Buffer.alloc(1024)]));
}

describe("pinned Claude-safe RTK acquisition", () => {
  test("pins official checksums for Linux/macOS without a mutable shell installer", () => {
    expect(Object.keys(CLAUDE_RTK_RELEASES).sort()).toEqual(["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"]);
    expect(CLAUDE_RTK_RELEASES["linux-x64"].archiveSha256).toBe("bc2b8902b0d9c796c82ef45f16ae2307e17757afeca5ee156235a3dc7bda5f89");
    expect(pinnedClaudeRtkRelease("linux", "x64")?.binarySha256).toBe("23433a2a50bdeb12199cadd4b94b639238d6c38529fcba1c30c9295db5fa9517");
    expect(pinnedClaudeRtkRelease("win32", "x64")).toBeUndefined();
  });

  test("mocked immutable release publishes one owner-only binary, verifies it and reuses it", async () => {
    const home = await mkdtemp(join(tmpdir(), "deck-claude-rtk-owned-"));
    const root = join(home, "rtk-v0.50.0");
    const binary = Buffer.from("fixture rtk binary; never executed");
    const archive = tarball(binary);
    const release = { asset: "rtk-fixture.tar.gz", archiveBytes: archive.length, archiveSha256: sha(archive), binaryBytes: binary.length, binarySha256: sha(binary) };
    try {
      expect(await installOwnedClaudeRtk(root, release, { fetchArchive: async () => archive })).toBe("installed");
      expect(inspectOwnedClaudeRtk(root, release)).toBe("ready");
      expect(await installOwnedClaudeRtk(root, release, { fetchArchive: async () => { throw new Error("should not download twice"); } })).toBe("unchanged");
      expect(await readFile(join(root, "rtk"))).toEqual(binary);
      await writeFile(join(root, "foreign"), "unrelated");
      expect(inspectOwnedClaudeRtk(root, release)).toBe("conflict");
      expect(await readFile(join(root, "foreign"), "utf8")).toBe("unrelated");
    } finally { await rm(home, { recursive: true, force: true }); }
  });

  test("bad digest, archive path and foreign owned content cannot be published or overwritten", async () => {
    const home = await mkdtemp(join(tmpdir(), "deck-claude-rtk-denied-"));
    const root = join(home, "rtk-v0.50.0");
    const binary = Buffer.from("fixture rtk binary");
    const archive = tarball(binary);
    const release = { asset: "rtk-fixture.tar.gz", archiveBytes: archive.length, archiveSha256: sha(archive), binaryBytes: binary.length, binarySha256: sha(binary) };
    try {
      await expect(installOwnedClaudeRtk(root, release, { fetchArchive: async () => Buffer.from("corrupt") })).rejects.toThrow("integrity mismatch");
      expect(inspectOwnedClaudeRtk(root, release)).toBe("absent");
      const traversal = tarball(binary, "../escape");
      expect(() => extractPinnedClaudeRtk(traversal, { ...release, archiveBytes: traversal.length, archiveSha256: sha(traversal) })).toThrow("structure is invalid");
      await mkdir(root);
      await writeFile(join(root, "unrelated"), "preserve");
      await expect(installOwnedClaudeRtk(root, release, { fetchArchive: async () => archive })).rejects.toThrow("conflicts");
      expect(await readFile(join(root, "unrelated"), "utf8")).toBe("preserve");
    } finally { await rm(home, { recursive: true, force: true }); }
  });
});
