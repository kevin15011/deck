import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readSessionProjectInstructions } from "./session-project-instructions";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const parent = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), "deck-instructions-")));
  roots.push(parent);
  const root = join(parent, "project");
  mkdirSync(root);
  return { parent, root, file: join(root, "AGENTS.md") };
}

describe("readSessionProjectInstructions", () => {
  test("missing root file is optional and does not search ancestors or nested directories", () => {
    const e = fixture();
    writeFileSync(join(e.parent, "AGENTS.md"), "Ancestor rules");
    mkdirSync(join(e.root, "nested"));
    writeFileSync(join(e.root, "nested", "AGENTS.md"), "Nested rules");
    expect(readSessionProjectInstructions(e.root)).toBeUndefined();
  });

  test("preserves complete UTF-8 rules and rereads changes on the next turn", () => {
    const e = fixture();
    const content = "# Rules\n\nPreserve café and 日本語.\n";
    writeFileSync(e.file, content);
    expect(readSessionProjectInstructions(e.root)).toBe(content);
    writeFileSync(e.file, "Updated rules\n");
    expect(readSessionProjectInstructions(e.root)).toBe("Updated rules\n");
  });

  test("accepts empty and exactly 64 KiB regular files without truncation", () => {
    const e = fixture();
    writeFileSync(e.file, "");
    expect(readSessionProjectInstructions(e.root)).toBe("");
    const content = "x".repeat(64 * 1024);
    writeFileSync(e.file, content);
    expect(readSessionProjectInstructions(e.root)).toBe(content);
  });

  test("rejects oversized rules explicitly rather than supplying a truncated prefix", () => {
    const e = fixture();
    writeFileSync(e.file, "x".repeat(64 * 1024 + 1));
    expect(() => readSessionProjectInstructions(e.root)).toThrow("exceeds the 64 KiB limit");
  });

  test.each(["inside", "outside", "dangling"])("rejects %s symbolic links", (target) => {
    const e = fixture();
    const path = join(target === "inside" ? e.root : e.parent, "target.md");
    if (target !== "dangling") writeFileSync(path, "Must not read linked content");
    symlinkSync(path, e.file);
    expect(() => readSessionProjectInstructions(e.root)).toThrow("regular file without a symbolic link");
  });

  test("rejects directories and FIFOs without blocking", () => {
    const e = fixture();
    mkdirSync(e.file);
    expect(() => readSessionProjectInstructions(e.root)).toThrow("regular file");
    rmSync(e.file, { recursive: true });
    execFileSync("mkfifo", [e.file]);
    expect(() => readSessionProjectInstructions(e.root)).toThrow("regular file");
  });

  test.each([Buffer.from([0xc3, 0x28]), Buffer.from("Rules\0invalid")])("rejects non-text bytes without echoing the content", (content) => {
    const e = fixture();
    writeFileSync(e.file, content);
    expect(() => readSessionProjectInstructions(e.root)).toThrow("project-instructions-unavailable");
  });
});
