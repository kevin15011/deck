/** Live MCP readiness for the one native backend whose shared rendezvous Deck manages. */
import { createHash } from "node:crypto";
import { mkdtempSync, realpathSync, rmSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { OWNED_CODEBASE_VERSION, verifyCodebaseExecutable } from "@deck/core";
import type { ChildMcpServerSpec } from "@deck/core/session/driver";
import type { ChildMcpContext, Supervisor, SupervisedProcess } from "@deck/session-host";

type StdioSpec = Exclude<ChildMcpServerSpec, { transport: "http" }>;
type Pending = { resolve(value: Record<string, unknown>): void; reject(error: Error): void };
type Connection = { process: SupervisedProcess; runtime: string; pending: Map<number, Pending>; nextId: number; closed: boolean; consumers: number; retired: boolean; failure?: Error; dispose?: Promise<void> };
type Entry = { projectRoot: string; obsolete?: boolean; connection?: Connection; operation?: { result: Promise<StdioSpec>; controller: AbortController; waiters: number }; negative?: { until: number; error: Error } };
type Options = {
  supervisor: Pick<Supervisor, "spawn">;
  environment?: Readonly<Record<string, string | undefined>>;
  runtimeParent?: string;
  coldTimeoutMs?: number;
  warmTimeoutMs?: number;
  cleanupTimeoutMs?: number;
  now?: () => number;
  /** Test seam; production verifies the reviewed exact native release digest. */
  verifyExecutable?: (path: string, signal: AbortSignal) => Promise<boolean>;
};

export class SessionCodebaseReadinessError extends Error {
  constructor(readonly kind: "unavailable" | "unsupported" | "cancelled") {
    super(`codebase-memory-${kind}: ${kind === "cancelled" ? "turn cancelled" : kind === "unsupported" ? "the selected executable or MCP protocol is not a supported Deck release" : "the selected backend did not become ready; retry after 30 seconds"}`);
  }
}
const failure = (kind: "unavailable" | "unsupported" | "cancelled") => new SessionCodebaseReadinessError(kind);
const ownedCodebasePath = (path: string) => basename(dirname(dirname(path))) === `codebase-native-v${OWNED_CODEBASE_VERSION}`;
const aborted = (signal: AbortSignal) => { if (signal.aborted) throw failure("cancelled"); };
const stable = (value: unknown): string => JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);

export class SessionCodebaseReadiness {
  private readonly entries = new Map<string, Entry>();
  private readonly verified = new Map<string, Promise<boolean>>();
  private readonly runtimes = new Set<string>();
  private readonly bindings = new Map<string, Connection>();
  private readonly leases = new WeakMap<StdioSpec, Connection>();
  private closed = false;
  private closing?: Promise<void>;
  constructor(private readonly options: Options) {}

