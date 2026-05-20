import {
  getPiRunnerCapability,
  type CapabilityId,
  type CapabilityStatus,
} from "@deck/adapter-pi";
import type {
  AdaptiveMemoryProviderChoice,
  PiRunnerAction,
  PiRunnerDashboardScreen,
  PiRunnerDashboardState,
  PiRunnerReviewPlan,
  TeamCapabilityProfile,
  UserSelectableCapabilityId,
} from "./state";

export type DashboardSectionId =
  | "runner-capabilities"
  | "adaptive-memory"
  | "runner-ui-visual-helpers"
  | "teams"
  | "review-install";

export type SectionReadiness = "ready" | "attention" | "pending" | "blocked";

export type DashboardSectionSummary = {
  id: DashboardSectionId;
  title: string;
  screen: PiRunnerDashboardScreen;
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

type SectionSignals = {
  ready: number;
  manual: number;
  pending: number;
  blocked: number;
  unknown: number;
  actions: number;
};

const DASHBOARD_SECTION_COUNT = 5;
const RUNNER_CAPABILITY_OPTION_COUNT = 4; // RTK, context-mode, codebase-memory, back
const ADAPTIVE_MEMORY_OPTION_COUNT = 4; // none, engram, supermemory, back
const VISUAL_HELPER_OPTION_COUNT = 2; // pi-hud toggle, back
const TEAMS_OPTION_COUNT = 3; // Developer Team, Developer Team detail, back
const DEVELOPER_TEAM_DETAIL_OPTION_COUNT = 3; // configure models, use current/defaults, back
const REVIEW_PLAN_OPTION_COUNT = 3; // run, back, dashboard
const INSTALL_PROGRESS_OPTION_COUNT = 1;
const COMPLETE_OPTION_COUNT = 1;

export function getCursorLimit(state: PiRunnerDashboardState): number {
  switch (state.screen) {
    case "dashboard":
      return DASHBOARD_SECTION_COUNT;
    case "runner-capabilities-detail":
      return RUNNER_CAPABILITY_OPTION_COUNT;
    case "adaptive-memory-detail":
      return ADAPTIVE_MEMORY_OPTION_COUNT;
    case "runner-ui-visual-helpers-detail":
      return VISUAL_HELPER_OPTION_COUNT;
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

export function clampCursor(cursor: number, state: PiRunnerDashboardState): number {
  const limit = getCursorLimit(state);
  if (limit <= 0) return 0;
  return Math.min(Math.max(cursor, 0), limit - 1);
}

export function getPlanActionCounts(plan: PiRunnerReviewPlan | undefined): PlanActionCounts {
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

export function getDashboardSectionSummaries(state: PiRunnerDashboardState): DashboardSectionSummary[] {
  const counts = getPlanActionCounts(state.plan);
  const capabilityOptions = getRunnerCapabilitySummaries(state);
  const selectedRunnerCapabilities = capabilityOptions.filter((option) => option.selected && option.requirementLevel === "configurable").length;
  const selectedVisualHelpers = capabilityOptions.filter((option) => option.selected && option.capabilityId === "pi-hud").length;
  const selectedTeams = Object.values(state.teams).filter((team) => team.selected).length;
  const runnerSignals = signalsForSection(state, ["rtk", "context-mode", "codebase-memory"]);
  const adaptiveSignals = signalsForActions(actionsMatching(state.plan, (action) => action.id.startsWith("adaptive-memory.") || action.capabilityId === "codebase-memory" && state.adaptiveMemory.provider === "engram"));
  const visualSignals = signalsForSection(state, state.runnerScope === "pi" ? ["runner-mermaid", "pi-hud"] : ["runner-mermaid"]);
  const teamSignals = signalsForActions(state.plan?.groups.teamApplications ?? []);

  return [
    {
      id: "runner-capabilities",
      title: "Runner Capabilities globales",
      screen: "runner-capabilities-detail",
      readiness: readinessFromSignals(runnerSignals),
      selectedCount: selectedRunnerCapabilities,
      totalCount: 3,
      actionCount: runnerSignals.actions,
      detail: `${selectedRunnerCapabilities}/3 configurables seleccionadas; ${formatSignals(runnerSignals)}. Mermaid se deriva como requerido.`,
    },
    {
      id: "adaptive-memory",
      title: "Adaptive Memory global",
      screen: "adaptive-memory-detail",
      readiness: readinessForAdaptiveMemory(state, adaptiveSignals),
      selectedCount: state.adaptiveMemory.provider === "none" ? 0 : 1,
      totalCount: 1,
      actionCount: adaptiveSignals.actions,
      detail: `Provider seleccionado: ${state.adaptiveMemory.provider}; ${formatSignals(adaptiveSignals)}.`,
    },
    {
      id: "runner-ui-visual-helpers",
      title: "Runner UI / visual helpers",
      screen: "runner-ui-visual-helpers-detail",
      readiness: readinessFromSignals(visualSignals),
      selectedCount: selectedVisualHelpers,
      totalCount: 1,
      actionCount: visualSignals.actions,
      detail: `Mermaid es requerido del runner; pi-hud es opcional y solo Pi; ${formatSignals(visualSignals)}.`,
    },
    {
      id: "teams",
      title: "Teams",
      screen: "teams-detail",
      readiness: readinessFromSignals(teamSignals),
      selectedCount: selectedTeams,
      totalCount: Object.keys(state.teams).length,
      actionCount: teamSignals.actions,
      detail: `${selectedTeams} team(s) seleccionados; ${formatSignals(teamSignals)}.`,
    },
    {
      id: "review-install",
      title: "Review & Install",
      screen: "review-plan",
      readiness: state.plan?.ready ? "ready" : counts.total > 0 ? "attention" : "pending",
      selectedCount: counts.total,
      totalCount: counts.total,
      actionCount: counts.total,
      detail: `${counts.automatic} automáticas, ${counts.manual} manuales/pendientes, ${counts.config} config, ${counts.team} team, ${counts.validation} validación.`,
    },
  ];
}

export function getRunnerCapabilitySummaries(state: PiRunnerDashboardState): CapabilityOptionSummary[] {
  const configurable: UserSelectableCapabilityId[] = ["rtk", "context-mode", "codebase-memory"];
  const summaries = configurable.map((capabilityId) => capabilitySummary(state, capabilityId, Boolean(state.selectedCapabilities[capabilityId])));

  summaries.push(capabilitySummary(state, "runner-mermaid", true));

  if (state.runnerScope === "pi") {
    summaries.push(capabilitySummary(state, "pi-hud", Boolean(state.selectedCapabilities["pi-hud"])));
  }

  return summaries;
}

export function getAdaptiveMemorySummary(state: PiRunnerDashboardState): AdaptiveMemorySummary {
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
      ? "Sin memoria adaptativa activa por default."
      : provider === "engram"
        ? "Engram habilita la acción técnica engram-memory derivada."
        : "Supermemory usa config no secreta y credenciales MCP redactadas.",
  };
}

export function getTeamCapabilityProfile(state: PiRunnerDashboardState, teamId: string): TeamCapabilityProfile {
  const team = state.teams[teamId];
  const mermaidStatus = state.capabilityStatuses["runner-mermaid"];
  const installable = !team?.selected || mermaidStatus === "ready";

  return {
    teamId,
    installable,
    capabilities: {
      "runner-mermaid": "inherits-runner",
      "context-mode": state.selectedCapabilities["context-mode"] ? "compatible" : "not-used",
      "codebase-memory": state.selectedCapabilities["codebase-memory"] ? "consumes-directly" : "not-used",
      rtk: state.selectedCapabilities.rtk ? "compatible" : "not-used",
      "pi-hud": state.selectedCapabilities["pi-hud"] ? "compatible" : "not-used",
      "adaptive-memory": state.adaptiveMemory.provider === "none" ? "not-used" : "consumes-directly",
    },
    diagnostics: installable
      ? []
      : ["Developer Team hereda Mermaid del runner; resolver Mermaid antes de aplicar el team."],
  };
}

function capabilitySummary(state: PiRunnerDashboardState, capabilityId: CapabilityId, selected: boolean): CapabilityOptionSummary {
  const capability = getPiRunnerCapability(capabilityId);
  const implementation = capability.implementations?.[state.runnerScope === "opencode" ? "opencode" : "pi"];
  const status = state.capabilityStatuses[capabilityId] ?? "unknown";

  return {
    capabilityId,
    label: capability.label,
    requirementLevel: capability.requirementLevel,
    selected,
    status,
    runnerScope: capability.runnerScope,
    implementationId: implementation?.id,
    detail: capabilityId === "runner-mermaid"
      ? `Mermaid es requerido; implementación ${implementation?.id ?? "TBD"} para ${state.runnerScope}.`
      : capability.description,
  };
}

function signalsForSection(state: PiRunnerDashboardState, capabilityIds: CapabilityId[]): SectionSignals {
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

function signalsForActions(actions: PiRunnerAction[]): SectionSignals {
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

function readinessForAdaptiveMemory(state: PiRunnerDashboardState, signals: SectionSignals): SectionReadiness {
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

function actionsForCapabilities(plan: PiRunnerReviewPlan | undefined, capabilityIds: CapabilityId[]): PiRunnerAction[] {
  if (!plan) return [];
  const wanted = new Set<CapabilityId>(capabilityIds);
  return allPlanActions(plan).filter((action) => action.capabilityId && wanted.has(action.capabilityId));
}

function actionsMatching(plan: PiRunnerReviewPlan | undefined, predicate: (action: PiRunnerAction) => boolean): PiRunnerAction[] {
  if (!plan) return [];
  return allPlanActions(plan).filter(predicate);
}

function allPlanActions(plan: PiRunnerReviewPlan): PiRunnerAction[] {
  return Object.values(plan.groups).flat();
}
