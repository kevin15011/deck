import type { EnvironmentId } from "@deck/core";

export type NextScreen =
  | "team-selection"
  | "developer-team-review"
  | "developer-team-installing"
  | "environment-selection"
  | "personality-selection"
  | "pi-preflight-checking"
  | "opencode-preflight-checking"
  | "codex-preflight-checking"
  | "complete";

type FlowContext = {
  selectedEnvironments: readonly string[];
  hasPiCommand: boolean;
  nextEnvironment: EnvironmentId | null;
};

type ReviewContext = {
  cursor: number;
  selectedEnvironments: readonly string[];
  nextEnvironment: EnvironmentId | null;
};

type AfterInstallContext = {
  selectedEnvironments: readonly string[];
  nextEnvironment: EnvironmentId | null;
};

type TeamSelectionContext = {
  selectedTeams: readonly string[];
  nextEnvironment: EnvironmentId | null;
};

export function getNextScreenAfterPiToolInstall(context: FlowContext): NextScreen {
  const hasPi = context.selectedEnvironments.includes("pi-development") && context.hasPiCommand;

  if (hasPi) {
    return "team-selection";
  }

  return resolveNextEnvironment(context.nextEnvironment);
}

export function getNextScreenAfterTeamSelection(context: TeamSelectionContext): NextScreen {
  if (context.selectedTeams.includes("developer-team")) {
    return "developer-team-review";
  }

  return resolveNextEnvironment(context.nextEnvironment);
}

export function getNextScreenAfterDeveloperTeamReview(context: ReviewContext): NextScreen {
  if (context.cursor === 0) {
    return "developer-team-installing";
  }

  return resolveNextEnvironment(context.nextEnvironment);
}

export function getNextScreenAfterDeveloperTeamInstall(context: AfterInstallContext): NextScreen {
  return resolveNextEnvironment(context.nextEnvironment);
}

export function getNextScreenAfterEnvironmentSelection(context: FlowContext): NextScreen {
  if (context.selectedEnvironments.length > 0) {
    return "personality-selection";
  }

  return "complete";
}

function resolveNextEnvironment(nextEnvironment: EnvironmentId | null): NextScreen {
  if (nextEnvironment === "pi-development") return "pi-preflight-checking";
  if (nextEnvironment === "opencode-development") return "opencode-preflight-checking";
  if (nextEnvironment === "codex-development") return "codex-preflight-checking";
  return "complete";
}
