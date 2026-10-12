import { expect, test } from "bun:test";
import { validateSupermemoryAccountCredential } from "./account-validation";

test("setup validates the account without project scope or reading memory/settings content", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  let cancelled = false;
  const result = await validateSupermemoryAccountCredential({ apiKey: "test-token", fetch: (async (url, init) => {
    calls.push({ url: String(url), init: init! });
    return { ok: true, status: 200, body: { cancel: async () => { cancelled = true; } }, json: () => { throw new Error("must not consume account content"); } } as unknown as Response;
  }) });
  expect(result.ok).toBe(true);
  expect(calls).toHaveLength(1);
  expect(calls[0]!.url).toBe("https://api.supermemory.ai/v3/settings");
  expect(calls[0]!.init.method).toBe("GET");
  expect(calls[0]!.init.redirect).toBe("error");
  expect(calls[0]!.init.body).toBeUndefined();
  expect(cancelled).toBe(true);
});

test("failed authentication and transport diagnostics never include the credential or response body", async () => {
  for (const response of [401, 403, 500]) {
    const result = await validateSupermemoryAccountCredential({ apiKey: "test-secret", fetch: (async () => new Response("test-secret", { status: response })) });
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain("test-secret");
  }
  const result = await validateSupermemoryAccountCredential({ apiKey: "test-secret", fetch: (async () => { throw new Error("test-secret"); }) });
  expect(result.ok).toBe(false);
  expect(JSON.stringify(result)).not.toContain("test-secret");
});
