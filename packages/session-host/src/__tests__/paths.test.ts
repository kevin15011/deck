import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, lstatSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  assertOutsideProject, assertPrivateFile, ensurePrivateDir, ensureStateLayout, resolveStatePaths, sessionPaths, sunPathLimit, writePrivateFile,
} from "../paths";
import { cleanupTempDirs, tempDir } from "./test-helpers";

afterEach(cleanupTempDirs);
const mode = (p: string) => lstatSync(p).mode & 0o777;

describe("resolveStatePaths", () => {
  test("defaults to ~/.local/state/deck", () => {
    const p = resolveStatePaths({ env: { HOME: "/home/u" }, uid: 7, platform: "linux", tmpdir: "/tmp" });
    expect(p.root).toBe("/home/u/.local/state/deck");
    expect(p.daemonDir).toBe("/home/u/.local/state/deck/daemon");
    expect(p.lockFile).toBe("/home/u/.local/state/deck/daemon/daemon.lock");
    expect(p.daemonInfoFile).toBe("/home/u/.local/state/deck/daemon/daemon.json");
    expect(p.sessionsDir).toBe("/home/u/.local/state/deck/sessions");
    expect(p.webDir).toBe("/home/u/.local/state/deck/web");
    expect(p.devicesFile).toBe("/home/u/.local/state/deck/web/devices.json");
    expect(p.logsDir).toBe("/home/u/.local/state/deck/logs");
    expect(p.socket).toEqual({ path: "/home/u/.local/state/deck/daemon/daemon.sock", dir: "/home/u/.local/state/deck/daemon", location: "state" });
  });

  test("honors an absolute XDG_STATE_HOME and ignores a relative one", () => {
    expect(resolveStatePaths({ env: { HOME: "/h", XDG_STATE_HOME: "/x/state" }, uid: 1, platform: "linux", tmpdir: "/tmp" }).root).toBe("/x/state/deck");
    expect(resolveStatePaths({ env: { HOME: "/h", XDG_STATE_HOME: "rel/state" }, uid: 1, platform: "linux", tmpdir: "/tmp" }).root).toBe("/h/.local/state/deck");
  });

  test("throws when neither HOME nor XDG_STATE_HOME can locate the state dir", () => {
    expect(() => resolveStatePaths({ env: {}, homedir: "", uid: 1, platform: "linux", tmpdir: "/tmp" })).toThrow(/state directory/i);
  });

  test("session and task paths are rooted under sessions/<id>", () => {
    const p = resolveStatePaths({ env: { HOME: "/h" }, uid: 1, platform: "linux", tmpdir: "/tmp" });
    const s = sessionPaths(p, "s-1");
    expect(s.dir).toBe("/h/.local/state/deck/sessions/s-1");
    expect(s.sessionFile).toBe("/h/.local/state/deck/sessions/s-1/session.json");
    expect(s.eventsDir).toBe("/h/.local/state/deck/sessions/s-1/events");
    expect(s.ledgerSnapshotFile).toBe("/h/.local/state/deck/sessions/s-1/ledger.snapshot.json");
    expect(s.taskDir("t-1")).toBe("/h/.local/state/deck/sessions/s-1/tasks/t-1");
    expect(s.taskCredentialFile("t-1")).toBe("/h/.local/state/deck/sessions/s-1/tasks/t-1/credential");
    expect(s.taskLeaseFile("t-1")).toBe("/h/.local/state/deck/sessions/s-1/tasks/t-1/lease.json");
  });

  test("rejects session and task ids that could traverse or hide", () => {
    const p = resolveStatePaths({ env: { HOME: "/h" }, uid: 1, platform: "linux", tmpdir: "/tmp" });
    for (const bad of ["", "..", "../x", "a/b", ".hidden", "a\0b", "x".repeat(65), "a b"]) {
      expect(() => sessionPaths(p, bad)).toThrow(/invalid/i);
    }
    expect(() => sessionPaths(p, "ok").taskDir("../escape")).toThrow(/invalid/i);
  });
});

describe("Unix socket path length (design 6.2)", () => {
  const long = "/" + "d".repeat(95); // state root = long + "/deck"; socket path > 104 bytes
  test("sun_path limits per platform", () => {
    expect(sunPathLimit("darwin")).toBe(104);
    expect(sunPathLimit("linux")).toBe(108);
  });

  test("a path that fits the limit stays in the state dir", () => {
    const p = resolveStatePaths({ env: { HOME: "/h", XDG_STATE_HOME: "/s" }, uid: 501, platform: "darwin", tmpdir: "/tmp" });
    expect(p.socket.location).toBe("state");
  });

  test("a too-long Darwin path falls back to $TMPDIR/deck-<uid>/daemon.sock", () => {
    const p = resolveStatePaths({ env: { HOME: "/h", XDG_STATE_HOME: long }, uid: 501, platform: "darwin", tmpdir: "/private/tmp/x" });
    expect(Buffer.byteLength(`${long}/deck/daemon/daemon.sock`)).toBeGreaterThanOrEqual(104);
    expect(p.socket).toEqual({ path: "/private/tmp/x/deck-501/daemon.sock", dir: "/private/tmp/x/deck-501", location: "tmp-fallback" });
  });

  test("the same path is still valid on Linux (limit 108)", () => {
    const p = resolveStatePaths({ env: { HOME: "/h", XDG_STATE_HOME: "/" + "d".repeat(80) }, uid: 501, platform: "linux", tmpdir: "/tmp" });
    expect(Buffer.byteLength(p.socket.path)).toBeGreaterThan(103);
    expect(p.socket.location).toBe("state");
  });

  test("throws a clear error when even the fallback is too long", () => {
    expect(() => resolveStatePaths({ env: { HOME: "/h", XDG_STATE_HOME: long }, uid: 501, platform: "darwin", tmpdir: "/" + "t".repeat(100) })).toThrow(/socket path/i);
  });
});

