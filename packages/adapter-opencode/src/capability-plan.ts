import {
  ALL_OPENCODE_RUNNER_CAPABILITY_IDS,
  getUserFacingOpenCodeCapability,
  type OpenCodeCapabilityId,
  type OpenCodeCapabilityStatus,
} from "./capability-catalog";
import { OPENCODE_INSTALLABLE_TOOLS } from "./installation-plan";
import type { OpenCodeRunnerCapabilityInventory } from "./capability-inventory";
import type { OpenCodeToolsReview } from "./required-tools";
import type { CapabilityInstructionBundle } from "@deck/core/teams/developer/instruction-bundles";

export type AdaptiveMemoryProviderChoice = "none" | "engram" | "supermemory";
export type OpenCodeRunnerActionStatus = "ready" | "manual" | "pending" | "blocked" | "complete" | "failed";

export type OpenCodeRunnerAction = {
  id: string;
  kind: string;
  title: string;
  description?: string;
  capabilityId?: OpenCodeCapabilityId;
  toolId?: string;
  source?: string;
  status: OpenCodeRunnerActionStatus;
  required?: boolean;
  dependencies?: string[];
  unresolvedCapabilities?: string[];
  diagnostics?: string[];
};

export type OpenCodeRunnerPlanDiagnostic = {
  code: string;
  message: string;
  severity: "info" | "warning" | "error";
  capabilityId?: string;
  actionId?: string;
};

export type OpenCodeRunnerReviewPlan = {
  groups: {
    automaticInstalls: OpenCodeRunnerAction[];
    manualSteps: OpenCodeRunnerAction[];
    configWrites: OpenCodeRunnerAction[];
    teamApplications: OpenCodeRunnerAction[];
    validations: OpenCodeRunnerAction[];
  };
  diagnostics: OpenCodeRunnerPlanDiagnostic[];
  ready: boolean;
};

type BuildOpenCodeRunnerReviewPlanState = {
  runnerScope?: string;
  selectedCapabilities?: Partial<Record<string, boolean>>;
  adaptiveMemory?: {
    provider?: AdaptiveMemoryProviderChoice;
    supermemory?: { configured?: boolean; hasToken?: boolean; userId?: string; teamId?: string; organizationId?: string };
  };
  teams?: Record<string, { selected?: boolean; modelAssignments?: unknown; thinkingAssignments?: unknown }>;
  runtime?: { toolsReview?: OpenCodeToolsReview };
  /** Package instruction toggles per runner scope. */
  packageInstructions?: Partial<Record<string, CapabilityInstructionBundle>>;
};

export function buildOpenCodeRunnerReviewPlan(
  state: BuildOpenCodeRunnerReviewPlanState,
  inventory: OpenCodeRunnerCapabilityInventory,
): OpenCodeRunnerReviewPlan {
  const groups: OpenCodeRunnerReviewPlan["groups"] = {
    automaticInstalls: [],
    manualSteps: [],
    configWrites: [],
    teamApplications: [],
    validations: [],
  };
  const diagnostics: OpenCodeRunnerPlanDiagnostic[] = [];

  addCapabilityActions(groups, diagnostics, state, inventory);
  addAdaptiveMemoryActions(groups, diagnostics, state);
  addTeamActions(groups, diagnostics, state, inventory);
  addPackageInstructionActions(groups, diagnostics, state);
  addValidationActions(groups);

  const unresolved = [
    ...groups.manualSteps,
    ...groups.configWrites,
    ...groups.teamApplications,
    ...groups.validations,
  ].some((action) => action.status === "manual" || action.status === "pending" || action.status === "blocked" || action.kind === "pending-source");

  return {
    groups,
    diagnostics,
    ready: !unresolved,
  };
}

function addCapabilityActions(
  groups: OpenCodeRunnerReviewPlan["groups"],
  diagnostics: OpenCodeRunnerPlanDiagnostic[],
  state: BuildOpenCodeRunnerReviewPlanState,
  inventory: OpenCodeRunnerCapabilityInventory,
): void {
  const selectedCapabilities = state.selectedCapabilities ?? {};

  for (const [capabilityId, selected] of Object.entries(selectedCapabilities) as [OpenCodeCapabilityId, boolean][]) {
    if (!selected) continue;
    const entry = inventory[capabilityId];
    const capability = getUserFacingOpenCodeCapability(capabilityId);
    if (!capability) continue;
    if (!entry || entry.status === "ready") continue;

    const tool = OPENCODE_INSTALLABLE_TOOLS.find((t) => t.id === capabilityId);

    if (capability.installKind === "opencode-plugin" && tool && entry.status === "missing") {
      groups.automaticInstalls.push({
        id: `capability.${capabilityId}.install`,
        kind: "install-opencode-plugin",
        title: `Install ${capability.label}`,
        description: capability.description,
        capabilityId,
        toolId: tool.id,
        source: tool.module,
        status: "ready",
      });
      continue;
    }

    const action = capability.installKind === "pending"
      ? buildPendingSourceAction(capabilityId, entry.status, entry.source)
      : buildManualExternalAction(capabilityId, tool?.module);
    groups.manualSteps.push(action);
    addCapabilityDiagnostic(diagnostics, capabilityId, entry.status, action.id, entry.diagnostics?.join(" ") ?? "");
  }
}

