import { afterEach, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { acquireRegistryLease } from "./registry-lease";

const fixtures: string[] = [];
async function fixture() {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "deck-lease-test-")));
  fixtures.push(root);
  return { root, lockRoot: path.join(root, "locks") };
}
afterEach(async () => { for (const root of fixtures.splice(0)) await fs.rm(root, { recursive: true, force: true }); });

// Protects exclusion after a contender closes; oracle: an independent process remains busy.
test("same-process contender cannot release the holder", async () => {
  const { root, lockRoot } = await fixture();
  const a = await acquireRegistryLease(root, { lockRoot, waitMs: 0 });
  expect(a.ok).toBe(true);
  const b = await acquireRegistryLease(root, { lockRoot, waitMs: 0 });
  expect(b.ok).toBe(false);
  if (!a.ok || b.ok) throw new Error("expected contention");
  const program = `const {acquireRegistryLease} = await import(process.argv[1]); const r = await acquireRegistryLease(process.argv[2], {lockRoot:process.argv[3],waitMs:0}); console.log(r.ok ? "acquired" : r.reason); if(r.ok) r.lease.release();`;
  const child = Bun.spawn([process.execPath, "-e", program, path.join(import.meta.dir, "registry-lease.ts"), root, lockRoot], { env: { ...process.env, HOME: root, XDG_STATE_HOME: root }, stdout: "pipe", stderr: "pipe" });
  expect((await new Response(child.stdout).text()).trim()).toBe("busy");
  expect(await child.exited).toBe(0);
  a.lease.release();
  const retry = await acquireRegistryLease(root, { lockRoot, waitMs: 0 });
  expect(retry.ok).toBe(true);
  if (retry.ok) retry.lease.release();
  const files = await fs.readdir(lockRoot);
  expect(files).toEqual([`${createHash("sha256").update(root).digest("hex")}.sqlite`]);
  expect((await fs.stat(path.join(lockRoot, files[0]!))).size).toBe(0);
});

// Protects nonblocking retry while a live writer finishes.
test("waiting contender acquires after release", async () => {
  const { root, lockRoot } = await fixture();
  const first = await acquireRegistryLease(root, { lockRoot, waitMs: 0 });
  if (!first.ok) throw new Error(first.reason);
  let released = false;
  const second = await acquireRegistryLease(root, { lockRoot, waitMs: 1000, sleep: async () => { first.lease.release(); released = true; } });
  expect(released).toBe(true);
  expect(second.ok).toBe(true);
  if (second.ok) second.lease.release();
});

// Protects live holders and crash release, including Node/Bun interoperability.
test("Node holder remains exclusive without expiry and SIGKILL releases it", async () => {
  const { root, lockRoot } = await fixture();
  await fs.mkdir(lockRoot, { mode: 0o700 });
  const file = path.join(lockRoot, `${createHash("sha256").update(root).digest("hex")}.sqlite`);
  const program = `const {DatabaseSync}=require('node:sqlite'); const db=new DatabaseSync(process.argv[1]); db.exec('BEGIN EXCLUSIVE'); console.log('HELD'); process.stdin.resume();`;
  const child = Bun.spawn(["node", "--no-warnings", "-e", program, file], { env: { ...process.env, HOME: root, XDG_STATE_HOME: root }, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  try {
    const reader = child.stdout.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain("HELD");
    await fs.chmod(file, 0o600);
    for (const now of [0, 60 * 60 * 1000]) {
      const result = await acquireRegistryLease(root, { lockRoot, waitMs: 0, now: () => now });
      expect(result.ok ? "acquired" : result.reason).toBe("busy");
      if (result.ok) result.lease.release();
    }
  } finally { child.kill("SIGKILL"); await child.exited; }
  const retry = await acquireRegistryLease(root, { lockRoot, waitMs: 0 });
  expect(retry.ok).toBe(true);
  if (retry.ok) retry.lease.release();
});

// Protects the private lock boundary and preserves foreign/corrupt bytes.
test("rejects unsafe and corrupt lock paths", async () => {
  const { root, lockRoot } = await fixture();
  await fs.mkdir(lockRoot, { mode: 0o755 });
  let result = await acquireRegistryLease(root, { lockRoot, waitMs: 0 });
  expect(result.ok ? "acquired" : result.reason).toBe("lock_root_unsafe");
  await fs.chmod(lockRoot, 0o700);
  const file = path.join(lockRoot, `${createHash("sha256").update(root).digest("hex")}.sqlite`);
  const target = path.join(root, "target");
  await fs.symlink(target, file);
  result = await acquireRegistryLease(root, { lockRoot, waitMs: 0 });
  expect(result.ok ? "acquired" : result.reason).toBe("lock_root_unsafe");
  await expect(fs.stat(target)).rejects.toThrow();
  await fs.unlink(file);
  await fs.writeFile(target, "foreign", { mode: 0o600 });
  await fs.link(target, file);
  result = await acquireRegistryLease(root, { lockRoot, waitMs: 0 });
  expect(result.ok ? "acquired" : result.reason).toBe("lock_root_unsafe");
  expect(await fs.readFile(target, "utf8")).toBe("foreign");
  await fs.unlink(file);
  await fs.writeFile(file, "garbage", { mode: 0o600 });
  result = await acquireRegistryLease(root, { lockRoot, waitMs: 0 });
  expect(result.ok ? "acquired" : result.reason).toBe("lock_unavailable");
  expect(await fs.readFile(file, "utf8")).toBe("garbage");
});

// Protects the lock inode from replacement by another user; oracle: unsafe ancestors cause no writes.
test("rejects untrusted ancestor ownership and writable modes before creating locks", async () => {
  for (const mode of [0o777, 0o775, 0o757]) {
    const { root, lockRoot } = await fixture();
    const parent = path.join(root, "parent");
    await fs.mkdir(parent, { mode });
    await fs.chmod(parent, mode);
    const result = await acquireRegistryLease(root, { lockRoot: path.join(parent, "locks"), waitMs: 0 });
    expect(result.ok ? "acquired" : result.reason).toBe("lock_root_unsafe");
    if (result.ok) result.lease.release();
    expect(await fs.readdir(parent)).toEqual([]);
  }
  const { root } = await fixture();
  const parent = path.join(root, "foreign");
  await fs.mkdir(parent);
  const result = await acquireRegistryLease(root, { lockRoot: path.join(parent, "locks"), waitMs: 0,
    lstat: async p => { const stat = await fs.lstat(p); return p === parent ? Object.assign(Object.create(Object.getPrototypeOf(stat)), stat, { uid: (process.getuid?.() ?? 0) + 10000 }) : stat; } });
  expect(result.ok ? "acquired" : result.reason).toBe("lock_root_unsafe");
  if (result.ok) result.lease.release();
  expect(await fs.readdir(parent)).toEqual([]);
});

// Protects ordinary homes and trusted root-owned ancestors, including sticky temporary parents.
test("accepts trusted root-owned ancestors and private home", async () => {
  const { root, lockRoot } = await fixture();
  const result = await acquireRegistryLease(root, { lockRoot, waitMs: 0,
    lstat: async p => { const stat = await fs.lstat(p); return p === path.dirname(root) ? Object.assign(Object.create(Object.getPrototypeOf(stat)), stat, { uid: 0, mode: (stat.mode & ~0o7777) | 0o1777 }) : stat; } });
  expect(result.ok).toBe(true);
  if (result.ok) result.lease.release();
});
