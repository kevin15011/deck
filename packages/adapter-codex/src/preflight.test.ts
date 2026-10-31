import { describe, expect, test } from "bun:test";

import { inspectCodexProject } from "./preflight";

describe("inspectCodexProject", () => {
  test("reports missing and unsupported binaries without external effects", async () => {
    expect((await inspectCodexProject("/p", { probe: async () => ({ found: false }) })).state).toBe("blocked");
    expect((await inspectCodexProject("/p", { probe: async () => ({ found: true, version: "0.100.0", help: "" }) })).state).toBe("unsupported");
  });

  test("does not warn about project trust because Deck's configuration is global", async () => {
    const result = await inspectCodexProject("/p", {
      probe: async () => ({ found: true, version: "0.146.1", help: "Usage: codex [OPTIONS]", execHelp: "Usage: codex exec [OPTIONS]", resumeHelp: "Usage: codex resume [SESSION_ID] --last" }),
      inspectTrust: async () => "untrusted",
      readProject: async () => ({ config: "[features]\nmulti_agent=true\n", roles: ["deck-lead"], skills: ["deck-apply-deep"], agentsInstructions: true }),
    });
    expect(result.state).toBe("ready");
    expect(result.diagnostics).toEqual([]);
  });

  test("blocks malformed project configuration", async () => {
    const result = await inspectCodexProject("/p", {
      probe: async () => ({ found: true, version: "0.146.1", help: "Usage: codex [OPTIONS]", execHelp: "Usage: codex exec [OPTIONS]", resumeHelp: "Usage: codex resume [SESSION_ID] --last" }),
      readProject: async () => ({ config: "[broken", roles: [], skills: [], agentsInstructions: false }),
    });
    expect(result.state).toBe("blocked");
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "codex-config-malformed")).toBe(true);
  });
});

test("a newer Codex is admitted with a compatibility warning", async () => {
 const result = await inspectCodexProject('/p', { probe: async () => ({ found: true, version: '0.200.0', help: 'Usage: codex' }) });
 expect(result.state).toBe('degraded');
 expect(result.diagnostics.some(item => item.code === 'codex-version-untested')).toBe(true);
});
