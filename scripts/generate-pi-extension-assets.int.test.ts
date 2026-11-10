import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { verifyPiExtensionAsset } from "./generate-pi-extension-assets";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

// Protects CI freshness: canonical generation must match both checked-in artifacts,
// including executable code and source metadata. Check mode must never repair them.
test("checked-in Pi extensions match canonical generation", () => {
  // Bun's test resolver differs from the production bundler (also see test-preload.ts).
  const result = Bun.spawnSync([process.execPath, "run", resolve(import.meta.dir, "generate-pi-extension-assets.ts"), "--check"], {
    cwd: resolve(import.meta.dir, ".."), stdout: "pipe", stderr: "pipe",
  });
  if (!result.success) throw new Error(result.stderr.toString());
});

// Oracle: a required generated file must exist and match every byte of generation.
// These faults cover a forged current digest over stale code, stale metadata, and absence.
test("freshness rejects missing files and independent metadata/body edits without writing", () => {
  const root = mkdtempSync(join(tmpdir(), "deck-pi-freshness-"));
  roots.push(root);
  const output = join(root, "extension.generated.js");
  const expected = "// source-sha256:current\nexport default 1;\n";
  expect(() => verifyPiExtensionAsset(output, expected)).toThrow(/ENOENT/);
  for (const stale of [expected.replace("current", "old"), expected.replace("default 1", "default 2")]) {
    writeFileSync(output, stale);
    expect(() => verifyPiExtensionAsset(output, expected)).toThrow(/Stale Pi extension asset/);
    expect(readFileSync(output, "utf8")).toBe(stale);
  }
  writeFileSync(output, expected);
  expect(() => verifyPiExtensionAsset(output, expected)).not.toThrow();
});
