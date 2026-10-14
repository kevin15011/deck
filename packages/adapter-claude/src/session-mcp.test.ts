import { afterEach, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeModelMetadata, claudePluginName, normalizeClaudeCapabilities, type ClaudeCapabilityId } from "./models";
import { createClaudeRunnerAdapter } from "./runner-adapter";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function setup(ids?: ClaudeCapabilityId[]) {
  const home = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), "deck-session-mcp-")));
  roots.push(home);
  const dataRoot = join(home, "deck");
  const parent = join(dataRoot, "claude");
  if (ids) {
    const capabilities = normalizeClaudeCapabilities(ids);
    const markerDir = join(parent, claudePluginName({}, capabilities), ".claude-plugin");
    mkdirSync(markerDir, { recursive: true, mode: 0o700 });
    writeFileSync(join(parent, "model-assignments.json"), claudeModelMetadata({}, capabilities, capabilities.includes("web-search") ? "tavily" : undefined), { mode: 0o600 });
    writeFileSync(join(markerDir, "plugin.json"), JSON.stringify({ name: "deck-developer-team", version: "1.0.0", description: "Deck Developer Team content" }, null, 2) + "\n", { mode: 0o600 });
  }
  return { home, dataRoot, parent };
}

test("no owned Claude selection needs no install and yields no ordinary child servers", async () => {
  const e = setup();
  const adapter = createClaudeRunnerAdapter({ ...e, resolveMemoryCredential: () => { throw new Error("must not read credentials"); } });
  expect(await adapter.readSessionMcpServers()).toEqual({});
});

test("session MCP reads only verified owned ordinary packages and excludes memory, web and hooks", async () => {
  const e = setup(["context-mode", "codebase-memory", "context7", "web-search", "rtk"]);
  const adapter = createClaudeRunnerAdapter({ ...e, resolveCommand: () => process.execPath,
    resolveMemoryCredential: () => { throw new Error("must not read memory credentials"); },
    webSearchCredential: () => { throw new Error("must not read web credentials"); },
    installSharedTool: async () => { throw new Error("must not install"); },
  });
  const servers = await adapter.readSessionMcpServers();
  expect(Object.keys(servers).sort()).toEqual(["codebase-memory", "context-mode", "context7"]);
  expect(servers["context-mode"]).toEqual({ command: realpathSync(process.execPath), args: [], env: {} });
});

test("a missing selected executable is refused rather than omitted", async () => {
  const e = setup(["context-mode"]);
  await expect(createClaudeRunnerAdapter({ ...e, resolveCommand: () => undefined }).readSessionMcpServers()).rejects.toThrow("verified executable");
});

test("untrusted owned selection is refused rather than treated as no selection", async () => {
  const e = setup(["context-mode"]);
  chmodSync(join(e.parent, "model-assignments.json"), 0o644);
  await expect(createClaudeRunnerAdapter(e).readSessionMcpServers()).rejects.toThrow("untrusted");
});

test("selected Serena requires read-only bootstrap evidence and never installs", async () => {
  const e = setup(["serena"]);
  const adapter = createClaudeRunnerAdapter({ ...e, serenaProxyCommand: [process.execPath, "internal", "serena-mcp"],
    serenaReadiness: async () => ({ state: "missing" }) as never,
    serenaBootstrap: async () => { throw new Error("must not bootstrap"); },
  });
  await expect(adapter.readSessionMcpServers()).rejects.toThrow("Serena");
});
