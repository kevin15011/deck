// Protects stat-only reuse and source invalidation; oracle: Slice 7 change-detection contract.
import { afterEach, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDeclaredSkillProvider } from "./declared-provider";
import { discoverSharedSkillCatalog } from "./shared";
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });
async function fixture() {
  const root = await fs.mkdtemp(join(tmpdir(), "skill-stats-")); roots.push(root);
  const skills = join(root, "skills");
  const write = async (name: string, description = name) => {
    const file = join(skills, name, "SKILL.md"); await fs.mkdir(join(skills, name), { recursive: true });
    await fs.writeFile(file, `---\nname: ${name}\ndescription: ${description}\n---\n`); return file;
  };
  const providers = [createDeclaredSkillProvider("codex", { roots: () => [{ id: "skills", root: skills, category: "user_runner", scope: "user" }] })];
  const scan = () => discoverSharedSkillCatalog({ projectRoot: root, providers });
  const save = async (catalog: Awaited<ReturnType<typeof scan>>) => { await fs.mkdir(join(root, ".atl"), { recursive: true }); await fs.writeFile(join(root, ".atl/skill-registry.md"), catalog.document); };
  return { root, skills, write, scan, save };
}
test("persisted stat fingerprints reuse unchanged descriptors and refresh only changed or added files", async () => {
  const f = await fixture(); const first = await f.write("first"); await f.write("second");
  const initial = await f.scan(); await f.save(initial);
  const open = spyOn(fs, "open");
  try {
    const same = await f.scan();
    expect(open.mock.calls.filter(([file]) => String(file).endsWith("SKILL.md"))).toHaveLength(0);
    expect(same.document).toBe(initial.document);
    open.mockClear();
    await f.write("second", "changed descriptor"); await f.write("added"); await fs.rm(first);
    const changed = await f.scan();
    expect(changed.frontmatter.records.map(r => r.name).sort()).toEqual(["added", "second"]);
    expect(changed.frontmatter.fingerprint).not.toBe(initial.frontmatter.fingerprint);
    expect(open.mock.calls.filter(([file]) => String(file).endsWith("SKILL.md"))).toHaveLength(2);
    expect(changed.document).not.toContain(f.root);
  } finally { open.mockRestore(); }
});
test("mtime alone invalidates metadata and a cached descriptor cannot bypass symlink containment", async () => {
  const f = await fixture(); const file = await f.write("first");
  const initial = await f.scan(); await f.save(initial);
  const stat = await fs.stat(file); await fs.utimes(file, stat.atime, new Date(stat.mtimeMs + 2000));
  const changed = await f.scan(); expect(changed.frontmatter.fingerprint).not.toBe(initial.frontmatter.fingerprint);
  await f.save(changed);
  const outside = join(f.root, "outside.md"); await fs.copyFile(file, outside); await fs.unlink(file); await fs.symlink(outside, file);
  const escaped = await f.scan(); expect(escaped.frontmatter.records).toHaveLength(0);
  expect(escaped.frontmatter.completeness).toBe("partial");
});
test("root and plugin generation changes invalidate cached descriptors while core roots reuse them", async () => {
  const f = await fixture(); await f.write("first");
  let generation = "one", root = f.skills;
  const providers = [createDeclaredSkillProvider("claude", { roots: () => [{ id: "plugin", root, generation, category: "deck_materialized", scope: "runner" }] })];
  const scan = () => discoverSharedSkillCatalog({ projectRoot: f.root, providers });
  await fs.mkdir(join(f.root, ".skills/core"), { recursive: true });
  await fs.writeFile(join(f.root, ".skills/core/SKILL.md"), "---\nname: core\n---\n");
  const initial = await scan(); await f.save(initial);
  const open = spyOn(fs, "open");
  try {
    expect((await scan()).document).toBe(initial.document);
    expect(open.mock.calls.filter(([file]) => String(file).endsWith("SKILL.md"))).toHaveLength(0);
    generation = "two";
    const next = await scan(); expect(next.frontmatter.fingerprint).not.toBe(initial.frontmatter.fingerprint);
    expect(open.mock.calls.filter(([file]) => String(file).endsWith("SKILL.md"))).toHaveLength(1);
    await f.save(next);
    root = join(f.root, "replacement"); await fs.cp(f.skills, root, { recursive: true, preserveTimestamps: true });
    expect((await scan()).frontmatter.fingerprint).not.toBe(next.frontmatter.fingerprint);
    await fs.rm(root, { recursive: true });
    expect((await scan()).frontmatter.records.map(row => row.name)).toEqual(["core"]);
  } finally { open.mockRestore(); }
});
