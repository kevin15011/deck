import { describe, expect, test } from "bun:test";

import { getEnvironmentOptions, getHomeMenuOptions, getPiInstalledNextSteps, placeholder } from "./menu-options";

describe("home menu options", () => {
  test("marks unfinished actions as yellow placeholders", () => {
    const options = getHomeMenuOptions();

    expect(options[0]).toEqual({ value: "start-installation", label: "Start installation" });
    expect(options.slice(1).map((option) => option.label)).toEqual([
      `Upgrade tools ${placeholder()}`,
      `Configure models ${placeholder()}`,
      `Management / uninstall ${placeholder()}`,
      `Doctor ${placeholder()}`,
      "Exit",
    ]);
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
