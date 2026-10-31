// Protects private snapshot integrity and exact lifecycle/root/generation binding.
import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readPreparedSessionStartContext } from "./start-context";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, {recursive:true, force:true}); });
test("prepared context requires private unchanged bytes and the current project, epoch and generation", () => {
  const root = mkdtempSync(join(tmpdir(), "deck-start-context-")); roots.push(root);
  const file = join(root, "context.json");
  const raw = JSON.stringify({root, epoch:"e", generation:"g", snapshotId:"snapshot", text:"prepared evidence"});
  writeFileSync(file, raw, {mode:0o600});
  const env = {DECK_SESSION_START_CONTEXT:file, DECK_SESSION_START_DIGEST:createHash("sha256").update(raw).digest("hex"), DECK_SESSION_START_EPOCH:"e", DECK_SESSION_START_GENERATION:"g"};
  expect(readPreparedSessionStartContext(root, env)).toBe("prepared evidence");
  expect(readPreparedSessionStartContext("/does-not-exist", {})).toBeUndefined();
  for (const key of ["DECK_SESSION_START_EPOCH", "DECK_SESSION_START_GENERATION", "DECK_SESSION_START_DIGEST"]) expect(() => readPreparedSessionStartContext(root, {...env,[key]:"stale"})).toThrow();
  expect(() => readPreparedSessionStartContext(tmpdir(), env)).toThrow("binding-mismatch");
  chmodSync(file, 0o644);
  expect(() => readPreparedSessionStartContext(root, env)).toThrow("untrusted");
  chmodSync(file, 0o600);
  const link = join(root,"link"); symlinkSync(file,link);
  expect(() => readPreparedSessionStartContext(root, {...env,DECK_SESSION_START_CONTEXT:link})).toThrow();
  writeFileSync(file, raw.replace("prepared evidence","tampered evidence"));
  expect(() => readPreparedSessionStartContext(root, env)).toThrow("digest-mismatch");
});
