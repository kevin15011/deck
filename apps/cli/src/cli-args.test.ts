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

  test("parses --memory=engram as memory provider", () => {
    const result = parseArgs(["pi", "developer", "--memory=engram"]);
    expect(result).toEqual<ParsedArgs>({
      command: "pi-launch",
      teamId: "developer-team",
      flags: {},
      memoryProvider: "engram",
    });
  });

  test("parses --memory=supermemory as memory provider", () => {
    const result = parseArgs(["pi", "developer", "--memory=supermemory"]);
    expect(result).toEqual<ParsedArgs>({
      command: "pi-launch",
      teamId: "developer-team",
      flags: {},
      memoryProvider: "supermemory",
    });
  });

  test("parses --memory=none as no memory provider", () => {
    const result = parseArgs(["pi", "developer", "--memory=none"]);
    expect(result).toEqual<ParsedArgs>({
      command: "pi-launch",
      teamId: "developer-team",
      flags: {},
    });
  });

  test("returns error for unsupported memory provider", () => {
    const result = parseArgs(["pi", "developer", "--memory=unknown"]);
    expect(result).toEqual<ParsedArgs>({
      command: "error",
      message: expect.stringContaining("Unsupported memory provider: unknown"),
    });
  });

  test("combines --memory=engram with --continue flag", () => {
    const result = parseArgs(["pi", "developer", "--continue", "--memory=engram"]);
    expect(result).toEqual<ParsedArgs>({
      command: "pi-launch",
      teamId: "developer-team",
      flags: { continue: true },
      memoryProvider: "engram",
    });
  });

  test("combines --memory=supermemory with --continue flag", () => {
    const result = parseArgs(["pi", "developer", "--continue", "--memory=supermemory"]);
    expect(result).toEqual<ParsedArgs>({
      command: "pi-launch",
      teamId: "developer-team",
      flags: { continue: true },
      memoryProvider: "supermemory",
    });
  });

  test("omits memoryProvider when no --memory flag is provided", () => {
    const result = parseArgs(["pi", "developer"]);
    expect(result).toEqual<ParsedArgs>({
      command: "pi-launch",
      teamId: "developer-team",
      flags: {},
    });
    expect("memoryProvider" in result).toBe(false);
  });

  // -------------------------------------------------------------------------
  // deck doctor tests
  // -------------------------------------------------------------------------

  test("parses 'deck doctor' as doctor command", () => {
    const result = parseArgs(["doctor"]);
    expect(result).toEqual<ParsedArgs>({ command: "doctor" });
  });

  test("parses 'deck doctor --fix' as error with no extra args message", () => {
    const result = parseArgs(["doctor", "--fix"]);
    expect(result).toEqual<ParsedArgs>({
      command: "error",
      message: expect.stringContaining("no acepta argumentos adicionales"),
    });
  });

  test("parses 'deck doctor extra' as error with no extra args message", () => {
    const result = parseArgs(["doctor", "extra"]);
    expect(result).toEqual<ParsedArgs>({
      command: "error",
      message: expect.stringContaining("no acepta argumentos adicionales"),
    });
  });

  // -------------------------------------------------------------------------
  // deck upgrade / deck update alias tests (T2.11)
  // -------------------------------------------------------------------------

  test("parses 'deck upgrade' as the upgrade command", () => {
    const result = parseArgs(["upgrade"]);
    expect(result).toEqual<ParsedArgs>({
      command: "upgrade",
      flags: {},
    });
  });

  test("parses 'deck update' as the upgrade command (alias)", () => {
    const result = parseArgs(["update"]);
    expect(result).toEqual<ParsedArgs>({
      command: "upgrade",
      flags: {},
    });
  });

  test("'deck update --yes' is treated the same as 'deck upgrade --yes'", () => {
    const update = parseArgs(["update", "--yes"]);
    const upgrade = parseArgs(["upgrade", "--yes"]);
    expect(update).toEqual(upgrade);
  });

  test("'deck update -y' is treated the same as 'deck upgrade -y'", () => {
    const update = parseArgs(["update", "-y"]);
    const upgrade = parseArgs(["upgrade", "-y"]);
    expect(update).toEqual(upgrade);
  });

  test("rejects unknown flags on 'deck update' just like 'deck upgrade'", () => {
    const result = parseArgs(["update", "--bogus"]);
    expect(result).toEqual<ParsedArgs>({
      command: "error",
      message: expect.stringContaining("update"),
    });
  });

  // -------------------------------------------------------------------------
  // deck rollback tests (REQ-RBK-001)
  // -------------------------------------------------------------------------

  test("parses 'deck rollback' as the rollback command", () => {
    const result = parseArgs(["rollback"]);
    expect(result).toEqual<ParsedArgs>({
      command: "rollback",
      flags: {},
    });
  });

  test("'deck rollback --force' sets the force flag", () => {
    const result = parseArgs(["rollback", "--force"]);
    expect(result).toEqual<ParsedArgs>({
      command: "rollback",
      flags: { force: true },
    });
  });

  test("'deck rollback --backup <id>' sets the backupId flag", () => {
    const result = parseArgs(["rollback", "--backup", "2026-06-02T12-00-00-000Z-0000000001"]);
    expect(result).toEqual<ParsedArgs>({
      command: "rollback",
      flags: { backupId: "2026-06-02T12-00-00-000Z-0000000001" },
    });
  });

  test("'deck rollback --backup=<id>' (= syntax) also sets the backupId flag", () => {
    const result = parseArgs(["rollback", "--backup=my-backup-id"]);
    expect(result).toEqual<ParsedArgs>({
      command: "rollback",
      flags: { backupId: "my-backup-id" },
    });
  });

  test("'deck rollback --backup' without a value is rejected", () => {
    const result = parseArgs(["rollback", "--backup"]);
    expect(result).toEqual<ParsedArgs>({
      command: "error",
      message: expect.stringContaining("--backup"),
    });
  });

  test("'deck rollback' combines --force and --backup", () => {
    const result = parseArgs(["rollback", "--force", "--backup", "abc-123"]);
    expect(result).toEqual<ParsedArgs>({
      command: "rollback",
      flags: { force: true, backupId: "abc-123" },
    });
  });

  test("'deck rollback' rejects unknown flags", () => {
    const result = parseArgs(["rollback", "--bogus"]);
    expect(result).toEqual<ParsedArgs>({
      command: "error",
      message: expect.stringContaining("rollback"),
    });
  });
});