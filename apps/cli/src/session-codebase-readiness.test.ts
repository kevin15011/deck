import { afterEach, describe, expect, test } from "bun:test";
import { PassThrough } from "node:stream";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SupervisedProcess } from "@deck/session-host";
import { SessionCodebaseReadiness } from "./session-codebase-readiness";

const roots: string[] = [];
const services: SessionCodebaseReadiness[] = [];
const leases: Array<{ service: SessionCodebaseReadiness; spec: any }> = [];
afterEach(async () => { for (const { service, spec } of leases.splice(0)) await service.release(spec); await Promise.all(services.splice(0).map((s) => s.close())); for (const p of roots.splice(0)) rmSync(p, { recursive: true, force: true }); });

function track(service: SessionCodebaseReadiness) {
  const ensure = service.ensure.bind(service);
  service.ensure = async (...args) => { const spec = await ensure(...args); leases.push({ service, spec }); return spec; };
  services.push(service); return service;
}

function fixture(coldTimeoutMs = 30, warmTimeoutMs = 20) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "deck-readiness-test-"))); roots.push(root);
  const binary = join(root, "fake-codebase"); writeFileSync(binary, "fixture");
  let mode = "healthy", spawns = 0, drains = 0, lists = 0, verifications = 0;
  const readyGates = new Map<string, Promise<any>>();
  const toolsGates = new Map<string, (reply: () => void) => void>();
  const environments: Record<string, string>[] = [];
  const processes: SupervisedProcess[] = [];
  const supervisor = { spawn(_command: string, _args: readonly string[], options: { env?: Record<string, string> } = {}) {
    spawns++; environments.push(options.env!);
    const stdout = new PassThrough(), stderr = new PassThrough(), stdin = new PassThrough();
    let resolveExit!: (v: unknown) => void;
    const exited = new Promise<any>((resolve) => { resolveExit = resolve; });
    let closed = false;
    const end = () => { if (closed) return; closed = true; drains++; stdout.end(); stderr.end(); resolveExit({ ok: true, code: 0, signal: null, drained: true, anchorLost: false }); };
    stdin.on("finish", end);
    stdin.on("data", (raw) => {
      for (const line of raw.toString().trim().split("\n")) {
        const msg = JSON.parse(line);
        if (!msg.id) continue;
        if (mode === "malformed") { stdout.write("not-json\n"); for (let i = 0; i < 20; i++) stdout.write("x".repeat(64 * 1024)); continue; }
        if (mode === "oversized") { stdout.write("x".repeat(1024 * 1024 + 1)); continue; }
        if (mode === "hang") { stderr.write("foreign daemon pid=424242 token=secret-never-show\n"); continue; }
        if (msg.method === "initialize") stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: mode === "protocol" ? "1900-01-01" : "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "codebase-memory-mcp", version: mode === "version" ? "99.0.0" : "0.11.0" } } }) + "\n");
        else if (msg.method === "tools/list") {
          lists++; const invalid = mode === "tools" || mode === "fail-next-list";
          if (mode === "fail-next-list") mode = "healthy";
          const reply = () => { if (!closed) stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { tools: (invalid ? ["unrelated"] : ["search_graph", "trace_path", "get_code_snippet"]).map((name) => ({ name, inputSchema: { type: "object" } })) } }) + "\n"); };
          const gate = toolsGates.get(_command); toolsGates.delete(_command);
          if (gate) gate(reply); else reply();
        }
      }
    });
    const child = { anchorPid: 7, ready: readyGates.get(_command) ?? Promise.resolve({ workerPid: 8 }), stdin, stdout, stderr, exited, interrupt: () => true, terminateGroup: async () => end() };
    processes.push(child); return child;
  } };
  let now = 0;
  const service = new SessionCodebaseReadiness({ supervisor, runtimeParent: root, environment: { CBM_CACHE_DIR: "/canonical/cache", SAFE: "value" }, coldTimeoutMs, warmTimeoutMs, cleanupTimeoutMs: 30, now: () => now, verifyExecutable: async () => { verifications++; return true; } });
  track(service);
  const spec = { command: binary, args: [], env: {} };
  const context = (signal?: AbortSignal) => ({ projectRoot: root, sessionId: "s", taskId: "t", signal: signal ?? new AbortController().signal });
  const anotherSpec = (name: string) => { const command = join(root, name); writeFileSync(command, "fixture"); return { ...spec, command }; };
  const holdReady = (command: string) => { let ready!: () => void; readyGates.set(command, new Promise((resolve) => { ready = () => resolve({ workerPid: 8 }); })); return ready; };
  const holdNextTools = (command: string) => {
    let requested!: () => void, reply!: () => void;
    const held = new Promise<void>((resolve) => { requested = resolve; });
    toolsGates.set(command, (respond) => { reply = respond; requested(); });
    return { held, reply: () => reply() };
  };
  return { root, binary, spec, context, service, environments, processes, supervisor, anotherSpec, holdReady, holdNextTools, verifications: () => verifications, setMode: (v: string) => { mode = v; }, advance: (v: number) => { now += v; }, counts: () => ({ spawns, drains, lists }) };
}

