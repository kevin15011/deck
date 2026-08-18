#!/usr/bin/env bun
/// <reference types="bun" />

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { buildBinary, codeSign, getHostBuildTarget, getVersion, type BuildTarget } from "./build-binaries";

export const CANARY_BINARY_NAME = "deck-canary";
const PAYLOAD_PREFIX = ".deck-canary.payload-";
const LOCK_DIR_NAME = ".deck-canary.lock";
const TXN_PREFIX = ".deck-canary.txn-";
const ALIAS_TMP_PREFIX = ".deck-canary.alias-";
const PAYLOAD_RE = /^\.deck-canary\.payload-[a-f0-9]{64}$/;

type ParsedCanaryArgs = { help: boolean; dryRun: boolean; installDir: string; targetPath: string };
type CanaryFs = Pick<typeof fs,
  | "existsSync" | "mkdirSync" | "mkdtempSync" | "lstatSync" | "readdirSync" | "readFileSync" | "writeFileSync"
  | "chmodSync" | "renameSync" | "rmSync" | "copyFileSync" | "closeSync" | "openSync" | "symlinkSync" | "readlinkSync"
>;
type CanaryStats = NonNullable<ReturnType<typeof fs.lstatSync>>;
type CanaryInstallDeps = {
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  cwd?: string;
  platform?: NodeJS.Platform;
  arch?: string;
  stdout?: Pick<typeof console, "log" | "warn">;
  stderr?: Pick<typeof console, "error">;
  fs?: CanaryFs;
  spawnSync?: typeof Bun.spawnSync;
  buildCanaryBinary?: (options: { target: BuildTarget; version: string; outputDir: string }) => Promise<string>;
  tempDir?: () => string;
  randomToken?: () => string;
  now?: () => number;
  effectiveUid?: () => number | undefined;
  effectiveGid?: () => number | undefined;
  pidAlive?: (pid: number) => "alive" | "dead" | "indeterminate";
  hooks?: Partial<Record<"afterStagedSmoke" | "beforeAliasCommit" | "afterAliasCommit", (context: { targetPath: string; payloadName: string; transactionDir: string }) => void>>;
};
type LockHandle = { path: string; token: string };

const HELP = `Install a checkout-built Deck canary binary.

Usage:
  bun run canary:install [-- --dir <absolute-or-home-relative-dir>]
  bun run canary:install -- --dry-run

Options:
  --dir <dir>  Install directory. Defaults to DECK_CANARY_BIN_DIR, then ~/.local/bin.
  --dry-run    Print the planned install path without compiling or writing.
  --help, -h   Show this help.

The installed command is an atomic relative symlink named deck-canary pointing
at an immutable digest-named payload in the same directory. Old digest payloads
may remain for manual rollback by retargeting the alias. This command does not
regenerate tracked source assets, build release archives, prepare release
descriptors, modify shell profiles, or replace the stable deck binary.
`;

