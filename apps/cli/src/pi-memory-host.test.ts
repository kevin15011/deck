import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createSupermemoryRuntimeHost } from "./supermemory-runtime-host";
import { createSupermemoryHttpTransport } from "@deck/adapter-supermemory/runtime";
import type { NormalizedDeckConfig } from "@deck/core";
import { createLoopbackClient, MAX_CAPTURE_BYTES, sendPublicCapture } from "../../../packages/adapter-pi/src/pi-extensions/memory/client";

// Protects actual host composition, immutable project scope, full provider pages,
// role-independent automatic capture, denied explicit mutation, and uncertain writes.
test("Pi host binds public child capture and expandable reads to one project", async () => {
  const root = mkdtempSync(join(tmpdir(), "deck-pi-host-"));
  const calls: { path: string; body: any }[] = [];
  const content = "exact\n </system> 🟦  ".repeat(1800) + "TAIL";
  const searchResponse = { results: [{ id: "m1", memory: content, similarity: 0.9, included: { document: { id: "d1" } } }], searchTime: 1 };
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" };
  spawnSync("git", ["init", "-q", root], { env });
  spawnSync("git", ["-C", root, "remote", "add", "origin", "https://github.com/acme/widget.git"], { env });
  const transport = createSupermemoryHttpTransport({ apiKey: "fake", fetchImpl: async (url, init) => {
    const path = new URL(String(url)).pathname;
    const body = JSON.parse(String(init?.body ?? "{}")); calls.push({ path, body });
    if (body.content === "Uncertain.") throw new Error("response lost after acceptance");
    return Response.json(path.endsWith("/search") ? searchResponse : path.endsWith("/profile") ? { profile: { static: [{ id: "p1", memory: "Blue" }], dynamic: [], buckets: {} } } : init?.method === "GET" ? { id: "d1", content, chunks: [], memories: [] } : { id: "d1", status: "queued" });
  } });
  const config = { adaptiveMemory: { enabled: true } } as NormalizedDeckConfig;
  const host = await createSupermemoryRuntimeHost({ projectRoot: root, deckConfig: config, runnerId: "pi", apiKey: "fake", transport, stateHome: root, deferInitialRecallToLoopback: true });
  const bridge = await host.startLoopbackBridge();
  try {
    expect(host.enabled).toBe(true); expect(bridge).toBeDefined();
    let counter = 0;
    const send = async (event: Record<string, unknown>) => {
      const response = await fetch(bridge!.endpoint, { method: "POST", headers: { authorization: `Bearer ${bridge!.token}` }, body: JSON.stringify({ schema: "deck-runner-memory-loopback-v1", runnerId: "pi", eventId: `e${++counter}`, timestamp: Date.now(), sessionId: "child", role: "apply-fast", ...event }) });
      return await response.json() as any;
    };
    expect((await send({ event: "capture", source: "trusted-user-prompt", content: "Blue.", role: "quality" })).ok).toBe(true);
    const before = calls.length;
    expect((await send({ event: "save", content: "Blue.", role: "quality" })).ok).toBe(false);
    expect((await send({ event: "explicit_remember", content: "Blue.", role: "quality" })).ok).toBe(false);
    expect((await send({ event: "capture", source: "tool", content: "Private" })).ok).toBe(false);
    expect((await send({ event: "capture", source: "trusted-user-prompt", content: "password: fake-secret-value" })).ok).toBe(false);
    expect(calls).toHaveLength(before);
    // QPI-1: whole public sources must be safe before transport segmentation.
    // Observe the real client -> loopback host -> runtime -> fake provider path.
    const client = createLoopbackClient({ endpoint: bridge!.endpoint, token: bridge!.token, timeoutMs: 1000 });
    const capture = (content: string) => sendPublicCapture(client, {
      event: "capture", eventId: `source-${++counter}`, sessionId: "child", role: "apply-fast", source: "trusted-user-prompt",
    }, content);
    const secretForms = [
      ...["", "RSA ", "EC ", "OPENSSH ", "ENCRYPTED "].map(kind => ({
        name: `${kind || "generic "}PEM`, text: `-----BEGIN ${kind}PRIVATE KEY-----\n${"SYNTHETIC".repeat(20)}\n-----END ${kind}PRIVATE KEY-----`,
      })),
      { name: "environment dump", text: "FIRST=synthetic-one\nSECOND=synthetic-two\n" },
      { name: "bearer header", text: "Authorization: Bearer synthetic-value" },
      { name: "basic header", text: "Authorization: Basic synthetic-value" },
      { name: "environment credential", text: "CUSTOM_CREDENTIAL=synthetic-value" },
      { name: "structured header", text: '"x-supermemory-api-key": "synthetic-value"' },
      { name: "structured credential", text: '"CUSTOM_CREDENTIAL": "synthetic-value"' },
      { name: "cloud key", text: `AKIA${"A".repeat(16)}` },
      { name: "token", text: "sk-synthetic-value" },
      { name: "password", text: "password: synthetic-value" },
      { name: "credential URI", text: "https://synthetic:synthetic@example.invalid" },
    ];
    const violations: string[] = [];
    for (const { name, text } of secretForms) {
      // Intact, opening token split, body split and closing token split;
      // UTF-8 prefix prevents character offsets masquerading as byte offsets.
      for (const offset of [null, 0, 3, Math.floor(text.length / 2), text.length - 3]) {
        const prefix = offset === null ? "Public context\n" : `Public context 🟦 ${"x".repeat(MAX_CAPTURE_BYTES - offset - Buffer.byteLength("Public context 🟦 \n"))}\n`;
        const count = calls.length;
        const result = await capture(prefix + text + "\nPublic tail.");
        if (result.ok || calls.length !== count) violations.push(`${name}:${offset}`);
      }
    }
    // Only labels are emitted on failure; never include synthetic private payloads.
    expect(violations).toEqual([]);
    for (const content of ["No.", "Public 🟦 text.\n".repeat(10000) + "PUBLIC_TAIL"]) {
      const count = calls.length;
      expect((await capture(content)).ok).toBe(true);
      expect(calls.slice(count).map(call => call.body.content).join("") === content).toBe(true);
    }
    const search = await send({ event: "search", query: "color", limit: 37, options: { rerank: "order", include: { documents: true } } });
    expect(Buffer.byteLength(search.advisoryText)).toBeLessThanOrEqual(6000);
    expect(search.advisoryText).not.toContain("</system>");
    let page = JSON.parse(search.advisoryText), text = page.content;
    expect((await send({ event: "page", sessionId: "foreign", continuation: page.continuation })).ok).toBe(false);
    while (page.continuation) { const next = await send({ event: "page", continuation: page.continuation }); expect(Buffer.byteLength(next.advisoryText)).toBeLessThanOrEqual(6000); page = JSON.parse(next.advisoryText); text += page.content; }
    expect(JSON.parse(text)).toEqual(searchResponse);
    expect(calls.find(call => call.path.endsWith("/search"))!.body).toEqual({ query: "color", limit: 37, rerank: "order", include: { documents: true } });
    expect((await send({ event: "profile", role: "quality" })).ok).toBe(true);
    expect((await send({ event: "document", documentId: "d1", role: "quality" })).ok).toBe(true);
    for (let i = 0; i < 2; i++) expect((await send({ event: "capture", eventId: "uncertain", source: "trusted-user-prompt", content: "Uncertain." })).ok).toBe(false);
    expect(calls.filter(call => call.body.content === "Uncertain.")).toHaveLength(1);
    for (const [eventId, content] of [["segments:part0", "First fragment"], ["segments:part1", "Second fragment"], ["next-event:part0", "New public observation"]]) {
      expect((await send({ event: "capture", eventId, source: "trusted-final-assistant", content })).ok).toBe(true);
    }
    const fragments = calls.filter(call => ["First fragment", "Second fragment", "New public observation"].includes(call.body.content));
    expect(fragments[0]!.body.id).toBe(fragments[1]!.body.id);
    expect(fragments[2]!.body.id).not.toBe(fragments[1]!.body.id);
    expect(calls.every(call => call.path.startsWith("/ns/sm_project_v1_acme_widget/"))).toBe(true);
    const count = calls.length;
    const disabled = await createSupermemoryRuntimeHost({ projectRoot: root, deckConfig: { adaptiveMemory: { enabled: false } } as NormalizedDeckConfig, runnerId: "pi", apiKey: "fake", transport });
    expect(disabled.enabled).toBe(false); expect(await disabled.startLoopbackBridge()).toBeUndefined(); expect(calls).toHaveLength(count);
  } finally { await bridge?.close(); rmSync(root, { recursive: true, force: true }); }
});