async function until(predicate: () => boolean) {
  for (let i = 0; i < 100 && !predicate(); i++) await Bun.sleep(1);
  expect(predicate()).toBe(true);
}

describe("managed Codebase Memory readiness", () => {
  test.each(["complete", "fail", "cancel", "shutdown"])("a superseded warm probe retains its runtime after the original lease releases: %s", async (outcome) => {
    const t = fixture(1000, 1000), b = { ...t.anotherSpec("binary-b"), env: { TOKEN: "rotated" } };
    const original = await t.service.ensure(t.spec, t.context());
    const runtime = original.env.CBM_RUNTIME_DIR!;
    const gate = t.holdNextTools(t.binary), abort = new AbortController();
    if (outcome === "fail") t.setMode("fail-next-list");
    const pending = t.service.ensure(t.spec, t.context(abort.signal));
    const result = Promise.allSettled([pending]);
    await gate.held;
    const preparedB = await t.service.ensure(b, t.context());
    await t.service.release(original);
    expect(t.counts()).toMatchObject({ spawns: 2, drains: 0 });
    expect(existsSync(runtime)).toBe(true);

    if (outcome === "complete" || outcome === "fail") {
      gate.reply(); const prepared = await pending;
      if (outcome === "complete") {
        expect(prepared.env.CBM_RUNTIME_DIR).toBe(runtime);
        expect(t.counts()).toMatchObject({ spawns: 2, drains: 0 });
      } else {
        expect(prepared.env.CBM_RUNTIME_DIR).not.toBe(runtime);
        expect(t.counts()).toMatchObject({ spawns: 3, drains: 1 });
      }
      await t.service.release(prepared);
    } else {
      if (outcome === "cancel") abort.abort(); else await t.service.close();
      const [settled] = await result;
      expect(settled!.status).toBe("rejected");
      if (settled!.status === "rejected") expect(settled.reason.message).toContain("cancelled");
      expect(t.counts()).toMatchObject({ spawns: 2, drains: 1 });
      gate.reply(); // A late held response cannot recreate or admit the cancelled generation.
    }
    expect(existsSync(runtime)).toBe(false);
    if (outcome !== "shutdown") {
      const warmB = await t.service.ensure(b, t.context());
      expect(warmB.env.CBM_RUNTIME_DIR).toBe(preparedB.env.CBM_RUNTIME_DIR);
      await t.service.release(warmB);
      await t.service.close();
    }
    await t.service.release(preparedB);
    expect(t.counts()).toMatchObject({ spawns: outcome === "fail" ? 3 : 2, drains: outcome === "fail" ? 3 : 2 });
    expect(existsSync(preparedB.env.CBM_RUNTIME_DIR!)).toBe(false);
  });

  test("alternating independently verified binaries retain separate exact runtimes", async () => {
    const t = fixture(), b = t.anotherSpec("binary-b");
    const a1 = await t.service.ensure(t.spec, t.context());
    await t.service.release(a1);
    const b1 = await t.service.ensure(b, t.context());
    await t.service.release(b1);
    for (const [spec, runtime] of [[t.spec, a1.env.CBM_RUNTIME_DIR], [b, b1.env.CBM_RUNTIME_DIR]] as const) {
      const again = await t.service.ensure(spec, t.context());
      expect(again.env.CBM_RUNTIME_DIR).toBe(runtime);
      await t.service.release(again);
    }
    expect(a1.env.CBM_RUNTIME_DIR).not.toBe(b1.env.CBM_RUNTIME_DIR);
    expect(t.counts()).toEqual({ spawns: 2, drains: 0, lists: 4 });
    expect(t.verifications()).toBe(2);
    await t.service.close();
    expect(t.counts().drains).toBe(2);
  });

  test("compatible active leases survive alternation and release without eviction within capacity", async () => {
    const t = fixture(), b = t.anotherSpec("binary-b");
    const a1 = await t.service.ensure(t.spec, t.context());
    const b1 = await t.service.ensure(b, t.context());
    const [a2, b2] = await Promise.all([t.service.ensure(t.spec, t.context()), t.service.ensure(b, t.context())]);
    await t.service.release(a1); await t.service.release(b1);
    expect(t.counts()).toMatchObject({ spawns: 2, drains: 0 });
    expect(a2.env.CBM_RUNTIME_DIR).toBe(a1.env.CBM_RUNTIME_DIR);
    expect(b2.env.CBM_RUNTIME_DIR).toBe(b1.env.CBM_RUNTIME_DIR);
    await t.service.release(a2); await t.service.release(b2);
    expect(t.counts().drains).toBe(0);
  });

  test("capacity evicts the least recently used eligible runtime, including warm hits", async () => {
    const t = fixture(), b = t.anotherSpec("binary-b"), c = t.anotherSpec("binary-c");
    const a1 = await t.service.ensure(t.spec, t.context()); await t.service.release(a1);
    const b1 = await t.service.ensure(b, t.context()); await t.service.release(b1);
    const a2 = await t.service.ensure(t.spec, t.context()); await t.service.release(a2);
    const c1 = await t.service.ensure(c, t.context()); await t.service.release(c1);
    expect(t.counts()).toMatchObject({ spawns: 3, drains: 1 });
    expect(existsSync(b1.env.CBM_RUNTIME_DIR!)).toBe(false);
    expect(existsSync(a1.env.CBM_RUNTIME_DIR!)).toBe(true);
    const a3 = await t.service.ensure(t.spec, t.context());
    expect(a3.env.CBM_RUNTIME_DIR).toBe(a1.env.CBM_RUNTIME_DIR);
    const b2 = await t.service.ensure(b, t.context());
    expect(b2.env.CBM_RUNTIME_DIR).not.toBe(b1.env.CBM_RUNTIME_DIR);
    expect(t.verifications()).toBe(3);
  });

  test("active leases can exceed two connections and release prunes without closing remaining consumers", async () => {
    const t = fixture();
    const a = await t.service.ensure(t.spec, t.context());
    const a2 = await t.service.ensure(t.spec, t.context());
    const b = await t.service.ensure(t.anotherSpec("binary-b"), t.context());
    const c = await t.service.ensure(t.anotherSpec("binary-c"), t.context());
    expect(t.counts()).toMatchObject({ spawns: 3, drains: 0 });
    await t.service.release(a);
    expect(t.counts().drains).toBe(0);
    await t.service.release(a2);
    expect(t.counts().drains).toBe(1);
    expect(existsSync(a.env.CBM_RUNTIME_DIR!)).toBe(false);
    expect(existsSync(b.env.CBM_RUNTIME_DIR!)).toBe(true);
    expect(existsSync(c.env.CBM_RUNTIME_DIR!)).toBe(true);
    await t.service.release(a2);
    await t.service.close(); expect(t.counts().drains).toBe(1);
    await t.service.release(b); await t.service.release(c);
    expect(t.counts().drains).toBe(3);
  });

  test("inflight overflow survives other completions and prunes when initialization completes", async () => {
    const t = fixture(1000), b = t.anotherSpec("binary-b"), c = t.anotherSpec("binary-c");
    const aReady = t.holdReady(t.binary), bReady = t.holdReady(b.command), cReady = t.holdReady(c.command);
    const pendingA = t.service.ensure(t.spec, t.context());
    const pendingB = t.service.ensure(b, t.context());
    const pendingC = t.service.ensure(c, t.context());
    await until(() => t.counts().spawns === 3);
    expect(t.counts().drains).toBe(0);
    aReady(); const a = await pendingA; await t.service.release(a);
    expect(t.counts().drains).toBe(1);
    bReady(); const preparedB = await pendingB;
    cReady(); const preparedC = await pendingC;
    expect(t.counts().drains).toBe(1);
    expect(existsSync(preparedB.env.CBM_RUNTIME_DIR!)).toBe(true);
    expect(existsSync(preparedC.env.CBM_RUNTIME_DIR!)).toBe(true);
  });

  test.each(["spec", "overlay", "inherited"])("%s environment rotation supersedes compatible binaries and cannot revive a retired binding", async (source) => {
    const t = fixture(), b = t.anotherSpec("binary-b"), environment = { TOKEN: "old" };
    const service = source === "inherited" ? track(new SessionCodebaseReadiness({ supervisor: t.supervisor, environment, verifyExecutable: async () => true })) : t.service;
    const prepare = (spec: typeof t.spec, token: string) => {
      if (source === "inherited") environment.TOKEN = token;
      return service.ensure(source === "spec" ? { ...spec, env: { TOKEN: token } } : spec, t.context(), source === "overlay" ? { TOKEN: token } : {});
    };
    const a = await prepare(t.spec, "old"), oldB = await prepare(b, "old");
    const rotated = await prepare(b, "new");
    expect(t.counts().drains).toBe(0);
    const again = await prepare(t.spec, "old");
    expect(again.env.CBM_RUNTIME_DIR).not.toBe(a.env.CBM_RUNTIME_DIR);
    await service.release(a); await service.release(oldB); await service.release(rotated);
    expect(t.counts()).toMatchObject({ spawns: 4, drains: 3 });
  });

  test("replacement at the same executable location re-verifies and retires the prior generation only after drain", async () => {
    const t = fixture(), b = t.anotherSpec("binary-b");
    const a = await t.service.ensure(t.spec, t.context()), warmB = await t.service.ensure(b, t.context());
    writeFileSync(t.binary, "replacement bytes");
    const replaced = await t.service.ensure(t.spec, t.context());
    expect(replaced.env.CBM_RUNTIME_DIR).not.toBe(a.env.CBM_RUNTIME_DIR);
    expect(t.verifications()).toBe(3);
    expect(t.counts().drains).toBe(0);
    await t.service.release(a);
    expect(t.counts().drains).toBe(1);
    const bAgain = await t.service.ensure(b, t.context());
    expect(bAgain.env.CBM_RUNTIME_DIR).toBe(warmB.env.CBM_RUNTIME_DIR);
  });

  test("retargeting a launch symlink supersedes its old binary despite a different real path", async () => {
    const t = fixture(), b = t.anotherSpec("binary-b"), launch = join(t.root, "launch");
    symlinkSync(t.binary, launch);
    const spec = { ...t.spec, command: launch };
    const a = await t.service.ensure(spec, t.context()); await t.service.release(a);
    unlinkSync(launch); symlinkSync(b.command, launch);
    const replacement = await t.service.ensure(spec, t.context());
    expect(t.verifications()).toBe(2);
    expect(t.counts()).toMatchObject({ spawns: 2, drains: 1 });
    expect(existsSync(a.env.CBM_RUNTIME_DIR!)).toBe(false);
    expect(replacement.env.CBM_RUNTIME_DIR).not.toBe(a.env.CBM_RUNTIME_DIR);
  });

  test("shutdown cancels and drains superseded initialization as well as the current key", async () => {
    const t = fixture(1000), b = t.anotherSpec("binary-b");
    t.holdReady(t.binary); t.holdReady(b.command);
    const old = t.service.ensure(t.spec, t.context(), { TOKEN: "old" });
    await until(() => t.counts().spawns === 1);
    const current = t.service.ensure(b, t.context(), { TOKEN: "new" });
    await until(() => t.counts().spawns === 2);
    // Attach rejection observers before closing either pending preparation.
    const results = Promise.allSettled([old, current]);
    await t.service.close();
    expect((await results).map(result => result.status)).toEqual(["rejected", "rejected"]);
    expect(t.counts().drains).toBe(2);
    for (const env of t.environments) expect(existsSync(env.CBM_RUNTIME_DIR!)).toBe(false);
  });

  test("cancelling overflow initialization cleans only its runtime and leaves both warm bindings reusable", async () => {
    const t = fixture(1000), b = t.anotherSpec("binary-b"), c = t.anotherSpec("binary-c");
    const a = await t.service.ensure(t.spec, t.context()), preparedB = await t.service.ensure(b, t.context());
    t.holdReady(c.command); const abort = new AbortController();
    const pending = t.service.ensure(c, t.context(abort.signal));
    await until(() => t.counts().spawns === 3); abort.abort();
    await expect(pending).rejects.toThrow("cancelled");
    expect(t.counts().drains).toBe(1);
    await t.service.release(a); await t.service.release(preparedB);
    const aAgain = await t.service.ensure(t.spec, t.context()), bAgain = await t.service.ensure(b, t.context());
    expect(aAgain.env.CBM_RUNTIME_DIR).toBe(a.env.CBM_RUNTIME_DIR);
    expect(bAgain.env.CBM_RUNTIME_DIR).toBe(preparedB.env.CBM_RUNTIME_DIR);
    expect(t.counts().spawns).toBe(3);
  });

  test("cancellation during capacity cleanup cannot publish a successful lease", async () => {
    const t = fixture(), b = t.anotherSpec("binary-b"), c = t.anotherSpec("binary-c");
    const a = await t.service.ensure(t.spec, t.context()); await t.service.release(a);
    const preparedB = await t.service.ensure(b, t.context()); await t.service.release(preparedB);
    const abort = new AbortController();
    t.processes[0]!.stdin.once("finish", () => abort.abort());
    await expect(t.service.ensure(c, t.context(abort.signal))).rejects.toThrow("cancelled");
    expect(t.counts()).toMatchObject({ spawns: 3, drains: 2 });
    const bAgain = await t.service.ensure(b, t.context());
    expect(bAgain.env.CBM_RUNTIME_DIR).toBe(preparedB.env.CBM_RUNTIME_DIR);
  });

  test("an admission during completion cleanup still coalesces with the initializing key", async () => {
    const t = fixture(), b = t.anotherSpec("binary-b"), c = t.anotherSpec("binary-c");
    const a = await t.service.ensure(t.spec, t.context()); await t.service.release(a);
    const preparedB = await t.service.ensure(b, t.context()); await t.service.release(preparedB);
    let concurrent: ReturnType<typeof t.service.ensure> | undefined;
    t.processes[0]!.stdin.once("finish", () => { concurrent = t.service.ensure(c, t.context()); });
    const preparedC = await t.service.ensure(c, t.context());
    expect(concurrent).toBeDefined();
    const joined = await concurrent!;
    expect(joined.env.CBM_RUNTIME_DIR).toBe(preparedC.env.CBM_RUNTIME_DIR);
    expect(t.counts()).toEqual({ spawns: 3, drains: 1, lists: 3 });
  });

  test("failed warm probe recovers once without invalidating a compatible binary or an older live lease", async () => {
    const t = fixture(), b = t.anotherSpec("binary-b");
    const a = await t.service.ensure(t.spec, t.context()), preparedB = await t.service.ensure(b, t.context());
    t.setMode("fail-next-list");
    const recovered = await t.service.ensure(t.spec, t.context());
    expect(recovered.env.CBM_RUNTIME_DIR).not.toBe(a.env.CBM_RUNTIME_DIR);
    expect(t.counts()).toMatchObject({ spawns: 3, drains: 0 });
    await t.service.release(a); expect(t.counts().drains).toBe(1);
    const bAgain = await t.service.ensure(b, t.context());
    expect(bAgain.env.CBM_RUNTIME_DIR).toBe(preparedB.env.CBM_RUNTIME_DIR);
  });

  test("retains one verified frontend and checks live MCP tools before every turn", async () => {
    const t = fixture();
    const first = await t.service.ensure(t.spec, t.context());
    const second = await t.service.ensure(t.spec, t.context());
    expect(first.env.CBM_RUNTIME_DIR).toBe(second.env.CBM_RUNTIME_DIR);
    expect(first.env.CBM_CACHE_DIR).toBeUndefined();
    expect(t.environments[0]?.CBM_CACHE_DIR).toBe("/canonical/cache");
    expect(t.counts()).toEqual({ spawns: 1, drains: 0, lists: 2 });
    await t.service.release(first); await t.service.release(second);
    await t.service.close(); expect(t.counts().drains).toBe(1);
  });

  test("coalesces concurrent initialization, while cancelling one waiter leaves the other active", async () => {
    const t = fixture(), a = new AbortController();
    const first = t.service.ensure(t.spec, t.context(a.signal));
    const second = t.service.ensure(t.spec, t.context());
    a.abort();
    await expect(first).rejects.toThrow("cancelled");
    await second;
    expect(t.counts().spawns).toBe(1);
    expect(t.counts().drains).toBe(0);
  });

  test("hanging backend is bounded, drained, redacted and negatively cached until identity changes", async () => {
    const t = fixture(); t.setMode("hang");
    const start = Date.now();
    await expect(t.service.ensure(t.spec, t.context())).rejects.toThrow("codebase-memory-unavailable");
    expect(Date.now() - start).toBeLessThan(500);
    expect(t.counts()).toMatchObject({ spawns: 1, drains: 1 });
    await expect(t.service.ensure(t.spec, t.context())).rejects.toThrow("codebase-memory-unavailable");
    expect(t.counts().spawns).toBe(1);
    t.setMode("healthy");
    await t.service.ensure({ ...t.spec, env: { CHANGED: "secret-new-value" } }, t.context());
    expect(t.counts().spawns).toBe(2);
  });

  test.each(["protocol", "version", "tools"])("rejects an unsupported %s without retaining the frontend", async (mode) => {
    const t = fixture(); t.setMode(mode);
    await expect(t.service.ensure(t.spec, t.context())).rejects.toThrow("codebase-memory-unsupported");
    expect(t.counts().drains).toBe(1);
  });

  test.each(["malformed", "oversized"])("a %s response fails with bounded safe output and drains its supervised frontend", async (mode) => {
    const t = fixture(); t.setMode(mode);
    let error: Error | undefined;
    try { await t.service.ensure(t.spec, t.context()); } catch (caught) { error = caught as Error; }
    expect(error?.message).toContain("codebase-memory-unavailable");
    expect(error?.message.length).toBeLessThan(200);
    expect(error?.message).not.toContain("secret-never-show");
    expect(t.counts().drains).toBe(1);
  });

  test("last-waiter cancellation drains the owned probe and does not poison the next turn", async () => {
    const t = fixture(); t.setMode("hang"); const abort = new AbortController();
    const pending = t.service.ensure(t.spec, t.context(abort.signal));
    await new Promise((r) => setTimeout(r, 1)); abort.abort();
    await expect(pending).rejects.toThrow("cancelled");
    expect(t.counts().drains).toBe(1);
    t.setMode("healthy"); await t.service.ensure(t.spec, t.context());
    expect(t.counts().spawns).toBe(2);
  });

  test("one failed warm check recovers in a fresh private runtime, and does not retry forever", async () => {
    const t = fixture(); const first = await t.service.ensure(t.spec, t.context());
    await t.service.release(first);
    t.setMode("hang");
    await expect(t.service.ensure(t.spec, t.context())).rejects.toThrow("codebase-memory-unavailable");
    expect(t.counts()).toMatchObject({ spawns: 2, drains: 2 });
    expect(t.environments[1]?.CBM_RUNTIME_DIR).not.toBe(first.env.CBM_RUNTIME_DIR);
    t.advance(30_001); t.setMode("healthy"); await t.service.ensure(t.spec, t.context());
    expect(t.counts().spawns).toBe(3);
  });

  test("an unverified executable never runs and shutdown rejects subsequent probes", async () => {
    const t = fixture();
    const service = track(new SessionCodebaseReadiness({ supervisor: { spawn: () => { throw new Error("must not spawn"); } }, runtimeParent: t.root, verifyExecutable: async () => false }));
    await expect(service.ensure(t.spec, t.context())).rejects.toThrow("codebase-memory-unsupported");
    await service.close();
    await expect(service.ensure(t.spec, t.context())).rejects.toThrow("cancelled");
  });

  test("recovery preserves a backend referenced by another native task until its handle drains", async () => {
    const t = fixture(), first = await t.service.ensure(t.spec, t.context());
    t.setMode("hang");
    await expect(t.service.ensure(t.spec, t.context())).rejects.toThrow("codebase-memory-unavailable");
    expect(t.counts()).toMatchObject({ spawns: 2, drains: 1 });
    await t.service.release(first); await t.service.release(first);
    expect(t.counts().drains).toBe(2);
  });

  test("spec changes retire the old binding without closing a live native consumer", async () => {
    const t = fixture(), first = await t.service.ensure(t.spec, t.context());
    const second = await t.service.ensure({ ...t.spec, args: ["--changed"] }, t.context());
    expect(second.env.CBM_RUNTIME_DIR).not.toBe(first.env.CBM_RUNTIME_DIR);
    expect(t.counts().drains).toBe(0);
    await t.service.release(first); expect(t.counts().drains).toBe(1);
    await t.service.release(first); expect(t.counts().drains).toBe(1);
  });

  test("simultaneous changed-spec admissions publish one new frontend", async () => {
    const t = fixture(), first = await t.service.ensure(t.spec, t.context());
    await t.service.release(first);
    await Promise.all([1, 2, 3].map(() => t.service.ensure({ ...t.spec, args: ["--new"] }, t.context())));
    expect(t.counts()).toMatchObject({ spawns: 2, drains: 1 });
  });

  test("a cancelled project cannot abort digest verification needed by another project", async () => {
    const t = fixture(), other = join(t.root, "another-project"); mkdirSync(other);
    let verified!: () => void, verificationSignal: AbortSignal | undefined;
    const service = track(new SessionCodebaseReadiness({ supervisor: t.supervisor, runtimeParent: t.root, coldTimeoutMs: 100, verifyExecutable: async (_path, signal) => { verificationSignal = signal; await new Promise<void>((resolve) => { verified = resolve; }); return !signal.aborted; } }));
    const a = new AbortController();
    const first = service.ensure(t.spec, t.context(a.signal));
    const second = service.ensure(t.spec, { ...t.context(), projectRoot: other });
    a.abort();
    await expect(first).rejects.toThrow("cancelled");
    expect(verificationSignal?.aborted).toBe(false);
    verified(); await second;
    expect(t.counts().spawns).toBe(1);
  });

  test("long configured state paths use a short private runtime and remove only that owned namespace", async () => {
    const t = fixture(), long = join(t.root, "x".repeat(100)); mkdirSync(long);
    const service = track(new SessionCodebaseReadiness({ supervisor: t.supervisor, runtimeParent: long, verifyExecutable: async () => true }));
    const prepared = await service.ensure(t.spec, t.context());
    const runtime = prepared.env.CBM_RUNTIME_DIR!;
    expect(Buffer.byteLength(runtime)).toBeLessThan(40);
    expect(runtime.startsWith(realpathSync("/tmp"))).toBe(true);
    mkdirSync(join(runtime, "owned-upstream-state"));
    await service.release(prepared); await service.close();
    expect(existsSync(runtime)).toBe(false);
    expect(existsSync(long)).toBe(true);
  });

  test("shutdown preserves a backend with an unproven native consumer until its lease is released", async () => {
    const t = fixture(), prepared = await t.service.ensure(t.spec, t.context());
    await t.service.close();
    expect(t.counts().drains).toBe(0);
    expect(existsSync(prepared.env.CBM_RUNTIME_DIR!)).toBe(true);
    await t.service.release(prepared);
    expect(t.counts().drains).toBe(1);
    expect(existsSync(prepared.env.CBM_RUNTIME_DIR!)).toBe(false);
  });
});

