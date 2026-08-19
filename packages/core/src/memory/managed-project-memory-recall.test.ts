import { describe, expect, test } from "bun:test";

import { parseManagedProjectMemoryRecallQuery, renderManagedProjectMemoryRecallFailure } from "./managed-project-memory-recall";

describe("managed project memory recall query boundary", () => {
  const sensitive = [
    "DATABASE_URL=postgres://user:pass@example.test/db",
    "MYSQL_URI=mysql://user:pass@example.test/db",
    "MONGO_URL=mongodb+srv://user:pass@example.test/db",
    "REDIS_URL=redis://:pass@example.test:6379/0",
    "AMQP_URL=amqp://user:pass@example.test/vhost",
    "LIBSQL_URL=libsql:///home/dev/private/app.db",
    "file:///home/dev/private/app.sqlite3",
    "sqlite:///tmp/customer.sqlite",
    "/home/dev/private/customer.sqlite",
    "https://user:pass@example.test/repo.git",
    "Authorization: Bearer secret-token",
    "Cookie: session=secret-token",
    "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----",
    "OPENAI_API_KEY=sk-secret-value",
    "--token fake-token-value",
    "password: fake-password-value",
  ];

  test("normalizes safe focused queries while enforcing the raw 1024-byte boundary first", () => {
    expect(parseManagedProjectMemoryRecallQuery("  prior   decision   rationale  ")).toEqual({ ok: true, query: "prior decision rationale" });
    expect(parseManagedProjectMemoryRecallQuery(` ${"é".repeat(512)} `)).toEqual({ ok: false, reason: "invalid-query" });
  });

  test("rejects controls and high-confidence secrets/DSNs", () => {
    expect(parseManagedProjectMemoryRecallQuery("line\nbreak")).toEqual({ ok: false, reason: "invalid-query" });
    for (const query of sensitive) {
      expect(parseManagedProjectMemoryRecallQuery(query)).toEqual({ ok: false, reason: "invalid-query" });
    }
  });

  test("renders distinct bounded failure envelopes that are not adaptive-memory context", () => {
    const rendered = renderManagedProjectMemoryRecallFailure("transport-failed");
    expect(rendered).toContain("DECK_MANAGED_PROJECT_MEMORY_RECALL_RESULT_JSON_V1");
    expect(rendered).not.toContain("DECK_ADAPTIVE_CONTEXT_JSON_V1");
    expect(Buffer.byteLength(rendered, "utf8")).toBeLessThanOrEqual(2_000);
    expect(renderManagedProjectMemoryRecallFailure("rate-limited")).toContain('"retryable":true');
    expect(renderManagedProjectMemoryRecallFailure("invalid-query")).toContain('"retryable":false');
  });
});
