export type NextScreen =
  | "team-selection"
  | "developer-team-review"
  | "developer-team-installing"
  | "environment-selection"
  | "personality-selection"
  | "pi-preflight-checking"
  | "opencode-preflight-checking"
  | "complete";

type FlowContext = {
  selectedEnvironments: readonly string[];
  hasPiCommand: boolean;
  hasOpenCodeNext: boolean;
};

type ReviewContext = {
  cursor: number;
  selectedEnvironments: readonly string[];
  hasOpenCodeNext: boolean;
};

type AfterInstallContext = {
  selectedEnvironments: readonly string[];
  hasOpenCodeNext: boolean;
};

type TeamSelectionContext = {
  selectedTeams: readonly string[];
  hasOpenCodeNext: boolean;
};

export function getNextScreenAfterPiToolInstall(context: FlowContext): NextScreen {
  const hasPi = context.selectedEnvironments.includes("pi-development") && context.hasPiCommand;

  if (hasPi) {
    return "team-selection";
  }

  return resolveNextEnvironment(context.hasOpenCodeNext);
}

export function getNextScreenAfterTeamSelection(context: TeamSelectionContext): NextScreen {
  if (context.selectedTeams.includes("developer-team")) {
    return "developer-team-review";
  }

  return resolveNextEnvironment(context.hasOpenCodeNext);
}

export function getNextScreenAfterDeveloperTeamReview(context: ReviewContext): NextScreen {
  if (context.cursor === 0) {
    return "developer-team-installing";
  }

  return resolveNextEnvironment(context.hasOpenCodeNext);
}

export function getNextScreenAfterDeveloperTeamInstall(context: AfterInstallContext): NextScreen {
  return resolveNextEnvironment(context.hasOpenCodeNext);
}

export function getNextScreenAfterEnvironmentSelection(context: FlowContext): NextScreen {
  if (context.selectedEnvironments.length > 0) {
    return "personality-selection";
  }

  return "complete";
}

export function getNextScreenAfterPersonalitySelection(context: FlowContext): NextScreen {
  const hasPi = context.selectedEnvironments.includes("pi-development");

  if (hasPi) {
    return "pi-preflight-checking";
  }

  const hasOpenCode = context.selectedEnvironments.includes("opencode-development");

  if (hasOpenCode) {
    return "opencode-preflight-checking";
  }

  return "complete";
}

function resolveNextEnvironment(hasOpenCodeNext: boolean): NextScreen {
  if (hasOpenCodeNext) {
    return "opencode-preflight-checking";
  }

  return "complete";
}