test("negative-cache metadata is bounded, retains recent backoff and expires without displacing warm connections", async () => {
  const t = fixture();
  const warm = await t.service.ensure(t.spec, t.context()); await t.service.release(warm);
  t.setMode("tools");
  let last = t.spec;
  for (let i = 0; i < 70; i++) {
    last = t.anotherSpec(`unsupported-${i}`);
    await expect(t.service.ensure(last, t.context())).rejects.toThrow("unsupported");
  }
  const spawns = t.counts().spawns;
  await expect(t.service.ensure(last, t.context())).rejects.toThrow("unsupported");
  expect(t.counts().spawns).toBe(spawns);
  // Process counts alone cannot detect leaked dead metadata; inspect only resident size.
  const entries = () => (t.service as unknown as { entries: Map<string, unknown> }).entries.size;
  expect(entries()).toBeLessThanOrEqual(65); // two budgets: one warm runtime + 64 negative entries
  t.advance(30_001); t.setMode("healthy");
  const again = await t.service.ensure(t.spec, t.context());
  expect(again.env.CBM_RUNTIME_DIR).toBe(warm.env.CBM_RUNTIME_DIR);
  expect(entries()).toBe(1);
  await t.service.ensure(last, t.context());
  expect(t.counts().spawns).toBe(spawns + 1);
});

