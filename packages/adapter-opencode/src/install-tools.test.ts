import { describe, expect, test } from "bun:test";

import { installOpenCodeTools } from "./install-tools";
import type { InstallableOpenCodeTool } from "./installation-plan";

const plan: InstallableOpenCodeTool[] = [
  { id: "context-mode", name: "context-mode", module: "context-mode", required: false, installKind: "opencode-plugin" },
];

describe("installOpenCodeTools", () => {
  test("runs opencode plugin install globally for selected tools", async () => {
    const calls: string[][] = [];
    const results = await installOpenCodeTools(
      "opencode",
      plan,
      () => {},
      async (command, args) => {
        calls.push([command, ...args]);
        return { exitCode: 0, stdout: "ok", stderr: "" };
      },
    );

    expect(calls).toEqual([["opencode", "plugin", "context-mode", "--global"]]);
    expect(results).toEqual([{ tool: "context-mode", success: true, message: undefined }]);
  });

  test("returns a failure result instead of throwing when plugin install fails", async () => {
    const [result] = await installOpenCodeTools(
      "opencode",
      plan,
      () => {},
      async () => ({ exitCode: 1, stdout: "", stderr: "failed" }),
    );

    expect(result).toEqual({ tool: "context-mode", success: false, message: "failed" });
  });

  test("does not run opencode plugin for external RTK", async () => {
    const calls: string[][] = [];
    const [result] = await installOpenCodeTools(
      "opencode",
      [{ id: "rtk", name: "RTK", module: "rtk-ai/rtk", required: false, installKind: "external" }],
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
