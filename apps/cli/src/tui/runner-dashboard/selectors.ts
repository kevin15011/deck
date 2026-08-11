/**
 * Runtime-agnostic dashboard selectors.
 *
 * Works with any runner (Pi, OpenCode, etc.) via the `runnerScope` field.
 * Capability catalogs are injected via the `capabilityResolver` parameter.
 */

import {
  type AdaptiveMemoryProviderChoice,
  type CapabilityId,
  type CapabilityStatus,
  type CanonicalInstructionPackageId,
  type RunnerAction,
  type RunnerDashboardScreen,
  type RunnerDashboardState,
  type RunnerReviewPlan,
  type TeamCapabilityProfile,
} from "./state";
import { getConfigurablePackageInstructionMetadata, type PackageInstructionPackageId } from "@deck/core";

/**
 * Dashboard section IDs for the grouping.
 */
export type DashboardSectionId =
  | "packages"
  | "adaptive-memory"
  | "web-search"
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
  detail: string;
};

export type AdaptiveMemorySummary = {
  provider: AdaptiveMemoryProviderChoice;
  options: { provider: AdaptiveMemoryProviderChoice; selected: boolean; label: string }[];
  configured: boolean;
  detail: string;
};

export type WebSearchSummary = {
  enabled: boolean;
  provider: string;
  credentialAvailable: boolean;
  runnerSupported: boolean;
  mcpConfigured: boolean;
  mcpConfigConflict: boolean;
  readiness: import("@deck/core").WebSearchReadinessState;
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
 * Package-selection contract. Runtime capabilities intentionally do not cross this boundary.
 */
export type CapabilityResolver = {
  getSupportedPackageInstructionIds?: () => readonly PackageInstructionPackageId[];
};

type SectionSignals = {
  ready: number;
  manual: number;
  pending: number;
  blocked: number;
  unknown: number;
  actions: number;
};

const DASHBOARD_SECTION_COUNT = 5;
const ADAPTIVE_MEMORY_OPTION_COUNT = 4; // none, engram, supermemory, back
const WEB_SEARCH_OPTION_COUNT = 3; // enable/disable, update credential, back
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
    case "web-search-detail":
      return WEB_SEARCH_OPTION_COUNT;
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
  const capabilityOptions = getPackageInstructionSummaries(state, resolver);
  const selectedPackages = capabilityOptions.filter((option) => option.selected).length;
  const selectedTeams = Object.values(state.teams).filter((team) => team.selected).length;
  const packageInstructionIds = capabilityOptions.map((option) => option.capabilityId);
  const packagesSignals = signalsForActions(actionsMatching(state.plan, (action) => action.id.startsWith("package-instructions.")));
  const adaptiveSignals = signalsForActions(actionsMatching(state.plan, (action) => action.id.startsWith("adaptive-memory.") || (action.capabilityId === "codebase-memory" && state.adaptiveMemory.provider === "engram")));
  const webSearchSignals = signalsForActions(actionsMatching(state.plan, (action) => action.capabilityId === "web-search" || action.id.startsWith("capability.web-search.")));
  const teamSignals = signalsForActions(state.plan?.groups.teamApplications ?? []);

  return [
    {
      id: "packages",
      title: "Packages",
      screen: "packages-detail",
      readiness: selectedPackages === 0 ? "pending" : readinessFromSignals(packagesSignals),
      selectedCount: selectedPackages,
      totalCount: packageInstructionIds.length,
      actionCount: packagesSignals.actions,
      detail: `${selectedPackages}/${packageInstructionIds.length} packages selected; ${formatSignals(packagesSignals)}.`,
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
      id: "web-search",
      title: "Web Search",
      screen: "web-search-detail",
      readiness: readinessForWebSearch(state, webSearchSignals),
      selectedCount: state.selectedCapabilities["web-search"] ? 1 : 0,
      totalCount: 1,
      actionCount: webSearchSignals.actions,
      detail: `Tavily ${state.selectedCapabilities["web-search"] ? "enabled" : "disabled"}; ${state.webSearch.credentialAvailable ? "credential detected" : "credential missing"}; ${formatSignals(webSearchSignals)}.`,
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
      detail: `${counts.total} action(s): ${counts.automatic} automatic`,
    },
  ];
}

