import { spawn } from "node:child_process";
import { realpathSync, statSync, watch, type FSWatcher } from "node:fs";
import { dirname, join } from "node:path";
import { constants as osConstants } from "node:os";
import type { Readable, Writable } from "node:stream";
import { isCompatibleCodebaseExecutable, pinnedOwnedCodebaseRelease, type CodebaseNativeRelease } from "../../core/src/owned-tools/codebase-native-artifact";
import { DECK_PI_MEMORY_ENV_BLANKS } from "./pi-mcp-env";
import { canonicalJson } from "./pi-manifest";
import { classifyNativeCodebase, nativeCodebaseFailureCode, readNativeCodebaseSelection } from "./pi-native-codebase-readiness";
import { inspectCodebaseGuardEntry, type CodebaseGuardArgs } from "./pi-codebase-guard-command";

const identity = (path: string): string => {
  const s = statSync(path, { bigint: true });
  return [realpathSync(path), s.dev, s.ino, s.size, s.mode, s.uid, s.gid, s.mtimeNs, s.ctimeNs].join(":");
};
/** This supervisor refuses known rejected bytes BEFORE spawn. Path execution still has a same-user TOCTOU race. */
export async function runPiCodebaseGuard(args: CodebaseGuardArgs, options: {
  input?: Readable; output?: Writable; error?: Writable; signal?: AbortSignal;
  /** Hermetic reviewed artifact only; the internal CLI never accepts release metadata. */
  release?: CodebaseNativeRelease;
  /** Test race seam; post-spawn identity detection cannot prevent executable side effects. */
  afterVerification?: () => void;
  /** Hermetic deadline seam; not accepted by the internal CLI. */
  drainTimeoutMs?: number;
} = {}): Promise<number> {
  options.signal?.throwIfAborted();
  const input = options.input ?? process.stdin, output = options.output ?? process.stdout, error = options.error ?? process.stderr;
  const refuse = (code: string) => { error.write(`Deck Codebase guard: ${code}.\n`); return code === "codebase-memory-unavailable" ? 69 : 78; };
  const release = options.release ?? pinnedOwnedCodebaseRelease();
  const compatible = (command: string) => isCompatibleCodebaseExecutable(command, release);
  let entryHash: string;
  let executable: string;
  let trackedPaths: string[];
  let baseline: string[];
  function verifySelection() {
    let binaryBefore: string | undefined;
    try { binaryBefore = identity(args.binary); } catch (failure) { if (!["ENOENT", "ENOTDIR"].includes((failure as NodeJS.ErrnoException).code ?? "")) throw failure; }
    const entry = readNativeCodebaseSelection(args.agentDir);
    const result = classifyNativeCodebase({ agentDir: args.agentDir, entry, compatible: options.release ? compatible : undefined, signal: options.signal });
    if (!entry || !result.owned || !result.guarded) throw new Error("pi-codebase-ownership-invalid");
    const guard = inspectCodebaseGuardEntry(entry.config, args.agentDir)!;
    if (canonicalJson({ agentDir: guard.agentDir, binary: guard.binary, executableId: guard.executableId, ...(guard.scriptId ? { scriptId: guard.scriptId } : {}) }) !== canonicalJson(args) || guard.command !== realpathSync(process.execPath) || (guard.script && guard.script !== realpathSync(process.argv[1]!))) throw new Error("pi-codebase-guard-invalid");
    if (result.status !== "ready") throw new Error("codebase-memory-unavailable");
    if (binaryBefore !== identity(args.binary)) throw new Error("codebase-memory-integrity-failed");
    return { entry, guard, binaryIdentity: binaryBefore };
  }
  try {
    const { entry, guard, binaryIdentity } = verifySelection();
    executable = guard.binary;
    entryHash = canonicalJson(entry.config);
    trackedPaths = [executable, join(args.agentDir, "deck/manifest.json"), join(args.agentDir, "mcp.json"), guard.command, ...(guard.script ? [guard.script] : [])];
    baseline = trackedPaths.map(identity);
    if (baseline[0] !== binaryIdentity) throw new Error("codebase-memory-integrity-failed");
  } catch (failure) {
    if (options.signal?.aborted || failure instanceof Error && failure.name === "AbortError") throw failure;
    return refuse(failure instanceof Error && failure.message === "codebase-memory-unavailable" ? failure.message : nativeCodebaseFailureCode(failure));
  }
  options.afterVerification?.();
  options.signal?.throwIfAborted();
  const child = spawn(executable, [], { stdio: ["pipe", "pipe", "pipe"], detached: false, shell: false, env: { ...process.env, ...DECK_PI_MEMORY_ENV_BLANKS } });
  return await new Promise<number>((resolve, reject) => {
    let stopping: number | undefined, finished = false, forced: ReturnType<typeof setTimeout> | undefined;
    let eofTimer: ReturnType<typeof setTimeout> | undefined;
    let closed = false, childCode = 1, flushed = 0;
    const deadline = () => {
      if (eofTimer || finished) return;
      eofTimer = setTimeout(() => {
        error.write("Deck Codebase guard: pi-codebase-output-drain-timeout.\n");
        terminate(74);
      }, options.drainTimeoutMs ?? 45_000);
    };
    const watchers: FSWatcher[] = [];
    let poll: ReturnType<typeof setInterval> | undefined;
    const terminate = (code: number) => {
      if (finished || stopping !== undefined) return;
      stopping = code;
      input.unpipe(child.stdin); input.pause();
      child.stdin.destroy();
      child.stdout.unpipe(output); child.stdout.resume();
      child.stderr.unpipe(error); child.stderr.resume();
      child.kill("SIGTERM");
      forced = setTimeout(() => { if (!closed) child.kill("SIGKILL"); else complete(); }, 500);
      if (closed) complete();
    };
    const drift = () => {
      if (finished || stopping !== undefined) return;
      try {
        const current = trackedPaths.map(identity);
        if (current.every((v, i) => v === baseline[i])) return;
        const { entry } = verifySelection();
        if (current[0] !== baseline[0] || canonicalJson(entry.config) !== entryHash) throw new Error("codebase-memory-integrity-failed");
        baseline = current; // Unrelated manifest/config edits do not seize custom servers or restart this child.
      } catch (failure) {
        if (options.signal?.aborted) { terminate(1); return; }
        const code = failure instanceof Error && failure.message === "codebase-memory-unavailable" ? failure.message : nativeCodebaseFailureCode(failure);
        refuse(code); terminate(78);
      }
    };
    const onEof = () => {
      // Let a cooperative server consume the final bytes and exit; bound an uncooperative server's lifetime.
      if (finished || stopping !== undefined || eofTimer) return;
      deadline();
      child.stdin.end();
    };
    const onStreamError = () => { if (!finished && stopping === undefined) error.write("Deck Codebase guard: pi-codebase-stream-failed.\n"); terminate(74); };
    const onAbort = () => terminate(1);
    const signals = ["SIGTERM", "SIGINT", "SIGHUP"] as const;
    const signalHandlers = signals.map(signal => { const handler = () => terminate(128 + osConstants.signals[signal]); process.on(signal, handler); return [signal, handler] as const; });
    options.signal?.addEventListener("abort", onAbort, { once: true });
    input.once("end", onEof); input.once("close", onEof); input.once("error", onStreamError);
    output.on("error", onStreamError); error.on("error", onStreamError); child.stdin.on("error", () => { if (child.exitCode === null && child.signalCode === null) onStreamError(); });
    child.stdout.on("error", onStreamError); child.stderr.on("error", onStreamError);
    child.once("error", () => { refuse("pi-codebase-child-failed"); terminate(78); });
    const complete = () => {
      if (finished || !closed || (stopping === undefined && flushed !== 2)) return;
      finished = true;
      if (forced) clearTimeout(forced); if (eofTimer) clearTimeout(eofTimer); if (poll) clearInterval(poll);
      for (const watcher of watchers) watcher.close();
      for (const [signal, handler] of signalHandlers) process.removeListener(signal, handler);
      options.signal?.removeEventListener("abort", onAbort);
      input.unpipe(child.stdin); input.pause(); input.removeListener("end", onEof); input.removeListener("close", onEof); input.removeListener("error", onStreamError);
      output.removeListener("error", onStreamError); error.removeListener("error", onStreamError);
      if (options.signal?.aborted) reject(options.signal.reason);
      else resolve(stopping ?? childCode);
    };
    child.once("exit", deadline);
    child.once("close", (code, signal) => {
      closed = true;
      childCode = code ?? (signal ? 128 + (osConstants.signals[signal] ?? 0) : 1);
      deadline();
      complete();
    });
    // A zero-length write callback is a FIFO flush barrier without ending shared destinations.
    // Source EOF and child close alone do not imply destination callbacks have completed.
    for (const [source, destination] of [[child.stdout, output], [child.stderr, error]] as const) {
      source.once("end", () => {
        if (finished || stopping !== undefined) return;
        destination.write("", () => { flushed++; complete(); });
      });
    }
    // A race detected here is already post-spawn: the child may have performed side effects. No race-prevention claim.
    try { if (trackedPaths.map(identity).some((v, i) => v !== baseline[i])) { refuse("codebase-memory-integrity-failed"); terminate(78); } }
    catch { refuse("codebase-memory-integrity-failed"); terminate(78); }
    if (stopping === undefined) {
      child.stdout.pipe(output, { end: false }); child.stderr.pipe(error, { end: false });
      input.pipe(child.stdin);
      if (input.readableEnded) onEof();
      poll = setInterval(drift, 1000);
      for (const directory of new Set(trackedPaths.map(dirname))) {
        try { const watcher = watch(directory, { persistent: false }, drift); watcher.on("error", () => { /* Poll remains authoritative when native watch becomes unavailable. */ }); watchers.push(watcher); } catch { /* Poll covers unsupported watches. */ }
      }
    }
    if (options.signal?.aborted) onAbort();
  });
}
