import { describe, expect, test } from "bun:test";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { CLAUDE_CODEBASE_RELEASES, inspectOwnedClaudeCodebase, installOwnedClaudeCodebase, pinnedClaudeCodebaseRelease } from "./codebase-native-artifact";

const sha = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
function tarMember(name: string, value: Buffer): Buffer {
  const header = Buffer.alloc(512);
  header.write(name);
  header.write(`${value.length.toString(8).padStart(11, "0")}\0`, 124);
  header[156] = 48;
  return Buffer.concat([header, value, Buffer.alloc((512 - value.length % 512) % 512)]);
}
function fixtureArchive(binary: Buffer, duplicate = false) {
  const members = [tarMember("codebase-memory-mcp", binary), tarMember("LICENSE", Buffer.from("MIT")), tarMember("install.sh", Buffer.from("not run")), tarMember("THIRD_PARTY_NOTICES.md", Buffer.from("fixture notice"))];
  return gzipSync(Buffer.concat([...members, ...(duplicate ? [members[0]!] : []), Buffer.alloc(1024)]));
}

describe("pinned Claude Codebase Memory native acquisition", () => {
  test("uses immutable upstream Linux/macOS release digests, not the npm shim", () => {
    expect(Object.keys(CLAUDE_CODEBASE_RELEASES).sort()).toEqual(["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"]);
    expect(pinnedClaudeCodebaseRelease("linux", "x64")?.archiveSha256).toBe("1f9e8293eb2bc5c05cfa27a7e8fc033da6d729ffad525ccfcdaa3fd606306683");
    expect(pinnedClaudeCodebaseRelease("win32", "x64")).toBeUndefined();
  });

  test("mocked release streams only the exact native binary into an owner-only Deck root", async () => {
    const home = await mkdtemp(join(tmpdir(), "deck-claude-codebase-native-"));
    const root = join(home, "native-v0.11.0");
    const binary = Buffer.from("fixture verified native binary; never executed");
    const archive = fixtureArchive(binary);
    const release = { asset: "fixture.tar.gz", archiveBytes: archive.length, archiveSha256: sha(archive), binaryBytes: binary.length, binarySha256: sha(binary) };
    try {
      expect(await installOwnedClaudeCodebase(root, release, { fetchArchive: async () => archive })).toBe("installed");
      expect(inspectOwnedClaudeCodebase(root, release)).toBe("ready");
      expect(await readFile(join(root, "codebase-memory-mcp"))).toEqual(binary);
      expect(await readdir(root)).toEqual(["codebase-memory-mcp"]);
      expect(await installOwnedClaudeCodebase(root, release, { fetchArchive: async () => { throw new Error("unnecessary download"); } })).toBe("unchanged");
      await writeFile(join(root, "unrelated"), "foreign");
      expect(inspectOwnedClaudeCodebase(root, release)).toBe("conflict");
    } finally { await rm(home, { recursive: true, force: true }); }
  });

  test("streams a non-aligned multi-chunk binary and skips ignored tar members without mixing padding into payload", async () => {
    const home = await mkdtemp(join(tmpdir(), "deck-claude-codebase-stream-"));
    const root = join(home, "native-v0.11.0");
    const binary = randomBytes(65_537);
    const archive = fixtureArchive(binary); // Includes three non-aligned ignored members after the binary.
    const release = { asset: "fixture.tar.gz", archiveBytes: archive.length, archiveSha256: sha(archive), binaryBytes: binary.length, binarySha256: sha(binary) };
    try {
      expect(await installOwnedClaudeCodebase(root, release, { fetchArchive: async () => archive })).toBe("installed");
      expect(await readFile(join(root, "codebase-memory-mcp"))).toEqual(binary);
      expect(await readdir(root)).toEqual(["codebase-memory-mcp"]);
      expect(inspectOwnedClaudeCodebase(root, release)).toBe("ready");
    } finally { await rm(home, { recursive: true, force: true }); }
  });

  test("rejects bad digest and unexpected archive entries before publication", async () => {
    const home = await mkdtemp(join(tmpdir(), "deck-claude-codebase-denial-"));
    const root = join(home, "native-v0.11.0");
    const binary = Buffer.from("fixture native binary");
    const archive = fixtureArchive(binary);
    const release = { asset: "fixture.tar.gz", archiveBytes: archive.length, archiveSha256: sha(archive), binaryBytes: binary.length, binarySha256: sha(binary) };
    try {
      await expect(installOwnedClaudeCodebase(root, release, { fetchArchive: async () => Buffer.from("bad") })).rejects.toThrow("integrity mismatch");
      expect(inspectOwnedClaudeCodebase(root, release)).toBe("absent");
      const duplicated = fixtureArchive(binary, true);
      await expect(installOwnedClaudeCodebase(root, { ...release, archiveBytes: duplicated.length, archiveSha256: sha(duplicated) }, { fetchArchive: async () => duplicated })).rejects.toThrow("untrusted");
      expect(inspectOwnedClaudeCodebase(root, release)).toBe("absent");
    } finally { await rm(home, { recursive: true, force: true }); }
  });
});
