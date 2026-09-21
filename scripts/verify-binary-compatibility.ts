#!/usr/bin/env bun
/** Native release verification. No installer, global toolchain, or provider effects. */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { readCanonicalBunVersionFromReleaseWorkflow } from "./generate-runner-execution-assets";

const ROOT = resolve(import.meta.dir, "..");
const SYSTEM_PATH = "/usr/bin:/bin:/usr/sbin:/sbin";
const HOOK = "packages/adapter-codex/assets/codex/hooks/developer-team-execution.generated.js";
const HOOK_CHECKS = ["capture", "recall", "denial", "invalid-input"];
const LIMITATIONS = [
  "Offline fixtures do not certify arbitrary upstream npm installations or all OS versions.",
  "Native host only; HOME/PATH isolation is not an OS security boundary. Source and dependency lifecycle scripts must be trusted.",
  "Node coverage exercises the generated Codex hook with a loopback protocol fixture, not installed third-party runners.",
];

export interface Command { argv: string[]; cwd: string; env: Record<string, string>; timeoutMs?: number; maxOutputBytes?: number; signal?: AbortSignal; operation?: string }
type Run = (command: Command) => Promise<string>;
type Download = (url: string, signal?: AbortSignal) => Promise<Uint8Array>;
interface Effects { run?: Run; download?: Download }
interface Identity { version: string; commit: string; target: string; channel: string }
interface ArchiveOptions extends Identity { archive: string; checksums: string; node: string; major: number; hook: string }
export interface Options extends Partial<ArchiveOptions> { root?: string; report?: string }
interface Evidence { ok: boolean; major: number; sha256?: string; nativeHost?: string; nodeVersion?: string; nodeArchiveSha256?: string; hookSha256?: string; standalone?: boolean; hookChecks?: string[]; identity?: Identity; error?: string; stage?: string }
interface Report { schema: string; ok: boolean; mode: string; host: string; cases: Evidence[]; limitations: string[]; error?: string; cancelled?: boolean; stage?: string }

function cancellationError(message = "Compatibility run cancelled"): Error {
  return Object.assign(new Error(message), { name: "AbortError" });
}

export function nativeTarget(platform: string = process.platform, arch: string = process.arch): string {
  if (!["linux", "darwin"].includes(platform) || !["x64", "arm64"].includes(arch)) throw new Error(`Unsupported native host: ${platform}-${arch}`);
  return `${platform}-${arch}`;
}

async function assertNativeHost(root: string, env: Record<string, string>, run: Run): Promise<string> {
  // process.arch alone describes the executable, and can conceal Rosetta/QEMU execution.
  const argv = process.platform === "darwin" ? ["/usr/sbin/sysctl", "-n", "hw.optional.arm64"] : ["/usr/bin/uname", "-m"];
  const value = (await run({ argv, cwd: root, env, operation: "native-host" })).trim();
  const arch = process.platform === "darwin"
    ? value === "1" ? "arm64" : value === "0" ? "x64" : undefined
    : value === "aarch64" || value === "arm64" ? "arm64" : value === "x86_64" ? "x64" : undefined;
  if (arch !== process.arch) throw new Error("Executing runtime does not match native host architecture");
  return `${process.platform}-${arch}`;
}

