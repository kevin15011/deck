import { describe, expect, test } from "bun:test";

import {
  createSupermemoryRuntime,
  DEFAULT_SUPERMEMORY_API_BASE_URL,
  createSupermemoryHttpTransport,
  resolveSupermemoryRolePolicy,
  type SupermemoryRuntimeTransport,
} from "./runtime";

function createFakeTransport() {
  const calls: Array<{ operation: string; payload: unknown }> = [];
  const transport: SupermemoryRuntimeTransport = {
    async add(payload) {
      calls.push({ operation: "add", payload });
      return { id: "doc-1" };
    },
    async search(payload) {
      calls.push({ operation: "search", payload });
      return {
        results: [
          { id: "m1", memory: "First relevant memory." },
          { id: "m2", memory: "Second relevant memory." },
          { id: "m3", memory: "Third relevant memory." },
          { id: "m4", memory: "Fourth relevant memory." },
          { id: "m5", memory: "Fifth relevant memory." },
          { id: "m6", memory: "Sixth relevant memory should be dropped." },
        ],
      };
    },
    async profile(payload) {
      calls.push({ operation: "profile", payload });
      return { profile: { static: ["Static project profile."], dynamic: ["Dynamic project profile."] } };
    },
    async health() {
      calls.push({ operation: "health", payload: {} });
      return { ok: true };
    },
  };
  return { calls, transport };
}

