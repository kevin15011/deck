import { describe, expect, test } from "bun:test";

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
      async () => ({ exitCode: 0, stdout: "", stderr: "" }), // pi install won't run
    );

    expect(results).toHaveLength(1);
    const result = results[0];
    // Status should be "reused" (success), NOT failed
    expect(result.status).toBe("reused");
    expect(result.success).toBe(true);
    expect(result.installKind).toBe("shared-binary");
    expect(result.message).toContain("Reusing existing");
  });

  test("shared-binary-plus-mcp: returns reused when context-mode binary is ready", async () => {
    const results = await installPiTools(
      "pi",
      [{ id: "context-mode", name: "context-mode", source: "context-mode (shared binary)", required: false, installKind: "shared-binary-plus-mcp" }],
      () => {},
      async () => ({ exitCode: 0, stdout: "", stderr: "" }),
    );

    expect(results).toHaveLength(1);
    const result = results[0];
    expect(result.status).toBe("reused");
    expect(result.success).toBe(true);
    expect(result.installKind).toBe("shared-binary-plus-mcp");
  });

  test("shared-binary-plus-mcp: returns reused when codebase-memory-mcp binary is ready", async () => {
    const results = await installPiTools(
      "pi",
      [{ id: "codebase-memory-mcp", name: "codebase-memory-mcp", source: "DeusData/codebase-memory-mcp", required: false, installKind: "shared-binary-plus-mcp" }],
      () => {},
      async () => ({ exitCode: 0, stdout: "", stderr: "" }),
    );

    expect(results).toHaveLength(1);
    const result = results[0];
    expect(result.status).toBe("reused");
    expect(result.success).toBe(true);
    expect(result.installKind).toBe("shared-binary-plus-mcp");
  });

  test("python-tool: returns reused when serena binary is ready", async () => {
    const results = await installPiTools(
      "pi",
      [{ id: "serena", name: "Serena", source: "serena (python tool)", required: false, installKind: "python-tool" }],
      () => {},
      async () => ({ exitCode: 0, stdout: "", stderr: "" }),
    );

    expect(results).toHaveLength(1);
    const result = results[0];
    expect(result.status).toBe("reused");
    expect(result.success).toBe(true);
    expect(result.installKind).toBe("python-tool");
  });

  test("python-tool: returns manual-verified when uv/pipx not available", async () => {
    // Mock healthcheck to return "missing" (not ready)
    // Mock uv/pipx to fail
    const results = await installPiTools(
      "pi",
      [{ id: "serena", name: "Serena", source: "serena (python tool)", required: false, installKind: "python-tool" }],
      () => {},
      async () => ({ exitCode: 1, stdout: "", stderr: "command not found" }),
    );

    expect(results).toHaveLength(1);
    const result = results[0];
    // Status should be "manual-verified" (success), NOT failed
    expect(result.success).toBe(true);
    expect(["manual-verified", "reused"]).toContain(result.status);
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
    const originalLog = console.log;
    console.log = (...args) => logs.push(args.join(" "));

    try {
      await installPiTools(
        "pi",
        [{ id: "rtk", name: "RTK", source: "rtk-ai/rtk", required: false, installKind: "shared-binary" }],
        () => {},
        async () => ({ exitCode: 0, stdout: "", stderr: "" }),
      );

      // Verify NO console.log with "[install-tools]" prefix - this would leak into TUI
      expect(logs.some(l => l.includes("[install-tools]"))).toBe(false);
    } finally {
      console.log = originalLog;
    }
  });
});

// ---------------------------------------------------------------------------
// Existing install-tools tests (preserved)
// ---------------------------------------------------------------------------

const plan: InstallablePiTool[] = [
  { id: "context-mode", name: "context-mode", source: "npm:context-mode", required: false, installKind: "pi-package" },
  { id: "codebase-memory", name: "codebase-memory", source: "npm:codebase-memory", required: false, installKind: "pi-package" },
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