export function isolatedEnvironment(root: string, path: string): Record<string, string> {
  const env: Record<string, string> = { PATH: path, LANG: "C", LC_ALL: "C", CI: "1", NO_COLOR: "1", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", npm_config_update_notifier: "false", npm_config_audit: "false", npm_config_fund: "false" };
  for (const [key, directory] of Object.entries({ HOME: "home", XDG_CONFIG_HOME: "config", XDG_CACHE_HOME: "cache", XDG_DATA_HOME: "data", XDG_STATE_HOME: "state", XDG_RUNTIME_DIR: "runtime", TMPDIR: "tmp", npm_config_cache: "npm-cache", BUN_INSTALL_CACHE_DIR: "bun-cache" })) {
    env[key] = join(root, directory);
    mkdirSync(env[key], { recursive: true, mode: 0o700 });
  }
  env.TMP = env.TEMP = env.TMPDIR;
  return env;
}

/** A new process group owns all descendants. Never leave children alive after exit/failure. */
export const runProcess: Run = (command) => new Promise((resolveResult, reject) => {
  if (command.signal?.aborted) { reject(cancellationError()); return; }
  const child = spawn(command.argv[0], command.argv.slice(1), { cwd: command.cwd, env: command.env, stdio: ["ignore", "pipe", "pipe"], detached: true });
  const chunks: Buffer[] = [];
  let bytes = 0, failure: Error | undefined;
  const kill = () => { if (child.pid) { try { process.kill(-child.pid, "SIGKILL"); } catch { /* Already reaped. */ } } };
  const stop = (message: string) => { failure ??= new Error(message); kill(); };
  const abort = (message?: string) => { failure = cancellationError(message); kill(); };
  const interrupted = () => abort("subprocess interrupted (SIGINT)");
  const terminated = () => abort("subprocess interrupted (SIGTERM)");
  const cancelled = () => abort();
  command.signal?.addEventListener("abort", cancelled, { once: true });
  // Standalone callers retain signal cleanup; orchestrated calls use their run-wide signal.
  if (!command.signal) {
    process.once("SIGINT", interrupted);
    process.once("SIGTERM", terminated);
  }
  const timer = setTimeout(() => stop("subprocess timeout"), command.timeoutMs ?? 30_000);
  child.stdout.on("data", (chunk: Buffer) => {
    bytes += chunk.length;
    if (bytes > (command.maxOutputBytes ?? 1024 * 1024)) stop("subprocess output limit exceeded");
    else chunks.push(chunk);
  });
  child.stderr.on("data", (chunk: Buffer) => {
    bytes += chunk.length;
    if (bytes > (command.maxOutputBytes ?? 1024 * 1024)) stop("subprocess output limit exceeded");
    // Do not persist tool output: dependency diagnostics can contain private data.
  });
  child.on("error", () => { failure ??= new Error("subprocess could not start"); });
  child.on("exit", kill);
  child.on("close", (code, signal) => {
    clearTimeout(timer);
    process.off("SIGINT", interrupted);
    process.off("SIGTERM", terminated);
    command.signal?.removeEventListener("abort", cancelled);
    kill();
    if (failure || code !== 0) reject(failure ?? new Error(`subprocess failed (exit ${code}, signal ${signal ?? "none"})`));
    else resolveResult(Buffer.concat(chunks).toString("utf8"));
  });
});

export function sha256(file: string): string { return createHash("sha256").update(readFileSync(file)).digest("hex"); }
function digest(bytes: Uint8Array): string { return createHash("sha256").update(bytes).digest("hex"); }

function eligibleSource(file: string): boolean {
  const parts = file.split("/");
  if (isAbsolute(file) || parts.some(part => !part || part === "." || part === "..") || file.includes("\\")) throw new Error("Unsafe source inventory path");
  if (parts.some(part => (part.startsWith(".") && part !== ".github") || /^(?:node_modules|dist(?:-cli)?|build|out|target|coverage|cache|__pycache__|tmp|temp|artifacts|release-assets)$/i.test(part))) return false;
  if (/(?:^|\/)(?:secrets?|credentials?)(?:\.[^/]*)?$/i.test(file) || /\.(?:pem|key|p12|pfx|log|tar|gz|zip)$/i.test(file)) return false;
  return true;
}

/** Git supplies tracked + non-ignored untracked names; bytes always come from the working tree. */
export async function copyCurrentSource(source: string, destination: string, run: Run = runProcess, env = isolatedEnvironment(dirname(destination), SYSTEM_PATH)): Promise<void> {
  mkdirSync(destination, { recursive: true });
  const inventory = await run({ argv: ["/usr/bin/git", "--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", "ls-files", "-z", "--cached", "--others", "--exclude-standard"], cwd: source, env, maxOutputBytes: 16 * 1024 * 1024, operation: "source-inventory" });
  for (const file of new Set(inventory.split("\0").filter(Boolean))) {
    if (!eligibleSource(file)) continue;
    let current = source, safe = true;
    for (const part of file.split("/")) {
      current = join(current, part);
      if (!existsSync(current) || lstatSync(current).isSymbolicLink()) { safe = false; break; }
    }
    if (!safe || !lstatSync(current).isFile()) continue;
    const to = join(destination, file);
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(current, to);
  }
}

/** Only explicit sandbox provisioning calls this. Unit tests inject bytes instead. */
export const downloadOfficial: Download = async (url, signal) => {
  if (!url.startsWith("https://nodejs.org/dist/")) throw new Error("Non-official Node download URL");
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.any([AbortSignal.timeout(60_000), ...(signal ? [signal] : [])]) });
  if (!response.ok || !response.body) throw new Error("Official Node download failed");
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      length += item.value.length;
      if (length > 100 * 1024 * 1024) throw new Error("Node download exceeds size limit");
      chunks.push(item.value);
    }
  } finally { await reader.cancel(); }
  return Buffer.concat(chunks);
};

