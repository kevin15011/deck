import { describe, expect, test } from "bun:test";

import { parseArgs, type ParsedArgs } from "./cli-args";

describe("parseArgs", () => {
  test("returns TUI mode when no args are provided", () => {
    const result = parseArgs([]);
    expect(result).toEqual({ command: "tui" });
  });

  test("returns TUI mode for unknown top-level commands", () => {
    const result = parseArgs(["unknown"]);
    expect(result).toEqual({ command: "tui" });
  });

  test("parses 'deck pi developer' as pi-launch for developer-team", () => {
    const result = parseArgs(["pi", "developer"]);
    expect(result).toEqual<ParsedArgs>({
      command: "pi-launch",
      teamId: "developer-team",
      flags: {},
    });
  });

  test("parses 'deck pi developer --continue' with continue flag", () => {
    const result = parseArgs(["pi", "developer", "--continue"]);
    expect(result).toEqual<ParsedArgs>({
      command: "pi-launch",
      teamId: "developer-team",
      flags: { continue: true },
    });
  });

  test("parses --continue=true explicitly", () => {
    const result = parseArgs(["pi", "developer", "--continue=true"]);
    expect(result).toEqual<ParsedArgs>({
      command: "pi-launch",
      teamId: "developer-team",
      flags: { continue: true },
    });
  });

  test("parses --continue=false as no continue", () => {
    const result = parseArgs(["pi", "developer", "--continue=false"]);
    expect(result).toEqual<ParsedArgs>({
      command: "pi-launch",
      teamId: "developer-team",
      flags: {},
    });
  });

  test("returns error for unknown team under 'deck pi'", () => {
    const result = parseArgs(["pi", "unknown-team"]);
    expect(result).toEqual<ParsedArgs>({
      command: "error",
      message: "Unknown Pi team: unknown-team. Available teams: developer",
    });
  });

  test("returns error when 'deck pi' is called without a team", () => {
    const result = parseArgs(["pi"]);
    expect(result).toEqual<ParsedArgs>({
      command: "error",
      message: expect.stringContaining("Usage"),
    });
  });

  test("parses --resume as distinct resume flag (not continue)", () => {
    const result = parseArgs(["pi", "developer", "--resume"]);
    expect(result).toEqual<ParsedArgs>({
      command: "pi-launch",
      teamId: "developer-team",
      flags: { resume: true },
    });
  });

  test("parses --resume=true explicitly as resume", () => {
    const result = parseArgs(["pi", "developer", "--resume=true"]);
    expect(result).toEqual<ParsedArgs>({
      command: "pi-launch",
      teamId: "developer-team",
      flags: { resume: true },
    });
  });

  test("parses --resume=false as no flags", () => {
    const result = parseArgs(["pi", "developer", "--resume=false"]);
    expect(result).toEqual<ParsedArgs>({
      command: "pi-launch",
      teamId: "developer-team",
      flags: {},
    });
  });

  test("rejects --continue and --resume as mutually exclusive", () => {
    const result = parseArgs(["pi", "developer", "--continue", "--resume"]);
    expect(result).toEqual<ParsedArgs>({
      command: "error",
      message: expect.stringContaining("--continue and --resume are mutually exclusive"),
    });
  });

  test("rejects --resume and --continue regardless of flag order", () => {
    const result = parseArgs(["pi", "developer", "--resume", "--continue"]);
    expect(result).toEqual<ParsedArgs>({
      command: "error",
      message: expect.stringContaining("--continue and --resume are mutually exclusive"),
    });
  });
});
