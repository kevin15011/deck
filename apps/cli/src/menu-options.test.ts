import { describe, expect, test } from "bun:test";

import {
  getEnvironmentOptions,
  getHomeMenuOptions,
  getPiInstalledNextSteps,
  placeholder,
  type RollbackAvailability,
} from "./menu-options";
import type { ReleaseCheckState } from "./tui/release-check";

describe("home menu options", () => {
  test("marks unfinished actions as yellow placeholders except implemented ones", () => {
    const options = getHomeMenuOptions();

    expect(options[0]).toEqual({ value: "start-installation", label: "Start installation" });
    expect(options[1]).toEqual({ value: "configure-packages", label: "Configure packages" });
    // T3.1: the upgrade-tools placeholder is now a real "Update Deck" action.
    expect(options[2]).toEqual({ value: "update-deck", label: "Update Deck" });
    expect(options[2]?.label).not.toContain(placeholder());
    expect(options[3]).toEqual({ value: "configure-models", label: "Configure models" });
    expect(options[4]).toEqual({ value: "management-uninstall", label: `Management / uninstall ${placeholder()}` });
    expect(options[5]).toEqual({ value: "doctor", label: "Doctor" });
    expect(options[6]).toEqual({ value: "exit", label: "Exit" });
  });

  test("surfaces the available version on the Update Deck label when release check finds one", () => {
    const releaseCheck: ReleaseCheckState = {
      kind: "available",
      version: "1.2.0",
      tag: "v1.2.0",
      channel: "stable",
      items: [],
      descriptor: null,
      reason: "newer-version",
    };

    const options = getHomeMenuOptions(releaseCheck);
    expect(options[2]).toEqual({ value: "update-deck", label: "Update Deck → 1.2.0" });
  });

  test("keeps the base Update Deck label when the release check is pending or resolved without updates", () => {
    const cases: ReadonlyArray<ReleaseCheckState | undefined> = [
      undefined,
      { kind: "pending" },
      { kind: "none" },
      { kind: "network-error", error: "x" },
    ];
    for (const releaseCheck of cases) {
      const options = getHomeMenuOptions(releaseCheck);
      expect(options[2]).toEqual({ value: "update-deck", label: "Update Deck" });
    }
  });
});

describe("home menu options — user-initiated rollback (REQ-RBK-002)", () => {
  test("omits the Roll back Deck entry when no backup availability is provided", () => {
    const options = getHomeMenuOptions();
    const rollback = options.find((o) => o.value === "rollback-deck");
    expect(rollback).toBeUndefined();
  });

  test("omits the Roll back Deck entry when rollback availability is explicitly null", () => {
    const options = getHomeMenuOptions(undefined, null);
    const rollback = options.find((o) => o.value === "rollback-deck");
    expect(rollback).toBeUndefined();
  });

  test("adds a Roll back Deck entry with the target version when a backup is available", () => {
    const availability: RollbackAvailability = {
      backupId: "2026-06-02T12-00-00-000Z-op-1",
      version: "1.1.0",
    };
    const options = getHomeMenuOptions(undefined, availability);
    const rollback = options.find((o) => o.value === "rollback-deck");
    expect(rollback).toBeDefined();
    expect(rollback?.label).toBe("Roll back Deck → 1.1.0");
    // The entry sits before Exit and after the rest of the menu.
    expect(options[options.length - 1]).toEqual({ value: "exit", label: "Exit" });
  });

  test("keeps the Update Deck and Roll back Deck entries independent", () => {
    const releaseCheck: ReleaseCheckState = {
      kind: "available",
      version: "1.2.0",
      tag: "v1.2.0",
      channel: "stable",
      items: [],
      descriptor: null,
      reason: "newer-version",
    };
    const availability: RollbackAvailability = {
      backupId: "backup-1",
      version: "1.1.0",
    };
    const options = getHomeMenuOptions(releaseCheck, availability);
    expect(options.find((o) => o.value === "update-deck")?.label).toBe("Update Deck → 1.2.0");
    expect(options.find((o) => o.value === "rollback-deck")?.label).toBe("Roll back Deck → 1.1.0");
  });
});

describe("Pi installation next steps", () => {
  test("shows setup placeholders when Pi is installed", () => {
    expect(getPiInstalledNextSteps()).toEqual([
      "Review required tools",
      `Configure models ${placeholder()}`,
      `Configure memory ${placeholder()}`,
      `Install environment ${placeholder()}`,
    ]);
  });
});

describe("environment options", () => {
  test("allows selecting Pi plus future environments as placeholders", () => {
    expect(getEnvironmentOptions()).toEqual([
      { value: "pi-development", label: "Pi Development Environment" },
      { value: "opencode-development", label: "OpenCode Development Environment" },
      { value: "claude-development", label: `Claude Development Environment ${placeholder()}` },
      { value: "codex-development", label: `Codex Development Environment ${placeholder()}` },
    ]);
  });
});