export async function provisionNode(major: number, target: string, root: string, effects: Effects = {}): Promise<{ path: string; sha256: string }> {
  if (![20, 24].includes(major) || !/^(linux|darwin)-(x64|arm64)$/.test(target)) throw new Error("Unsupported Node distribution");
  const download = effects.download ?? downloadOfficial, run = effects.run ?? runProcess;
  const base = `https://nodejs.org/dist/latest-v${major}.x/`;
  const sums = Buffer.from(await download(`${base}SHASUMS256.txt`)).toString("utf8");
  const pattern = new RegExp(`^([a-f0-9]{64})  (node-v${major}\\.\\d+\\.\\d+-${target}\\.tar\\.gz)$`, "gm");
  const matches = [...sums.matchAll(pattern)];
  if (matches.length !== 1) throw new Error("Official Node checksum entry missing or ambiguous");
  const [, expected, name] = matches[0];
  const bytes = await download(`${base}${name}`), actual = digest(bytes);
  if (actual !== expected) throw new Error("Node checksum mismatch");
  const directory = join(root, `node-${major}`);
  mkdirSync(directory, { recursive: true });
  const archive = join(directory, name);
  writeFileSync(archive, bytes);
  await run({ argv: ["/usr/bin/tar", "-xzf", archive, "-C", directory], cwd: directory, env: isolatedEnvironment(directory, SYSTEM_PATH), timeoutMs: 60_000, operation: "extract-node" });
  return { path: join(directory, name.slice(0, -7), "bin/node"), sha256: actual };
}

/** Runs the actual generated hook's default fetch transport using only a loopback server. */
export const NODE_HOOK_FIXTURE = `
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
const { forwardCodexTrustedHook } = await import(pathToFileURL(process.argv[2]).href);
const calls = [];
let denied = false;
const server = createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  calls.push({ path: req.url, method: req.method, auth: req.headers.authorization, body: JSON.parse(body) });
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(denied ? { accepted: false, reason: 'fixture-denied' } : { ok: true, advisoryText: 'offline-fixture-context' }));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
try {
  const endpoint = 'http://127.0.0.1:' + server.address().port + '/deck-runner-memory/v1';
  const options = { endpoint, token: 'offline-fixture-token' };
  const input = { session_id: 'compat', turn_id: 'turn-1', cwd: process.cwd(), hook_event_name: 'UserPromptSubmit', prompt: 'remember offline compatibility' };
  const captured = await forwardCodexTrustedHook(input, options);
  assert.deepEqual(captured, { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: 'offline-fixture-context' } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].path, '/deck-runner-memory/v1');
  assert.equal(calls[0].auth, 'Bearer offline-fixture-token');
  assert.equal(calls[0].body.schema, 'deck-runner-memory-loopback-v1');
  assert.equal(calls[0].body.event, 'capture');
  assert.equal(calls[0].body.source, 'trusted-user-prompt');
  assert.equal(calls[0].body.content, input.prompt);
  const recalled = await forwardCodexTrustedHook({ ...input, hook_event_name: 'SessionStart' }, options);
  assert.equal(recalled.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.equal(calls[1].body.event, 'session_start');
  denied = true;
  assert.deepEqual(await forwardCodexTrustedHook(input, options), { decision: 'block', reason: 'fixture-denied' });
  assert.deepEqual(await forwardCodexTrustedHook({}, options), { decision: 'block', reason: 'invalid-evidence' });
  assert.equal(calls.length, 3);
  console.log(JSON.stringify({ ok: true, node: process.version, platform: process.platform, arch: process.arch, checks: ['capture', 'recall', 'denial', 'invalid-input'] }));
} finally {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
`;