describe("Supermemory first-class runtime", () => {
  test("captures eligible conversation through a stable customId and server-bound containerTag", async () => {
    const fake = createFakeTransport();
    const runtime = createSupermemoryRuntime({
      canonicalScope: "sm_project_v1_kevin15011_deck",
      sessionId: "runner-session-1",
      transport: fake.transport,
    });

    const result = await runtime.capture({
      role: "assistant",
      source: "trusted-final-assistant",
      content: "Implemented the runtime boundary and verified it with fake transport.",
      capturedAt: "2026-08-15T00:00:00.000Z",
    });

    expect(result.ok).toBe(true);
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]).toMatchObject({ operation: "add" });
    expect(fake.calls[0]!.payload).toMatchObject({
      containerTag: "sm_project_v1_kevin15011_deck",
      customId: expect.stringMatching(/^deck_conversation_[a-f0-9]{16}$/),
      dreaming: "dynamic",
    });
    expect(result.metrics).toMatchObject({ operation: "capture", status: "succeeded", provider: "supermemory" });
    expect(JSON.stringify(result.metrics)).not.toContain("runtime boundary");
    expect(JSON.stringify(result.metrics)).not.toContain("kevin15011_deck");
  });

  test("rejects secret capture before transport", async () => {
    const fake = createFakeTransport();
    const runtime = createSupermemoryRuntime({
      canonicalScope: "sm_project_v1_kevin15011_deck",
      sessionId: "runner-session-1",
      transport: fake.transport,
    });

    const result = await runtime.capture({ role: "user", source: "trusted-user-prompt", content: "SUPERMEMORY_API_KEY=secret" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("secret_detected");
    expect(fake.calls).toHaveLength(0);
    expect(JSON.stringify(result)).not.toContain("SUPERMEMORY_API_KEY=secret");
  });

  test("rejects ordinary credential assignment forms before transport", async () => {
    const fake = createFakeTransport();
    const runtime = createSupermemoryRuntime({ canonicalScope: "sm_project_v1_kevin15011_deck", sessionId: "runner-session-1", transport: fake.transport });

    for (const content of [
      "Implemented credential validation. password: fake-password-value",
      "Implemented credential validation. api_key = \"fake-api-key-value\"",
      "Implemented credential validation. --token fake-token-value",
      "Implemented credential validation. https://fake-user:fake-pass@example.invalid/repo",
      "Implemented credential validation. Cookie: session=fake-session-value",
    ]) {
      const result = await runtime.capture({ role: "assistant", source: "trusted-final-assistant", content });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe("secret_detected");
    }
    expect(fake.calls).toHaveLength(0);
  });

  test("rejects raw operational shapes before transport even from trusted sources", async () => {
    const fake = createFakeTransport();
    const runtime = createSupermemoryRuntime({
      canonicalScope: "sm_project_v1_kevin15011_deck",
      sessionId: "runner-session-1",
      transport: fake.transport,
    });

    for (const content of [
      "$ bun test\nFAIL runtime.test.ts\nExpected: 1\nReceived: 2",
      "diff --git a/a.ts b/a.ts\n@@ -1 +1 @@\n-old\n+new",
      "Error: boom\n    at run (/tmp/app.ts:1:1)\n    at main (/tmp/main.ts:2:1)",
      "OFFICIAL CONTEXT\n## ADDED Requirements\n- Incidental OpenSpec artifact content",
    ]) {
      const result = await runtime.capture({ role: "assistant", source: "trusted-final-assistant", content });
      expect(result.ok).toBe(false);
      expect(result.metrics.status).toBe("skipped");
    }
    expect(fake.calls).toHaveLength(0);
  });

  test("loads profile and task search with role-aware budgets without rerank or query rewrite", async () => {
    const fake = createFakeTransport();
    const runtime = createSupermemoryRuntime({
      canonicalScope: "sm_project_v1_kevin15011_deck",
      sessionId: "runner-session-1",
      transport: fake.transport,
    });

    const profile = await runtime.profile({ role: "lead" });
    const search = await runtime.search({ role: "quality", query: "regression risk" });

    expect(profile.ok).toBe(true);
    expect(search.ok).toBe(true);
    expect(fake.calls.map((call) => call.operation)).toEqual(["profile", "search"]);
    expect(fake.calls[0]!.payload).toMatchObject({ containerTag: "sm_project_v1_kevin15011_deck" });
    expect(fake.calls[1]!.payload).toMatchObject({
      containerTag: "sm_project_v1_kevin15011_deck",
      q: "regression risk",
      searchMode: "hybrid",
      limit: 3,
    });
    expect(search.ok && search.context.items).toHaveLength(3);
    expect(search.ok && search.context.rerank).toBe(false);
    expect(search.ok && search.context.rewriteQuery).toBe(false);
  });

  test("role policy keeps Apply Fast narrow and Apply Deep bounded", () => {
    expect(resolveSupermemoryRolePolicy("apply-fast")).toMatchObject({ maxResults: 0, profile: "skip" });
    expect(resolveSupermemoryRolePolicy("apply-deep")).toMatchObject({ maxResults: 5, maxTokens: 1500 });
    expect(resolveSupermemoryRolePolicy("quality")).toMatchObject({ advisoryOnly: true, maxResults: 3 });
  });

  test("documents the official API base URL for HTTP endpoint control", () => {
    expect(DEFAULT_SUPERMEMORY_API_BASE_URL).toBe("https://api.supermemory.ai");
  });

  test("uses abortable minimal HTTP operations for add/search/profile endpoint control", async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined; body: unknown }> = [];
    const transport = createSupermemoryHttpTransport({
      apiKey: "sm_test",
      baseURL: "https://api.supermemory.ai",
      async fetchImpl(url, init) {
        calls.push({ url: String(url), init, body: JSON.parse(String(init?.body ?? "{}")) });
        return Response.json(String(url).endsWith("/v4/search") ? { results: [] } : String(url).endsWith("/v4/profile") ? { profile: { static: [], dynamic: [] } } : { id: "doc" });
      },
    });

    await transport.add({ content: "hello", containerTag: "sm_project_v1_kevin15011_deck", customId: "deck_conversation_123", dreaming: "dynamic" });
    await transport.search({ q: "hello", containerTag: "sm_project_v1_kevin15011_deck", searchMode: "hybrid", limit: 5 });
    await transport.profile({ containerTag: "sm_project_v1_kevin15011_deck" });

    expect(calls.map((call) => new URL(call.url).pathname)).toEqual(["/v3/documents", "/v4/search", "/v4/profile"]);
    expect(calls.every((call) => call.init?.headers && JSON.stringify(call.init.headers).includes("Bearer sm_test"))).toBe(true);
    expect(calls[1]!.body).toEqual({ q: "hello", containerTag: "sm_project_v1_kevin15011_deck", searchMode: "hybrid", rerank: false, rewriteQuery: false, limit: 5 });
  });

  test("aborts HTTP transport on timeout", async () => {
    let aborted = false;
    const transport = createSupermemoryHttpTransport({
      apiKey: "sm_test",
      timeoutMs: 1,
      fetchImpl: (_url, init) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          aborted = true;
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        });
      }),
    });

    await expect(transport.search({ q: "timeout", containerTag: "sm_project_v1_kevin15011_deck", searchMode: "hybrid", limit: 1 })).rejects.toThrow("timed out and was aborted");
    expect(aborted).toBe(true);
  });

  test("provider diagnostics never echo response body or query", async () => {
    const transport = createSupermemoryHttpTransport({
      apiKey: "sm_test",
      async fetchImpl() {
        return new Response("provider echoed query=do-not-leak and token=do-not-leak", { status: 500 });
      },
    });
    const runtime = createSupermemoryRuntime({ canonicalScope: "sm_project_v1_kevin15011_deck", sessionId: "s", transport });
    const result = await runtime.search({ role: "lead", query: "query=do-not-leak" });
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).toContain("status=500");
    expect(JSON.stringify(result)).not.toContain("do-not-leak");
  });
});