function stripControl(value: string, limit = 2000): string {
  return value.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "").slice(0, limit);
}
function isEnoent(error: unknown): boolean { return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "ENOENT"; }
function token(deps: CanaryInstallDeps): string { return deps.randomToken?.() ?? crypto.randomBytes(16).toString("hex"); }
function defaultUserCanaryInstallDir(homeDir: string): string { return path.join(homeDir, ".local", "bin"); }
function defaultInstallDir(env: NodeJS.ProcessEnv, homeDir: string): string { return env.DECK_CANARY_BIN_DIR?.trim() ? env.DECK_CANARY_BIN_DIR : defaultUserCanaryInstallDir(homeDir); }
function expandHome(input: string, homeDir: string): string {
  if (input === "~") return homeDir;
  if (input.startsWith("~/") || input.startsWith(`~${path.sep}`)) return path.join(homeDir, input.slice(2));
  if (input.startsWith("~")) throw new Error("--dir supports only '~' or '~/' home-relative paths.");
  return input;
}
function validateInstallDir(input: string, homeDir: string): string {
  if (!input) throw new Error("Install directory must not be empty.");
  if (input.includes("\0")) throw new Error("Install directory must not contain NUL bytes.");
  const expanded = expandHome(input, homeDir);
  if (!path.isAbsolute(expanded)) throw new Error("Install directory must be absolute or home-relative with '~'.");
  const parts = expanded.split(path.sep).filter(Boolean);
  if (parts.some((part) => part === "." || part === "..")) throw new Error("Install directory must not contain '.' or '..' path segments.");
  const normalized = path.normalize(expanded);
  if (normalized === path.parse(normalized).root) throw new Error("Refusing to install directly into the filesystem root.");
  return normalized;
}
export function parseCanaryInstallArgs(argv: string[], deps: CanaryInstallDeps = {}): ParsedCanaryArgs {
  const env = deps.env ?? process.env;
  const homeDir = deps.homeDir ?? os.homedir();
  const rawArgs = argv[0]?.includes("install-canary") || argv[0]?.endsWith("bun") ? argv.slice(2) : argv;
  let help = false; let dryRun = false; let dirValue: string | undefined;
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index]!;
    if (arg === "--") continue;
    if (arg === "--help" || arg === "-h") { help = true; continue; }
    if (arg === "--dry-run") { dryRun = true; continue; }
    if (arg === "--dir") {
      const next = rawArgs[index + 1];
      if (!next || next.startsWith("--")) throw new Error("--dir requires a directory value.");
      dirValue = next; index += 1; continue;
    }
    if (arg.startsWith("--dir=")) { const value = arg.slice("--dir=".length); if (!value) throw new Error("--dir requires a directory value."); dirValue = value; continue; }
    if (arg.startsWith("-")) throw new Error(`Unknown flag: ${arg}`);
    throw new Error(`Unexpected positional argument: ${arg}`);
  }
  const installDir = validateInstallDir(dirValue ?? defaultInstallDir(env, homeDir), homeDir);
  return { help, dryRun, installDir, targetPath: path.join(installDir, CANARY_BINARY_NAME) };
}

