import { describe, expect, test } from "bun:test";

import { inspectPiEnvironment } from "./preflight";

describe("inspectPiEnvironment", () => {
  test("reads Pi version from stderr and detects the Pi agent config directory", () => {
    const result = inspectPiEnvironment({
      command: "pi",
      homeDirectory: "/home/tester",
      env: {},
      runCommand: () => ({ exitCode: 0, stdout: "", stderr: "0.74.0\n" }),
      pathExists: (path) => path === "/home/tester/.pi/agent",
    });

    expect(result).toEqual({
      version: "0.74.0",
      versionStatus: expect.objectContaining({ supported: false, reason: "below-minimum" }),
      agentDir: "/home/tester/.pi/agent",
      configDirectory: "/home/tester/.pi/agent",
      existingConfiguration: true,
    });
  });
});

describe("inspectPiEnvironment minimum version (Pi >= 1.0.0)", () => {
  const base = { command: "pi", homeDirectory: "/home/tester", env: {}, pathExists: () => false, readDir: () => [], readFile: () => "", getStat: () => ({ isDirectory: () => false, isFile: () => true }), includeChecks: true } as const;

  test("supported version passes the version check", () => {
    const result = inspectPiEnvironment({ ...base, runCommand: () => ({ exitCode: 0, stdout: "1.0.0\n" }) });
    expect(result.versionStatus?.supported).toBe(true);
    const check = result.checks!.find((c) => c.id === "pi-min-version");
    expect(check?.status).toBe("pass");
  });

  test("old version fails with an upgrade hint", () => {
    const result = inspectPiEnvironment({ ...base, runCommand: () => ({ exitCode: 0, stdout: "0.99.3\n" }) });
    const check = result.checks!.find((c) => c.id === "pi-min-version");
    expect(check?.status).toBe("fail");
    expect(check?.severity).toBe("error");
    expect(check?.remediation).toContain("@earendil-works/pi-coding-agent");
    expect(result.summary?.ready).toBe(false);
  });

  test("unparseable output fails", () => {
    const result = inspectPiEnvironment({ ...base, runCommand: () => ({ exitCode: 0, stdout: "banana\n" }) });
    expect(result.versionStatus?.reason).toBe("unparseable");
    expect(result.checks!.find((c) => c.id === "pi-min-version")?.status).toBe("fail");
  });

  test("a binary that cannot run is unavailable", () => {
    const result = inspectPiEnvironment({ ...base, runCommand: () => ({ exitCode: 1, stdout: "", stderr: "spawn pi ENOENT" }) });
    expect(result.versionStatus?.reason).toBe("unavailable");
    expect(result.checks!.find((c) => c.id === "pi-min-version")?.status).toBe("fail");
  });
});

describe("inspectPiEnvironment agent directory resolution", () => {
  test("PI_CODING_AGENT_DIR overrides the default and is the only config candidate", () => {
    const seen: string[] = [];
    const result = inspectPiEnvironment({
      command: "pi",
      homeDirectory: "/home/tester",
      env: { PI_CODING_AGENT_DIR: "/opt/pi-home" },
      runCommand: () => ({ exitCode: 0, stdout: "1.0.0" }),
      pathExists: (path) => { seen.push(path); return path === "/opt/pi-home"; },
    });
    expect(result.configDirectory).toBe("/opt/pi-home");
    expect(result.agentDir).toBe("/opt/pi-home");
    expect(seen.some((path) => path.startsWith("/home/tester"))).toBe(false);
  });

  test("a relative override is a blocking diagnostic and nothing is probed", () => {
    const result = inspectPiEnvironment({
      command: "pi",
      homeDirectory: "/home/tester",
      env: { PI_CODING_AGENT_DIR: "relative/dir" },
      runCommand: () => ({ exitCode: 0, stdout: "1.0.0" }),
      pathExists: () => true,
      includeChecks: true,
      readDir: () => [],
      readFile: () => "",
      getStat: () => ({ isDirectory: () => false, isFile: () => true }),
    });
    expect(result.agentDirDiagnostic).toContain("PI_CODING_AGENT_DIR");
    expect(result.configDirectory).toBeUndefined();
    expect(result.checks!.find((c) => c.id === "pi-agent-dir")?.status).toBe("fail");
  });
});