test("warm unsupported hash remains cached after retry TTL, invalidates on file replacement, and never spawns", async () => {
  const t = fixture(); let checks = 0, now = 0;
  const service = track(new SessionCodebaseReadiness({ supervisor: t.supervisor, runtimeParent: t.root, now: () => now, verifyExecutable: async () => { checks++; return false; } }));
  await expect(service.ensure(t.spec, t.context())).rejects.toThrow("codebase-memory-unsupported");
  now = 31_000;
  await expect(service.ensure(t.spec, t.context())).rejects.toThrow("codebase-memory-unsupported");
  expect(checks).toBe(1); expect(t.counts().spawns).toBe(0);
  writeFileSync(t.binary, "replaced fixture bytes");
  await expect(service.ensure(t.spec, t.context())).rejects.toThrow("codebase-memory-unsupported");
  expect(checks).toBe(2);
  const cancelled = new AbortController(); cancelled.abort();
  await expect(service.ensure(t.spec, t.context(cancelled.signal))).rejects.toThrow("codebase-memory-cancelled");
  expect(checks).toBe(2); expect(t.counts().spawns).toBe(0);
});

test("an owned artifact mismatch is fatal integrity failure, not optional unsupported", async () => {
  const t=fixture(), directory=join(t.root,"codebase-native-v0.11.0","fixture-platform"); mkdirSync(directory,{recursive:true});
  const binary=join(directory,"codebase-memory-mcp"); writeFileSync(binary,"tampered owned bytes");
  const service=track(new SessionCodebaseReadiness({supervisor:t.supervisor,verifyExecutable:async()=>false}));
  await expect(service.ensure({...t.spec,command:binary},t.context())).rejects.toThrow("codebase-memory-integrity-failed"); expect(t.counts().spawns).toBe(0);
});

test("native supervisor authorization/control failures retain their identity", async () => {
  const t=fixture(), error=Object.assign(new Error("protected supervisor failure"),{code:"EACCES"});
  const service=track(new SessionCodebaseReadiness({supervisor:{spawn(){throw error;}},verifyExecutable:async()=>true}));
  await expect(service.ensure(t.spec,t.context())).rejects.toBe(error);
});