export async function verifyArchive(options: ArchiveOptions, root: string, run: Run = runProcess): Promise<Evidence> {
  const evidence: Evidence = { ok: false, major: options.major };
  try {
    if (options.target !== nativeTarget()) throw new Error("Archive target does not match native host");
    if (![20, 24].includes(options.major) || !isAbsolute(options.node)) throw new Error("Expected an absolute Node executable and major 20 or 24");
    if (!/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(options.version) || !/^[a-f0-9]{7,40}$/.test(options.commit) || !["stable", "beta", "dev"].includes(options.channel)) throw new Error("Invalid expected build identity");
    mkdirSync(root, { recursive: true });
    const archive = join(root, "candidate.tar.gz");
    copyFileSync(options.archive, archive);
    evidence.sha256 = sha256(archive);
    const entries = readFileSync(options.checksums, "utf8").split(/\r?\n/).map(line => /^([a-f0-9]{64})\s+\*?(.+)$/.exec(line)).filter(entry => entry?.[2] === basename(options.archive));
    if (entries.length !== 1 || entries[0]?.[1] !== evidence.sha256) throw new Error("Candidate checksum missing, ambiguous, or mismatched");
    const env = isolatedEnvironment(root, SYSTEM_PATH), extraction = join(root, "extracted");
    evidence.nativeHost = await assertNativeHost(root, env, run);
    mkdirSync(extraction, { recursive: true });
    const invoke = (operation: string, argv: string[], environment = env) => run({ argv, cwd: root, env: environment, operation });
    if ((await invoke("archive-list", ["/usr/bin/tar", "-tzf", archive])).trim() !== "deck") throw new Error("Unsafe archive: expected only deck");
    const listing = (await invoke("archive-metadata", ["/usr/bin/tar", "-tvzf", archive])).trim().split("\n");
    if (listing.length !== 1 || !listing[0].startsWith("-")) throw new Error("Unsafe archive: deck must be a regular file");
    await invoke("extract-candidate", ["/usr/bin/tar", "-xzf", archive, "-C", extraction]);
    const binary = join(extraction, "deck");
    if (!lstatSync(binary).isFile() || lstatSync(binary).isSymbolicLink()) throw new Error("Extracted deck is not a regular file");
    const output = await invoke("standalone-version", [binary, "version"], isolatedEnvironment(join(root, "standalone"), ""));
    const actual = { version: /^deck (.+)$/m.exec(output)?.[1], commit: /^commit: (.+)$/m.exec(output)?.[1], target: /^target: (.+)$/m.exec(output)?.[1], channel: /^channel: (.+)$/m.exec(output)?.[1] };
    for (const key of ["version", "commit", "target", "channel"] as const) if (actual[key] !== options[key]) throw new Error(`Build identity mismatch: ${key}`);
    evidence.standalone = true;
    evidence.identity = actual as Identity;
    const nodeEnv = isolatedEnvironment(join(root, "node-smoke"), dirname(options.node));
    const version = (await invoke("node-version", [options.node, "--version"], nodeEnv)).trim();
    evidence.nodeVersion = version;
    if (!new RegExp(`^v${options.major}\\.\\d+\\.\\d+$`).test(version)) throw new Error("Actual Node version does not match requested major");
    const hook = join(root, "hook.mjs"), fixture = join(root, "node-hook-fixture.mjs");
    copyFileSync(options.hook, hook);
    evidence.hookSha256 = sha256(hook);
    writeFileSync(fixture, NODE_HOOK_FIXTURE);
    const boundary = JSON.parse(await invoke("node-hook", [options.node, fixture, hook], nodeEnv));
    if (boundary.ok !== true || boundary.node !== version || `${boundary.platform}-${boundary.arch}` !== options.target || JSON.stringify(boundary.checks) !== JSON.stringify(HOOK_CHECKS)) throw new Error("Missing or mismatched Node boundary evidence");
    evidence.hookChecks = boundary.checks;
    evidence.ok = true;
    return evidence;
  } catch (error) { throw Object.assign(error instanceof Error ? error : new Error("Verification failed"), { evidence }); }
}