// Preflight checks tests (TDD first - failing tests before implementation)
describe("inspectPiEnvironment with structured checks", () => {
  test("returns structured checks when includeChecks is enabled", () => {
    const result = inspectPiEnvironment({
      command: "pi",
      homeDirectory: "/home/tester",
      env: {},
      runCommand: () => ({ exitCode: 0, stdout: "", stderr: "0.74.0\n" }),
      pathExists: (path) => path === "/home/tester/.pi/agent/mcp.json",
      readDir: () => [],
      readFile: () => "",
      getStat: () => ({ isDirectory: () => false, isFile: () => true }),
      includeChecks: true,
    });

    expect(result.checks).toBeDefined();
    expect(result.checks!.length).toBeGreaterThan(0);
    expect(result.summary).toBeDefined();
  });

  test("fails MCP config persistence check when config missing", () => {
    const result = inspectPiEnvironment({
      command: "pi",
      homeDirectory: "/home/tester",
      env: {},
      runCommand: () => ({ exitCode: 0, stdout: "", stderr: "0.74.0\n" }),
      pathExists: () => false,
      readDir: () => [],
      readFile: () => "",
      getStat: () => ({ isDirectory: () => false, isFile: () => true }),
      includeChecks: true,
    });

    const mcpCheck = result.checks!.find((c) => c.id === "mcp-config-persistence");
    expect(mcpCheck?.status).toBe("fail");
    expect(mcpCheck?.severity).toBe("error");
  });

  test("detects stale package replacement check", () => {
    const result = inspectPiEnvironment({
      command: "pi",
      homeDirectory: "/home/tester",
      env: {},
      runCommand: () => ({ exitCode: 0, stdout: "", stderr: "0.74.0\n" }),
      pathExists: (path) =>
        path === "/home/tester/.pi/agent" ||
        path === "/home/tester/.pi/agent/settings.json",
      readDir: () => [],
      readFile: (path) => {
        if (path.includes("settings.json")) {
          return JSON.stringify({ packages: [{ name: "@dreki-gg/pi-context7" }] });
        }
        return "";
      },
      getStat: () => ({ isDirectory: () => false, isFile: () => true }),
      includeChecks: true,
    });

    const staleCheck = result.checks!.find((c) => c.id === "stale-package-replacement");
    expect(staleCheck?.status).toBe("warn");
    expect(staleCheck?.diagnostics).toContain("Found stale package: @dreki-gg/pi-context7");
  });

  test("detects nested skills cleanup check", () => {
    const result = inspectPiEnvironment({
      command: "pi",
      homeDirectory: "/home/tester",
      env: {},
      runCommand: () => ({ exitCode: 0, stdout: "", stderr: "0.74.0\n" }),
      pathExists: (path) =>
        path === "/home/tester/.pi/skills" ||
        path === "/home/tester/.pi/skills/my-skill/SKILL.md/SKILL.md",
      readDir: (path) => (path === "/home/tester/.pi/skills" ? ["my-skill"] : []),
      readFile: () => "",
      getStat: () => ({ isDirectory: () => false, isFile: () => true }),
      includeChecks: true,
    });

    const nestedCheck = result.checks!.find((c) => c.id === "nested-skills-cleanup");
    expect(nestedCheck?.status).toBe("warn");
  });

  test("detects legacy SDD cleanup check", () => {
    const result = inspectPiEnvironment({
      command: "pi",
      homeDirectory: "/home/tester",
      env: {},
      runCommand: () => ({ exitCode: 0, stdout: "", stderr: "0.74.0\n" }),
      pathExists: (path) => path === "/home/tester/.pi/agent" || path === "/home/tester/.pi/skills",
      readDir: (path) =>
        path === "/home/tester/.pi/agent" ? ["sdd-agent.md"] : [],
      readFile: () => "",
      getStat: () => ({ isDirectory: () => false, isFile: () => true }),
      includeChecks: true,
    });

    const legacyCheck = result.checks!.find((c) => c.id === "legacy-sdd-cleanup");
    expect(legacyCheck?.status).toBe("warn");
  });

  test("fails shared binary usability check when version unknown", () => {
    const result = inspectPiEnvironment({
      command: "pi",
      homeDirectory: "/home/tester",
      env: {},
      runCommand: () => ({ exitCode: 1, stdout: "", stderr: "command not found" }),
      pathExists: () => false,
      readDir: () => [],
      readFile: () => "",
      getStat: () => ({ isDirectory: () => false, isFile: () => true }),
      includeChecks: true,
    });

    const binaryCheck = result.checks!.find((c) => c.id === "shared-binary-usability");
    expect(binaryCheck?.status).toBe("fail");
    expect(binaryCheck?.severity).toBe("error");
  });

  test("computes summary with failed/warnings counts", () => {
    const result = inspectPiEnvironment({
      command: "pi",
      homeDirectory: "/home/tester",
      env: {},
      runCommand: () => ({ exitCode: 1, stdout: "", stderr: "not found" }),
      pathExists: () => false,
      readDir: () => [],
      readFile: () => "",
      getStat: () => ({ isDirectory: () => false, isFile: () => true }),
      includeChecks: true,
    });

    expect(result.summary?.ready).toBe(false);
    expect(result.summary?.failed).toBeGreaterThan(0);
  });
});
