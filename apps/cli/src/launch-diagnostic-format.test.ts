import { describe, expect, test } from "bun:test";
import { formatLaunchDiagnostic, shouldColorStderr } from "./launch-diagnostic-format";

const YELLOW = "\u001b[33m";
const RED = "\u001b[31m";
const RESET = "\u001b[0m";

describe("launch diagnostic presentation", () => {
  const warning = {
    code: "claude-static-compatible",
    severity: "warning" as const,
    message: "Pinned official Supermemory plugin owns recall/capture; Deck only supplies the selected process-local profile and verified scope. Co-loaded user plugins may see the process credential; protected execution remains unsupported.",
  };

  test("renders the static-compatible warning in yellow with unchanged text", () => {
    expect(formatLaunchDiagnostic(warning, true)).toBe(`${YELLOW}[claude-static-compatible] ${warning.message}${RESET}`);
  });

  test("renders errors in red", () => {
    const error = { code: "claude-memory-handoff-unverified", severity: "error" as const, message: "blocked" };
    expect(formatLaunchDiagnostic(error, true)).toBe(`${RED}[claude-memory-handoff-unverified] blocked${RESET}`);
  });

  test("emits plain text when color is disabled or severity is informational", () => {
    expect(formatLaunchDiagnostic(warning, false)).toBe(`[claude-static-compatible] ${warning.message}`);
    expect(formatLaunchDiagnostic({ code: "x", severity: "info", message: "m" }, true)).toBe("[x] m");
  });

  test("honors NO_COLOR, FORCE_COLOR and TTY", () => {
    expect(shouldColorStderr({ NO_COLOR: "1", FORCE_COLOR: "1" }, true)).toBe(false);
    expect(shouldColorStderr({ FORCE_COLOR: "1" }, false)).toBe(true);
    expect(shouldColorStderr({}, true)).toBe(true);
    expect(shouldColorStderr({}, false)).toBe(false);
    expect(shouldColorStderr({ TERM: "dumb" }, true)).toBe(false);
    expect(shouldColorStderr({ FORCE_COLOR: "0" }, true)).toBe(false);
    expect(shouldColorStderr({ FORCE_COLOR: "false" }, true)).toBe(false);
    expect(shouldColorStderr({ FORCE_COLOR: "" }, false)).toBe(false);
    expect(shouldColorStderr({ NO_COLOR: "" }, true)).toBe(true);
  });
});
