import { describe, expect, test } from "bun:test";

import {
  reviewOpenCodeTools,
  resolveOpenCodeInstalledEvidence,
  type OpenCodeEvidenceContext,
} from "./required-tools";

function contextFor(options: {
  env?: Record<string, string | undefined>;
  files?: Record<string, string>;
  executableFiles?: readonly string[];
  nonExecutableFiles?: readonly string[];
  directories?: readonly string[];
  platform?: "linux" | "darwin" | "win32";
} = {}): OpenCodeEvidenceContext {
  const files = new Map(Object.entries(options.files ?? {}));
  const executableFiles = new Set(options.executableFiles ?? []);
  const nonExecutableFiles = new Set(options.nonExecutableFiles ?? []);
  const directories = new Set(options.directories ?? []);
  const stat = (path: string) => {
    if (directories.has(path)) return { size: 0, mode: 0o755, isFile: () => false, isDirectory: () => true };
    if (files.has(path) || executableFiles.has(path) || nonExecutableFiles.has(path)) {
      return { size: files.get(path)?.length ?? 4, mode: executableFiles.has(path) ? 0o755 : 0o644, isFile: () => true, isDirectory: () => false };
    }
    throw new Error(`missing: ${path}`);
  };

  return {
    projectRoot: "/project",
    workspaceRoot: "/project",
    homeDirectory: "/home/tester",
    currentDirectory: "/cwd",
    platform: options.platform ?? "linux",
    env: { PATH: "", ...options.env },
    readFile: (path) => files.get(path) ?? (() => { throw new Error(`missing: ${path}`); })(),
    stat,
    realpath: (path) => {
      if (path === "/tmp/bin/dangling") throw new Error("dangling symlink");
      stat(path);
      return path;
    },
    access: (path) => {
      if (!executableFiles.has(path)) throw new Error(`not executable: ${path}`);
    },
  };
}

