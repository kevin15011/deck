import { describe, expect, test } from "bun:test";

import { detectSelectedRuntimes } from "./runtime-detection";

describe("detectSelectedRuntimes", () => {
  test("detects Pi, OpenCode, Claude, and Codex commands independently", () => {
    const result = detectSelectedRuntimes(["pi-development", "opencode-development", "claude-development", "codex-development"], {
      commandExists: (command) => command === "pi" || command === "opencode" || command === "claude",
    });

    expect(result).toEqual([
      { environment: "Pi Development Environment", runtime: "pi", installed: true, command: "pi" },
      { environment: "OpenCode Development Environment", runtime: "opencode", installed: true, command: "opencode" },
      { environment: "Claude Development Environment", runtime: "claude", installed: true, command: "claude" },
      { environment: "Codex Development Environment", runtime: "codex", installed: false },
    ]);
  });

  test("keeps installed environments eligible when another selected runtime is missing", () => {
    const result = detectSelectedRuntimes(["pi-development", "claude-development"], {
      commandExists: (command) => command === "claude",
    });

    expect(result.filter((status) => status.installed).map((status) => status.runtime)).toEqual(["claude"]);
    expect(result.filter((status) => !status.installed).map((status) => status.runtime)).toEqual(["pi"]);
  });
});
