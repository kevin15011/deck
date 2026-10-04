import { describe, expect, test } from "bun:test";
import { getDefaultDeckConfig } from "@deck/core";
import type { SupermemoryAddPayload, SupermemorySearchPayload, SupermemoryRuntimeTransport } from "@deck/adapter-supermemory/runtime";
import { mkdtemp } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createSupermemoryRuntimeHost } from "./supermemory-runtime-host";

const SCHEMA = "deck-runner-memory-loopback-v1";
const SAVE_TEXT = "Decision: the adaptive memory loopback now serves explicit search and save for Pi and Codex.";

async function bridgeFor(runnerId: "pi" | "codex", options: { searchResults?: { content: string }[] } = {}) {
  const adds: SupermemoryAddPayload[] = [];
  const searches: SupermemorySearchPayload[] = [];
  const root = await mkdtemp(join(tmpdir(), "deck-sm-explicit-tools-"));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["remote", "add", "origin", "https://github.com/kevin15011/deck.git"], { cwd: root, stdio: "ignore" });
  const transport: SupermemoryRuntimeTransport = {
    async health() {},
    async profile() { return { profile: {} }; },
    async search(payload) { searches.push(payload); return { results: options.searchResults ?? [{ id: "m1", content: "Convention: all memory goes through the loopback." }] }; },
    async add(payload) { adds.push(payload); },
  };
  const host = await createSupermemoryRuntimeHost({
    projectRoot: root,
    stateHome: await mkdtemp(join(tmpdir(), "deck-sm-explicit-tools-state-")),
    deckConfig: { ...getDefaultDeckConfig(), adaptiveMemory: { enabled: true, activeProvider: "supermemory" } },
    runnerId,
    role: "lead",
    launchMode: "interactive",
    deferInitialRecallToLoopback: true,
    transport,
    observabilitySink: { path: "memory://t", healthy: true, diagnostics: [], observe() {}, health: () => ({ healthy: true, diagnostics: [] }) },
  });
  const bridge = (await host.startLoopbackBridge())!;
  let counter = 0;
  const post = async (body: Record<string, unknown>, token = bridge.token): Promise<any> => {
    const response = await fetch(bridge.endpoint, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ schema: SCHEMA, runnerId, eventId: `e-${counter++}`, timestamp: Date.now(), sessionId: "native-session", ...body }),
    });
    return { status: response.status, ...(await response.json() as object) };
  };
  return { bridge, post, adds, searches };
}