/**
 * Returns capability option summaries for the Packages section.
 * Uses the injected capability resolver to get catalog entries.
 */
/**
 * Returns only toggleable capability IDs (configurable + optional requirement levels).
 * This matches what the UI renders in PackagesDetail.
 */
export function getPackageInstructionSummaries(state: RunnerDashboardState, resolver?: CapabilityResolver): CapabilityOptionSummary[] {
  return getConfigurablePackageInstructionMetadata(resolver?.getSupportedPackageInstructionIds?.() ?? []).map((entry) => ({
    capabilityId: entry.id,
    label: entry.label,
    requirementLevel: "configurable",
    selected: state.packageInstructions[entry.id] === true,
    status: state.capabilityStatuses[entry.id] ?? "unknown",
    runnerScope: state.runnerScope,
    detail: entry.description,
  }));
}

export function getToggleablePackageInstructionIds(state: RunnerDashboardState, resolver?: CapabilityResolver): CanonicalInstructionPackageId[] {
  return getPackageInstructionSummaries(state, resolver).map((summary) => summary.capabilityId as CanonicalInstructionPackageId);
}

export function getAdaptiveMemorySummary(state: RunnerDashboardState): AdaptiveMemorySummary {
  const provider = state.adaptiveMemory.provider;
  const configured = provider !== "supermemory" || Boolean(state.adaptiveMemory.supermemory?.configured);
  const supermemoryUi = state.runnerUi?.adaptiveMemory?.supermemory;
  const engramUi = state.runnerUi?.adaptiveMemory?.engram;

  return {
    provider,
    configured,
    options: [
      { provider: "none", selected: provider === "none", label: "None" },
      { provider: "engram", selected: provider === "engram", label: engramUi?.label ?? "Engram" },
      { provider: "supermemory", selected: provider === "supermemory", label: "Supermemory" },
    ],
    detail: provider === "none"
      ? "No adaptive memory active by default."
      : provider === "engram"
        ? engramUi?.detail ?? "Engram enables the derived engram-memory technical action."
        : supermemoryUi?.selectionStatus ?? "Supermemory uses non-secret config and redacted MCP credentials.",
  };
}

export function getWebSearchSummary(state: RunnerDashboardState): WebSearchSummary {
  return {
    enabled: state.selectedCapabilities["web-search"] === true,
    provider: state.webSearch.provider ?? "tavily",
    credentialAvailable: state.webSearch.credentialAvailable,
    runnerSupported: state.webSearch.runnerSupported,
    mcpConfigured: state.webSearch.mcpConfigured,
    mcpConfigConflict: state.webSearch.mcpConfigConflict,
    readiness: state.webSearch.readiness,
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
      serena: state.selectedCapabilities.serena ? "consumes-directly" : "not-used",
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

function readinessForWebSearch(state: RunnerDashboardState, signals: SectionSignals): SectionReadiness {
  if (!state.selectedCapabilities["web-search"]) return "pending";
  if (state.webSearch.mcpConfigConflict || !state.webSearch.runnerSupported) return "blocked";
  if (!state.webSearch.credentialAvailable || !state.webSearch.mcpConfigured) return "attention";
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

function actionsMatching(plan: RunnerReviewPlan | undefined, predicate: (action: RunnerAction) => boolean): RunnerAction[] {
  if (!plan) return [];
  return allPlanActions(plan).filter(predicate);
}

function allPlanActions(plan: RunnerReviewPlan): RunnerAction[] {
  return Object.values(plan.groups).flat();
}
