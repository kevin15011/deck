import { describe, expect, test } from "bun:test";

import { CODEX_LAUNCH_NEGATIVE_FIXTURES, CODEX_RELEASE_FIXTURES, inspectCodexCompatibility } from "./compatibility";

describe("released Codex compatibility fixtures", () => {
  test("covers the pinned minimum and current stable releases without network access", () => {
    expect(CODEX_RELEASE_FIXTURES.map((fixture) => fixture.version)).toEqual(["0.145.0", "0.146.1"]);
    for (const fixture of CODEX_RELEASE_FIXTURES) {
      const result = inspectCodexCompatibility(fixture);
      expect(result.launch).toEqual({
        interactive: true,
        exec: true,
        resumeById: true,
        resumeLatest: true,
      });
      expect(result.projectConfig).toBe(true);
      expect(result.roles).toBe(true);
      expect(result.skills).toBe(true);
      expect(result.multiAgent).toBe(true);
      expect(result.mcp).toEqual({ stdio: true, streamableHttp: true });
      expect(result.executionClass).toBe("static-compatible");
      expect(Object.values(result.routeClassifications)).toEqual([
        "static-compatible",
        "static-compatible",
        "static-compatible",
        "static-compatible",
      ]);
      expect(result.trustedBridge.reason).toContain("adaptive memory");
    }
  });

  test("does not guess an unsupported resume flag", () => {
    const fixture = { ...CODEX_RELEASE_FIXTURES[0]!, resumeHelp: CODEX_RELEASE_FIXTURES[0]!.resumeHelp.replace("--last", "") };
    expect(inspectCodexCompatibility(fixture).launch.resumeLatest).toBe(false);
  });

  test("has captured negative evidence for every launch mode", () => {
    for (const negative of CODEX_LAUNCH_NEGATIVE_FIXTURES) {
      expect(inspectCodexCompatibility(negative.fixture).launch[negative.mode]).toBe(false);
    }
  });
});
