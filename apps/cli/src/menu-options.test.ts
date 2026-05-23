import { describe, expect, test } from "bun:test";

import { getEnvironmentOptions, getHomeMenuOptions, getPiInstalledNextSteps, placeholder } from "./menu-options";

describe("home menu options", () => {
  test("marks unfinished actions as yellow placeholders except implemented ones", () => {
    const options = getHomeMenuOptions();

    expect(options[0]).toEqual({ value: "start-installation", label: "Start installation" });
    expect(options[1]).toEqual({ value: "configure-packages", label: "Configure packages" });
    expect(options[2]).toEqual({ value: "upgrade-tools", label: `Upgrade tools ${placeholder()}` });
    expect(options[3]).toEqual({ value: "configure-models", label: "Configure models" });
    expect(options[4]).toEqual({ value: "management-uninstall", label: `Management / uninstall ${placeholder()}` });
    expect(options[5]).toEqual({ value: "doctor", label: "Doctor" });
    expect(options[6]).toEqual({ value: "exit", label: "Exit" });
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
