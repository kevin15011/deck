/**
 * Runtime-agnostic dashboard selectors.
 *
 * Works with any runner (Pi, OpenCode, etc.) via the `runnerScope` field.
 * Capability catalogs are injected via the `capabilityResolver` parameter.
 */

import {
  CANONICAL_INSTRUCTION_PACKAGE_IDS,
  type AdaptiveMemoryProviderChoice,
  type CapabilityId,
  type CapabilityStatus,
  type RunnerAction,
  type RunnerDashboardScreen,
  type RunnerDashboardState,
  type RunnerReviewPlan,
  type TeamCapabilityProfile,
} from "./state";

/**
 * Dashboard section IDs for the grouping.
 */
export type DashboardSectionId =
  | "packages"
  | "adaptive-memory"
  | "teams"
  | "review-install"
  | "package-instructions";

export type SectionReadiness = "ready" | "attention" | "pending" | "blocked";

export type DashboardSectionSummary = {
  id: DashboardSectionId;
  title: string;
  screen: RunnerDashboardScreen;
  readiness: SectionReadiness;
  selectedCount: number;
  totalCount: number;
  actionCount: number;
  detail: string;
};

export type CapabilityOptionSummary = {
  capabilityId: CapabilityId;
  label: string;
  requirementLevel: "required" | "optional" | "configurable";
  selected: boolean;
  status: CapabilityStatus | "unknown";
  runnerScope: string;
  implementationId?: string;
  detail: string;
};

export type AdaptiveMemorySummary = {
  provider: AdaptiveMemoryProviderChoice;
  options: { provider: AdaptiveMemoryProviderChoice; selected: boolean; label: string }[];
  configured: boolean;
  detail: string;
};

export type PlanActionCounts = {
  automatic: number;
  manual: number;
  config: number;
  team: number;
  validation: number;
  total: number;
};

/**
 * Generic capability catalog entry — adapters provide their own catalogs.
 */
export type CapabilityCatalogEntry = {
  capabilityId: CapabilityId;
  label: string;
  description: string;
  runnerScope: string;
  requirementLevel: "required" | "optional" | "configurable";
  toolId?: string;
  source?: string;
  implementations?: Record<string, { id: string; source: string; installKind: string; note?: string }>;
  isInternal?: boolean;
};

/**
 * Resolver function that adapters provide to look up capabilities.
 */
export type CapabilityResolver = {
  getCapability: (capabilityId: CapabilityId) => CapabilityCatalogEntry | undefined;
  getUserFacingIds: () => CapabilityId[];
};

type SectionSignals = {
  ready: number;
  manual: number;
  pending: number;
  blocked: number;
  unknown: number;
  actions: number;
};

const DASHBOARD_SECTION_COUNT = 4;
const ADAPTIVE_MEMORY_OPTION_COUNT = 4; // none, engram, supermemory, back
const TEAMS_OPTION_COUNT = 3; // Developer Team, Developer Team detail, back
const DEVELOPER_TEAM_DETAIL_OPTION_COUNT = 3; // configure models, use current/defaults, back
const REVIEW_PLAN_OPTION_COUNT = 2; // run, dashboard
const INSTALL_PROGRESS_OPTION_COUNT = 1;
const COMPLETE_OPTION_COUNT = 1;

export function getCursorLimit(state: RunnerDashboardState, packageCount: number): number {
  switch (state.screen) {
    case "dashboard":
      return DASHBOARD_SECTION_COUNT;
    case "packages-detail":
      return packageCount + 1; // capabilities + back
    case "adaptive-memory-detail":
      return ADAPTIVE_MEMORY_OPTION_COUNT;
    case "teams-detail":
      return TEAMS_OPTION_COUNT;
    case "developer-team-detail":
      return DEVELOPER_TEAM_DETAIL_OPTION_COUNT;
    case "review-plan":
      return REVIEW_PLAN_OPTION_COUNT;
    case "install-progress":
      return INSTALL_PROGRESS_OPTION_COUNT;
    case "complete":
      return COMPLETE_OPTION_COUNT;
    default:
      return 1;
  }
}

export function clampCursor(cursor: number, state: RunnerDashboardState, packageCount: number): number {
  const limit = getCursorLimit(state, packageCount);
  if (limit <= 0) return 0;
  return Math.min(Math.max(cursor, 0), limit - 1);
}

export function getPlanActionCounts(plan: RunnerReviewPlan | undefined): PlanActionCounts {
  const groups = plan?.groups;
  const automatic = groups?.automaticInstalls.length ?? 0;
  const manual = groups?.manualSteps.length ?? 0;
  const config = groups?.configWrites.length ?? 0;
  const team = groups?.teamApplications.length ?? 0;
  const validation = groups?.validations.length ?? 0;

  return {
    automatic,
    manual,
    config,
    team,
    validation,
    total: automatic + manual + config + team + validation,
  };
}

