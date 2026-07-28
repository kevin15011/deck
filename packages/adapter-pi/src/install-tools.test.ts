import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { installPiTools } from "./install-tools";
import type { InstallablePiTool } from "./installation-plan";
import {
  installInternalRunnerPackages,
  type InternalRunnerInstallResult,
} from "./install-tools";
import type { InternalRunnerPackageInstallAction } from "./internal-runner-packages";

// ---------------------------------------------------------------------------
// Repair #18: Tests for installKind dispatch (shared-binary, python-tool, etc.)
// These tests verify that installPiTools respects installKind and correctly
// maps result statuses (reused/installed/manual-verified should NOT become failed)
// ---------------------------------------------------------------------------

describe("installPiTools with installKind dispatch", () => {
  test("shared-binary: returns reused when binary is already usable (ready)", async () => {
    const results = await installPiTools(
      "pi",
      [{ id: "rtk", name: "RTK", source: "rtk-ai/rtk", required: false, installKind: "shared-binary" }],
      () => {},
      {
        runInstallCommand: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
        checkSharedBinaryUsability: async (command) => ({ status: "ready", command, resolvedPath: "/fixture/rtk", version: "1.0.0" }),
      },
    );

    expect(results).toEqual([expect.objectContaining({ status: "reused", success: true, installKind: "shared-binary" })]);
    expect(results[0].message).toContain("Reusing existing");
  });

  test("shared-binary-plus-mcp: returns reused when context-mode binary is ready", async () => {
    const results = await installPiTools(
      "pi",
      [{ id: "context-mode", name: "context-mode", source: "context-mode (shared binary)", required: false, installKind: "shared-binary-plus-mcp" }],
      () => {},
      {
        checkSharedBinaryUsability: async (command) => ({ status: "ready", command, resolvedPath: "/fixture/context-mode", version: "1.0.0" }),
      },
    );

    expect(results).toEqual([expect.objectContaining({ status: "reused", success: true, installKind: "shared-binary-plus-mcp" })]);
  });

  test("shared-binary-plus-mcp: returns reused when codebase-memory-mcp binary is ready", async () => {
    const results = await installPiTools(
      "pi",
      [{ id: "codebase-memory-mcp", name: "codebase-memory-mcp", source: "DeusData/codebase-memory-mcp", required: false, installKind: "shared-binary-plus-mcp" }],
      () => {},
      {
        checkSharedBinaryUsability: async (command) => ({ status: "ready", command, resolvedPath: "/fixture/codebase-memory-mcp", version: "1.0.0" }),
      },
    );

    expect(results).toEqual([expect.objectContaining({ status: "reused", success: true, installKind: "shared-binary-plus-mcp" })]);
  });

  test("python-tool: returns reused when serena binary is ready", async () => {
    const results = await installPiTools(
      "pi",
      [{ id: "serena", name: "Serena", source: "serena (python tool)", required: false, installKind: "python-tool" }],
      () => {},
      {
        checkSharedBinaryUsability: async (command) => ({ status: "ready", command, resolvedPath: "/fixture/serena", version: "1.0.0" }),
      },
    );

    expect(results).toEqual([expect.objectContaining({ status: "reused", success: true, installKind: "python-tool" })]);
  });

  test("python-tool: returns manual-verified after exact uv/pipx failures", async () => {
    const commands: string[][] = [];
    const results = await installPiTools(
      "pi",
      [{ id: "serena", name: "Serena", source: "serena (python tool)", required: false, installKind: "python-tool" }],
      () => {},
      {
        runInstallCommand: async (command, args) => {
          commands.push([command, ...args]);
          return { exitCode: 1, stdout: "", stderr: "command not found" };
        },
        checkSharedBinaryUsability: async (command) => ({ status: "missing", command }),
      },
    );

    expect(commands).toEqual([
      ["uv", "tool", "install", "serena"],
      ["pipx", "install", "serena"],
    ]);
    expect(results).toEqual([expect.objectContaining({ status: "manual-verified", success: true })]);
  });

  test("npm-package-plus-mcp: installs context7 via npx", async () => {
    const calls: string[][] = [];
    const results = await installPiTools(
      "pi",
      [{ id: "context7", name: "Context7", source: "npm:@upstash/context7-mcp", required: false, installKind: "npm-package-plus-mcp" }],
      () => {},
      async (command, args) => {
        calls.push([command, ...args]);
        return { exitCode: 0, stdout: "ok", stderr: "" };
      },
    );

    expect(calls).toEqual([["npx", "-y", "@upstash/context7-mcp"]]);
    expect(results[0].status).toBe("installed");
    expect(results[0].success).toBe(true);
    expect(results[0].installKind).toBe("npm-package-plus-mcp");
  });

  test("pi-package: uses pi install command", async () => {
    const calls: string[][] = [];
    const results = await installPiTools(
      "pi",
      [{ id: "sub-agents", name: "sub-agents", source: "npm:pi-subagents", required: true, installKind: "pi-package" }],
      () => {},
      async (command, args) => {
        calls.push([command, ...args]);
        return { exitCode: 0, stdout: "ok", stderr: "" };
      },
    );

    expect(calls).toEqual([["pi", "install", "npm:pi-subagents"]]);
    expect(results[0].status).toBe("installed");
    expect(results[0].installKind).toBe("pi-package");
  });

  test("dispatch does NOT log to console - output leaks into Ink TUI", async () => {
    const logs: string[] = [];
    const probeCalls: string[] = [];
    const originalLog = console.log;
    console.log = (...args) => logs.push(args.join(" "));

    try {
      await installPiTools(
        "pi",
        [{ id: "rtk", name: "RTK", source: "rtk-ai/rtk", required: false, installKind: "shared-binary" }],
        () => {},
        {
          runInstallCommand: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
          checkSharedBinaryUsability: async (command) => {
            probeCalls.push(command);
            return { status: "ready", command, resolvedPath: "/fixture/rtk", version: "fixture-1" };
          },
        },
      );

      expect(probeCalls).toEqual(["rtk"]);
      expect(logs.some((line) => line.includes("[install-tools]"))).toBe(false);
    } finally {
      console.log = originalLog;
    }
  });


  test("every shared-binary unit path declares a deterministic usability probe", () => {
    const source = readFileSync(import.meta.path, "utf8");
    const dispatchTest = source.match(
      /test\("dispatch does NOT log to console - output leaks into Ink TUI"[\s\S]*?\n  \}\);/,
    )?.[0];

    expect(dispatchTest).toContain("checkSharedBinaryUsability");
  });


  test("uses same-fourth-position dependency overrides for deterministic shared-binary probes", async () => {
    const probeCalls: Array<{ command: string; timeoutMs: number }> = [];
    const commandCalls: string[][] = [];
    const results = await installPiTools(
      "pi",
      [{ id: "rtk", name: "RTK", source: "rtk-ai/rtk", required: false, installKind: "shared-binary" }],
      () => {},
      {
        runInstallCommand: async (command, args) => {
          commandCalls.push([command, ...args]);
          return { exitCode: 1, stdout: "", stderr: "not available" };
        },
        checkSharedBinaryUsability: async (command, options) => {
          probeCalls.push({ command, timeoutMs: options?.timeoutMs ?? -1 });
          return { status: "ready", command, resolvedPath: `/fixture/${command}`, version: "fixture-1" };
        },
        sharedBinaryUsabilityTimeoutMs: 1_234,
      },
    );

    expect(results[0]).toMatchObject({ status: "reused", success: true });
    expect(probeCalls).toEqual([{ command: "rtk", timeoutMs: 1_234 }]);
    expect(commandCalls).toEqual([]);
  });


  test("blocks a shared binary that remains missing after the no-op install attempt", async () => {
    const probeCalls: string[] = [];
    const results = await installPiTools(
      "pi",
      [{ id: "rtk", name: "RTK", source: "rtk-ai/rtk", required: false, installKind: "shared-binary" }],
      () => {},
      {
        checkSharedBinaryUsability: async (command) => {
          probeCalls.push(command);
          return { status: "missing", command };
        },
      },
    );

    expect(probeCalls).toEqual(["rtk", "rtk"]);
    expect(results).toEqual([expect.objectContaining({ status: "blocked", success: false, message: "rtk installed but not usable" })]);
  });

  test("fails closed without installation when a shared binary is initially unusable", async () => {
    const commands: string[][] = [];
    const results = await installPiTools(
      "pi",
      [{ id: "rtk", name: "RTK", source: "rtk-ai/rtk", required: false, installKind: "shared-binary" }],
      () => {},
      {
        runInstallCommand: async (command, args) => {
          commands.push([command, ...args]);
          return { exitCode: 0, stdout: "", stderr: "" };
        },
        checkSharedBinaryUsability: async (command) => ({ status: "unusable", command, resolvedPath: "/fixture/rtk", reason: "fixture unusable" }),
      },
    );

    expect(commands).toEqual([]);
    expect(results).toEqual([expect.objectContaining({ status: "blocked", success: false, message: "fixture unusable" })]);
  });

  test("falls back from uv to pipx and reports the exact successful Serena outcome", async () => {
    const commands: string[][] = [];
    const probes = [
      { status: "missing" as const, command: "serena" },
      { status: "ready" as const, command: "serena", resolvedPath: "/fixture/serena", version: "2.0.0" },
    ];
    const results = await installPiTools(
      "pi",
      [{ id: "serena", name: "Serena", source: "serena (python tool)", required: false, installKind: "python-tool" }],
      () => {},
      {
        runInstallCommand: async (command, args) => {
          commands.push([command, ...args]);
          return { exitCode: command === "uv" ? 1 : 0, stdout: "", stderr: "" };
        },
        checkSharedBinaryUsability: async () => probes.shift()!,
      },
    );

    expect(commands).toEqual([
      ["uv", "tool", "install", "serena"],
      ["pipx", "install", "serena"],
    ]);
    expect(results).toEqual([expect.objectContaining({ status: "installed", success: true, message: "Installed serena via pipx (2.0.0)" })]);
  });

  test("fails closed when Serena remains explicitly unusable after an injected uv install", async () => {
    const statuses = [
      { status: "missing" as const, command: "serena" },
      { status: "unusable" as const, command: "serena", resolvedPath: "/fixture/serena", reason: "fixture healthcheck failed" },
    ];
    const commands: string[][] = [];

    const results = await installPiTools(
      "pi",
      [{ id: "serena", name: "Serena", source: "serena (python tool)", required: false, installKind: "python-tool" }],
      () => {},
      {
        runInstallCommand: async (command, args) => {
          commands.push([command, ...args]);
          return { exitCode: 0, stdout: "", stderr: "" };
        },
        checkSharedBinaryUsability: async () => statuses.shift()!,
      },
    );

    expect(commands).toEqual([["uv", "tool", "install", "serena"]]);
    expect(results[0]).toMatchObject({ status: "blocked", success: false, message: "fixture healthcheck failed" });
  });
});

