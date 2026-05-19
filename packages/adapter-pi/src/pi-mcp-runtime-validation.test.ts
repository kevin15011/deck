import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateSupermemoryPiMcpRuntime } from "./pi-mcp-runtime-validation";

const SENTINEL_TOKEN = "sm_runtime_secret_DO_NOT_LEAK";
const ENDPOINT = "https://supermemory-new.stlmcp.com";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "deck-runtime-validation-"));
}

function writeConfig(path: string, token = SENTINEL_TOKEN) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(
    path,
    JSON.stringify({
      mcpServers: {
        supermemory: {
          transport: "http",
          url: ENDPOINT,
          headers: { "x-supermemory-api-key": token },
        },
      },
    }),
  );
}

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" }, ...init });
}

function assertNoSecret(value: unknown) {
  const text = JSON.stringify(value);
  expect(text).not.toContain(SENTINEL_TOKEN);
  expect(text).not.toMatch(/x-supermemory-api-key\s*[:=]\s*sm_/i);
}

describe("validateSupermemoryPiMcpRuntime", () => {
  test("returns configuration diagnostic when static config is missing", async () => {
    const dir = tempDir();
    try {
      const result = await validateSupermemoryPiMcpRuntime({ configPath: join(dir, "missing.json"), fetch: (() => { throw new Error("should not fetch"); }) as unknown as typeof fetch });
      expect(result.ok).toBe(false);
      expect(result.diagnostics[0]?.code).toBe("configuration-invalid");
      assertNoSecret(result);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("times out with a bounded timeout diagnostic", async () => {
    const dir = tempDir();
    const configPath = join(dir, "mcp.json");
    try {
      writeConfig(configPath);
      const result = await validateSupermemoryPiMcpRuntime({
        configPath,
        timeoutMs: 1,
        fetch: ((_url: RequestInfo | URL, init?: RequestInit) => new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        })) as unknown as typeof fetch,
      });
      expect(result.ok).toBe(false);
      expect(result.diagnostics[0]?.code).toBe("timeout");
      assertNoSecret(result);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("classifies 401 and 403 as unauthenticated without leaking credentials", async () => {
    const dir = tempDir();
    const configPath = join(dir, "mcp.json");
    try {
      writeConfig(configPath);
      const result = await validateSupermemoryPiMcpRuntime({
        configPath,
        fetch: (async () => jsonResponse({ error: "no" }, { status: 401 })) as unknown as typeof fetch,
      });
      expect(result.ok).toBe(false);
      expect(result.diagnostics[0]?.code).toBe("unauthenticated");
      assertNoSecret(result);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("returns invalid-response for malformed JSON", async () => {
    const dir = tempDir();
    const configPath = join(dir, "mcp.json");
    try {
      writeConfig(configPath);
      const result = await validateSupermemoryPiMcpRuntime({
        configPath,
        fetch: (async () => new Response("not-json", { status: 200, headers: { "content-type": "application/json" } })) as unknown as typeof fetch,
      });
      expect(result.ok).toBe(false);
      expect(result.diagnostics[0]?.code).toBe("invalid-response");
      assertNoSecret(result);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });


  test("redacts exact configured token from fetch rejection diagnostics", async () => {
    const dir = tempDir();
    const configPath = join(dir, "mcp.json");
    try {
      writeConfig(configPath);
      const result = await validateSupermemoryPiMcpRuntime({
        configPath,
        fetch: (async () => { throw new Error(SENTINEL_TOKEN); }) as unknown as typeof fetch,
      });
      expect(result.ok).toBe(false);
      expect(result.diagnostics[0]?.code).toBe("runtime-unreachable");
      assertNoSecret(result);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("redacts exact configured token from JSON-RPC error diagnostics", async () => {
    const dir = tempDir();
    const configPath = join(dir, "mcp.json");
    try {
      writeConfig(configPath);
      const result = await validateSupermemoryPiMcpRuntime({
        configPath,
        fetch: (async () => jsonResponse({ jsonrpc: "2.0", id: "initialize", error: { code: -32000, message: SENTINEL_TOKEN } })) as unknown as typeof fetch,
      });
      expect(result.ok).toBe(false);
      expect(result.diagnostics[0]?.code).toBe("invalid-response");
      assertNoSecret(result);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("returns missing-tools when execute or search_docs is absent", async () => {
    const dir = tempDir();
    const configPath = join(dir, "mcp.json");
    let calls = 0;
    try {
      writeConfig(configPath);
      const result = await validateSupermemoryPiMcpRuntime({
        configPath,
        fetch: (async () => {
          calls += 1;
          return calls === 1
            ? jsonResponse({ jsonrpc: "2.0", id: "initialize", result: {} })
            : jsonResponse({ jsonrpc: "2.0", id: "tools/list", result: { tools: [{ name: "execute" }] } });
        }) as unknown as typeof fetch,
      });
      expect(result.ok).toBe(false);
      expect(result.diagnostics[0]?.code).toBe("missing-tools");
      assertNoSecret(result);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("sends MCP initialize params before tools/list and exposes required tools", async () => {
    const dir = tempDir();
    const configPath = join(dir, "mcp.json");
    const bodies: unknown[] = [];
    try {
      writeConfig(configPath);
      const result = await validateSupermemoryPiMcpRuntime({
        configPath,
        fetch: (async (_url: RequestInfo | URL, init?: RequestInit) => {
          const body = JSON.parse(String(init?.body));
          bodies.push(body);
          expect(JSON.stringify(init?.headers)).toContain(SENTINEL_TOKEN);
          return body.method === "initialize"
            ? jsonResponse({ jsonrpc: "2.0", id: body.id, result: {} })
            : jsonResponse({ jsonrpc: "2.0", id: body.id, result: { tools: [{ name: "execute" }, { name: "search_docs" }] } });
        }) as unknown as typeof fetch,
      });
      expect(bodies.map((body) => (body as { method?: string }).method)).toEqual(["initialize", "tools/list"]);
      const initialize = bodies[0] as { params?: { protocolVersion?: unknown; capabilities?: unknown; clientInfo?: unknown } };
      expect(typeof initialize.params?.protocolVersion).toBe("string");
      expect(initialize.params?.capabilities).toEqual({});
      expect(initialize.params?.clientInfo).toEqual({ name: "deck-pi-runtime-validation", version: "0.0.0" });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.authenticatedRuntimeValidated).toBe(true);
        expect(result.toolNames).toEqual(["execute", "search_docs"]);
      }
      assertNoSecret(result);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
