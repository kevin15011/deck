import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { DEFAULT_PI_AGENT_DIR_SEGMENTS, piAgentPaths, resolvePiAgentDir, requirePiAgentDir } from "./agent-dir";

describe("resolvePiAgentDir", () => {
  test("defaults to ~/.pi/agent when PI_CODING_AGENT_DIR is unset", () => {
    const result = resolvePiAgentDir({}, "/home/tester");
    expect(result).toEqual({ ok: true, dir: "/home/tester/.pi/agent", source: "default" });
    expect(DEFAULT_PI_AGENT_DIR_SEGMENTS).toEqual([".pi", "agent"]);
  });

  test("honors an absolute PI_CODING_AGENT_DIR", () => {
    expect(resolvePiAgentDir({ PI_CODING_AGENT_DIR: "/opt/pi-home" }, "/home/tester")).toEqual({
      ok: true,
      dir: "/opt/pi-home",
      source: "env",
    });
  });

  test("normalizes redundant segments and trailing separators", () => {
    const result = resolvePiAgentDir({ PI_CODING_AGENT_DIR: "/opt//pi-home/./x/../" }, "/home/tester");
    expect(result).toEqual({ ok: true, dir: "/opt/pi-home", source: "env" });
  });

  test("a relative override is a blocking diagnostic", () => {
    const result = resolvePiAgentDir({ PI_CODING_AGENT_DIR: "relative/dir" }, "/home/tester");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("PI_AGENT_DIR_RELATIVE");
      expect(result.message).toContain("PI_CODING_AGENT_DIR");
    }
  });

  test("an empty or whitespace override is a blocking diagnostic", () => {
    for (const value of ["", "   "]) {
      const result = resolvePiAgentDir({ PI_CODING_AGENT_DIR: value }, "/home/tester");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("PI_AGENT_DIR_EMPTY");
    }
  });

  test("rejects NUL bytes", () => {
    const result = resolvePiAgentDir({ PI_CODING_AGENT_DIR: "/opt/pi\0home" }, "/home/tester");
    expect(result.ok).toBe(false);
  });

  test("requires an absolute home when defaulting", () => {
    const result = resolvePiAgentDir({}, "relative-home");
    expect(result.ok).toBe(false);
  });
});

describe("requirePiAgentDir", () => {
  test("returns the directory", () => {
    expect(requirePiAgentDir({ PI_CODING_AGENT_DIR: "/opt/pi" }, "/h")).toBe("/opt/pi");
  });

  test("throws a blocking error naming the variable before any write", () => {
    expect(() => requirePiAgentDir({ PI_CODING_AGENT_DIR: "rel" }, "/h")).toThrow(/PI_CODING_AGENT_DIR/);
  });
});

describe("piAgentPaths", () => {
  test("derives every Deck-relevant path from one directory", () => {
    const paths = piAgentPaths("/opt/pi");
    expect(paths.settings).toBe("/opt/pi/settings.json");
    expect(paths.mcp).toBe("/opt/pi/mcp.json");
    expect(paths.deckRoot).toBe(join("/opt/pi", "deck"));
    expect(paths.packageRoot).toBe("/opt/pi/deck/package");
    expect(paths.manifest).toBe("/opt/pi/deck/manifest.json");
    expect(paths.profilesRoot).toBe("/opt/pi/deck/profiles");
    expect(paths.packageSettingsEntry).toBe("deck/package");
  });
});
