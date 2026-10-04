import { expect, test } from "bun:test";
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { childSessionPath, prepareChildSession } from "./storage";
import { clean, type Job } from "./jobs";

test("private exact history: no glob/latest lookup, parent/task/header binding and no symlink adoption", () => {
  const dir = mkdtempSync(join(tmpdir(), "deck-child-storage-"));
  try {
    const parentFile = join(dir, "parent.jsonl"); const job = { id: randomUUID(), childId: randomUUID(), parent: "parent", cwd: dir } as Job;
    const file = prepareChildSession(parentFile, job);
    expect(lstatSync(file).mode & 0o777).toBe(0o600); expect(lstatSync(dirname(file)).mode & 0o777).toBe(0o700);
    expect(JSON.parse(readFileSync(file, "utf8")).deckTaskId).toBe(job.id);
    expect(prepareChildSession(parentFile, job, true)).toBe(file);
    expect(childSessionPath(parentFile, "other", job.childId)).not.toBe(file);
    expect(() => prepareChildSession(parentFile, { ...job, id: randomUUID() }, true)).toThrow("binding mismatch");
    expect(() => prepareChildSession(parentFile, { ...job, childId: randomUUID() }, true)).toThrow("unavailable");
    chmodSync(file, 0o644); expect(() => prepareChildSession(parentFile, job, true)).toThrow("Unsafe"); chmodSync(file, 0o600);
    rmSync(file); const target = join(dir, "unrelated"); writeFileSync(target, "secret", { mode: 0o600 }); symlinkSync(target, file);
    expect(() => prepareChildSession(parentFile, job, true)).toThrow("Unsafe"); expect(readFileSync(target, "utf8")).toBe("secret");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test("symlinked storage directory refused before any child header is written", () => {
  const dir = mkdtempSync(join(tmpdir(), "deck-child-symlink-"));
  try {
    const target = join(dir, "elsewhere"); mkdirSync(target, { mode: 0o700 }); symlinkSync(target, join(dir, ".deck-subagents"));
    expect(() => prepareChildSession(join(dir, "parent"), { id: randomUUID(), childId: randomUUID(), parent: "p", cwd: dir } as Job)).toThrow("Unsafe");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test("untrusted terminal controls, credentials and output floods are bounded/redacted", () => {
  expect(clean("\x1b]0;title\x07\x1b[31mhello\u202e")).toBe("hello");
  expect(clean("Authorization: Bearer private-value token=secret-value")).not.toContain("private-value");
  expect(clean("a".repeat(100000))).toHaveLength(12000);
});