function lstatMaybe(targetPath: string, f: CanaryFs): CanaryStats | undefined { try { return f.lstatSync(targetPath) as CanaryStats; } catch (e) { if (isEnoent(e)) return undefined; throw e; } }
function digestFile(filePath: string, f: CanaryFs): string { return crypto.createHash("sha256").update(f.readFileSync(filePath)).digest("hex"); }
function effectiveUid(deps: CanaryInstallDeps = {}): number | undefined { return deps.effectiveUid?.() ?? (typeof process.geteuid === "function" ? process.geteuid() : undefined); }
function effectiveGid(deps: CanaryInstallDeps = {}): number | undefined { return deps.effectiveGid?.() ?? (typeof process.getegid === "function" ? process.getegid() : undefined); }
function isTrustedGroupWritableDefaultDir(dir: string, stat: CanaryStats, deps: CanaryInstallDeps): boolean {
  const uid = effectiveUid(deps);
  const gid = effectiveGid(deps);
  if (uid === undefined || gid === undefined) return false;
  if (Number(stat.uid) !== uid || Number(stat.gid) !== gid) return false;
  const homeDir = deps.homeDir ?? os.homedir();
  return dir === validateInstallDir(defaultUserCanaryInstallDir(homeDir), homeDir);
}
function validateExistingDirectory(dir: string, f: CanaryFs, deps: CanaryInstallDeps): void {
  const stat = lstatMaybe(dir, f);
  if (!stat) return;
  if (stat.isSymbolicLink()) throw new Error(`Refusing symlink install path component: ${dir}`);
  if (!stat.isDirectory()) throw new Error(`Install path component is not a directory: ${dir}`);
  const uid = effectiveUid(deps);
  if (uid !== undefined && Number(stat.uid) !== uid) throw new Error(`Install directory is not owned by the current user: ${dir}`);
  if ((Number(stat.mode) & 0o002) !== 0) throw new Error(`Install directory must not be world writable: ${dir}`);
  if ((Number(stat.mode) & 0o020) !== 0) {
    if (!isTrustedGroupWritableDefaultDir(dir, stat, deps)) throw new Error(`Install directory must not be group writable unless it is the user-owned primary-group default canary directory: ${dir}`);
    (deps.stdout ?? console).warn("Warning: accepting group-writable default canary directory because it is user-owned and primary-group-owned.");
  }
}
function ensureSafeInstallDirectory(installDir: string, f: CanaryFs, deps: CanaryInstallDeps): void {
  const root = path.parse(installDir).root;
  let cursor = root;
  for (const part of path.relative(root, installDir).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    const stat = lstatMaybe(cursor, f);
    if (!stat) { f.mkdirSync(cursor, { mode: 0o755 }); continue; }
    if (stat.isSymbolicLink()) throw new Error(`Refusing symlink install path component: ${cursor}`);
    if (!stat.isDirectory()) throw new Error(`Install path component is not a directory: ${cursor}`);
  }
  validateExistingDirectory(installDir, f, deps);
}
function validatePayloadName(name: string): void { if (!PAYLOAD_RE.test(name)) throw new Error(`Invalid deck-canary payload name: ${name}`); }
function validatePayload(pathName: string, expectedDigest: string, f: CanaryFs): void {
  const stat = lstatMaybe(pathName, f);
  if (!stat || stat.isSymbolicLink() || !stat.isFile()) throw new Error(`Invalid deck-canary payload: ${pathName}`);
  if ((Number(stat.mode) & 0o777) !== 0o755) throw new Error(`Invalid deck-canary payload mode: ${pathName}`);
  const uid = effectiveUid();
  if (uid !== undefined && Number(stat.uid) !== uid) throw new Error(`Invalid deck-canary payload owner: ${pathName}`);
  if (digestFile(pathName, f) !== expectedDigest) throw new Error(`Invalid deck-canary payload digest: ${pathName}`);
}
function validateExistingAlias(aliasPath: string, installDir: string, f: CanaryFs): void {
  const stat = lstatMaybe(aliasPath, f);
  if (!stat) return;
  if (!stat.isSymbolicLink()) throw new Error(`Refusing to replace non-symlink deck-canary target: ${aliasPath}`);
  const link = f.readlinkSync(aliasPath);
  if (path.isAbsolute(link) || link.includes("/") || link.includes("\\") || link === "deck" || link.includes("..")) throw new Error(`Refusing unsafe deck-canary alias target: ${link}`);
  validatePayloadName(link);
  validatePayload(path.join(installDir, link), link.slice(PAYLOAD_PREFIX.length), f);
}
function pidState(pid: number, deps: CanaryInstallDeps): "alive" | "dead" | "indeterminate" {
  if (deps.pidAlive) return deps.pidAlive(pid);
  try { process.kill(pid, 0); return "alive"; } catch (e) { return (e as NodeJS.ErrnoException).code === "ESRCH" ? "dead" : "indeterminate"; }
}
function acquireLock(installDir: string, deps: CanaryInstallDeps, f: CanaryFs): LockHandle {
  const lockPath = path.join(installDir, LOCK_DIR_NAME);
  const ownerToken = token(deps);
  try {
    f.mkdirSync(lockPath, { mode: 0o700 });
  } catch (error) {
    if (!isEnoent(error)) {
      const metaPath = path.join(lockPath, "owner.json");
      try {
        const stat = lstatMaybe(lockPath, f);
        const metaStat = lstatMaybe(metaPath, f);
        if (!stat?.isDirectory() || stat.isSymbolicLink() || !metaStat?.isFile() || metaStat.isSymbolicLink()) throw new Error("invalid lock metadata");
        const meta = JSON.parse(f.readFileSync(metaPath, "utf-8")) as { pid?: number; createdAt?: number; ownerToken?: string };
        if (typeof meta.pid !== "number" || typeof meta.createdAt !== "number" || typeof meta.ownerToken !== "string") throw new Error("invalid lock metadata");
        const state = pidState(meta.pid, deps);
        if (state !== "dead") throw new Error(`deck-canary install lock is ${state}; remove ${lockPath} only after verifying no canary installer is active.`);
        f.rmSync(lockPath, { recursive: true, force: true });
        f.mkdirSync(lockPath, { mode: 0o700 });
      } catch (lockError) {
        throw new Error(lockError instanceof Error ? lockError.message : `Cannot acquire deck-canary install lock at ${lockPath}.`);
      }
    } else {
      throw error;
    }
  }
  const metaPath = path.join(lockPath, "owner.json");
  const fd = f.openSync(metaPath, "wx", 0o600);
  try { f.writeFileSync(fd, JSON.stringify({ pid: process.pid, createdAt: deps.now?.() ?? Date.now(), ownerToken }, null, 2)); } finally { f.closeSync(fd); }
  f.chmodSync(metaPath, 0o600);
  return { path: lockPath, token: ownerToken };
}
function releaseLock(lock: LockHandle | undefined, f: CanaryFs): void {
  if (!lock) return;
  try {
    const meta = JSON.parse(f.readFileSync(path.join(lock.path, "owner.json"), "utf-8")) as { ownerToken?: string };
    if (meta.ownerToken === lock.token) f.rmSync(lock.path, { recursive: true, force: true });
  } catch {}
}
function cleanupOwnedTransactions(installDir: string, f: CanaryFs): void {
  for (const entry of f.readdirSync(installDir)) {
    if (!entry.startsWith(TXN_PREFIX) && !entry.startsWith(ALIAS_TMP_PREFIX)) continue;
    const full = path.join(installDir, entry);
    const stat = lstatMaybe(full, f);
    if (!stat) continue;
    if (stat.isSymbolicLink()) { f.rmSync(full, { force: true }); continue; }
    if (!stat.isDirectory()) throw new Error(`Refusing suspicious canary artifact: ${full}`);
    f.rmSync(full, { recursive: true, force: true });
  }
}
function smokeBinary(binaryPath: string, deps: CanaryInstallDeps, phase: string): void {
  const result = (deps.spawnSync ?? Bun.spawnSync)({ cmd: [binaryPath, "version"], env: { PATH: "" }, cwd: deps.cwd ?? process.cwd() });
  if (!result.success) throw new Error(`${phase} deck-canary version smoke failed. ${stripControl(new TextDecoder().decode(result.stderr) || new TextDecoder().decode(result.stdout))}`.trim());
}
function createPayload(compiledPath: string, payloadPath: string, digest: string, f: CanaryFs): void {
  const existing = lstatMaybe(payloadPath, f);
  if (existing) { validatePayload(payloadPath, digest, f); return; }
  const fd = f.openSync(payloadPath, "wx", 0o755);
  try { f.writeFileSync(fd, f.readFileSync(compiledPath)); } finally { f.closeSync(fd); }
  f.chmodSync(payloadPath, 0o755);
  validatePayload(payloadPath, digest, f);
}
async function defaultBuildCanaryBinary(options: { target: BuildTarget; version: string; outputDir: string }): Promise<string> {
  const binaryPath = await buildBinary(options.target[0], options.target[1], options.target[2], options.version, { binaryName: CANARY_BINARY_NAME, outputDir: options.outputDir });
  if (options.target[0] === "darwin") codeSign(binaryPath);
  return binaryPath;
}
function isDirOnPath(installDir: string, env: NodeJS.ProcessEnv): boolean { return (env.PATH ?? "").split(path.delimiter).filter(Boolean).map((entry) => path.resolve(entry)).includes(path.resolve(installDir)); }
function activateAlias(compiledPath: string, targetPath: string, deps: CanaryInstallDeps): void {
  const f = deps.fs ?? fs;
  const installDir = path.dirname(targetPath);
  let lock: LockHandle | undefined;
  let txnDir: string | undefined;
  let tmpAlias: string | undefined;
  try {
    ensureSafeInstallDirectory(installDir, f, deps);
    lock = acquireLock(installDir, deps, f);
    cleanupOwnedTransactions(installDir, f);
    validateExistingAlias(targetPath, installDir, f);
    const digest = digestFile(compiledPath, f);
    smokeBinary(compiledPath, deps, "staged");
    deps.hooks?.afterStagedSmoke?.({ targetPath, payloadName: `${PAYLOAD_PREFIX}${digest}`, transactionDir: installDir });
    const payloadName = `${PAYLOAD_PREFIX}${digest}`;
    validatePayloadName(payloadName);
    const payloadPath = path.join(installDir, payloadName);
    createPayload(compiledPath, payloadPath, digest, f);
    txnDir = f.mkdtempSync(path.join(installDir, TXN_PREFIX));
    const txnStat = lstatMaybe(txnDir, f);
    if (!txnStat?.isDirectory() || txnStat.isSymbolicLink()) throw new Error(`Unsafe canary transaction directory: ${txnDir}`);
    tmpAlias = path.join(txnDir, `${ALIAS_TMP_PREFIX}${token(deps)}`);
    f.symlinkSync(payloadName, tmpAlias);
    deps.hooks?.beforeAliasCommit?.({ targetPath, payloadName, transactionDir: txnDir });
    f.renameSync(tmpAlias, targetPath);
    deps.hooks?.afterAliasCommit?.({ targetPath, payloadName, transactionDir: txnDir });
    if (f.readlinkSync(targetPath) !== payloadName) throw new Error("deck-canary alias changed during activation; refusing further writes.");
    smokeBinary(targetPath, deps, "activated alias");
    if (f.readlinkSync(targetPath) !== payloadName) throw new Error("deck-canary alias changed during activation smoke; refusing further writes.");
  } finally {
    if (tmpAlias && f.existsSync(tmpAlias)) f.rmSync(tmpAlias, { force: true });
    if (txnDir && f.existsSync(txnDir)) f.rmSync(txnDir, { recursive: true, force: true });
    releaseLock(lock, f);
  }
}
export async function installCanary(argv: string[] = process.argv, deps: CanaryInstallDeps = {}): Promise<number> {
  const out = deps.stdout ?? console; const err = deps.stderr ?? console;
  let args: ParsedCanaryArgs;
  try { args = parseCanaryInstallArgs(argv, deps); } catch (e) { err.error(stripControl(e instanceof Error ? e.message : String(e))); return 2; }
  if (args.help) { out.log(HELP.trimEnd()); return 0; }
  out.log(`deck-canary install path: ${args.targetPath}`);
  if (args.dryRun) { out.log("Dry run: no compile or file writes performed."); return 0; }
  let outputDir: string | undefined; const ownsOutputDir = !deps.tempDir;
  try {
    const target = getHostBuildTarget(deps.platform ?? os.platform(), deps.arch ?? os.arch());
    outputDir = deps.tempDir?.() ?? fs.mkdtempSync(path.join(os.tmpdir(), "deck-canary-build-"));
    const compiledPath = await (deps.buildCanaryBinary ?? defaultBuildCanaryBinary)({ target, version: getVersion(), outputDir });
    activateAlias(compiledPath, args.targetPath, deps);
    out.log(`Installed deck-canary: ${args.targetPath}`);
    out.log("Example: cd /path/to/project && deck-canary opencode developer");
    if (!isDirOnPath(args.installDir, deps.env ?? process.env)) out.warn(`Warning: ${args.installDir} is not on PATH. Use the absolute command: ${args.targetPath}`);
    return 0;
  } catch (e) { err.error(stripControl(e instanceof Error ? e.message : String(e))); return 1; }
  finally { if (ownsOutputDir && outputDir && fs.existsSync(outputDir)) fs.rmSync(outputDir, { recursive: true, force: true }); }
}
if (import.meta.main) process.exit(await installCanary(process.argv));