function addAdaptiveMemoryActions(
  groups: OpenCodeRunnerReviewPlan["groups"],
  diagnostics: OpenCodeRunnerPlanDiagnostic[],
  state: BuildOpenCodeRunnerReviewPlanState,
): void {
  const provider = state.adaptiveMemory?.provider ?? "none";
  if (provider === "none") return;

  if (provider === "engram") {
    const tool = OPENCODE_INSTALLABLE_TOOLS.find((t) => t.id === "engram-memory");
    groups.manualSteps.push({
      id: "adaptive-memory.engram.manual-install",
      kind: "manual-external-install",
      title: "Install Engram adaptive memory",
      description: "Engram adaptive memory requires manual installation for OpenCode.",
      toolId: "engram-memory",
      source: tool?.module,
      status: "manual",
      required: true,
      diagnostics: ["Install or verify Engram manually before using it as the adaptive-memory provider."],
    });
    diagnostics.push({
      code: "MANUAL_TOOL_REQUIRED",
      severity: "warning",
      message: "Engram adaptive memory requires manual external installation when selected.",
      actionId: "adaptive-memory.engram.manual-install",
    });
    return;
  }

  const supermemory = state.adaptiveMemory?.supermemory;
  const configured = Boolean(supermemory?.configured && supermemory.userId);
  const hasToken = Boolean(supermemory?.hasToken);
  const supermemoryReady = configured && hasToken;

  groups.configWrites.push({
    id: "adaptive-memory.supermemory.deck-config",
    kind: "write-deck-config",
    title: "Write Supermemory non-secret Deck config",
    description: "Records Supermemory as the selected Adaptive Memory provider without storing tokens in .deck/config.json.",
    status: configured ? "ready" : "pending",
    required: true,
    diagnostics: ["Supermemory tokens must be handed off through MCP config, not Deck config."],
  });
  groups.configWrites.push({
    id: "adaptive-memory.supermemory.opencode-mcp-config",
    kind: "write-mcp-config",
    title: "Configure Supermemory OpenCode MCP",
    description: "Writes Supermemory MCP server config to OpenCode's opencode.json.",
    status: hasToken ? "ready" : "pending",
    required: true,
    diagnostics: ["Credential value must be redacted and never persisted in Deck config."],
  });
  groups.validations.push({
    id: "adaptive-memory.supermemory.validate",
    kind: "validate",
    title: "Validate Supermemory provider configuration",
    description: "Validate non-secret config before provider injection.",
    status: supermemoryReady ? "ready" : "pending",
    required: true,
  });
  diagnostics.push({
    code: "SUPERMEMORY_CONFIGURATION_REQUIRED",
    severity: supermemoryReady ? "info" : "warning",
    message: supermemoryReady
      ? "Supermemory uses config/validation/provider handoff only; no package install action is generated."
      : "Supermemory requires non-secret userId config plus MCP token handoff before provider injection; no package install action is generated.",
    actionId: "adaptive-memory.supermemory.deck-config",
  });
}

function addTeamActions(
  groups: OpenCodeRunnerReviewPlan["groups"],
  _diagnostics: OpenCodeRunnerPlanDiagnostic[],
  state: BuildOpenCodeRunnerReviewPlanState,
  inventory: OpenCodeRunnerCapabilityInventory,
): void {
  const developerTeam = state.teams?.["developer-team"];
  if (!developerTeam?.selected) return;

  const unresolvedCapabilities = getUnresolvedTeamCapabilities(inventory);
  const blocked = unresolvedCapabilities.some((capabilityId) => inventory[capabilityId]?.status === "blocked");

  groups.teamApplications.push({
    id: "team.developer-team.apply",
    kind: "apply-team-bundle",
    title: "Apply Developer Team bundle",
    description: unresolvedCapabilities.length > 0
      ? "Applies Developer Team agents/skills after inherited runner capabilities are satisfied."
      : "Applies Developer Team agents/skills with existing model/thinking semantics.",
    status: unresolvedCapabilities.length === 0 ? "ready" : blocked ? "blocked" : "pending",
    required: true,
    unresolvedCapabilities,
  });
}

