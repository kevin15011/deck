import { afterEach, describe, expect, test } from "bun:test";
import { PassThrough } from "node:stream";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
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

function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "deck-readiness-test-"))); roots.push(root);
  const binary = join(root, "fake-codebase"); writeFileSync(binary, "fixture");
  let mode = "healthy", spawns = 0, drains = 0, lists = 0;
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
        else if (msg.method === "tools/list") { lists++; stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { tools: (mode === "tools" ? ["unrelated"] : ["search_graph", "trace_path", "get_code_snippet"]).map((name) => ({ name, inputSchema: { type: "object" } })) } }) + "\n"); }
      }
    });
    const child = { anchorPid: 7, ready: Promise.resolve({ workerPid: 8 }), stdin, stdout, stderr, exited, interrupt: () => true, terminateGroup: async () => end() };
    processes.push(child); return child;
  } };
  let now = 0;
  const service = new SessionCodebaseReadiness({ supervisor, runtimeParent: root, environment: { CBM_CACHE_DIR: "/canonical/cache", SAFE: "value" }, coldTimeoutMs: 30, warmTimeoutMs: 20, cleanupTimeoutMs: 30, now: () => now, verifyExecutable: async () => true });
  track(service);
  const spec = { command: binary, args: [], env: {} };
  const context = (signal?: AbortSignal) => ({ projectRoot: root, sessionId: "s", taskId: "t", signal: signal ?? new AbortController().signal });
  return { root, binary, spec, context, service, environments, processes, supervisor, setMode: (v: string) => { mode = v; }, advance: (v: number) => { now += v; }, counts: () => ({ spawns, drains, lists }) };
}

describe("managed Codebase Memory readiness", () => {
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