describe("loopback explicit search and save", () => {
  test("search returns a compact advisory envelope bound to the host canonical tag", async () => {
    const { bridge, post, searches } = await bridgeFor("pi");
    const result = await post({ event: "search", role: "lead", query: "loopback convention" });
    expect(result.ok).toBe(true);
    expect(result.resultCount).toBe(1);
    expect(result.advisoryText).toContain("DECK_ADAPTIVE_CONTEXT_JSON_V1");
    expect(result.advisoryText).toContain("all memory goes through the loopback");
    expect(searches).toHaveLength(1);
    expect(searches[0]!.containerTag).toMatch(/^sm_project_v1_/);
    expect(searches[0]!.q).toBe("loopback convention");
    await bridge.close();
  });

  test("search honors an optional limit but never exceeds the role policy", async () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ content: `Fact number ${i} about the loopback.` }));
    const { bridge, post } = await bridgeFor("pi", { searchResults: many });
    expect((await post({ event: "search", role: "lead", query: "facts", limit: 2 })).resultCount).toBe(2);
    expect((await post({ event: "search", role: "lead", query: "facts", limit: 99 })).resultCount).toBe(5);
    expect((await post({ event: "search", role: "quality", query: "facts", limit: 99 })).resultCount).toBe(3);
    expect((await post({ event: "search", role: "lead", query: "facts", limit: 0 })).ok).toBe(false);
    await bridge.close();
  });

  test("search reports an empty result without failing and rejects empty or oversized queries", async () => {
    const { bridge, post } = await bridgeFor("pi", { searchResults: [] });
    expect(await post({ event: "search", role: "lead", query: "nothing here" })).toMatchObject({ ok: true, resultCount: 0 });
    expect(await post({ event: "search", role: "lead", query: "   " })).toMatchObject({ ok: false, diagnostics: ["invalid-query"] });
    expect(await post({ event: "search", role: "lead", query: "x".repeat(1_025) })).toMatchObject({ ok: false, diagnostics: ["invalid-query"] });
    await bridge.close();
  });

  test("read-only roles may search but cannot save; apply-fast has no search", async () => {
    const { bridge, post, adds } = await bridgeFor("pi");
    expect((await post({ event: "search", role: "investigate", query: "decisions" })).ok).toBe(true);
    expect((await post({ event: "search", role: "deck-quality", query: "decisions" })).ok).toBe(true);
    for (const role of ["investigate", "quality", "deck-investigate", "deck-quality"]) {
      const denied = await post({ event: "save", role, content: SAVE_TEXT });
      expect(denied).toMatchObject({ ok: false, diagnostics: ["role-not-permitted"] });
    }
    expect(adds).toHaveLength(0);
    expect((await post({ event: "search", role: "apply-fast", query: "decisions" })).ok).toBe(false);
    await bridge.close();
  });

  test("lead and write roles save through the canonical tag", async () => {
    const { bridge, post, adds } = await bridgeFor("pi");
    for (const role of ["lead", "architect", "apply-deep", "apply-fast", "setup"]) {
      const saved = await post({ event: "save", role, content: `${SAVE_TEXT} (${role})` });
      expect(saved).toMatchObject({ ok: true, diagnostics: [] });
    }
    expect(adds).toHaveLength(5);
    for (const add of adds) {
      expect(add.containerTag).toMatch(/^sm_project_v1_/);
      expect(add.metadata).toMatchObject({ source: "explicit-remember", dependency: "explicit-remember" });
    }
    await bridge.close();
  });

  test("save applies the kind label, size limit, secret redaction and eligibility policy", async () => {
    const { bridge, post, adds } = await bridgeFor("codex");
    expect((await post({ event: "save", role: "lead", kind: "decision", content: SAVE_TEXT })).ok).toBe(true);
    expect(adds[0]!.content.startsWith("[decision] ")).toBe(true);
    expect(await post({ event: "save", role: "lead", kind: "weird", content: SAVE_TEXT })).toMatchObject({ ok: false, diagnostics: ["invalid-kind"] });
    expect(await post({ event: "save", role: "lead", content: "x ".repeat(9_000) })).toMatchObject({ ok: false, diagnostics: ["invalid-content"] });
    const secret = await post({ event: "save", role: "lead", content: "Remember this deployment note: API_KEY=sk-abcdefghijklmnopqrstuvwxyz is the production key for the service." });
    expect(secret.ok).toBe(false);
    expect(JSON.stringify(secret)).not.toContain("sk-abcdefghijkl");
    const trivial = await post({ event: "save", role: "lead", content: "ok thanks" });
    expect(trivial.ok).toBe(false);
    expect(adds).toHaveLength(1);
    await bridge.close();
  });

  test("runner-supplied scope fields, bad auth and a foreign runner id are rejected", async () => {
    const { bridge, post, adds, searches } = await bridgeFor("pi");
    expect(await post({ event: "save", role: "lead", content: SAVE_TEXT, containerTag: "attacker" })).toMatchObject({ ok: false, diagnostics: ["scope-input-rejected"] });
    expect(await post({ event: "search", role: "lead", query: "q", metadata: { scope: "attacker" } })).toMatchObject({ ok: false, diagnostics: ["scope-input-rejected"] });
    expect((await post({ event: "search", role: "lead", query: "q" }, "wrong-token")).status).toBe(401);
    expect(await post({ event: "save", role: "lead", content: SAVE_TEXT, runnerId: "codex" })).toMatchObject({ ok: false, diagnostics: ["invalid-evidence"] });
    expect(adds).toHaveLength(0);
    expect(searches).toHaveLength(0);
    await bridge.close();
  });

  test("a replayed save event id is idempotent and does not write twice", async () => {
    const { bridge, post, adds } = await bridgeFor("pi");
    const body = { event: "save", role: "lead", content: SAVE_TEXT, eventId: "save-once" };
    expect((await post(body)).ok).toBe(true);
    expect((await post(body)).ok).toBe(true);
    expect(adds).toHaveLength(1);
    await bridge.close();
  });

  test("existing events keep working unchanged on the same bridge", async () => {
    const { bridge, post } = await bridgeFor("pi");
    expect((await post({ event: "session_start", role: "lead", query: "current task" })).ok).toBe(true);
    expect((await post({ event: "shutdown_flush", role: "lead" })).ok).toBe(true);
    expect(await post({ event: "nope", role: "lead" })).toMatchObject({ ok: false, diagnostics: ["unsupported-event"] });
    await bridge.close();
  });
});
