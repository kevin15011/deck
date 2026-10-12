/**
 * State layout, permissions and Unix-socket path handling (XR-3.2, design 6.2).
 * Everything lives under the user state dir, never in a project repository.
 */
import { randomBytes } from "node:crypto";
import { chmodSync, closeSync, constants, fsyncSync, lstatSync, mkdirSync, openSync, renameSync, unlinkSync, writeSync } from "node:fs";
import { homedir as osHomedir, tmpdir as osTmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export type SocketLocation = { path: string; dir: string; location: "state" | "tmp-fallback" };

export type StatePaths = {
  root: string;
  daemonDir: string;
  lockFile: string;
  daemonInfoFile: string;
  sessionsDir: string;
  webDir: string;
  devicesFile: string;
  logsDir: string;
  socket: SocketLocation;
};

export type ResolveStatePathsOptions = {
  env?: Readonly<Record<string, string | undefined>>;
  homedir?: string;
  tmpdir?: string;
  uid?: number;
  platform?: NodeJS.Platform;
};

/** Maximum `sockaddr_un.sun_path` size in bytes, including the terminating NUL. */
export function sunPathLimit(platform: NodeJS.Platform = process.platform): number {
  return platform === "darwin" ? 104 : 108;
}

const currentUid = () => process.getuid?.() ?? 0;
const fitsSocket = (path: string, platform: NodeJS.Platform) => Buffer.byteLength(path) < sunPathLimit(platform);

export function resolveStatePaths(options: ResolveStatePathsOptions = {}): StatePaths {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const uid = options.uid ?? currentUid();
  const xdg = env.XDG_STATE_HOME;
  const home = env.HOME || (options.homedir ?? osHomedir());
  const base = xdg && isAbsolute(xdg) ? xdg : home && isAbsolute(home) ? join(home, ".local", "state") : undefined;
  if (!base) throw new Error("Cannot locate the user state directory: set HOME or an absolute XDG_STATE_HOME");
  const root = join(base, "deck");
  const daemonDir = join(root, "daemon");

  let socket: SocketLocation = { path: join(daemonDir, "daemon.sock"), dir: daemonDir, location: "state" };
  if (!fitsSocket(socket.path, platform)) {
    const dir = join(options.tmpdir ?? osTmpdir(), `deck-${uid}`);
    socket = { path: join(dir, "daemon.sock"), dir, location: "tmp-fallback" };
    if (!fitsSocket(socket.path, platform)) {
      throw new Error(`Unix socket path is too long for ${platform} (limit ${sunPathLimit(platform) - 1} bytes): ${socket.path}`);
    }
  }

  return {
    root,
    daemonDir,
    lockFile: join(daemonDir, "daemon.lock"),
    daemonInfoFile: join(daemonDir, "daemon.json"),
    sessionsDir: join(root, "sessions"),
    webDir: join(root, "web"),
    devicesFile: join(root, "web", "devices.json"),
    logsDir: join(root, "logs"),
    socket,
  };
}

const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
export function assertSafeSegment(value: string, label: string): string {
  if (typeof value !== "string" || !SAFE_SEGMENT.test(value) || value.includes("..")) throw new Error(`Invalid ${label}: ${JSON.stringify(value)}`);
  return value;
}

export type SessionPaths = {
  dir: string;
  sessionFile: string;
  eventsDir: string;
  ledgerSnapshotFile: string;
  tasksDir: string;
  taskDir(taskId: string): string;
  taskCredentialFile(taskId: string): string;
  taskLeaseFile(taskId: string): string;
};

export function sessionPaths(paths: StatePaths, sessionId: string): SessionPaths {
  const dir = join(paths.sessionsDir, assertSafeSegment(sessionId, "session id"));
  const tasksDir = join(dir, "tasks");
  const taskDir = (taskId: string) => join(tasksDir, assertSafeSegment(taskId, "task id"));
  return {
    dir,
    sessionFile: join(dir, "session.json"),
    eventsDir: join(dir, "events"),
    ledgerSnapshotFile: join(dir, "ledger.snapshot.json"),
    tasksDir,
    taskDir,
    taskCredentialFile: (taskId) => join(taskDir(taskId), "credential"),
    taskLeaseFile: (taskId) => join(taskDir(taskId), "lease.json"),
  };
}

export type PrivateDirOptions = { uid?: number; strict?: boolean };

/**
 * Create (0700) or verify a private directory. `strict` never repairs: used for shared
 * locations such as $TMPDIR where a pre-existing directory may belong to someone else.
 */
export function ensurePrivateDir(dir: string, options: PrivateDirOptions = {}): void {
  const uid = options.uid ?? currentUid();
  let stat = lstatOrUndefined(dir);
  if (!stat) {
    try { mkdirSync(dir, { mode: 0o700 }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    stat = lstatSync(dir);
    if (stat.isDirectory() && !stat.isSymbolicLink() && stat.uid === uid) { chmodSync(dir, 0o700); return; }
  }
  if (stat.isSymbolicLink()) throw new Error(`Refusing symlink for private directory: ${dir}`);
  if (!stat.isDirectory()) throw new Error(`Private path is not a directory: ${dir}`);
  if (stat.uid !== uid) throw new Error(`Private directory has the wrong owner: ${dir}`);
  if ((stat.mode & 0o077) !== 0) {
    if (options.strict) throw new Error(`Private directory must be 0700: ${dir}`);
    chmodSync(dir, 0o700);
  }
}

function lstatOrUndefined(path: string) {
  try { return lstatSync(path); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
}

/** Create the deck state tree with 0700 directories and verify the socket directory. */
export function ensureStateLayout(paths: StatePaths, options: { uid?: number } = {}): void {
  mkdirSync(dirname(paths.root), { recursive: true });
  for (const dir of [paths.root, paths.daemonDir, paths.sessionsDir, paths.webDir, paths.logsDir]) ensurePrivateDir(dir, options);
  if (paths.socket.location === "tmp-fallback") ensurePrivateDir(paths.socket.dir, { ...options, strict: true });
}

/** Atomic 0600 write: temp file (O_EXCL, no symlink follow), fsync, rename. */
export function writePrivateFile(file: string, data: string | Uint8Array): void {
  const temp = `${file}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  const fd = openSync(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
  try {
    const buffer = typeof data === "string" ? Buffer.from(data, "utf8") : data;
    for (let offset = 0; offset < buffer.length;) offset += writeSync(fd, buffer, offset, buffer.length - offset);
    fsyncSync(fd);
  } catch (error) {
    closeSync(fd);
    try { unlinkSync(temp); } catch { /* best effort */ }
    throw error;
  }
  closeSync(fd);
  renameSync(temp, file);
}

export function assertPrivateFile(file: string, options: { uid?: number } = {}): void {
  const stat = lstatSync(file);
  if (stat.isSymbolicLink()) throw new Error(`Refusing symlink for private file: ${file}`);
  if (!stat.isFile()) throw new Error(`Private path is not a regular file: ${file}`);
  if (stat.uid !== (options.uid ?? currentUid())) throw new Error(`Private file has the wrong owner: ${file}`);
  if ((stat.mode & 0o077) !== 0) throw new Error(`Private file must be 0600: ${file}`);
}

/** XR-3.2: no session data may live inside a project repository. */
export function assertOutsideProject(stateRoot: string, projectRoot: string): void {
  const rel = relative(resolve(projectRoot), resolve(stateRoot));
  if (rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel))) {
    throw new Error(`Session state must not live inside the project: ${stateRoot} is inside ${projectRoot}`);
  }
}