  async ensure(spec: StdioSpec, context: ChildMcpContext, overlay: Readonly<Record<string, string>> = {}): Promise<StdioSpec> {
    aborted(context.signal);
    if (this.closed) throw failure("cancelled");
    let binary: string, identity: string, projectRoot: string;
    const environment = Object.fromEntries(Object.entries({ ...(this.options.environment ?? process.env), ...spec.env, ...overlay }).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
    projectRoot = realpathSync(context.projectRoot);
    try {
      const resolved = Bun.which(spec.command, { PATH: environment.PATH, cwd: context.projectRoot });
      binary = realpathSync(resolved ?? spec.command);
      const stat = statSync(binary, { bigint: true });
      if (!stat.isFile()) { if ([spec.command, binary].some(ownedCodebasePath)) throw new Error("codebase-memory-integrity-failed"); throw failure("unsupported"); }
      identity = stable([binary, stat.dev, stat.ino, stat.size, stat.mode, stat.uid, stat.gid, stat.mtimeNs, stat.ctimeNs].map(String));
    } catch (error) {
      if (ownedCodebasePath(spec.command) && ["ENOTDIR", "ELOOP"].includes((error as NodeJS.ErrnoException).code ?? "")) throw new Error("codebase-memory-integrity-failed");
      if (["ENOENT", "ENOTDIR", "ELOOP"].includes((error as NodeJS.ErrnoException).code ?? "")) throw failure("unsupported");
      throw error;
    }
    // Credentials and all effective launch inputs are hashed in memory; none enter diagnostics or paths.
    const key = createHash("sha256").update(stable([identity, spec, projectRoot, environment])).digest("hex");
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { projectRoot }; this.entries.set(key, entry);
      for (const previous of this.entries.values()) {
        if (previous === entry || previous.projectRoot !== projectRoot) continue;
        previous.obsolete = true;
        if (previous.connection) {
          previous.connection.retired = true;
          if (!previous.operation) await this.retire(previous.connection);
        }
      }
    }
    entry.obsolete = false;
    aborted(context.signal);
    if (this.closed) throw failure("cancelled");
    if (entry.negative && entry.negative.until > (this.options.now ?? Date.now)()) throw entry.negative.error;
    entry.negative = undefined;
    if (!entry.operation) {
      const controller = new AbortController();
      const operation = { controller, waiters: 0, result: Promise.resolve(spec) };
      entry.operation = operation;
      operation.result = this.check(entry, spec, binary, identity, projectRoot, environment, key, controller.signal).catch((error: Error) => {
        if (!controller.signal.aborted && !this.closed) entry!.negative = { until: (this.options.now ?? Date.now)() + 30_000, error };
        throw error;
      }).finally(() => { if (entry!.operation === operation) entry!.operation = undefined; });
      void operation.result.catch(() => {});
    }
    const operation = entry.operation;
    operation.waiters++;
    return new Promise<StdioSpec>((resolve, reject) => {
      let settled = false;
      const release = () => { settled = true; context.signal.removeEventListener("abort", cancel); operation.waiters--; };
      const cancel = () => {
        if (settled) return;
        release();
        if (!operation.waiters) {
          operation.controller.abort();
          // The final waiter owns cleanup too: cancellation is acknowledged only after drain.
          void operation.result.finally(() => reject(failure("cancelled"))).catch(() => {});
        } else reject(failure("cancelled"));
      };
      context.signal.addEventListener("abort", cancel, { once: true });
      operation.result.then((result) => {
        if (!settled) {
          const binding = this.bindings.get(result.env.CBM_RUNTIME_DIR!);
          if (!binding || binding.closed || this.closed) { release(); reject(failure("cancelled")); return; }
          const leased = { ...result, env: { ...result.env } };
          if (entry!.obsolete) binding.retired = true;
          binding.consumers++; this.leases.set(leased, binding); release(); resolve(leased);
        }
      }, (error) => { if (!settled) { release(); reject(error); } });
      if (context.signal.aborted) cancel();
    });
  }