export function getDashboardSectionSummaries(state: RunnerDashboardState, resolver?: CapabilityResolver): DashboardSectionSummary[] {
  const counts = getPlanActionCounts(state.plan);
  const capabilityOptions = getRunnerCapabilitySummaries(state, resolver);
  const selectedPackages = capabilityOptions.filter((option) => option.selected && option.requirementLevel === "configurable").length;
  const selectedTeams = Object.values(state.teams).filter((team) => team.selected).length;
  const configurableIds = resolver?.getUserFacingIds() ?? [];
  const packagesSignals = signalsForSection(state, configurableIds);
  const adaptiveSignals = signalsForActions(actionsMatching(state.plan, (action) => action.id.startsWith("adaptive-memory.") || (action.capabilityId === "codebase-memory" && state.adaptiveMemory.provider === "engram")));
  const teamSignals = signalsForActions(state.plan?.groups.teamApplications ?? []);

  return [
    {
      id: "packages",
      title: "Packages",
      screen: "packages-detail",
      readiness: selectedPackages === 0 ? "pending" : readinessFromSignals(packagesSignals),
      selectedCount: selectedPackages,
      totalCount: configurableIds.length,
      actionCount: packagesSignals.actions,
      detail: `${selectedPackages}/${configurableIds.length} packages selected; ${formatSignals(packagesSignals)}.`,
    },
    {
      id: "adaptive-memory",
      title: "Adaptive Memory",
      screen: "adaptive-memory-detail",
      readiness: state.adaptiveMemory.provider === "none" ? "pending" : readinessForAdaptiveMemory(state, adaptiveSignals),
      selectedCount: state.adaptiveMemory.provider === "none" ? 0 : 1,
      totalCount: 1,
      actionCount: adaptiveSignals.actions,
      detail: `Provider selected: ${state.adaptiveMemory.provider}; ${formatSignals(adaptiveSignals)}.`,
    },
    {
      id: "teams",
      title: "Teams",
      screen: "teams-detail",
      readiness: selectedTeams === 0 ? "pending" : readinessFromSignals(teamSignals),
      selectedCount: selectedTeams,
      totalCount: Object.keys(state.teams).length,
      actionCount: teamSignals.actions,
      detail: `${selectedTeams} team(s) selected; ${formatSignals(teamSignals)}.`,
    },
    {
      id: "review-install",
      title: "Review & Install",
      screen: "review-plan",
      readiness: state.plan?.ready ? "ready" : counts.total > 0 ? "attention" : "pending",
      selectedCount: counts.total,
      totalCount: counts.total,
      actionCount: counts.total,
      detail: `${counts.automatic} automatic, ${counts.manual} manual/pending, ${counts.config} config, ${counts.team} team, ${counts.validation} validation.`,
    },
  ];
}

/**
 * Returns capability option summaries for the Packages section.
 * Uses the injected capability resolver to get catalog entries.
 */
export function getRunnerCapabilitySummaries(state: RunnerDashboardState, resolver?: CapabilityResolver): CapabilityOptionSummary[] {
  const configurable = resolver?.getUserFacingIds() ?? [];
  return configurable.map((capabilityId) =>
    capabilitySummary(state, capabilityId, Boolean(state.selectedCapabilities[capabilityId]), resolver),
  );
}

export function getAdaptiveMemorySummary(state: RunnerDashboardState): AdaptiveMemorySummary {
  const provider = state.adaptiveMemory.provider;
  const configured = provider !== "supermemory" || Boolean(state.adaptiveMemory.supermemory?.configured);

  return {
    provider,
    configured,
    options: [
      { provider: "none", selected: provider === "none", label: "None" },
      { provider: "engram", selected: provider === "engram", label: "Engram" },
      { provider: "supermemory", selected: provider === "supermemory", label: "Supermemory" },
    ],
    detail: provider === "none"
      ? "No adaptive memory active by default."
      : provider === "engram"
        ? "Engram enables the derived engram-memory technical action."
        : "Supermemory uses non-secret config and redacted MCP credentials.",
  };
}

/**
 * Returns the capability consumption profile for a team.
 */
export function getTeamCapabilityProfile(state: RunnerDashboardState, teamId: string): TeamCapabilityProfile {
  const team = state.teams[teamId];
  const installable = Boolean(team?.selected);

  return {
    teamId,
    installable,
    capabilities: {
      "context-mode": state.selectedCapabilities["context-mode"] ? "compatible" : "not-used",
      "codebase-memory": state.selectedCapabilities["codebase-memory"] ? "consumes-directly" : "not-used",
      rtk: state.selectedCapabilities.rtk ? "compatible" : "not-used",
      "adaptive-memory": state.adaptiveMemory.provider === "none" ? "not-used" : "consumes-directly",
    },
    diagnostics: installable
      ? []
      : ["Select the team to proceed with installation."],
  };
}

