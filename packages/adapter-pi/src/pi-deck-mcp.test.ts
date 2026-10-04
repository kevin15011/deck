import { describe, expect, test } from "bun:test";
import { isAbsolute } from "node:path";
import { TAVILY_PROVIDER_DESCRIPTOR } from "@deck/provider-tavily";

import {
  DECK_PI_MEMORY_ENV_BLANKS,
  buildDeckPiMcpEntry,
  resolveDeckPiMcpServers,
  selectDeckPiMcpServerIds,
  validateDeckPiMcpEntry,
} from "./pi-deck-mcp";

const exes: Record<string, string> = { npx: "/usr/bin/npx", "context-mode": "/usr/local/bin/context-mode" };
const tools = (overrides: { codebase?: string } = {}) => ({
  resolveExecutable: (name: string) => exes[name],
  codebase: { command: () => overrides.codebase ?? "/data/deck/pi/tools/codebase-native-v0.11.0/linux-x64/codebase-memory-mcp" },
});

describe("buildDeckPiMcpEntry", () => {
  test("is direct-exposed and blanks every memory variable", () => {
    const entry = buildDeckPiMcpEntry({ command: "/usr/bin/npx", args: ["-y", "x"] });
    expect(entry).toEqual({ command: "/usr/bin/npx", args: ["-y", "x"], env: { ...DECK_PI_MEMORY_ENV_BLANKS }, exposure: "direct" });
    expect(Object.keys(DECK_PI_MEMORY_ENV_BLANKS).sort()).toEqual(["DECK_RUNNER_MEMORY_ENDPOINT", "DECK_RUNNER_MEMORY_TOKEN", "DECK_RUNNER_MEMORY_TOKEN_FILE"]);
    expect(Object.values(DECK_PI_MEMORY_ENV_BLANKS).every((value) => value === "")).toBe(true);
  });

  test("rejects a bare command name", () => {
    expect(() => buildDeckPiMcpEntry({ command: "npx", args: [] })).toThrow(/absolute/i);
  });
});

describe("validateDeckPiMcpEntry", () => {
  test("accepts an entry built by Deck", () => {
    expect(validateDeckPiMcpEntry(buildDeckPiMcpEntry({ command: "/usr/bin/npx", args: [] }), () => true)).toEqual([]);
  });

  test("flags relative commands, missing executables, wrong exposure and missing env blanks", () => {
    const problems = validateDeckPiMcpEntry({ command: "context-mode", args: [], env: {}, exposure: "codemode" }, () => false);
    expect(problems.join(" ")).toMatch(/absolute/);
    expect(problems.join(" ")).toMatch(/exposure/);
    expect(problems.join(" ")).toMatch(/DECK_RUNNER_MEMORY_TOKEN/);
    expect(validateDeckPiMcpEntry({ command: "/nope", args: [], env: { ...DECK_PI_MEMORY_ENV_BLANKS }, exposure: "direct" }, () => false).join(" ")).toMatch(/does not exist|not executable/i);
  });

  test("flags an inline credential", () => {
    const problems = validateDeckPiMcpEntry({ command: "/usr/bin/npx", args: [], env: { ...DECK_PI_MEMORY_ENV_BLANKS, TAVILY_API_KEY: "tvly-secret" }, exposure: "direct" }, () => true);
    expect(problems.join(" ")).toMatch(/credential|secret/i);
  });
});

describe("selectDeckPiMcpServerIds", () => {
  test("explicit capability selection maps to servers and ignores non-MCP capabilities", () => {
    expect(selectDeckPiMcpServerIds({ capabilityIds: ["context-mode", "rtk", "codebase-memory-mcp", "adaptive-memory"], instructionPackageIds: [], webSearchEnabled: false, ownedServers: ["serena"] })).toEqual(["context-mode", "codebase-memory"]);
  });

  test("a launch without an explicit selection keeps servers Deck already owns", () => {
    expect(selectDeckPiMcpServerIds({ capabilityIds: undefined, instructionPackageIds: [], webSearchEnabled: false, ownedServers: ["context7", "serena"] })).toEqual(["context7", "serena"]);
  });

  test("instruction packages and web search add servers", () => {
    expect(selectDeckPiMcpServerIds({ capabilityIds: undefined, instructionPackageIds: ["context-mode", "codebase-memory", "serena"], webSearchEnabled: true, ownedServers: [] })).toEqual(["context-mode", "codebase-memory", "serena", "web-search"]);
  });

  test("an explicit selection ignores instruction packages and the web search flag", () => {
    expect(selectDeckPiMcpServerIds({ capabilityIds: ["context7"], instructionPackageIds: ["context-mode", "serena"], webSearchEnabled: true, ownedServers: [] })).toEqual(["context7"]);
  });

  test("deselecting in the TUI removes a previously owned server", () => {
    expect(selectDeckPiMcpServerIds({ capabilityIds: ["context7"], instructionPackageIds: [], webSearchEnabled: false, ownedServers: ["context7", "context-mode"] })).toEqual(["context7"]);
  });
});

