import { expect, test } from "bun:test";
import { createSupermemoryHttpTransport, createSupermemoryRuntime } from "./runtime";

const scope = "sm_project_v1_acme_widget";
// Protects public short turns, role-independent recall and the actual v5 wire contract.
test("Pi public turns append in v5 and Apply Fast receives provider-ranked complete results", async () => {
  const calls: { path: string; body: any }[] = [];
  const result = { id: "m1", memory: "First\n  exact passage", included: { document: { id: "d1" } } };
  const transport = createSupermemoryHttpTransport({ apiKey: "fake", fetchImpl: async (url, init) => {
    const path = new URL(String(url)).pathname;
    calls.push({ path, body: JSON.parse(String(init?.body)) });
    return Response.json(path.endsWith("/profile") ? { profile: { static: [{ id: "p1", memory: "Profile" }], dynamic: [], buckets: {} } } : path.endsWith("/search") ? { results: [result], searchTime: 1 } : { id: "doc1", status: "queued" });
  } });
  const runtime = createSupermemoryRuntime({ canonicalScope: scope, sessionId: "pi-child", runnerId: "pi", transport });
  for (const content of ["Use blue.", "Done."]) expect((await runtime.capture({ role: "user", content, source: "trusted-user-prompt", correlationId: "one-segmented-public-event" })).ok).toBe(true);
  const search = await runtime.search({ role: "apply-fast", query: "color" });
  expect(search.ok).toBe(true);
  if (search.ok) expect(search.context.items[0]?.content).toBe(result.memory);
  const profile = await runtime.profile({ role: "apply-fast" });
  expect(profile.ok).toBe(true);
  if (profile.ok) expect(profile.context.items[0]).toMatchObject({ id: "p1", content: "Profile" });
  expect((await runtime.search({ role: "lead", query: "password: fake-sensitive-value" })).ok).toBe(false);
  expect(calls.map(c => c.path)).toEqual([`/ns/${scope}/document`, `/ns/${scope}/document`, `/ns/${scope}/search`, `/ns/${scope}/profile`]);
  expect(calls[0]!.body.id).toBe(calls[1]!.body.id);
  expect(calls[0]!.body).not.toHaveProperty("customId");
  expect(calls[2]!.body).toEqual({ query: "color" });
  expect(calls[3]!.body).toEqual({});
});

// Protects uncertain append effects: a failed HTTP response never triggers a remote retry.
test("uncertain append remains failed and is not retried", async () => {
  let calls = 0;
  const transport = createSupermemoryHttpTransport({ apiKey: "fake", fetchImpl: async () => { calls++; throw new Error("lost response"); } });
  const runtime = createSupermemoryRuntime({ canonicalScope: scope, sessionId: "pi", runnerId: "pi", transport });
  expect((await runtime.capture({ role: "user", content: "Blue.", source: "trusted-user-prompt" })).ok).toBe(false);
  expect(calls).toBe(1);
});

// Protects scope-absent legacy transport from being redirected to an invented namespace.
test("legacy global transport remains on its supported wire contract", async () => {
  const paths: string[] = [];
  const transport = createSupermemoryHttpTransport({ apiKey: "fake", fetchImpl: async url => { paths.push(new URL(String(url)).pathname); return Response.json({}); } });
  await transport.add({ containerTag: "legacy", customId: "session", content: "Blue." });
  await transport.search({ containerTag: "legacy", q: "color" });
  await transport.profile({ containerTag: "legacy" });
  expect(paths).toEqual(["/v3/documents", "/v4/search", "/v4/profile"]);
});
