import pc from "picocolors";

export type MenuOption = {
  value: string;
  label: string;
};

export function placeholder(): string {
  return pc.yellow("(placeholder)");
}

export function getHomeMenuOptions(): MenuOption[] {
  return [
    { value: "start-installation", label: "Start installation" },
    { value: "upgrade-tools", label: `Upgrade tools ${placeholder()}` },
    { value: "configure-models", label: `Configure models ${placeholder()}` },
    { value: "management-uninstall", label: `Management / uninstall ${placeholder()}` },
    { value: "doctor", label: `Doctor ${placeholder()}` },
    { value: "exit", label: "Exit" },
  ];
}

export function getEnvironmentOptions(): MenuOption[] {
  return [
    { value: "pi-development", label: "Pi Development Environment" },
    { value: "opencode-development", label: "OpenCode Development Environment" },
    { value: "claude-development", label: `Claude Development Environment ${placeholder()}` },
    { value: "codex-development", label: `Codex Development Environment ${placeholder()}` },
  ];
}

export function getPiInstalledNextSteps(): string[] {
  return [
    "Review required tools",
    `Configure models ${placeholder()}`,
    `Configure memory ${placeholder()}`,
    `Install environment ${placeholder()}`,
  ];
}
