import { describe, expect, test } from "bun:test";

import type { InstallablePiTool } from "./installation-plan";
import { installPiTools } from "./install-tools";

type FakeOwned = { state: () => string; command: () => string | undefined; install: () => Promise<"installed" | "unchanged">; supported: () => boolean; root: string; existing?: () => string | undefined };

function fakeTools(overrides: { rtk?: Partial<FakeOwned>; codebase?: Partial<FakeOwned>; npx?: string | undefined } = {}) {
  const calls: string[] = [];
  const tools = {
    resolveExecutable: (name: string) => (name === "npx" ? ("npx" in overrides ? overrides.npx : "/usr/bin/npx") : undefined),
    rtk: { state: () => "absent", command: () => undefined, install: async () => { calls.push("rtk.install"); return "installed" as const; }, supported: () => true, root: "/x/rtk", ...overrides.rtk },
    codebase: { state: () => "absent", command: () => undefined, existing: () => undefined, install: async () => { calls.push("codebase.install"); return "installed" as const; }, supported: () => true, root: "/x/cb", ...overrides.codebase },
  };
  return { tools: tools as never, calls };
}

const rtk: InstallablePiTool = { id: "rtk", name: "RTK", source: "rtk-ai/rtk", required: false, installKind: "shared-binary", capabilityId: "rtk" };
const codebase: InstallablePiTool = { id: "codebase-memory-mcp", name: "codebase-memory-mcp", source: "DeusData/codebase-memory-mcp", required: false, installKind: "shared-binary-plus-mcp", capabilityId: "codebase-memory-mcp" };
const webSearch: InstallablePiTool = { id: "web-search", name: "Web Search", source: "npm:tavily-mcp@0.2.22", required: false, installKind: "mcp-server", capabilityId: "web-search" };
const noPath = { checkSharedBinaryUsability: async (command: string) => ({ status: "ready" as const, command, resolvedPath: `/usr/bin/${command}`, version: "9.9.9" }) };

describe("installPiTools with Deck-owned tools", () => {
  test("RTK ignores a PATH binary and installs the pinned artifact when absent", async () => {
    const { tools, calls } = fakeTools();
    const [result] = await installPiTools("pi", [rtk], () => {}, { piTools: tools, ...noPath });
    expect(calls).toEqual(["rtk.install"]);
    expect(result).toMatchObject({ status: "installed", success: true });
  });

  test("an already-ready owned RTK is reused without installing", async () => {
    const { tools, calls } = fakeTools({ rtk: { state: () => "ready", command: () => "/x/rtk/rtk" } });
    const [result] = await installPiTools("pi", [rtk], () => {}, { piTools: tools });
    expect(calls).toEqual([]);
    expect(result).toMatchObject({ status: "reused", success: true });
  });

  test("a conflicting or unusable owned RTK blocks instead of overwriting", async () => {
    for (const state of ["conflict", "unusable"]) {
      const { tools, calls } = fakeTools({ rtk: { state: () => state } });
      const [result] = await installPiTools("pi", [rtk], () => {}, { piTools: tools });
      expect(calls).toEqual([]);
      expect(result).toMatchObject({ status: "blocked", success: false });
    }
  });

  test("an unsupported platform is blocked with a clear message", async () => {
    const { tools } = fakeTools({ rtk: { state: () => "unsupported", supported: () => false } });
    const [result] = await installPiTools("pi", [rtk], () => {}, { piTools: tools });
    expect(result).toMatchObject({ status: "blocked", success: false });
    expect(result!.message).toMatch(/pinned/i);
  });

  test("an install failure is a failed result, not a throw", async () => {
    const { tools } = fakeTools({ rtk: { install: async () => { throw new Error("Pinned RTK release integrity mismatch."); } } });
    const [result] = await installPiTools("pi", [rtk], () => {}, { piTools: tools });
    expect(result).toMatchObject({ status: "failed", success: false });
    expect(result!.message).toContain("integrity mismatch");
  });

  test("Codebase Memory reuses a usable shared binary and plans no owned download", async () => {
    const { tools, calls } = fakeTools({ codebase: { existing: () => "/home/u/.local/bin/codebase-memory-mcp", command: () => "/home/u/.local/bin/codebase-memory-mcp" } });
    const [result] = await installPiTools("pi", [codebase], () => {}, { piTools: tools });
    expect(calls).toEqual([]);
    expect(result).toMatchObject({ status: "reused", success: true });
    expect(result!.message).toContain("shared");
  });

  test("Codebase Memory falls back to the pinned owned release", async () => {
    const { tools, calls } = fakeTools();
    const [result] = await installPiTools("pi", [codebase], () => {}, { piTools: tools });
    expect(calls).toEqual(["codebase.install"]);
    expect(result).toMatchObject({ status: "installed", success: true });
  });

  test("Context Mode keeps the shared-binary check", async () => {
    const probes: string[] = [];
    const { tools } = fakeTools();
    const [result] = await installPiTools("pi", [{ id: "context-mode", name: "context-mode", source: "context-mode (shared binary)", required: false, installKind: "shared-binary-plus-mcp", capabilityId: "context-mode" }], () => {}, {
      piTools: tools,
      checkSharedBinaryUsability: async (command) => { probes.push(command); return { status: "ready", command, resolvedPath: "/usr/bin/context-mode", version: "1" }; },
    });
    expect(probes).toEqual(["context-mode"]);
    expect(result!.status).toBe("reused");
  });

  test("Web Search needs only npx and never touches a credential", async () => {
    const { tools } = fakeTools();
    const [ok] = await installPiTools("pi", [webSearch], () => {}, { piTools: tools });
    expect(ok).toMatchObject({ status: "installed", success: true, installKind: "mcp-server" });

    const { tools: noNpx } = fakeTools({ npx: undefined });
    const [missing] = await installPiTools("pi", [webSearch], () => {}, { piTools: noNpx });
    expect(missing).toMatchObject({ status: "failed", success: false });
    expect(missing!.message).toMatch(/npx/);
  });
});
