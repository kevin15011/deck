import { describe, expect, test } from "bun:test";

import { inspectCodexProject } from "./preflight";

describe("inspectCodexProject", () => {
  test("reports missing and unsupported binaries without external effects", async () => {
    expect((await inspectCodexProject("/p", { probe: async () => ({ found: false }) })).state).toBe("blocked");
    expect((await inspectCodexProject("/p", { probe: async () => ({ found: true, version: "0.100.0", help: "" }) })).state).toBe("unsupported");
  });

  test("reports untrusted project config as materialized but inactive", async () => {
    const result = await inspectCodexProject("/p", {
      probe: async () => ({ found: true, version: "0.146.1", help: "Usage: codex [OPTIONS]", execHelp: "Usage: codex exec [OPTIONS]", resumeHelp: "Usage: codex resume [SESSION_ID] --last" }),
      inspectTrust: async () => "untrusted",
      readProject: async () => ({ config: "[features]\nmulti_agent=true\n", roles: ["deck-lead"], skills: ["deck-apply-deep"], agentsInstructions: true }),
    });
    expect(result.state).toBe("degraded");
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "materialized-but-inactive")).toBe(true);
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