/**
 * Returns a summary for a single capability option.
 */
function capabilitySummary(state: RunnerDashboardState, capabilityId: CapabilityId, selected: boolean, resolver?: CapabilityResolver): CapabilityOptionSummary {
  const capability = resolver?.getCapability(capabilityId);
  if (!capability) {
    return {
      capabilityId,
      label: capabilityId,
      requirementLevel: "configurable",
      selected,
      status: state.capabilityStatuses[capabilityId] ?? "unknown",
      runnerScope: state.runnerScope,
      detail: `Capability '${capabilityId}' not found in user-facing catalog.`,
    };
  }

  const implementation = capability.implementations?.[state.runnerScope as "pi" | "opencode"];
  const status = state.capabilityStatuses[capabilityId] ?? "unknown";

  return {
    capabilityId,
    label: capability.label,
    requirementLevel: capability.requirementLevel,
    selected,
    status,
    runnerScope: capability.runnerScope,
    implementationId: implementation?.id,
    detail: capability.description,
  };
}

function signalsForSection(state: RunnerDashboardState, capabilityIds: CapabilityId[]): SectionSignals {
  const statusSignals = signalsForCapabilityStatuses(capabilityIds.map((capabilityId) => state.capabilityStatuses[capabilityId]));
  const actionSignals = signalsForActions(actionsForCapabilities(state.plan, capabilityIds));

  return {
    ready: statusSignals.ready + actionSignals.ready,
    manual: statusSignals.manual + actionSignals.manual,
    pending: statusSignals.pending + actionSignals.pending,
    blocked: statusSignals.blocked + actionSignals.blocked,
    unknown: statusSignals.unknown + actionSignals.unknown,
    actions: actionSignals.actions,
  };
}

function signalsForCapabilityStatuses(statuses: Array<CapabilityStatus | undefined>): SectionSignals {
  return statuses.reduce<SectionSignals>((signals, status) => {
    switch (status) {
      case "ready":
        signals.ready += 1;
        break;
      case "blocked":
        signals.blocked += 1;
        break;
      case "pending-source":
      case "manual":
        signals.pending += 1;
        break;
      case "missing":
        signals.manual += 1;
        break;
      default:
        signals.unknown += 1;
        break;
    }
    return signals;
  }, emptySignals());
}

function signalsForActions(actions: RunnerAction[]): SectionSignals {
  return actions.reduce<SectionSignals>((signals, action) => {
    signals.actions += 1;
    if (action.status === "blocked" || action.status === "failed") signals.blocked += 1;
    else if (action.status === "pending" || action.kind === "pending-source") signals.pending += 1;
    else if (action.status === "manual" || action.kind === "manual-external-install") signals.manual += 1;
    else if (action.status === "ready" || action.status === "complete") signals.ready += 1;
    else signals.unknown += 1;
    return signals;
  }, emptySignals());
}

function readinessForAdaptiveMemory(state: RunnerDashboardState, signals: SectionSignals): SectionReadiness {
  if (state.adaptiveMemory.provider === "supermemory" && !state.adaptiveMemory.supermemory?.configured) return "pending";
  return readinessFromSignals(signals);
}

function readinessFromSignals(signals: SectionSignals): SectionReadiness {
  if (signals.blocked > 0) return "blocked";
  if (signals.pending > 0 || signals.unknown > 0) return "pending";
  if (signals.manual > 0) return "attention";
  return "ready";
}

function formatSignals(signals: SectionSignals): string {
  return `${signals.manual} manual, ${signals.pending} pending, ${signals.blocked} blocked, ${signals.unknown} unknown`;
}

function emptySignals(): SectionSignals {
  return { ready: 0, manual: 0, pending: 0, blocked: 0, unknown: 0, actions: 0 };
}

function actionsForCapabilities(plan: RunnerReviewPlan | undefined, capabilityIds: CapabilityId[]): RunnerAction[] {
  if (!plan) return [];
  const wanted = new Set<CapabilityId>(capabilityIds);
  return allPlanActions(plan).filter((action) => action.capabilityId && wanted.has(action.capabilityId));
}

function actionsMatching(plan: RunnerReviewPlan | undefined, predicate: (action: RunnerAction) => boolean): RunnerAction[] {
  if (!plan) return [];
  return allPlanActions(plan).filter(predicate);
}

function allPlanActions(plan: RunnerReviewPlan): RunnerAction[] {
  return Object.values(plan.groups).flat();
}
