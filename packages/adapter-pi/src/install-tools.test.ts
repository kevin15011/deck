import { describe, expect, test } from "bun:test";

import { installPiTools } from "./install-tools";
import type { InstallablePiTool } from "./installation-plan";

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
  });

  test("returns a failure result instead of throwing when installation command fails", async () => {
    const [result] = await installPiTools(
      "pi",
      [plan[0]],
      () => {},
      async () => ({ exitCode: 1, stdout: "", stderr: "failed" }),
    );

    expect(result).toEqual({ tool: "context-mode", success: false, message: "failed" });
  });

  test("does not run pi install for external RTK", async () => {
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
    expect(result).toEqual({ tool: "RTK", success: false, message: "Manual install required from rtk-ai/rtk." });
  });
});