  private async check(entry: Entry, spec: StdioSpec, binary: string, identity: string, projectRoot: string, environment: Record<string, string>, key: string, signal: AbortSignal): Promise<StdioSpec> {
    if (entry.connection) {
      try {
        await this.deadline(signal, this.options.warmTimeoutMs ?? 2000, (boundedSignal) => this.tools(entry.connection!, boundedSignal));
        return { ...spec, env: { ...spec.env, CBM_RUNTIME_DIR: entry.connection.runtime } };
      } catch (error) {
        await this.retire(entry.connection); entry.connection = undefined;
        aborted(signal);
        if (!(error instanceof SessionCodebaseReadinessError)) throw error;
      }
    }
    try {
      await this.deadline(signal, this.options.coldTimeoutMs ?? 15_000, async (boundedSignal) => {
        let verified = this.verified.get(identity);
        if (!verified) {
          // Verification is read-only and may serve several project/spec admissions. Give it
          // its own finite lifetime so one cancelled turn cannot poison another caller.
          const verificationSignal = AbortSignal.timeout(this.options.coldTimeoutMs ?? 15_000);
          verified = (this.options.verifyExecutable ?? this.verifyExecutable)(binary, verificationSignal).catch(error => {
            if (verificationSignal.aborted && error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name)) throw failure("unavailable");
            throw error;
          });
          this.verified.set(identity, verified);
          while (this.verified.size > 64) this.verified.delete(this.verified.keys().next().value!);
          void verified.catch(() => { if (this.verified.get(identity) === verified) this.verified.delete(identity); });
        }
        if (!await verified) {
          if ([binary, spec.command].some(ownedCodebasePath)) throw new Error("codebase-memory-integrity-failed");
          throw failure("unsupported");
        }
        aborted(boundedSignal);
        // Upstream appends a uid directory and Unix socket name. Keep even long XDG roots out
        // of sun_path; mkdtemp gives this Deck instance exclusive 0700 ownership and a new epoch.
        const parent = this.options.runtimeParent && Buffer.byteLength(realpathSync(this.options.runtimeParent)) <= 30 ? realpathSync(this.options.runtimeParent) : realpathSync("/tmp");
        const runtime = mkdtempSync(join(parent, `dcb-${key.slice(0, 6)}-`)); this.runtimes.add(runtime);
        entry.connection = this.connect(binary, spec.args, projectRoot, { ...environment, CBM_RUNTIME_DIR: runtime }, runtime);
        const connection = entry.connection;
        await this.abortable(connection.process.ready, boundedSignal);
        const response = await this.request(connection, "initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "deck-session-readiness", version: "1" } }, boundedSignal);
        const server = response.serverInfo as Record<string, unknown> | undefined;
        if (response.protocolVersion !== "2024-11-05" || server?.name !== "codebase-memory-mcp" || server.version !== OWNED_CODEBASE_VERSION) throw failure("unsupported");
        connection.process.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
        await this.tools(connection, boundedSignal);
      });
      aborted(signal);
      return { ...spec, env: { ...spec.env, CBM_RUNTIME_DIR: entry.connection!.runtime } };
    } catch (error) {
      if (entry.connection) { await this.retire(entry.connection); entry.connection = undefined; }
      aborted(signal);
      // Warm failure permits exactly this one fresh managed generation. Never touch a PID
      // printed by a backend or retry native account rendezvous indefinitely.
      throw error;
    }
  }

  private readonly verifyExecutable = async (path: string, signal: AbortSignal): Promise<boolean> => {
    aborted(signal);
    const compatible = await verifyCodebaseExecutable(path, signal);
    aborted(signal);
    return compatible;
  };