export async function signDarwinCandidate(target: string, binary: string, invoke: (operation: string, argv: string[]) => Promise<string>): Promise<void> {
  if (!target.startsWith("darwin-")) return;
  // Bun 1.3.12 can leave a malformed inherited signature; --force alone cannot replace it.
  // Only mutate our newly compiled candidate, never an archive being verified.
  await invoke("remove-build-signature", ["/usr/bin/codesign", "--remove-signature", binary]);
  await invoke("sign-candidate", ["/usr/bin/codesign", "--force", "--sign", "-", binary]);
  await invoke("verify-build-signature", ["/usr/bin/codesign", "--verify", "--strict", binary]);
}

async function buildCurrentSource(source: string, root: string, run: Run): Promise<Omit<ArchiveOptions, "node" | "major">> {
  const canonical = readCanonicalBunVersionFromReleaseWorkflow(source);
  if (Bun.version !== canonical) throw new Error(`Sandbox requires canonical Bun ${canonical}; executing Bun is ${Bun.version}. No build or download performed.`);
  const env = isolatedEnvironment(join(root, "build-environment"), SYSTEM_PATH), copy = join(root, "source");
  await assertNativeHost(root, env, run);
  const commit = (await run({ argv: ["/usr/bin/git", "rev-parse", "HEAD"], cwd: source, env, operation: "source-commit" })).trim();
  await copyCurrentSource(source, copy, run, env);
  const tools = join(root, "tools");
  mkdirSync(tools);
  symlinkSync(process.execPath, join(tools, "bun"));
  env.PATH = `${tools}:${SYSTEM_PATH}`;
  const version = JSON.parse(readFileSync(join(copy, "package.json"), "utf8")).version;
  const target = nativeTarget(), channel = "dev";
  const invoke = (operation: string, argv: string[]) => run({ argv, cwd: copy, env, timeoutMs: 600_000, maxOutputBytes: 8 * 1024 * 1024, operation });
  await invoke("install-dependencies", [process.execPath, "install", "--frozen-lockfile"]);
  await invoke("generate-runner-assets", [process.execPath, "scripts/generate-runner-execution-assets.ts"]);
  await invoke("generate-build-info", [process.execPath, "scripts/generate-build-info.ts", "--version", version, "--commit", commit, "--target", target, "--channel", channel]);
  await invoke("generate-skills", [process.execPath, "scripts/generate-skill-bundle.ts"]);
  const output = join(root, "candidate");
  mkdirSync(output);
  await invoke("compile-candidate", [process.execPath, "build", "--compile", `--target=bun-${target}`, "--outfile", join(output, "deck"), "apps/cli/src/main.tsx"]);
  await signDarwinCandidate(target, join(output, "deck"), invoke);
  const archive = join(root, `deck_v${version}_${target}.tar.gz`), checksums = join(root, "checksums.txt");
  await invoke("archive-candidate", ["/usr/bin/tar", "-czf", archive, "-C", output, "deck"]);
  writeFileSync(checksums, `${sha256(archive)}  ${basename(archive)}\n`);
  return { archive, checksums, hook: join(copy, HOOK), version, commit, target, channel };
}

