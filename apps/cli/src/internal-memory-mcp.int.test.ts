import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const MAIN = fileURLToPath(new URL("./main.tsx", import.meta.url));
const TOKEN = "deck-loopback-stdio-e2e-token";

let dir: string | undefined;
let server: ReturnType<typeof Bun.serve> | undefined;
afterEach(() => { server?.stop(true); server = undefined; if (dir) rmSync(dir, { recursive: true, force: true }); dir = undefined; });

describe("deck internal memory-mcp (real process, stdio, fake loopback)", () => {
  test("serves initialize, tools/list and tools/call over stdio using only the endpoint and token file", async () => {
    dir = mkdtempSync(join(tmpdir(), "deck-memory-mcp-e2e-"));
    const seen: Array<{ auth: string | null; body: Record<string, any> }> = [];
    server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) { const body = JSON.parse(await request.text()); seen.push({ auth: request.headers.get("authorization"), body }); return Response.json(body.event === "search" ? { ok: true, advisoryText: "E2E_ADVISORY", resultCount: 1, diagnostics: [] } : { ok: true, diagnostics: [] }); } });
    const tokenFile = join(dir, "token");
    writeFileSync(tokenFile, `${TOKEN}\n`, { mode: 0o600 });
    chmodSync(tokenFile, 0o600);
    const home = join(dir, "home");
    const child = Bun.spawn([process.execPath, MAIN, "internal", "memory-mcp"], {
      cwd: dir,
      stdin: "pipe", stdout: "pipe", stderr: "pipe",
      env: { PATH: process.env.PATH ?? "", HOME: home, XDG_CONFIG_HOME: join(home, ".config"), XDG_STATE_HOME: join(home, ".state"), XDG_DATA_HOME: join(home, ".data"), DECK_RUNNER_MEMORY_ENDPOINT: `http://127.0.0.1:${server.port}/deck-runner-memory/v1`, DECK_RUNNER_MEMORY_TOKEN_FILE: tokenFile },
    });
    const frames = [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } } },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "memory_search", arguments: { query: "what did we decide" } } },
      { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "memory_save", arguments: { content: "Decision: the stdio memory server is covered by a real process test." } } },
    ];
    child.stdin.write(`${frames.map((frame) => JSON.stringify(frame)).join("\n")}\n`);
    await child.stdin.end();
    const timer = setTimeout(() => child.kill("SIGKILL"), 60_000);
    const [stdout, stderr] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
    const code = await child.exited;
    clearTimeout(timer);
    expect(stderr).toBe("");
    expect(code).toBe(0);
    const messages = stdout.trim().split("\n").map((line) => JSON.parse(line));
    expect(messages.map((message) => message.id).sort()).toEqual([1, 2, 3, 4]);
    expect(messages.find((m) => m.id === 2).result.tools.map((tool: any) => tool.name).sort()).toEqual(["memory_save", "memory_search"]);
    expect(messages.find((m) => m.id === 3).result.content[0].text).toBe("E2E_ADVISORY");
    expect(messages.find((m) => m.id === 4).result.content[0].text).toMatch(/saved/i);
    expect(seen.map((entry) => entry.body.event)).toEqual(["search", "save"]);
    for (const entry of seen) { expect(entry.auth).toBe(`Bearer ${TOKEN}`); expect(entry.body).toMatchObject({ runnerId: "codex", role: "lead" }); }
    expect(stdout).not.toContain(TOKEN);
  }, 90_000);

  test("without the loopback variables the process still answers the handshake and lists no tools", async () => {
    dir = mkdtempSync(join(tmpdir(), "deck-memory-mcp-e2e-"));
    const home = join(dir, "home");
    const child = Bun.spawn([process.execPath, MAIN, "internal", "memory-mcp"], { cwd: dir, stdin: "pipe", stdout: "pipe", stderr: "pipe", env: { PATH: process.env.PATH ?? "", HOME: home, XDG_CONFIG_HOME: join(home, ".config") } });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })}\n`);
    await child.stdin.end();
    const stdout = await new Response(child.stdout).text();
    expect(await child.exited).toBe(0);
    expect(JSON.parse(stdout.trim()).result.tools).toEqual([]);
  }, 90_000);
});