  private connect(binary: string, args: readonly string[], cwd: string, env: Record<string, string>, runtime: string): Connection {
    const child = this.options.supervisor.spawn(binary, args, { cwd, env });
    const connection: Connection = { process: child, runtime, pending: new Map(), nextId: 1, closed: false, consumers: 0, retired: false };
    this.bindings.set(runtime, connection);
    let buffer = "";
    const fail = (error?: unknown) => { connection.closed = true; connection.failure = error instanceof Error ? error : failure("unavailable"); buffer = ""; for (const pending of connection.pending.values()) pending.reject(connection.failure); connection.pending.clear(); };
    child.stderr.on("data", () => {}); // Never surface raw external diagnostics, paths, credentials or PID suggestions.
    child.stdout.on("data", (chunk) => {
      if (connection.closed) return;
      buffer += chunk.toString("utf8");
      if (Buffer.byteLength(buffer) > 1024 * 1024) { fail(); return; }
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
        let message: { jsonrpc?: string; id?: number; result?: Record<string, unknown>; error?: unknown };
        try { message = JSON.parse(line); } catch { fail(); return; }
        const pending = message && connection.pending.get(message.id!);
        if (!pending) continue;
        connection.pending.delete(message.id!);
        if (message.jsonrpc !== "2.0" || message.error || !message.result || typeof message.result !== "object") pending.reject(failure("unavailable"));
        else pending.resolve(message.result);
      }
    });
    void child.exited.then(() => fail(), error => fail(error));
    return connection;
  }

  private async tools(connection: Connection, signal: AbortSignal): Promise<void> {
    const result = await this.request(connection, "tools/list", {}, signal);
    if (!Array.isArray(result.tools) || !["search_graph", "trace_path", "get_code_snippet"].every((name) => (result.tools as unknown[]).some((tool) => tool && typeof tool === "object" && (tool as { name?: unknown }).name === name))) throw failure("unsupported");
  }

  private request(connection: Connection, method: string, params: unknown, signal: AbortSignal): Promise<Record<string, unknown>> {
    if (connection.closed) return Promise.reject(connection.failure ?? failure("unavailable"));
    const id = connection.nextId++;
    const result = new Promise<Record<string, unknown>>((resolve, reject) => {
      connection.pending.set(id, { resolve, reject });
      try { connection.process.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n"); }
      catch (error) { connection.pending.delete(id); reject(error instanceof Error ? error : new Error("codebase-control-failed")); }
    });
    return this.abortable(result, signal).finally(() => connection.pending.delete(id));
  }

  private abortable<T>(result: Promise<T>, signal: AbortSignal): Promise<T> {
    return new Promise((resolve, reject) => {
      const abort = () => reject(failure("cancelled"));
      signal.addEventListener("abort", abort, { once: true });
      result.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
      if (signal.aborted) abort();
    });
  }

  private async deadline<T>(signal: AbortSignal, ms: number, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const bounded = new AbortController();
    const abort = () => bounded.abort(); signal.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(abort, ms);
    try { aborted(signal); return await this.abortable(operation(bounded.signal), bounded.signal); }
    catch (error) {
      if (!signal.aborted && bounded.signal.aborted && error instanceof SessionCodebaseReadinessError && error.kind === "cancelled") throw failure("unavailable");
      throw error;
    }
    finally { clearTimeout(timer); signal.removeEventListener("abort", abort); }
  }

  private dispose(connection: Connection): Promise<void> {
    return connection.dispose ??= (async () => {
      connection.closed = true;
      for (const pending of connection.pending.values()) pending.reject(failure("cancelled")); connection.pending.clear();
      // EOF allows upstream's supported last-client shutdown. Escalation is confined to our
      // live supervised frontend group, never to the independently managed account daemon.
      connection.process.stdin.end();
      const grace = this.options.cleanupTimeoutMs ?? 500;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const drained = await Promise.race([connection.process.exited.then(() => true), new Promise<false>((resolve) => { timer = setTimeout(() => resolve(false), grace); })]);
      if (timer) clearTimeout(timer);
      if (!drained) { await connection.process.terminateGroup(0); await connection.process.exited; }
      this.bindings.delete(connection.runtime);
      // This namespace was freshly created by this service, never adopted from configuration.
      // All native consumers and the supervised group have drained before its removal.
      if (this.runtimes.has(connection.runtime)) {
        try { if (realpathSync(connection.runtime) === connection.runtime) rmSync(connection.runtime, { recursive: true }); this.runtimes.delete(connection.runtime); } catch { /* retain ownership evidence when cleanup fails */ }
      }
    })();
  }

  private retire(connection: Connection): Promise<void> {
    connection.retired = true;
    return connection.consumers ? Promise.resolve() : this.dispose(connection);
  }

  /** Each successful ensure acquires a task reference. The caller releases after native drain. */
  release(spec: StdioSpec): Promise<void> {
    const connection = this.leases.get(spec); this.leases.delete(spec);
    if (!connection || !connection.consumers) return Promise.resolve();
    connection.consumers--;
    return connection.retired && !connection.consumers ? this.dispose(connection) : Promise.resolve();
  }

  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    for (const entry of this.entries.values()) entry.operation?.controller.abort();
    return this.closing = (async () => {
      await Promise.all([...this.entries.values()].map(async (entry) => { await entry.operation?.result.catch(() => {}); }));
      // A rejected native close is not proof that its backend consumers drained. Preserve
      // that binding and its namespace for the daemon's containment/recovery path.
      await Promise.all([...this.bindings.values()].map((connection) => this.retire(connection)));
      this.entries.clear(); this.verified.clear();
    })();
  }
}
