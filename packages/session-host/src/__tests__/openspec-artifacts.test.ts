import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { listOpenSpecArtifacts, readOpenSpecArtifact } from "../openspec-artifacts";
import { cleanupTempDirs, tempDir } from "./test-helpers";

afterEach(cleanupTempDirs);
function fixture() {
  const projectRoot = tempDir("openspec-viewer-");
  const changes = join(projectRoot, "openspec", "changes");
  const write = (path: string, text = "# Proposal\n\nA **read-only** artifact.") => {
    const file = join(changes, path);
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, text);
    return file;
  };
  return { projectRoot, changes, write };
}

describe("session-scoped OpenSpec artifact reader", () => {
  test("lists only active changes and Markdown artifacts, with nested paths and metadata", () => {
    const f = fixture();
    f.write("alpha/proposal.md"); f.write("alpha/specs/session/spec.md");
    f.write("alpha/state.yaml"); f.write("alpha/.private/secret.md");
    f.write("beta/tasks.md"); f.write("archive/old/proposal.md");
    const result = listOpenSpecArtifacts({ projectRoot: f.projectRoot });
    expect(result).toMatchObject({ ok: true, data: { changes: [
      { changeId: "alpha", artifacts: [{ path: "proposal.md" }, { path: "specs/session/spec.md" }] },
      { changeId: "beta", artifacts: [{ path: "tasks.md" }] },
    ] } });
    if (!result.ok) throw new Error("expected catalog");
    expect((result.data as any).changes[0].artifacts[0]).toMatchObject({ sizeBytes: Buffer.byteLength("# Proposal\n\nA **read-only** artifact."), updatedAt: expect.any(String) });
  });

  test("bound sessions cannot list or read another change and reading never creates a tree", () => {
    const f = fixture(); f.write("alpha/tasks.md"); f.write("beta/tasks.md");
    const scope = { projectRoot: f.projectRoot, changeId: "alpha" };
    expect(listOpenSpecArtifacts(scope)).toMatchObject({ ok: true, data: { boundChangeId: "alpha", changes: [{ changeId: "alpha" }] } });
    expect(readOpenSpecArtifact(scope, "beta", "tasks.md")).toMatchObject({ ok: false, code: "openspec-forbidden" });
    expect(readOpenSpecArtifact(scope, "alpha", "tasks.md")).toMatchObject({ ok: true, data: { changeId: "alpha", path: "tasks.md", markdown: "# Proposal\n\nA **read-only** artifact." } });
    const empty = tempDir();
    expect(listOpenSpecArtifacts({ projectRoot: empty })).toEqual({ ok: true, data: { changes: [] } });
    expect(readOpenSpecArtifact({ projectRoot: empty }, "alpha", "tasks.md")).toMatchObject({ ok: false, code: "openspec-not-found" });
  });

  test.each(["../tasks.md", "/tasks.md", "specs//tasks.md", "specs/./tasks.md", "specs/../tasks.md", "specs\\tasks.md", "tasks.md\0", "%2e%2e/tasks.md", "state.yaml", ".secret.md"])("rejects unsafe or non-Markdown path %j", (path) => {
    const f = fixture(); f.write("alpha/tasks.md");
    expect(readOpenSpecArtifact({ projectRoot: f.projectRoot }, "alpha", path)).toMatchObject({ ok: false, code: "openspec-invalid" });
  });

  test.each(["archive", "ARCHIVE", "../alpha", "/alpha", "a\\b", "a%2fb", "", "alpha\0"])("rejects invalid or archived change %j", (changeId) => {
    const f = fixture();
    expect(readOpenSpecArtifact({ projectRoot: f.projectRoot }, changeId, "tasks.md")).toMatchObject({ ok: false, code: "openspec-invalid" });
  });

  test("refuses symlink files, change directories and nested directories without leaking paths", () => {
    const f = fixture(), external = tempDir();
    writeFileSync(join(external, "secret.md"), "private");
    f.write("alpha/tasks.md");
    symlinkSync(join(external, "secret.md"), join(f.changes, "alpha", "linked.md"));
    symlinkSync(external, join(f.changes, "alpha", "nested"));
    symlinkSync(external, join(f.changes, "linked"));
    for (const [changeId, path] of [["alpha", "linked.md"], ["alpha", "nested/secret.md"], ["linked", "secret.md"]]) {
      const result = readOpenSpecArtifact({ projectRoot: f.projectRoot }, changeId!, path!);
      expect(result).toEqual({ ok: false, code: "openspec-forbidden", message: "OpenSpec artifact access is not allowed." });
      expect(JSON.stringify(result)).not.toContain(external);
    }
    expect(listOpenSpecArtifacts({ projectRoot: f.projectRoot })).toMatchObject({ ok: true, data: { changes: [{ changeId: "alpha", artifacts: [{ path: "tasks.md" }] }] } });
  });

  test.each(["openspec", "changes"])("rejects a symlinked %s root", (part) => {
    const f = fixture(), external = tempDir();
    mkdirSync(join(f.projectRoot, "openspec"), { recursive: true });
    symlinkSync(external, part === "openspec" ? (rmSync(join(f.projectRoot, "openspec"), { recursive: true }), join(f.projectRoot, "openspec")) : f.changes);
    expect(listOpenSpecArtifacts({ projectRoot: f.projectRoot })).toMatchObject({ ok: false, code: "openspec-forbidden" });
    expect(readOpenSpecArtifact({ projectRoot: f.projectRoot }, "alpha", "tasks.md")).toMatchObject({ ok: false, code: "openspec-forbidden" });
  });

  test("returns current content, missing/deleted and oversized artifacts safely", () => {
    const f = fixture(), file = f.write("alpha/tasks.md", "first");
    expect(readOpenSpecArtifact({ projectRoot: f.projectRoot }, "alpha", "tasks.md")).toMatchObject({ ok: true, data: { markdown: "first" } });
    writeFileSync(file, "updated");
    expect(readOpenSpecArtifact({ projectRoot: f.projectRoot }, "alpha", "tasks.md")).toMatchObject({ ok: true, data: { markdown: "updated" } });
    writeFileSync(file, Buffer.alloc(1024 * 1024 + 1, 97));
    expect(readOpenSpecArtifact({ projectRoot: f.projectRoot }, "alpha", "tasks.md")).toMatchObject({ ok: false, code: "openspec-too-large" });
    rmSync(file);
    expect(readOpenSpecArtifact({ projectRoot: f.projectRoot }, "alpha", "tasks.md")).toMatchObject({ ok: false, code: "openspec-not-found" });
    expect(readOpenSpecArtifact({ projectRoot: f.projectRoot }, "missing", "tasks.md")).toMatchObject({ ok: false, code: "openspec-not-found" });
    mkdirSync(file);
    expect(readOpenSpecArtifact({ projectRoot: f.projectRoot }, "alpha", "tasks.md")).toMatchObject({ ok: false, code: "openspec-not-found" });
  });

  test("bounds enumeration and nested depth", () => {
    const f = fixture();
    for (let i = 0; i < 501; i++) f.write(`alpha/doc-${i}.md`, "text");
    expect(listOpenSpecArtifacts({ projectRoot: f.projectRoot })).toMatchObject({ ok: false, code: "openspec-limit" });
    expect(readOpenSpecArtifact({ projectRoot: f.projectRoot }, "alpha", "a/b/c/d/e/f/g/h/i.md")).toMatchObject({ ok: false, code: "openspec-invalid" });
  });
});
