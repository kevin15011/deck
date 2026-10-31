import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readChildInvocationId } from "./storage";

test("child identity ignores history UTF-8 split at the bounded read edge", () => {
  // protects: valid host identity is independent of model history and read chunk boundaries.
  // oracle: only the newline-delimited host header supplies invocation identity.
  const root = mkdtempSync(join(tmpdir(), "deck-child-header-"));
  const file = join(root, "child.jsonl");
  try {
    const header = JSON.stringify({ type: "session", id: "child", deckParent: "parent", deckTaskId: "task", cwd: root }) + "\n";
    const history = "x".repeat(8191 - Buffer.byteLength(header)) + "€\n";
    writeFileSync(file, header + history, { mode: 0o600 });
    expect(readChildInvocationId(file, "parent", "task", root)).toBe("child");
    expect(() => readChildInvocationId(file, "other", "task", root)).toThrow("binding mismatch");
    writeFileSync(file, Buffer.concat([Buffer.from('{"id":"'), Buffer.from([0xff]), Buffer.from('"}\n')]));
    expect(() => readChildInvocationId(file, "parent", "task", root)).toThrow();
    writeFileSync(file, "x".repeat(8192) + "\n");
    expect(() => readChildInvocationId(file, "parent", "task", root)).toThrow("header unavailable");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
