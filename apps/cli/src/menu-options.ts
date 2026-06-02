import pc from "picocolors";

import type { ReleaseCheckState } from "./tui/release-check";

export type MenuOption = {
  value: string;
  label: string;
};

export type RollbackAvailability = {
  /** The id of the latest restorable backup (e.g. "2026-06-02T12-00-00-000Z-op-1"). */
  backupId: string;
  /** The Deck version recorded in that backup (the version we would roll back TO). */
  version: string;
};

export function placeholder(): string {
  return pc.yellow("(placeholder)");
}

/**
 * Build the home menu options.
 *
 * The `releaseCheck` argument follows the existing contract: when the
 * check resolves to `available`, the "Update Deck" entry is suffixed
 * with the target version (e.g. "Update Deck → v1.2.0") so the user
 * sees the upgrade opportunity from the home screen.
 *
 * The `rollbackAvailability` argument (REQ-RBK-002) is optional. When
 * provided AND non-null, a "Roll back Deck → v{version}" entry is
 * added to the menu so the user can initiate a user-driven rollback
 * from the TUI without going through the CLI. When `null` or omitted
 * (no restorable backup on disk), the entry is not rendered.
 */
export function getHomeMenuOptions(
  releaseCheck?: ReleaseCheckState,
  rollbackAvailability?: RollbackAvailability | null,
): MenuOption[] {
  const updateLabel =
    releaseCheck?.kind === "available"
      ? `Update Deck → ${releaseCheck.version}`
      : "Update Deck";

  const options: MenuOption[] = [
    { value: "start-installation", label: "Start installation" },
    { value: "configure-packages", label: "Configure packages" },
    { value: "update-deck", label: updateLabel },
    { value: "configure-models", label: "Configure models" },
    { value: "management-uninstall", label: `Management / uninstall ${placeholder()}` },
    { value: "doctor", label: "Doctor" },
  ];

  if (rollbackAvailability) {
    options.push({
      value: "rollback-deck",
      label: `Roll back Deck → ${rollbackAvailability.version}`,
    });
  }

  options.push({ value: "exit", label: "Exit" });

  return options;
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
