import { describe, expect, test } from "bun:test";

import { inspectOpenCodeEnvironment } from "./preflight";

describe("inspectOpenCodeEnvironment", () => {
  test("detects OpenCode version and config package manifest", () => {
    const result = inspectOpenCodeEnvironment({
      command: "opencode",
      homeDirectory: "/home/tester",
      runCommand: () => ({ exitCode: 0, stdout: "1.14.48\n" }),
      pathExists: (path) => path === "/home/tester/.config/opencode" || path === "/home/tester/.config/opencode/package.json",
    });

    expect(result).toEqual({
      version: "1.14.48",
      configDirectory: "/home/tester/.config/opencode",
      packageManifest: "/home/tester/.config/opencode/package.json",
      existingConfiguration: true,
    });
  });

  test("reports unknown version when OpenCode version command fails", () => {
    const result = inspectOpenCodeEnvironment({
      command: "opencode",
      homeDirectory: "/home/tester",
      runCommand: () => ({ exitCode: 1, stdout: "", stderr: "failed" }),
      pathExists: () => false,
    });

    expect(result.version).toBe("unknown");
    expect(result.existingConfiguration).toBe(false);
  });
});