function addValidationActions(groups: OpenCodeRunnerReviewPlan["groups"]): void {
  groups.validations.push({
    id: "validation.opencode-runner-capabilities",
    kind: "validate",
    title: "Validate OpenCode runner capability state",
    description: "Re-run environment/tool checks after executable actions complete.",
    status: "ready",
  });
}

/**
 * Adds a config-write action when package instruction injection is enabled for a runner scope.
 *
 * Package instruction injection is toggled per-runner via .deck/config.json's `packageInstructions`
 * field. When a runner scope has at least one instruction enabled, we persist that config so it
 * survives across `deck-init` runs.
 *
 * This writes to .deck/config.json's `packageInstructions` field, NOT the same config key used by
 * internal-runner packages. They are independent.
 */
function addPackageInstructionActions(
  groups: OpenCodeRunnerReviewPlan["groups"],
  diagnostics: OpenCodeRunnerPlanDiagnostic[],
  state: BuildOpenCodeRunnerReviewPlanState,
): void {
  const runnerScope = state.runnerScope ?? "opencode";
  const opencodeBundle = state.packageInstructions?.[runnerScope];
  if (!opencodeBundle || opencodeBundle.instructions.length === 0) return;

  groups.configWrites.push({
    id: "package-instructions.opencode.deck-config",
    kind: "write-deck-config",
    title: "Write package instruction configuration",
    description: "Persists per-runner package instruction toggles to .deck/config.json. This controls prompt instruction injection, not package installation.",
    status: "ready",
    required: false,
    diagnostics: [
      "Package instruction toggles affect prompt content only; they do not install or remove packages.",
    ],
  });

  diagnostics.push({
    code: "PACKAGE_INSTRUCTIONS_CONFIGURED",
    severity: "info",
    message: "Package instruction injection is enabled; prompt content will include configured package guidance.",
    actionId: "package-instructions.opencode.deck-config",
  });
}

function buildManualExternalAction(capabilityId: OpenCodeCapabilityId, source: string | undefined): OpenCodeRunnerAction {
  const capability = getUserFacingOpenCodeCapability(capabilityId);
  return {
    id: `capability.${capabilityId}.manual`,
    kind: "manual-external-install",
    title: `Manual setup: ${capability?.label ?? capabilityId}`,
    description: capability?.description,
    capabilityId,
    source,
    status: "manual",
    diagnostics: [`${capability?.label ?? capabilityId} is external/manual; it is not treated as a failed automatic install.`],
  };
}

function buildPendingSourceAction(capabilityId: OpenCodeCapabilityId, status: OpenCodeCapabilityStatus, source: string | undefined): OpenCodeRunnerAction {
  const capability = getUserFacingOpenCodeCapability(capabilityId);
  return {
    id: `capability.${capabilityId}.pending-source`,
    kind: "pending-source",
    title: `${capability?.label ?? capabilityId}: source pending`,
    description: capability?.description,
    capabilityId,
    source: source ?? "TBD",
    status: status === "blocked" ? "blocked" : "pending",
    diagnostics: [`${capability?.label ?? capabilityId} has no confirmed source/detector yet.`],
  };
}

function addCapabilityDiagnostic(
  diagnostics: OpenCodeRunnerPlanDiagnostic[],
  capabilityId: OpenCodeCapabilityId,
  status: OpenCodeCapabilityStatus,
  actionId: string,
  detail: string,
): void {
  diagnostics.push({
    code: status === "manual" ? "MANUAL_TOOL_REQUIRED" : "CAPABILITY_SOURCE_UNKNOWN",
    severity: status === "blocked" ? "error" : "warning",
    message: detail || `${capabilityId} is ${status}.`,
    capabilityId,
    actionId,
  });
}

function getUnresolvedTeamCapabilities(inventory: OpenCodeRunnerCapabilityInventory): OpenCodeCapabilityId[] {
  const userFacingIds = ALL_OPENCODE_RUNNER_CAPABILITY_IDS.filter((id) => {
    const entry = getUserFacingOpenCodeCapability(id);
    return entry && entry.requirementLevel === "required";
  });

  return userFacingIds.filter((capabilityId) => {
    const status = inventory[capabilityId]?.status;
    return status !== "ready";
  });
}