describe("resolveDeckPiMcpServers", () => {
  const base = { existingServers: {}, ownedServerNames: [] as string[], webSearchProvider: TAVILY_PROVIDER_DESCRIPTOR as never };

  test("builds absolute, direct entries for every selected server", () => {
    const { servers, diagnostics } = resolveDeckPiMcpServers({
      ...base,
      selected: ["context7", "context-mode", "codebase-memory", "web-search"],
      tools: tools(),
    });
    expect(Object.keys(servers).sort()).toEqual(["codebase-memory", "context-mode", "context7", "web-search"]);
    for (const entry of Object.values(servers)) {
      expect(isAbsolute(entry.command as string)).toBe(true);
      expect(entry.exposure).toBe("direct");
      expect(entry.env).toEqual(DECK_PI_MEMORY_ENV_BLANKS);
    }
    expect(servers.context7).toMatchObject({ command: "/usr/bin/npx", args: ["-y", "@upstash/context7-mcp"] });
    expect(servers["context-mode"]).toMatchObject({ command: "/usr/local/bin/context-mode", args: [] });
    expect(servers["codebase-memory"]!.command).toBe("/data/deck/pi/tools/codebase-native-v0.11.0/linux-x64/codebase-memory-mcp");
    expect(servers["web-search"]).toMatchObject({ command: "/usr/bin/npx", args: ["-y", "tavily-mcp@0.2.22"] });
    expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  });

  test("the Tavily credential never appears in an entry", () => {
    const { servers } = resolveDeckPiMcpServers({ ...base, selected: ["web-search"], tools: tools() });
    expect(JSON.stringify(servers)).not.toMatch(/tvly|TAVILY_API_KEY/);
  });

  test("a server whose executable cannot be resolved is omitted with a warning", () => {
    const { servers, diagnostics } = resolveDeckPiMcpServers({ ...base, selected: ["context-mode", "codebase-memory"], tools: { resolveExecutable: () => undefined, codebase: { command: () => undefined } } });
    expect(servers).toEqual({});
    expect(diagnostics.map((d) => d.code).sort()).toEqual(["PI_MCP_SERVER_UNAVAILABLE", "PI_MCP_SERVER_UNAVAILABLE"]);
    expect(diagnostics.every((d) => d.severity === "warning")).toBe(true);
  });

  test("an unresolved server that Deck already owns keeps its existing entry", () => {
    const existing = buildDeckPiMcpEntry({ command: "/old/context-mode", args: [] });
    const { servers } = resolveDeckPiMcpServers({ ...base, selected: ["context-mode"], tools: { resolveExecutable: () => undefined, codebase: { command: () => undefined } }, existingServers: { "context-mode": existing }, ownedServerNames: ["context-mode"] });
    expect(servers["context-mode"]).toEqual(existing);
  });

  test("web search requires the Tavily provider descriptor", () => {
    const { servers, diagnostics } = resolveDeckPiMcpServers({ ...base, selected: ["web-search"], webSearchProvider: undefined, tools: tools() });
    expect(servers).toEqual({});
    expect(diagnostics[0]!.message).toMatch(/Web Search/i);
  });

  test("serena is adopted from its evidence-gated entry and normalized", () => {
    const legacy = { command: "/data/deck/tools/serena/bin/serena", args: ["start-mcp-server"] };
    const { servers } = resolveDeckPiMcpServers({ ...base, selected: ["serena"], tools: tools(), existingServers: { serena: legacy } });
    expect(servers.serena).toEqual({ command: legacy.command, args: legacy.args, env: DECK_PI_MEMORY_ENV_BLANKS, exposure: "direct" });
  });

  test("serena without a configured entry is skipped with a warning", () => {
    const { servers, diagnostics } = resolveDeckPiMcpServers({ ...base, selected: ["serena"], tools: tools() });
    expect(servers).toEqual({});
    expect(diagnostics[0]!.message).toMatch(/Serena/);
  });

  test("a serena entry with a relative command is rejected", () => {
    const { servers, diagnostics } = resolveDeckPiMcpServers({ ...base, selected: ["serena"], tools: tools(), existingServers: { serena: { command: "serena", args: [] } } });
    expect(servers).toEqual({});
    expect(diagnostics[0]!.severity).toBe("warning");
  });
});