describe("private filesystem helpers (XR-3.2)", () => {
  test("ensureStateLayout creates every deck directory 0700 even under a permissive umask", () => {
    const base = tempDir();
    const paths = resolveStatePaths({ env: { HOME: base, XDG_STATE_HOME: join(base, "state") }, tmpdir: base });
    const previous = process.umask(0);
    try { ensureStateLayout(paths); } finally { process.umask(previous); }
    for (const dir of [paths.root, paths.daemonDir, paths.sessionsDir, paths.webDir, paths.logsDir]) expect(mode(dir)).toBe(0o700);
  });

  test("ensurePrivateDir tightens a loose directory the user owns", () => {
    const base = tempDir();
    const dir = join(base, "loose");
    mkdirSync(dir, { mode: 0o755 });
    chmodSync(dir, 0o755);
    ensurePrivateDir(dir);
    expect(mode(dir)).toBe(0o700);
  });

  test("ensurePrivateDir refuses symlinks and files", () => {
    const base = tempDir();
    mkdirSync(join(base, "real"), { mode: 0o700 });
    symlinkSync(join(base, "real"), join(base, "link"));
    writeFileSync(join(base, "file"), "x");
    expect(() => ensurePrivateDir(join(base, "link"))).toThrow(/symlink|not a directory/i);
    expect(() => ensurePrivateDir(join(base, "file"))).toThrow(/not a directory/i);
  });

  test("strict mode refuses (never tightens) a foreign-owner or loose directory", () => {
    const base = tempDir();
    const dir = join(base, "tmpfallback");
    mkdirSync(dir, { mode: 0o755 });
    chmodSync(dir, 0o755);
    expect(() => ensurePrivateDir(dir, { strict: true })).toThrow(/0700/);
    chmodSync(dir, 0o700);
    expect(() => ensurePrivateDir(dir, { strict: true, uid: (process.getuid?.() ?? 0) + 1 })).toThrow(/owner/i);
    expect(() => ensurePrivateDir(dir, { strict: true })).not.toThrow();
  });

  test("ensureStateLayout prepares and verifies the tmp fallback socket dir", () => {
    const base = tempDir();
    const uid = process.getuid?.() ?? 0;
    const long = join(base, "d".repeat(100));
    const tmp = join(base, "tmp");
    mkdirSync(tmp);
    const paths = resolveStatePaths({ env: { HOME: base, XDG_STATE_HOME: long }, uid, platform: "darwin", tmpdir: tmp });
    expect(paths.socket.location).toBe("tmp-fallback");
    ensureStateLayout(paths, { uid });
    expect(mode(paths.socket.dir)).toBe(0o700);
    // a hostile pre-created dir (wrong mode) must be refused, not tightened
    const hostile = resolveStatePaths({ env: { HOME: base, XDG_STATE_HOME: long }, uid: uid + 1, platform: "darwin", tmpdir: tmp });
    mkdirSync(hostile.socket.dir, { mode: 0o755, recursive: true });
    chmodSync(hostile.socket.dir, 0o755);
    expect(() => ensureStateLayout(hostile, { uid: uid + 1 })).toThrow();
  });

  test("writePrivateFile writes 0600 atomically and replaces existing content", () => {
    const base = tempDir();
    const file = join(base, "a.json");
    const previous = process.umask(0);
    try { writePrivateFile(file, "one"); writePrivateFile(file, "two"); } finally { process.umask(previous); }
    expect(mode(file)).toBe(0o600);
    expect(Bun.file(file).size).toBe(3);
    expect(() => assertPrivateFile(file)).not.toThrow();
  });

  test("assertPrivateFile rejects loose, symlinked and foreign files", () => {
    const base = tempDir();
    const file = join(base, "f");
    writeFileSync(file, "x", { mode: 0o644 });
    chmodSync(file, 0o644);
    expect(() => assertPrivateFile(file)).toThrow(/0600/);
    chmodSync(file, 0o600);
    symlinkSync(file, join(base, "l"));
    expect(() => assertPrivateFile(join(base, "l"))).toThrow(/symlink/i);
    expect(() => assertPrivateFile(file, { uid: (process.getuid?.() ?? 0) + 1 })).toThrow(/owner/i);
  });

  test("session data is refused inside a project repository", () => {
    expect(() => assertOutsideProject("/work/repo/.state/deck", "/work/repo")).toThrow(/project/i);
    expect(() => assertOutsideProject("/home/u/.local/state/deck", "/work/repo")).not.toThrow();
    expect(() => assertOutsideProject("/work/repo2/x", "/work/repo")).not.toThrow();
  });
});
