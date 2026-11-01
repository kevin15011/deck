import { expect, test } from "bun:test";
import { createLoopbackClient, sendPublicCapture, MAX_CAPTURE_BYTES } from "./client";

test("stalled response.json is bounded even when transport ignores abort", async () => {
  let signal: AbortSignal | undefined;
  const client = createLoopbackClient({ endpoint: "http://127.0.0.1", token: "test", timeoutMs: 10,
    fetchImpl: (async (_url, init) => {
      signal = init?.signal as AbortSignal;
      return { status: 200, json: () => new Promise(() => {}) } as Response;
    }) as typeof fetch });
  const result = await Promise.race([client.send({ event: "save", eventId: "save-1" }), Bun.sleep(200).then(() => "stalled")]);
  expect(result).toEqual({ ok: false, diagnostics: ["timeout"] });
  expect(signal?.aborted).toBe(true);
});

test("uncertain save is never replayed and late success cannot replace failure", async () => {
  const bodies: unknown[] = [];
  let completed = 0;
  const client = createLoopbackClient({ endpoint: "http://127.0.0.1", token: "test", timeoutMs: 10,
    fetchImpl: (async (_url, init) => {
      bodies.push(init?.body);
      await Bun.sleep(60);
      completed++;
      return Response.json({ ok: true, diagnostics: [] });
    }) as typeof fetch });
  const result = await client.send({ event: "save", eventId: "save-1", content: "summary" }, { retries: 1 });
  expect(result).toEqual({ ok: false, diagnostics: ["timeout"] });
  expect(bodies).toHaveLength(1);
  await Bun.sleep(80);
  expect(completed).toBe(1);
  expect(result.ok).toBe(false);
});

// Protects cancellation against a transport that ignores AbortSignal.
test("cancelled read releases the caller and aborts without retry", async () => {
  const controller = new AbortController(); let requests = 0; let providerSignal: AbortSignal | undefined;
  const client = createLoopbackClient({ endpoint: "http://127.0.0.1", token: "fake", timeoutMs: 1000, fetchImpl: (async (_url, init) => { requests++; providerSignal = init?.signal as AbortSignal; return await new Promise(() => {}); }) as typeof fetch });
  const pending = client.send({ event: "search", query: "color" }, { signal: controller.signal, retries: 1 });
  controller.abort();
  expect(await pending).toEqual({ ok: false, diagnostics: ["cancelled"] });
  expect(providerSignal?.aborted).toBe(true); expect(requests).toBe(1);
});

// Protects recovery visibility and credential admission before a transport split.
test("segmented capture stops at uncertainty and checks secrets across segment boundaries", async () => {
  const calls: Record<string, unknown>[] = [];
  const client = { send: async (event: Record<string, unknown>) => { calls.push(event); return { ok: calls.length === 1, diagnostics: [] }; } };
  const result = await sendPublicCapture(client, { event: "capture", eventId: "large", source: "trusted-user-prompt" }, "x".repeat(MAX_CAPTURE_BYTES * 3));
  expect(result.ok).toBe(false); expect(calls).toHaveLength(2);
  expect(result.diagnostics.join(" ")).toContain("2/3");
  const secret = await sendPublicCapture(client, { event: "capture", eventId: "secret", source: "trusted-user-prompt" }, "x".repeat(MAX_CAPTURE_BYTES - 5) + " password: fake-sensitive-value");
  expect(secret.ok).toBe(false); expect(calls).toHaveLength(2);
});
