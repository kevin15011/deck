import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, readFile, readdir, rm, writeFile, mkdir, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { assertAllowedRequest, classifyId, classifyNamespace, matchesSession, matchingSessionIds, readKey, redactDeep, runInventory, scrub, validateRequestCap } from "./inventory.ts";
import { parseArgs } from "./args.ts";

let temp = "";
const previous = process.env.SUPERMEMORY_INVENTORY_API_KEY_FILE;
async function keyFixture(key = "SENTINEL_SECRET_KEY_123456") {
  temp = await mkdtemp(join(tmpdir(), "deck-inventory-"));
  const keyPath = join(temp, "key"); await writeFile(keyPath, key, { mode: 0o600 }); await chmod(keyPath, 0o600);
  process.env.SUPERMEMORY_INVENTORY_API_KEY_FILE = keyPath;
  return { keyPath, key };
}
afterEach(async () => {
  if (previous === undefined) delete process.env.SUPERMEMORY_INVENTORY_API_KEY_FILE;
  else process.env.SUPERMEMORY_INVENTORY_API_KEY_FILE = previous;
  if (temp) await rm(temp, { recursive: true, force: true }); temp = "";
});

describe("memory inventory safety", () => {
  test("rejects disallowed methods, paths, and namespaces before fetch", () => {
    let calls = 0;
    const fetchImpl = (async () => { calls++; throw new Error("unexpected"); }) as typeof fetch;
    for (const [method, path] of [["PATCH", "/ns/sm_project_v1_kevin15011_deck"], ["POST", "/v4/search"], ["GET", "/ns/another/document/id"], ["DELETE", "/ns/sm_project_v1_kevin15011_deck/document/id"]]) {
      expect(() => assertAllowedRequest(method, path)).toThrow();
    }
    expect(calls).toBe(0);
    for (const path of ["/ns/sm_project_v1_kevin15011_deck/document/..", "/ns/sm_project_v1_kevin15011_deck/document/%2e%2e", "/ns/sm_project_v1_kevin15011_deck/document/x?moveTo=y", "/ns/sm_project_v1_kevin15011_deck/document/x#frag", "/ns/sm_project_v1_kevin15011_deck/"]) expect(() => assertAllowedRequest("GET", path)).toThrow();
    expect(assertAllowedRequest("GET", "/ns/sm_project_v1_kevin15011_deck").template).toBe("/ns/{namespace}");
  });

  test("redacts quality probe token formats and keyed secret fields", () => {
    const samples = ["ghp_abcdefghijklmnopqrstuvwxyz0123456789", "github_pat_11ABCDEFG0123456789_abcdefghijklmnop", "glpat-abcdefghijklmnopqrstuvwxyz", "xo" + "xb-123456789012-1234567890123-AbCdEfGhIjKlMnOpQrStUvWx", "AIzaSyA-abcdefghijklmnopqrstuvwxyz12345", "sk" + "_live_51Habcdefghijklmnopqrstu", "rk" + "_test_51Habcdefghijklmnopqrstu", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U", "npm_abcdefghijklmnopqrstuvwxyz0123456789", "sm_abcdefghijklmnopqrstuvwxyz123456", "Authorization: token abcdef1234567890", "Bearer abcdef1234567890abcdef", "run --password hunter2secret", "{\\\"apiKey\\\":\\\"abcd1234efgh\\\"}", "Credential: aws-default-profile", "private_key: n/a", "credential=foo"];
    for (const sample of samples) expect(String(redactDeep(sample).value)).not.toBe(sample);
    const object = redactDeep({ apiKey: "sensitive-value", password: "hunter2", profile: { static: ["hello"] } });
    expect(object.value).toEqual({ apiKey: "[REDACTED_SECRET]", password: "[REDACTED_SECRET]", profile: { static: ["hello"] } });
  });

  test("dry-run is offline preflight and validates cap and flags", async () => {
    await keyFixture(); let calls = 0;
    const fetchImpl = (async () => { calls++; throw new Error("must not fetch"); }) as typeof fetch;
    const output = await runInventory({ fetchImpl, dryRun: true, outputRoot: join(temp, "out") });
    expect(output.preflight).toBe(true); expect(calls).toBe(0);
    for (const n of [0, -1, 1501, Number.NaN, 1.2]) expect(() => validateRequestCap(n)).toThrow();
    expect(validateRequestCap(10)).toBe(10);
    expect(() => parseArgs(["--live", "--max-requests", "abc"])).toThrow();
    expect(() => parseArgs(["--live", "--unknown"])).toThrow();
  });

  test("requires protected key file and parent modes", async () => {
    const { keyPath } = await keyFixture();
    expect(await readKey()).toBe("SENTINEL_SECRET_KEY_123456");
    await chmod(keyPath, 0o644); await expect(readKey()).rejects.toThrow();
  });

  test("scrubs sentinel credentials and redacts before persisted output", async () => {
    const { key } = await keyFixture();
    expect(scrub(`error ${key}`, [key])).not.toContain(key);
    const safe = redactDeep({ content: `Authorization: Bearer ${key}; email a@b.com at /home/user/a`, metadata: { secret: key } }, [key]);
    expect(JSON.stringify(safe.value)).not.toContain(key);
    const outside = join(temp, "out"); await mkdir(outside, { mode: 0o700 });
    const response = (payload: unknown) => new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === "/namespaces") return response({ namespaces: [{ namespace: `sm_project_v1_${url.searchParams.get("page")}`, documentCount: 1, memoryCount: 0 }], pagination: { totalPages: 2 } });
      if (url.pathname.endsWith("/list/documents")) return response({ documents: [{ id: "d1", type: "ghp_abcdefghijklmnopqrstuvwxyz0123456789", metadata: { sm_source: "claude-code" }, system: { createdAt: "2026-10-21T01:00:00Z" } }], pagination: { totalPages: 1 } });
      if (url.pathname.endsWith("/list/memories")) return response({ memories: [], pagination: { totalPages: 1 } });
      if (url.pathname.endsWith("/document/d1")) return response({ id: "d1", content: `[Session 78139695-03a1-4ce3-816d-d522df8dd928] Authorization: Bearer ${key}`, metadata: {}, system: { createdAt: "2026-10-21T01:00:00Z" } });
      if (url.pathname.endsWith("/profile/buckets")) return response({ buckets: {} });
      if (url.pathname.endsWith("/profile")) return response({ profile: { static: [], dynamic: [], buckets: {} } });
      throw new Error(`unhandled ${url.pathname}`);
    }) as typeof fetch;
    const logs: string[] = []; const oldLog = console.log; console.log = (v) => logs.push(String(v));
    const result = await runInventory({ fetchImpl, live: true, outputRoot: outside, maxRequests: 20, delayMs: 100, retries: 0, now: new Date("2026-10-21T02:00:00Z") });
    console.log = oldLog;
    const dir = join(outside, (await readdir(outside))[0]);
    for (const file of await readdir(dir)) expect(await readFile(join(dir, file), "utf8")).not.toContain(key);
    expect(result.summary.exposedSessions).toHaveLength(1);
    expect(logs.join(" ")).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz0123456789");
    expect(result.summary.classification.type["[REDACTED_TOKEN]"]).toBe(1);
    expect(result.log.length).toBe(7);
    expect(result.summary.counts.namespaces).toBe(2);
    expect(result.summary.namespace).toBe("sm_project_v1_kevin15011_deck");
    expect(result.log.filter((entry) => entry.path === "/namespaces")).toHaveLength(2);
  });

  test("does not leak credentials from transport errors", async () => {
    const { key } = await keyFixture();
    const fetchImpl = (async () => { throw new Error(`transport failed with ${key}`); }) as typeof fetch;
    const logs: string[] = []; const oldLog = console.log; console.log = (v) => logs.push(String(v));
    const error = await runInventory({ fetchImpl, live: true, retries: 0, maxRequests: 1, outputRoot: join(temp, "out") }).catch((e) => e as Error);
    console.log = oldLog;
    expect(error.message).not.toContain(key);
    expect(logs.join(" ")).toContain('"operations": 1');
    expect(logs.join(" ")).toContain('"0": 1');
  });

  test("reports non-JSON response generically and records failed operation", async () => {
    await keyFixture();
    const fetchImpl = (async () => new Response("password_is_hunter2xyz <html> topsecretvalue", { status: 200 })) as typeof fetch;
    const logs: string[] = []; const oldLog = console.log; console.log = (v) => logs.push(String(v));
    const error = await runInventory({ fetchImpl, live: true, outputRoot: join(temp, "out"), retries: 0 }).catch((e) => e as Error);
    console.log = oldLog;
    expect(error.message).toBe("non-JSON response (44 bytes)");
    expect(logs.join(" ")).toContain('"operations": 1');
    expect(logs.join(" ")).not.toContain("topsecretvalue");
    const outDir = join(temp, "out", (await readdir(join(temp, "out")))[0]);
    expect(await readFile(join(outDir, "request-log.partial.json"), "utf8")).toContain('"status": 200');
  });

  test("quarantines invalid-id records, excludes their content, and continues inventory", async () => {
    await keyFixture();
    const paths: string[] = [];
    const json = (value: unknown) => Response.json(value);
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input)); paths.push(url.pathname);
      if (url.pathname === "/namespaces") return json({ namespaces: [{ namespace: "sm_project_v1_kevin15011_deck", documentCount: 2, memoryCount: 0 }], pagination: { totalPages: 1 } });
      if (url.pathname.endsWith("/list/documents")) return json({ documents: [{ id: ".", content: "DO_NOT_EXPORT_INVALID_ID_CONTENT" }, { id: "suspicious-doc", type: "text" }, { id: "valid-doc", type: "text" }], pagination: { totalPages: 1 } });
      if (url.pathname.endsWith("/list/memories")) return json({ memories: [], pagination: { totalPages: 1 } });
      if (url.pathname.endsWith("/document/valid-doc")) return json({ id: "valid-doc", content: "safe document content", system: { createdAt: "2026-10-21T01:00:00Z" } });
      if (url.pathname.endsWith("/document/suspicious-doc")) return json({ id: "suspicious-doc", content: "MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7", system: { createdAt: "2026-10-21T01:00:00Z" } });
      if (url.pathname.endsWith("/profile/buckets")) return json({ buckets: {} });
      if (url.pathname.endsWith("/profile")) return json({ profile: { static: [], dynamic: [], buckets: {} } });
      throw new Error("unexpected request");
    }) as typeof fetch;
    const root = join(temp, "out"); const logs: string[] = []; const oldLog = console.log; console.log = (v) => logs.push(String(v));
    const result = await runInventory({ fetchImpl, live: true, outputRoot: root, retries: 0 }); console.log = oldLog;
    expect(paths.filter((p) => p.includes("/document/"))).toEqual(["/ns/sm_project_v1_kevin15011_deck/document/suspicious-doc", "/ns/sm_project_v1_kevin15011_deck/document/valid-doc"]);
    expect(result.summary.invalidDocumentIds).toBe(1);
    expect(result.summary.quarantinedRecords).toBe(2);
    expect(result.summary.quarantinePatterns.private_key_material).toBe(1);
    expect(logs.join(" ")).toContain('"quarantinedRecords": 2');
    const dir = join(root, (await readdir(root))[0]);
    const files = await readdir(dir);
    expect(files).toContain("documents-memories.jsonl");
    expect(files.sort()).toEqual(["document-details.json", "documents-memories.jsonl", "namespaces.json", "profile-buckets.json", "profile.json", "request-log.json", "summary.json"].sort());
    const jsonl = await readFile(join(dir, "documents-memories.jsonl"), "utf8");
    expect(jsonl).not.toContain("DO_NOT_EXPORT_INVALID_ID_CONTENT");
    expect(jsonl).not.toContain("MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7");
    expect(jsonl).toContain("idHash");
    expect(jsonl).toContain("invalid_document_id");
    expect(jsonl).toContain("private_key_material");
    expect(jsonl).not.toContain("suspicious-doc");
    expect(jsonl).toContain("safe document content");
  });

  test("attributes memories linked to matched exposed document ids", async () => {
    await keyFixture();
    const sid = "78139695-03a1-4ce3-816d-d522df8dd928";
    const json = (value: unknown) => Response.json(value);
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === "/namespaces") return json({ namespaces: [{ namespace: "sm_project_v1_kevin15011_deck", documentCount: 1, memoryCount: 1 }], pagination: { totalPages: 1 } });
      if (url.pathname.endsWith("/list/documents")) return json({ documents: [{ id: "internal-doc", customId: sid }], pagination: { totalPages: 1 } });
      if (url.pathname.endsWith("/list/memories")) return json({ memories: [{ id: "memory-1", documentId: "internal-doc", memory: "linked fact", createdAt: "2026-10-21T04:00:00Z" }], pagination: { totalPages: 1 } });
      if (url.pathname.endsWith("/document/internal-doc")) return json({ id: "internal-doc", content: "captured", system: { createdAt: "2026-10-21T03:00:00Z" } });
      if (url.pathname.endsWith("/profile/buckets")) return json({ buckets: {} });
      if (url.pathname.endsWith("/profile")) return json({ profile: { static: [], dynamic: [], buckets: {} } });
      throw new Error("unexpected request");
    }) as typeof fetch;
    const oldLog = console.log; console.log = () => {};
    const result = await runInventory({ fetchImpl, live: true, outputRoot: join(temp, "out"), retries: 0, now: new Date("2026-10-21T05:00:00Z") }); console.log = oldLog;
    const memory = result.summary.exposedSessions.find((entry: any) => entry.recordKind === "memory");
    expect(memory).toMatchObject({ matchedSession: sid, matchReason: "internal link", inWindow: true, id: "memory-1" });
  });

  test("rejects symlinked output path components", async () => {
    await keyFixture();
    const real = join(temp, "real"); const link = join(temp, "link"); await mkdir(real, { mode: 0o700 }); await symlink(real, link);
    const fetchImpl = (async () => { throw new Error("must not fetch"); }) as typeof fetch;
    await expect(runInventory({ fetchImpl, dryRun: true, outputRoot: join(link, "inventory") })).rejects.toThrow("symlinks");
  });

  test("enforces request cap and refuses repository output", async () => {
    await keyFixture(); let calls = 0;
    const fetchImpl = (async () => { calls++; return new Response(JSON.stringify({ namespaces: [], pagination: { totalPages: 1 } })); }) as typeof fetch;
    await expect(runInventory({ fetchImpl, live: true, maxRequests: 1, retries: 0, outputRoot: join(temp, "elsewhere") })).rejects.toThrow("request cap");
    expect(calls).toBe(1);
    await expect(runInventory({ fetchImpl, live: true, outputRoot: resolve("benchmarks/memory-inventory/output") })).rejects.toThrow("outside the repository");
  });

  test("classifies namespaces and ids; matches sessions within window", () => {
    expect(classifyNamespace("repo_a__0123456789abcdef")).toBe("repo_*__<16hex>");
    expect(classifyId("opencode:capture:x")).toBe("opencode:capture:*");
    const row = { id: "doc", content: "[Session abc] text", system: { createdAt: "2026-10-21T01:00:00Z" } };
    expect(matchesSession(row, new Set(["abc"]), Date.parse("2026-10-21T00:00Z"), Date.parse("2026-10-21T02:00Z"))).toBe(true);
    expect(matchesSession(row, new Set(["abc"]), Date.parse("2026-10-22T00:00Z"), Date.parse("2026-10-23T00:00Z"))).toBe(false);
    expect(matchesSession(row, new Set(["abc"]), Date.parse("garbage"), Date.parse("garbage"))).toBe(false);
    expect(matchingSessionIds({ id: "m1", documentId: "abc" }, new Set(["abc"]))).toEqual([]);
  });
});
