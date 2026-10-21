import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCodebaseCompatibilityInspector } from "./codebase-native-artifact";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const sha = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const binary = "#!/bin/sh\nprintf 'codebase-memory-mcp 0.11.0\\n'\n# build A\n";
const release = { asset: "fixture", archiveBytes: 0, archiveSha256: "", binaryBytes: Buffer.byteLength(binary), binarySha256: sha(binary) };
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "deck-codebase-compatibility-")); roots.push(root);
  const path = join(root, "codebase-memory-mcp"); writeFileSync(path, binary, { mode: 0o700 });
  return { root, path };
}

test("same-version, same-size wrong bytes are rejected and shared bytes remain untouched", () => {
  const { path } = fixture(); const wrong = binary.replace("build A", "build B"); writeFileSync(path, wrong);
  expect(createCodebaseCompatibilityInspector()(path, release)).toBe(false);
  expect(readFileSync(path, "utf8")).toBe(wrong);
});

test("verified shared reuse caches positive and negative hashes but invalidates on identity changes", () => {
  const { path, root } = fixture(); let hashes = 0;
  const inspect = createCodebaseCompatibilityInspector({ hashFile: (path) => { hashes++; return sha(readFileSync(path)); } });
  expect(inspect(path, release)).toBe(true); expect(inspect(path, release)).toBe(true); expect(hashes).toBe(1);
  writeFileSync(path, binary.replace("build A", "build B"));
  expect(inspect(path, release)).toBe(false); expect(inspect(path, release)).toBe(false); expect(hashes).toBe(2);
  writeFileSync(join(root, "replacement"), binary, { mode: 0o700 }); renameSync(join(root, "replacement"), path);
  expect(inspect(path, release)).toBe(true); expect(hashes).toBe(3);
  chmodSync(path, 0o600); expect(inspect(path, release)).toBe(false);
});

test("cache is bounded and separates release identities and symlink targets", () => {
  const { path, root } = fixture(); let hashes = 0;
  const inspect = createCodebaseCompatibilityInspector({ maxEntries: 1, hashFile: (path) => { hashes++; return sha(readFileSync(path)); } });
  const link = join(root, "link"); symlinkSync(path, link);
  expect(inspect(link, release)).toBe(true);
  expect(inspect(path, { ...release, binarySha256: "0".repeat(64) })).toBe(false);
  expect(inspect(path, release)).toBe(true); expect(hashes).toBe(3);
  const other = join(root, "other"); writeFileSync(other, binary.replace("build A", "build B"), { mode: 0o700 });
  rmSync(link); symlinkSync(other, link); expect(inspect(link, release)).toBe(false);
});

test("abortable preparation verification agrees with installation and does not swallow cancellation", async () => {
  const { verifyCodebaseExecutable } = await import("./codebase-native-artifact");
  const { path } = fixture(); const signal = new AbortController();
  expect(await verifyCodebaseExecutable(path, signal.signal, release)).toBe(true);
  writeFileSync(path, binary.replace("build A", "build B"));
  expect(await verifyCodebaseExecutable(path, signal.signal, release)).toBe(false);
  signal.abort(); await expect(verifyCodebaseExecutable(path, signal.signal, release)).rejects.toThrow();
});

test("a file changed during hashing is rejected without caching the stale success", () => {
  const { path } = fixture();
  const inspect = createCodebaseCompatibilityInspector({ hashFile: (path) => { writeFileSync(path, binary.replace("build A", "build B")); return sha(binary); } });
  expect(inspect(path, release)).toBe(false);
});
