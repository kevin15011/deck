import { expect, test } from "bun:test";
import { createLoopbackClient } from "./client";

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

test("slow save times out, retries keep identical bytes and late success cannot replace failure", async () => {
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
  expect(bodies).toHaveLength(2);
  expect(bodies[0]).toBe(bodies[1]);
  await Bun.sleep(80);
  expect(completed).toBe(2);
  expect(result.ok).toBe(false);
});