export async function runCompatibility(options: Options, effects: Effects = {}): Promise<Report> {
  const report: Report = { schema: "deck-binary-compatibility-v1", ok: false, mode: options.archive ? "existing-archive" : "current-source", host: `${process.platform}-${process.arch}`, cases: [], limitations: LIMITATIONS };
  const root = mkdtempSync(join(tmpdir(), "deck-compat-"));
  const controller = new AbortController(), { signal } = controller;
  const cancel = () => controller.abort();
  process.on("SIGINT", cancel);
  process.on("SIGTERM", cancel);
  const checkCancellation = () => { if (signal.aborted) throw cancellationError(); };
  const run: Run = async command => {
    checkCancellation();
    report.stage = command.operation ?? "subprocess";
    const output = await (effects.run ?? runProcess)({ ...command, signal });
    checkCancellation();
    return output;
  };
  const download: Download = async url => {
    checkCancellation();
    report.stage = "download-node";
    const bytes = await (effects.download ?? downloadOfficial)(url, signal);
    checkCancellation();
    return bytes;
  };
  try {
    nativeTarget();
    let candidate: Omit<ArchiveOptions, "node" | "major">;
    if (options.archive) {
      for (const key of ["checksums", "hook", "version", "commit", "target", "channel", "node", "major"] as const) if (!options[key]) throw new Error(`Existing archive requires --${key}`);
      if (!isAbsolute(options.node!)) throw new Error("Expected an absolute Node executable");
      candidate = options as ArchiveOptions;
    } else {
      if ([options.node, options.major, options.checksums, options.hook, options.version, options.commit, options.target, options.channel].some(value => value !== undefined)) throw new Error("Archive-only flags require --archive");
      candidate = await buildCurrentSource(resolve(options.root ?? ROOT), root, run);
    }
    for (const major of options.archive ? [options.major!] : [20, 24]) {
      checkCancellation();
      let provisioned: { path: string; sha256: string } | undefined;
      try {
        if (!options.archive) provisioned = await provisionNode(major, candidate.target, root, { run, download });
        const evidence = await verifyArchive({ ...candidate, major, node: provisioned?.path ?? resolve(options.node!) }, join(root, `case-${major}`), run);
        evidence.nodeArchiveSha256 = provisioned?.sha256;
        report.cases.push(evidence);
      } catch (error) {
        const partial = (error as { evidence?: Evidence }).evidence;
        report.cases.push({ ...partial, ok: false, major, sha256: partial?.sha256 ?? sha256(candidate.archive), nodeArchiveSha256: provisioned?.sha256, stage: report.stage, error: signal.aborted ? "Compatibility run cancelled" : error instanceof Error ? error.message : "Compatibility case failed" });
        checkCancellation();
      }
    }
    report.ok = report.cases.length === (options.archive ? 1 : 2) && report.cases.every(item => item.ok);
  } catch (error) {
    report.cancelled = signal.aborted;
    report.error = signal.aborted ? "Compatibility run cancelled" : error instanceof Error ? error.message : "Compatibility run failed";
  } finally {
    try { rmSync(root, { recursive: true, force: true }); }
    finally { process.off("SIGINT", cancel); process.off("SIGTERM", cancel); }
  }
  if (options.report) writeFileSync(resolve(options.report), `${JSON.stringify(report, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  return report;
}

if (import.meta.main) {
  try {
    const { values } = parseArgs({ args: process.argv.slice(2).filter(arg => arg !== "--"), strict: true, options: {
      archive: { type: "string" }, checksums: { type: "string" }, node: { type: "string" }, major: { type: "string" },
      target: { type: "string" }, version: { type: "string" }, commit: { type: "string" }, channel: { type: "string" },
      hook: { type: "string" }, report: { type: "string" }, help: { type: "boolean" },
    } });
    if (values.help) console.log("bun run sandbox:compat [--report NEW_FILE]\nExisting archive: --archive FILE --checksums FILE --node ABSOLUTE_PATH --major 20|24 --target OS-ARCH --version VERSION --commit SHA --channel stable|beta|dev --hook GENERATED_JS [--report NEW_FILE]\nDefault: builds current working source in a disposable copy; downloads official Node 20 and 24. Requires canonical Bun, Git, tar, native Linux/macOS x64/arm64, and network for dependencies/provisioning. Reports never overwrite existing files.");
    else {
      const result = await runCompatibility({ ...values, major: values.major === undefined ? undefined : Number(values.major) } as Options);
      console.log(JSON.stringify(result, null, 2));
      process.exitCode = result.ok ? 0 : 1;
    }
  } catch { console.error(JSON.stringify({ schema: "deck-binary-compatibility-v1", ok: false, error: "Invalid arguments or report could not be written. Use --help; report destination must be a new file." })); process.exitCode = 1; }
}