describe("reviewOpenCodeTools", () => {
  test("detects OpenCode packages from the config package manifest", () => {
    const result = reviewOpenCodeTools({
      homeDirectory: "/home/tester",
      environment: { PATH: "" },
      packageManifest: "/home/tester/.config/opencode/package.json",
      commandExists: (command) => command === "codebase-memory-mcp",
      pathExists: () => true,
      readFile: () => JSON.stringify({ dependencies: { "context-mode": "^1.0.0" } }),
    });

    expect(result.installedPackages).toEqual(["context-mode", "codebase-memory-mcp"]);
    expect(result.tools).toEqual([
      { name: "RTK", installed: false },
      { name: "context-mode", installed: false },
      { name: "codebase-memory", installed: true },
      { name: "Context7", installed: false },
      { name: "Serena", installed: false },
    ]);
    expect(result.toolStatuses.find((tool) => tool.name === "context-mode")).toEqual({
      name: "context-mode",
      available: "missing",
      configured: "missing",
      ready: "missing",
    });
  });

  test("detects tools configured in opencode.json MCP and plugin sections", () => {
    const result = reviewOpenCodeTools({
      packageManifest: "/home/tester/.config/opencode/package.json",
      configPath: "/home/tester/.config/opencode/opencode.json",
      commandExists: (command) => command === "rtk",
      pathExists: (path) => path.endsWith("package.json") || path.endsWith("opencode.json"),
      readFile: (path) => {
        if (path.endsWith("package.json")) return JSON.stringify({ dependencies: {} });
        return JSON.stringify({
          mcp: {
            "codebase-memory": {},
            "context-mode": {},
            context7: {},
          },
          plugin: ["context-mode"],
        });
      },
    });

    expect(result.tools).toEqual([
      { name: "RTK", installed: true },
      { name: "context-mode", installed: false },
      { name: "codebase-memory", installed: false },
      { name: "Context7", installed: false },
      { name: "Serena", installed: false },
    ]);
  });

  test("reports missing tools when package manifest is missing", () => {
    const result = reviewOpenCodeTools({
      packageManifest: "/missing/package.json",
      pathExists: () => false,
    });

    expect(result.installedPackages).toEqual([]);
    expect(result.error).toBe("OpenCode package manifest not found.");
    expect(result.tools.every((tool) => !tool.installed)).toBe(true);
  });

  test("accepts only exact executable PATH evidence when default config files are absent", () => {
    const context = contextFor({
      env: { PATH: "/tmp/bin" },
      executableFiles: ["/tmp/bin/codebase-memory-mcp"],
    });

    const evidence = resolveOpenCodeInstalledEvidence("codebase-memory", context);
    expect(evidence).toEqual({
      toolId: "codebase-memory",
      state: "usable",
      source: "PATH",
      reasonCodes: ["PATH-usable"],
    });

    const review = reviewOpenCodeTools({
      evidenceContext: context,
      packageManifest: "/missing/package.json",
      configPath: "/missing/opencode.json",
      pathExists: () => false,
    });
    expect(review.tools.find((tool) => tool.name === "codebase-memory")?.installed).toBe(true);
    expect(review.evidence?.["codebase-memory"]).toEqual(evidence);
  });

  test("uses the effective JSONC config command only when its target is executable", () => {
    const context = contextFor({
      files: {
        "/project/opencode.json": '{"mcp":{"codebase-memory":{"type":"local","command":["/tmp/bin/codebase-memory-mcp"]}}}',
      },
      executableFiles: ["/tmp/bin/codebase-memory-mcp"],
    });

    expect(resolveOpenCodeInstalledEvidence("codebase-memory", context)).toEqual({
      toolId: "codebase-memory",
      state: "usable",
      source: "configured",
      reasonCodes: ["configured-usable"],
    });
  });

  test("retains broken configuration reasons while allowing independent PATH evidence", () => {
    const context = contextFor({
      env: { PATH: "/tmp/bin" },
      files: {
        "/project/opencode.json": '{"mcp":{"codebase-memory":{"type":"local","command":["/missing/codebase-memory-mcp"]}}}',
      },
      executableFiles: ["/tmp/bin/codebase-memory-mcp"],
    });

    const evidence = resolveOpenCodeInstalledEvidence("codebase-memory", context);
    expect(evidence.state).toBe("usable");
    expect(evidence.source).toBe("PATH");
    expect(evidence.reasonCodes).toEqual(["configured-target-missing", "PATH-usable"]);
  });

  test("does not promote declarations, directories, empty files, or non-executable files", () => {
    const declared = reviewOpenCodeTools({
      evidenceContext: contextFor({ files: { "/home/tester/.config/opencode/package.json": '{"dependencies":{"codebase-memory":"0.9.0"}}' } }),
      packageManifest: "/home/tester/.config/opencode/package.json",
      configPath: "/missing/opencode.json",
      pathExists: (path) => path.endsWith("package.json"),
      readFile: () => '{"dependencies":{"codebase-memory":"0.9.0"}}',
    });
    expect(declared.tools.find((tool) => tool.name === "codebase-memory")?.installed).toBe(false);
    expect(declared.evidence?.["codebase-memory"]?.state).toBe("declared");

    expect(resolveOpenCodeInstalledEvidence("codebase-memory", contextFor({
      env: { PATH: "/tmp/bin" },
      directories: ["/tmp/bin/codebase-memory-mcp"],
    })).reasonCodes).toContain("PATH-non-file");
    expect(resolveOpenCodeInstalledEvidence("codebase-memory", contextFor({
      env: { PATH: "/tmp/bin" },
      nonExecutableFiles: ["/tmp/bin/codebase-memory-mcp"],
    })).reasonCodes).toContain("PATH-non-executable");
  });

  test("treats pure mode as executable-only evidence", () => {
    const context = contextFor({
      env: { OPENCODE_PURE: "1" },
      files: { "/project/opencode.json": '{"mcp":{"codebase-memory":{"command":["/missing/codebase-memory-mcp"]}}}' },
      executableFiles: [],
    });

    expect(resolveOpenCodeInstalledEvidence("codebase-memory", context).state).toBe("absent");
  });
});
