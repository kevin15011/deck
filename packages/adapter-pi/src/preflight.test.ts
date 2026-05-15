import { describe, expect, test } from "bun:test";

import { inspectPiEnvironment } from "./preflight";

describe("inspectPiEnvironment", () => {
  test("reads Pi version from stderr and detects the Pi agent config directory", () => {
    const result = inspectPiEnvironment({
      command: "pi",
      homeDirectory: "/home/tester",
      runCommand: () => ({ exitCode: 0, stdout: "", stderr: "0.74.0\n" }),
      pathExists: (path) => path === "/home/tester/.pi/agent",
    });

    expect(result).toEqual({
      version: "0.74.0",
      configDirectory: "/home/tester/.pi/agent",
      existingConfiguration: true,
    });
  });
});
