import { describe, expect, test } from "bun:test";

import { installOpenCodeTools, commandExistsInPath, type InstallCommandResult } from "./install-tools";
import type { InstallableOpenCodeTool } from "./installation-plan";
import type { OpenCodeEvidenceContext, OpenCodeInstalledEvidence } from "./required-tools";

function evidenceContext(): OpenCodeEvidenceContext {
  return {
    projectRoot: "/project",
    workspaceRoot: "/project",
    homeDirectory: "/home/tester",
    currentDirectory: "/cwd",
    platform: "linux",
    env: { PATH: "" },
    readFile: () => { throw new Error("not used"); },
    stat: () => { throw new Error("not used"); },
    realpath: (path) => path,
    access: () => {},
  };
}

function state(toolId: InstallableOpenCodeTool["id"], status: OpenCodeInstalledEvidence["state"]): OpenCodeInstalledEvidence {
  return {
    toolId,
    state: status,
    source: status === "usable" ? "PATH" : "absent",
    reasonCodes: status === "usable" ? ["PATH-usable"] : ["no-evidence"],
  };
}

const successfulCommand = async (): Promise<InstallCommandResult> => ({ exitCode: 0, stdout: "", stderr: "" });

describe("installOpenCodeTools", () => {
  test("executes npm install -g for npm-package-plus-mcp and does NOT write to plugin array", async () => {
    const plan: InstallableOpenCodeTool[] = [
      { id: "context-mode", name: "context-mode", module: "context-mode", required: false, installKind: "npm-package-plus-mcp" },
    ];
    let installed = false;
    const results = await installOpenCodeTools("opencode", plan, () => {}, async () => {
      installed = true;
      return successfulCommand();
    }, {
      evidenceContext: evidenceContext(),
      resolveEvidence: () => state("context-mode", installed ? "usable" : "absent"),
    });

    expect(results[0]?.success).toBe(true);
    expect(results[0]?.outcome).toBe("executed");
    expect(results[0]?.message).toContain("context-mode");
  });

  test("returns failure for external tools", async () => {
    const [result] = await installOpenCodeTools(
      "opencode",
      [{ id: "rtk", name: "RTK", module: "rtk-ai/rtk", required: false, installKind: "external" }],
      () => {},
      async () => ({ exitCode: 0, stdout: "", stderr: "" }),
    );

    expect(result.success).toBe(false);
    expect(result.message).toBe("Manual install required from rtk-ai/rtk.");
  });

  test("skips mcp-server tools with informational message", async () => {
    const [result] = await installOpenCodeTools(
      "opencode",
      [{ id: "context7", name: "Context7", module: "@upstash/context7-mcp", required: false, installKind: "mcp-server" }],
      () => {},
      async () => ({ exitCode: 0, stdout: "", stderr: "" }),
    );

    expect(result.success).toBe(false);
    expect(result.message).toContain("MCP server configured via write-mcp-config action");
  });

  describe("python-tool (serena)", () => {
    test("skips serena when python3 is missing", async () => {
      const mockCommandExists = (cmd: string): boolean => {
        return cmd === "uv" || cmd === "pipx";
      };

      const [result] = await installOpenCodeTools(
        "opencode",
        [{ id: "serena", name: "Serena", module: "oraios/serena", required: false, installKind: "python-tool" }],
        () => {},
        async () => ({ exitCode: 0, stdout: "", stderr: "" }),
        { commandExists: mockCommandExists },
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain("Python3 is not installed");
    });

    test("succeeds when serena already exists in PATH", async () => {
      const mockCommandExists = (cmd: string): boolean => {
        return cmd === "python3" || cmd === "serena";
      };

      const [result] = await installOpenCodeTools(
        "opencode",
        [{ id: "serena", name: "Serena", module: "oraios/serena", required: false, installKind: "python-tool" }],
        () => {},
        async () => ({ exitCode: 0, stdout: "", stderr: "" }),
        { commandExists: mockCommandExists },
      );

      expect(result.success).toBe(true);
      expect(result.message).toContain("Serena found in PATH");
    });

    test("installs via uv and verifies success", async () => {
      let callCount = 0;
      const mockCommandExists = (cmd: string): boolean => {
        if (cmd === "python3" || cmd === "uv") return true;
        if (cmd === "serena") {
          callCount++;
          return callCount > 1;
        }
        return false;
      };

      const [result] = await installOpenCodeTools(
        "opencode",
        [{ id: "serena", name: "Serena", module: "oraios/serena", required: false, installKind: "python-tool" }],
        () => {},
        async () => ({ exitCode: 0, stdout: "Installed serena", stderr: "" }),
        { commandExists: mockCommandExists },
      );

      expect(result.success).toBe(true);
      expect(result.message).toContain("installed via uv");
    });

    test("fails when uv install succeeds but serena not in PATH", async () => {
      const mockCommandExists = (cmd: string): boolean => {
        return cmd === "python3" || cmd === "uv";
      };

      const [result] = await installOpenCodeTools(
        "opencode",
        [{ id: "serena", name: "Serena", module: "oraios/serena", required: false, installKind: "python-tool" }],
        () => {},
        async () => ({ exitCode: 0, stdout: "Installed serena", stderr: "" }),
        { commandExists: mockCommandExists },
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain("not found in PATH");
    });

    test("skips when neither uv nor pipx exists", async () => {
      const mockCommandExists = (cmd: string): boolean => {
        return cmd === "python3";
      };

      const [result] = await installOpenCodeTools(
        "opencode",
        [{ id: "serena", name: "Serena", module: "oraios/serena", required: false, installKind: "python-tool" }],
        () => {},
        async () => ({ exitCode: 0, stdout: "", stderr: "" }),
        { commandExists: mockCommandExists },
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain("neither");
    });

    test("installs via pipx when uv not available", async () => {
      let callCount = 0;
      const mockCommandExists = (cmd: string): boolean => {
        if (cmd === "python3" || cmd === "pipx") return true;
        if (cmd === "serena") {
          callCount++;
          return callCount > 1;
        }
        return false;
      };

      const [result] = await installOpenCodeTools(
        "opencode",
        [{ id: "serena", name: "Serena", module: "oraios/serena", required: false, installKind: "python-tool" }],
        () => {},
        async () => ({ exitCode: 0, stdout: "Installed serena", stderr: "" }),
        { commandExists: mockCommandExists },
      );

      expect(result.success).toBe(true);
      expect(result.message).toContain("installed via pipx");
    });
  });

  test("returns already-present with no external effect for usable evidence", async () => {
    let effects = 0;
    const [result] = await installOpenCodeTools(
      "opencode",
      [{ id: "codebase-memory", name: "codebase-memory", module: "DeusData/codebase-memory-mcp", required: false, installKind: "shell-script", shellInstallUrl: "https://example.test/install.sh" }],
      () => {},
      async () => { effects++; return successfulCommand(); },
      {
        evidenceContext: evidenceContext(),
        resolveEvidence: () => state("codebase-memory", "usable"),
        downloadScript: async () => { effects++; return "#!/bin/sh\n"; },
        runShellScript: async () => { effects++; return successfulCommand(); },
      },
    );

    expect(result?.outcome).toBe("already-present");
    expect(result?.success).toBe(true);
    expect(result?.installerInvoked).toBe(false);
    expect(effects).toBe(0);
  });

  test("rechecks after download and discards a stale shell script", async () => {
    let checks = 0;
    let downloads = 0;
    let shellRuns = 0;
    const [result] = await installOpenCodeTools(
      "opencode",
      [{ id: "codebase-memory", name: "codebase-memory", module: "DeusData/codebase-memory-mcp", required: false, installKind: "shell-script", shellInstallUrl: "https://example.test/install.sh" }],
      () => {},
      successfulCommand,
      {
        evidenceContext: evidenceContext(),
        resolveEvidence: () => state("codebase-memory", ++checks < 2 ? "absent" : "usable"),
        downloadScript: async () => { downloads++; return "#!/bin/sh\n"; },
        runShellScript: async () => { shellRuns++; return successfulCommand(); },
      },
    );

    expect(result?.outcome).toBe("already-present");
    expect(downloads).toBe(1);
    expect(shellRuns).toBe(0);
  });

  test("keeps a genuine v0.9.0-style failure failed with bounded sanitized diagnostics", async () => {
    const rawStderr = "pgrep: pattern that searches for process name longer than 15 characters will result in zero matches\nerror: failed to copy binary to /home/tester/.local/bin/codebase-memory-mcp (ETXTBSY) token=super-secret\n";
    const [result] = await installOpenCodeTools(
      "opencode",
      [{ id: "codebase-memory", name: "codebase-memory", module: "DeusData/codebase-memory-mcp", required: false, installKind: "shell-script", shellInstallUrl: "https://example.test/install.sh" }],
      () => {},
      successfulCommand,
      {
        evidenceContext: evidenceContext(),
        resolveEvidence: () => state("codebase-memory", "absent"),
        downloadScript: async () => "#!/bin/sh\n",
        runShellScript: async () => ({ exitCode: 1, stdout: "", stderr: rawStderr }),
      },
    );

    expect(result?.outcome).toBe("failed");
    expect(result?.success).toBe(false);
    expect(result?.installerInvoked).toBe(true);
    expect(result?.cause).toContain("ETXTBSY");
    expect(result?.cause).toContain("failed to copy binary");
    expect(result?.cause).not.toContain("super-secret");
    expect(result?.cause).not.toContain("/home/tester");
    expect(Object.keys(result ?? {})).not.toContain("raw");
    expect(JSON.stringify(result)).not.toContain("super-secret");
    expect((result as { raw?: unknown } | undefined)?.raw).toBeDefined();
  });

  test("scopes concurrent installs by project, home, and exact tool ID", async () => {
    let release: (() => void) | undefined;
    let effects = 0;
    let installed = false;
    const waitForRelease = new Promise<void>((resolve) => { release = resolve; });
    const options = {
      evidenceContext: evidenceContext(),
      resolveEvidence: () => state("context-mode", installed ? "usable" : "absent"),
    };
    const runner = async (): Promise<InstallCommandResult> => {
      effects++;
      await waitForRelease;
      installed = true;
      return successfulCommand();
    };
    const plan = [{ id: "context-mode", name: "context-mode", module: "context-mode", required: false, installKind: "npm-package-plus-mcp" }] satisfies InstallableOpenCodeTool[];
    const first = installOpenCodeTools("opencode", plan, () => {}, runner, options);
    const second = installOpenCodeTools("opencode", plan, () => {}, runner, options);
    await Promise.resolve();
    release?.();
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(effects).toBe(1);
    expect(firstResult[0]?.outcome).toBe("executed");
    expect(secondResult[0]?.outcome).toBe("already-present");
  });

  test("cancels before effects and isolates duplicate or failing package IDs", async () => {
    const controller = new AbortController();
    controller.abort();
    let effects = 0;
    const results = await installOpenCodeTools(
      "opencode",
      [
        { id: "context-mode", name: "context-mode", module: "context-mode", required: false, installKind: "npm-package-plus-mcp" },
        { id: "context-mode", name: "context-mode", module: "context-mode", required: false, installKind: "npm-package-plus-mcp" },
        { id: "codebase-memory", name: "codebase-memory", module: "DeusData/codebase-memory-mcp", required: false, installKind: "shell-script", shellInstallUrl: "https://example.test/install.sh" },
      ],
      () => {},
      async () => { effects++; return { exitCode: 1, stdout: "", stderr: "failed" }; },
      { evidenceContext: evidenceContext(), resolveEvidence: () => state("context-mode", "absent"), signal: controller.signal },
    );

    expect(results).toHaveLength(3);
    expect(results[0]?.outcome).toBe("skipped");
    expect(results[1]?.outcome).toBe("skipped");
    expect(results[2]?.outcome).toBe("skipped");
    expect(effects).toBe(0);
  });

  test("marks a later duplicate ID as an integrity failure without a second effect", async () => {
    let effects = 0;
    const results = await installOpenCodeTools(
      "opencode",
      [
        { id: "context-mode", name: "context-mode", module: "context-mode", required: false, installKind: "npm-package-plus-mcp" },
        { id: "context-mode", name: "context-mode", module: "context-mode", required: false, installKind: "npm-package-plus-mcp" },
      ],
      () => {},
      async () => { effects++; return { exitCode: 1, stdout: "", stderr: "first failure" }; },
      { evidenceContext: evidenceContext(), resolveEvidence: (toolId) => state(toolId, toolId === "serena" ? "usable" : "absent") },
    );

    expect(results.map((result) => result.outcome)).toEqual(["failed", "failed"]);
    expect(results[1]?.cause).toContain("Duplicate tool ID");
    expect(results[1]?.installerInvoked).toBe(false);
    expect(effects).toBe(1);
  });

  test("continues with unrelated packages after one package fails", async () => {
    const calls: string[] = [];
    let serenaChecks = 0;
    const results = await installOpenCodeTools(
      "opencode",
      [
        { id: "context-mode", name: "context-mode", module: "context-mode", required: false, installKind: "npm-package-plus-mcp" },
        { id: "serena", name: "Serena", module: "oraios/serena", required: false, installKind: "npm-package" },
      ],
      () => {},
      async (command) => {
        calls.push(command);
        return command === "npm" && calls.length === 1
          ? { exitCode: 1, stdout: "", stderr: "first package failed" }
          : successfulCommand();
      },
      { evidenceContext: evidenceContext(), resolveEvidence: (toolId) => state(toolId, toolId === "serena" && ++serenaChecks > 1 ? "usable" : "absent") },
    );

    expect(results.map((result) => result.outcome)).toEqual(["failed", "executed"]);
    expect(calls).toEqual(["npm", "npm"]);
  });

  test("bounds raw captures and adversarial sanitized diagnostics", async () => {
    const ansi = "\u001b[2K\u001b[31m";
    const stderr = `${"progress ".repeat(10_000)}\n${ansi}ERROR token=secret-value /home/tester/private.txt https://example.test/?token=url-secret\n`;
    const [result] = await installOpenCodeTools(
      "opencode",
      [{ id: "codebase-memory", name: "codebase-memory", module: "DeusData/codebase-memory-mcp", required: false, installKind: "shell-script", shellInstallUrl: "https://example.test/install.sh" }],
      () => {},
      successfulCommand,
      {
        evidenceContext: evidenceContext(),
        resolveEvidence: () => state("codebase-memory", "absent"),
        downloadScript: async () => "#!/bin/sh\n",
        runShellScript: async () => ({ exitCode: 1, stdout: "", stderr }),
      },
    );

    const raw = (result as { raw?: { stdout: string; stderr: string; stderrTruncated: boolean } }).raw;
    expect(raw?.stderrTruncated).toBe(true);
    expect(Buffer.byteLength(raw?.stderr ?? "", "utf8")).toBeLessThanOrEqual(65_536);
    expect(result?.diagnostic?.lines.length).toBeLessThanOrEqual(6);
    expect(result?.diagnostic?.lines.every((line) => [...line].length <= 240)).toBe(true);
    expect(Buffer.byteLength(result?.cause ?? "", "utf8")).toBeLessThanOrEqual(320);
    expect(result?.cause).not.toContain("secret-value");
    expect(result?.cause).not.toContain("url-secret");
    expect(result?.cause).not.toContain("/home/tester");
    expect(result?.cause).not.toContain("\u001b");
  });

  test("rejects an oversized downloaded script before shell execution", async () => {
    let shellRuns = 0;
    const [result] = await installOpenCodeTools(
      "opencode",
      [{ id: "codebase-memory", name: "codebase-memory", module: "DeusData/codebase-memory-mcp", required: false, installKind: "shell-script", shellInstallUrl: "https://example.test/install.sh" }],
      () => {},
      successfulCommand,
      {
        evidenceContext: evidenceContext(),
        resolveEvidence: () => state("codebase-memory", "absent"),
        downloadScript: async () => "x".repeat(1024 * 1024 + 1),
        runShellScript: async () => { shellRuns++; return successfulCommand(); },
      },
    );

    expect(result?.outcome).toBe("failed");
    expect(result?.diagnostic?.stage).toBe("download");
    expect(result?.installerInvoked).toBe(false);
    expect(shellRuns).toBe(0);
  });

  test("cooperatively cancels during download without starting the shell", async () => {
    const controller = new AbortController();
    let finishDownload!: (script: string) => void;
    let shellRuns = 0;
    const download = new Promise<string>((resolve) => { finishDownload = resolve; });
    const pending = installOpenCodeTools(
      "opencode",
      [{ id: "codebase-memory", name: "codebase-memory", module: "DeusData/codebase-memory-mcp", required: false, installKind: "shell-script", shellInstallUrl: "https://example.test/install.sh" }],
      () => {},
      successfulCommand,
      {
        signal: controller.signal,
        evidenceContext: evidenceContext(),
        resolveEvidence: () => state("codebase-memory", "absent"),
        downloadScript: async () => download,
        runShellScript: async () => { shellRuns++; return successfulCommand(); },
      },
    );
    controller.abort();
    finishDownload("#!/bin/sh\n");
    const [result] = await pending;

    expect(result?.outcome).toBe("skipped");
    expect(result?.installerInvoked).toBe(false);
    expect(shellRuns).toBe(0);
  });
});