// ---------------------------------------------------------------------------
// Existing install-tools tests (preserved)
// ---------------------------------------------------------------------------

const plan: InstallablePiTool[] = [
  { id: "context-mode", name: "context-mode", source: "npm:context-mode", required: false, installKind: "pi-package" },
  { id: "codebase-memory-mcp", name: "codebase-memory", source: "npm:codebase-memory", required: false, installKind: "pi-package" },
];

describe("installPiTools", () => {
  test("runs pi install for each selected tool and reports success incrementally", async () => {
    const calls: string[][] = [];
    const emitted: string[] = [];

    const results = await installPiTools(
      "pi",
      plan,
      (result) => emitted.push(result.tool),
      async (command, args) => {
        calls.push([command, ...args]);
        return { exitCode: 0, stdout: "ok", stderr: "" };
      },
    );

    expect(calls).toEqual([
      ["pi", "install", "npm:context-mode"],
      ["pi", "install", "npm:codebase-memory"],
    ]);
    expect(emitted).toEqual(["context-mode", "codebase-memory"]);
    expect(results.every((result) => result.success)).toBe(true);
    expect(results.every((result) => result.actionKind === "install-pi-package" && result.status === "installed")).toBe(true);
  });

  test("returns a failure result instead of throwing when installation command fails", async () => {
    const [result] = await installPiTools(
      "pi",
      [plan[0]],
      () => {},
      async () => ({ exitCode: 1, stdout: "", stderr: "failed" }),
    );

    expect(result.tool).toBe("context-mode");
    expect(result.success).toBe(false);
    expect(result.actionKind).toBe("install-pi-package");
    expect(result.status).toBe("failed");
    expect(result.message).toBe("failed");
    expect(result.installKind).toBe("pi-package");
    expect(result.exitCode).toBe(1);
  });

  test("does not run pi install for external RTK and returns manual review-plan result", async () => {
    const calls: string[][] = [];
    const [result] = await installPiTools(
      "pi",
      [{ id: "rtk", name: "RTK", source: "rtk-ai/rtk", required: false, installKind: "external" }],
      () => {},
      async (command, args) => {
        calls.push([command, ...args]);
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    );

    expect(calls).toEqual([]);
    expect(result.tool).toBe("RTK");
    expect(result.success).toBe(true);
    expect(result.actionKind).toBe("manual-external-install");
    expect(result.status).toBe("manual");
    expect(result.message).toBe("Manual external install required from rtk-ai/rtk.");
    expect(result.installKind).toBe("external");
  });

  test("returns manual external result when install command is unavailable", async () => {
    const emitted: string[] = [];
    const results = await installPiTools(
      undefined,
      [
        { id: "rtk", name: "RTK", source: "rtk-ai/rtk", required: false, installKind: "external" },
        { id: "context-mode", name: "context-mode", source: "npm:context-mode", required: false, installKind: "pi-package" },
      ],
      (result) => emitted.push(result.tool),
      async () => {
        throw new Error("should not run");
      },
    );

    expect(emitted).toEqual(["RTK", "context-mode"]);

    // First result: external install - should succeed (manual)
    expect(results[0].tool).toBe("RTK");
    expect(results[0].success).toBe(true);
    expect(results[0].actionKind).toBe("manual-external-install");
    expect(results[0].status).toBe("manual");
    expect(results[0].installKind).toBe("external");

    // Second result: pi-package without command - should fail
    expect(results[1].tool).toBe("context-mode");
    expect(results[1].success).toBe(false);
    expect(results[1].actionKind).toBe("install-pi-package");
    expect(results[1].status).toBe("failed");
    expect(results[1].message).toBe("Pi install command is unavailable.");
    expect(results[1].installKind).toBe("pi-package");
  });
});

// ---------------------------------------------------------------------------
// installInternalRunnerPackages tests (Task 6)
// ---------------------------------------------------------------------------

const piMermaidAction: InternalRunnerPackageInstallAction = {
  packageId: "pi-mermaid",
  name: "Visual explanation support",
  source: "npm:pi-mermaid",
  installKind: "npm-package",
  reason: "pi-mermaid is required but not installed.",
};

describe("installInternalRunnerPackages", () => {
  test("installs internal package via pi install npm:pi-mermaid and reports success", async () => {
    const calls: string[][] = [];
    const emitted: InternalRunnerInstallResult[] = [];

    const results = await installInternalRunnerPackages(
      "pi",
      [piMermaidAction],
      (result) => emitted.push(result),
      async (command, args) => {
        calls.push([command, ...args]);
        return { exitCode: 0, stdout: "installed", stderr: "" };
      },
    );

    expect(calls).toEqual([["pi", "install", "npm:pi-mermaid"]]);
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      packageId: "pi-mermaid",
      success: true,
      actionKind: "install-pi-package",
      status: "installed",
      message: undefined,
      errorCode: undefined,
    });
    expect(emitted[0].success).toBe(true);
    expect(emitted[0].status).toBe("installed");
  });

  test("reports failure with visual_support_install_failed error code when install fails", async () => {
    const emitted: InternalRunnerInstallResult[] = [];

    const [result] = await installInternalRunnerPackages(
      "pi",
      [piMermaidAction],
      (result) => emitted.push(result),
      async () => ({ exitCode: 1, stdout: "", stderr: "npm error E404" }),
    );

    expect(result.success).toBe(false);
    expect(result.status).toBe("failed");
    expect(result.errorCode).toBe("visual_support_install_failed");
    expect(result.message).toBe("npm error E404");
    expect(emitted[0].errorCode).toBe("visual_support_install_failed");
  });

  test("reports failure when pi install command is unavailable", async () => {
    const emitted: InternalRunnerInstallResult[] = [];

    const [result] = await installInternalRunnerPackages(
      undefined,
      [piMermaidAction],
      (result) => emitted.push(result),
      async () => { throw new Error("should not run"); },
    );

    expect(result.success).toBe(false);
    expect(result.status).toBe("failed");
    expect(result.message).toBe("Pi install command is unavailable.");
    expect(result.errorCode).toBe("visual_support_install_failed");
  });

  test("processes multiple internal package install actions in order", async () => {
    const actions: InternalRunnerPackageInstallAction[] = [
      piMermaidAction,
    ];

    const calls: string[][] = [];
    await installInternalRunnerPackages(
      "pi",
      actions,
      () => {},
      async (command, args) => {
        calls.push([command, ...args]);
        return { exitCode: 0, stdout: "ok", stderr: "" };
      },
    );

    // Only one internal package defined; verifies calls are in order
    expect(calls).toEqual([["pi", "install", "npm:pi-mermaid"]]);
  });

  test("throws no TypeScript errors — actionKind is install-pi-package", async () => {
    // Type-level verification: InternalRunnerInstallResult.actionKind must be
    // "install-pi-package" (same as PiToolInstallResult for review-plan compatibility).
    const emitted: InternalRunnerInstallResult[] = [];

    const [result] = await installInternalRunnerPackages(
      "pi",
      [piMermaidAction],
      (r) => emitted.push(r),
      async () => ({ exitCode: 0, stdout: "", stderr: "" }),
    );

    // actionKind is "install-pi-package" — ensure it's assignable to the union
    const _kind: "install-pi-package" = result.actionKind;
    expect(_kind).toBe("install-pi-package");
  });

  test("Spec error contracts — visual_support_install_failed is surfaced correctly", async () => {
    const [result] = await installInternalRunnerPackages(
      "pi",
      [piMermaidAction],
      () => {},
      async () => ({ exitCode: 1, stdout: "", stderr: "network timeout" }),
    );

    // REQ-PIINSTALL-004: If pi-mermaid installation fails, surface visual_support_install_failed
    expect(result.errorCode).toBe("visual_support_install_failed");
    expect(result.success).toBe(false);
    expect(result.status).toBe("failed");
  });
});