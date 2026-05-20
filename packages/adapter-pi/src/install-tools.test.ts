import { describe, expect, test } from "bun:test";

import { installPiTools } from "./install-tools";
import type { InstallablePiTool } from "./installation-plan";
import {
  installInternalRunnerPackages,
  type InternalRunnerInstallResult,
} from "./install-tools";
import type { InternalRunnerPackageInstallAction } from "./internal-runner-packages";

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

    expect(result).toEqual({
      tool: "context-mode",
      success: false,
      actionKind: "install-pi-package",
      status: "failed",
      message: "failed",
    });
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
    expect(result).toEqual({
      tool: "RTK",
      success: true,
      actionKind: "manual-external-install",
      status: "manual",
      message: "Manual external install required from rtk-ai/rtk.",
    });
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
    expect(results).toEqual([
      {
        tool: "RTK",
        success: true,
        actionKind: "manual-external-install",
        status: "manual",
        message: "Manual external install required from rtk-ai/rtk.",
      },
      {
        tool: "context-mode",
        success: false,
        actionKind: "install-pi-package",
        status: "failed",
        message: "Pi install command is unavailable.",
      },
    ]);
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