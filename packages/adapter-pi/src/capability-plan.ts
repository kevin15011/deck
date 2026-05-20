import {
  ALL_PI_RUNNER_CAPABILITY_IDS,
  getUserFacingCapability,
  type CapabilityId,
  type CapabilityImplementationId,
  type CapabilityStatus,
  type RunnerScope,
  type TechnicalActionKind,
} from "./capability-catalog";
import {
  getCapabilityInstallableToolMappings,
  getPiInstallableTool,
  getPiPrerequisiteInstallableTools,
  type InstallablePiToolId,
} from "./installation-plan";
import {
  detectInternalRunnerPackageStatus,
  getInternalRunnerPackageInstallAction,
  type InternalRunnerPackageId,
} from "./internal-runner-packages";
import type { PiRunnerCapabilityInventory } from "./capability-inventory";
import type { PiRequiredToolsReview } from "./required-tools";

export type AdaptiveMemoryProviderChoice = "none" | "engram" | "supermemory";
export type PiRunnerActionStatus = "ready" | "manual" | "pending" | "blocked" | "complete" | "failed";

export type PiRunnerAction = {
  id: string;
  kind: TechnicalActionKind;
  title: string;
  description?: string;
  capabilityId?: CapabilityId;
  toolId?: InstallablePiToolId;
  /** Internal package identifier for automatic internal-package install actions. */
  internalPackageId?: InternalRunnerPackageId;
  implementationId?: CapabilityImplementationId;
  source?: string;
  status: PiRunnerActionStatus;
  required?: boolean;
  dependencies?: CapabilityId[];
  unresolvedCapabilities?: CapabilityId[];
  diagnostics?: string[];
};

export type PiRunnerPlanDiagnostic = {
  code: string;
  message: string;
  severity: "info" | "warning" | "error";
  capabilityId?: CapabilityId;
  actionId?: string;
};

export type PiRunnerReviewPlan = {
  groups: {
    automaticInstalls: PiRunnerAction[];
    manualSteps: PiRunnerAction[];
    configWrites: PiRunnerAction[];
    teamApplications: PiRunnerAction[];
    validations: PiRunnerAction[];
  };
  diagnostics: PiRunnerPlanDiagnostic[];
  ready: boolean;
};

type BuildPiRunnerReviewPlanState = {
  runnerScope?: RunnerScope;
  selectedCapabilities?: Partial<Record<CapabilityId, boolean>>;
  adaptiveMemory?: {
    provider?: AdaptiveMemoryProviderChoice;
    supermemory?: { configured?: boolean; hasToken?: boolean; userId?: string; teamId?: string; organizationId?: string };
  };
  teams?: Record<string, { selected?: boolean; modelAssignments?: unknown; thinkingAssignments?: unknown }>;
  runtime?: { toolsReview?: PiRequiredToolsReview };
};

const EXCLUDED_PLAN_TERMS = ["@juicesharp/rpiv-todo", "@juicesharp/rpiv-ask-user-question", "context7"];

type CapabilityToolPlanMetadata = ReturnType<typeof getCapabilityInstallableToolMappings>[number];

export function buildPiRunnerReviewPlan(
  state: BuildPiRunnerReviewPlanState,
  inventory: PiRunnerCapabilityInventory,
): PiRunnerReviewPlan {
  const groups: PiRunnerReviewPlan["groups"] = {
    automaticInstalls: [],
    manualSteps: [],
    configWrites: [],
    teamApplications: [],
    validations: [],
  };
  const diagnostics: PiRunnerPlanDiagnostic[] = [];
  const runnerScope = state.runnerScope ?? "pi";

  addPrerequisiteActions(groups, state.runtime?.toolsReview);
  addCapabilityActions(groups, diagnostics, state, inventory, runnerScope);
  addInternalRunnerSupportActions(groups, state.runtime?.toolsReview, runnerScope);
  addAdaptiveMemoryActions(groups, diagnostics, state, state.runtime?.toolsReview);
  addTeamActions(groups, diagnostics, state, inventory);
  addValidationActions(groups);

  const cleanGroups = removeExcludedActions(groups);
  const unresolved = [
    ...cleanGroups.manualSteps,
    ...cleanGroups.configWrites,
    ...cleanGroups.teamApplications,
    ...cleanGroups.validations,
  ].some((action) => action.status === "manual" || action.status === "pending" || action.status === "blocked" || action.kind === "pending-source");

  return {
    groups: cleanGroups,
    diagnostics: diagnostics.filter((diagnostic) => !containsExcludedTerm(diagnostic.message)),
    ready: !unresolved,
  };
}

function addPrerequisiteActions(groups: PiRunnerReviewPlan["groups"], review: PiRequiredToolsReview | undefined): void {
  const installedNames = buildInstalledNameSet(review);

  for (const tool of getPiPrerequisiteInstallableTools()) {
    if (installedNames.has(normalizeName(tool.name)) || installedNames.has(normalizeName(tool.source))) continue;

    groups.automaticInstalls.push({
      id: `prerequisite.${tool.id}`,
      kind: "install-pi-package",
      title: `Install ${tool.name}`,
      description: "Required Pi runner prerequisite derived by the capability review plan.",
      toolId: tool.id,
      source: tool.source,
      status: "ready",
      required: true,
    });
  }
}

function addCapabilityActions(
  groups: PiRunnerReviewPlan["groups"],
  diagnostics: PiRunnerPlanDiagnostic[],
  state: BuildPiRunnerReviewPlanState,
  inventory: PiRunnerCapabilityInventory,
  runnerScope: RunnerScope,
): void {
  const selectedCapabilities = state.selectedCapabilities ?? {};

  for (const [capabilityId, selected] of Object.entries(selectedCapabilities) as [CapabilityId, boolean][]) {
    if (!selected) continue;
    const entry = inventory[capabilityId];
    const capability = getUserFacingCapability(capabilityId);
    if (!capability) continue;
    const toolMetadata = getCapabilityToolMetadata(capabilityId);
    const installKind = toolMetadata?.installKind ?? capability.installKind;
    const toolId = toolMetadata?.toolId ?? capability.toolId;
    const source = toolMetadata?.source ?? capability.source;
    if (!entry || entry.status === "ready") continue;

    if (installKind === "pi-package" && toolId && entry.status === "missing") {
      groups.automaticInstalls.push({
        id: `capability.${capabilityId}.install`,
        kind: "install-pi-package",
        title: `Install ${capability.label}`,
        description: capability.description,
        capabilityId,
        toolId,
        source,
        status: "ready",
      });
      continue;
    }

    const action = installKind === "pending"
      ? buildPendingSourceAction(capabilityId, entry.status, entry.source, entry.implementationId as CapabilityImplementationId | undefined, capability.requirementLevel === "required")
      : buildManualExternalAction(capabilityId, toolId, source);
    groups.manualSteps.push(action);
    addCapabilityDiagnostic(diagnostics, capabilityId, entry.status, action.id, entry.diagnostics?.join(" ") ?? "");
  }
}

/**
 * Handles internal runner support — automatic silent install or ready/not-checked feedback.
 *
 * Replaces the manual `runner-mermaid` pending-source flow with automatic
 * internal package support actions (Fix #1).
 *
 * - Missing `pi-mermaid` → automatic install action titled "Install visual explanation support"
 * - Present `pi-mermaid` → validation/ready feedback only
 * - Absent review data → "not-checked" feedback only (no install action scheduled)
 *
 * Fix #1: Sets `internalPackageId` on the install action so the action-runner can route
 * it through `installInternalRunnerPackages()` instead of `buildInstallableTool()`.
 * Fix #2: Uses neutral `Validate visual explanation support` instead of Mermaid terminology.
 *
 * REQ-PIINSTALL-001, REQ-PIINSTALL-002, REQ-PIINSTALL-003.
 */
function addInternalRunnerSupportActions(
  groups: PiRunnerReviewPlan["groups"],
  review: PiRequiredToolsReview | undefined,
  runnerScope: RunnerScope,
): void {
  if (runnerScope !== "pi") return;

  const packageId: InternalRunnerPackageId = "pi-mermaid";
  const state = detectInternalRunnerPackageStatus(packageId, review);

  // Fix #4: When review data is absent, surface "not-checked" validation feedback
  // rather than scheduling an install without evidence.
  if (state.status === "ready" || state.status === "not-checked") {
    const feedbackTitle = state.status === "ready"
      ? "Validate visual explanation support"
      : "Validate visual explanation support";
    const feedbackDescription = state.status === "ready"
      ? "Visual explanation support is required and already satisfied."
      : "Could not verify visual explanation support — review data is not available.";
    groups.validations.push({
      id: "capability.runner-mermaid.validate",
      kind: "validate",
      title: feedbackTitle,
      description: feedbackDescription,
      capabilityId: "runner-mermaid",
      // implementationId intentionally omitted — do not expose pi-mermaid in user-facing review
      source: "npm:pi-mermaid",
      status: "ready",
      required: true,
    });
    return;
  }

  const installAction = getInternalRunnerPackageInstallAction(packageId, review);
  if (installAction) {
    groups.automaticInstalls.push({
      id: `internal.${packageId}.install`,
      kind: "install-pi-package",
      title: "Install visual explanation support",
      description: "Automatically installs visual explanation support.",
      // Fix #1: Set internalPackageId so the action-runner routes this through
      // installInternalRunnerPackages() instead of buildInstallableTool().
      internalPackageId: packageId,
      source: installAction.source,
      status: "ready",
      required: true,
    });
  }
}

function addAdaptiveMemoryActions(
  groups: PiRunnerReviewPlan["groups"],
  diagnostics: PiRunnerPlanDiagnostic[],
  state: BuildPiRunnerReviewPlanState,
  review: PiRequiredToolsReview | undefined,
): void {
  const provider = state.adaptiveMemory?.provider ?? "none";
  if (provider === "none") return;

  if (provider === "engram") {
    const installedNames = buildInstalledNameSet(review);
    if (installedNames.has("engram") || installedNames.has("engram-memory")) {
      groups.validations.push({
        id: "adaptive-memory.engram.validate",
        kind: "validate",
        title: "Validate Engram adaptive memory",
        description: "Engram selected as the single Adaptive Memory provider.",
        toolId: "engram-memory",
        source: getPiInstallableTool("engram-memory")?.source,
        status: "ready",
      });
      return;
    }

    groups.manualSteps.push({
      id: "adaptive-memory.engram.manual-install",
      kind: "manual-external-install",
      title: "Install Engram adaptive memory",
      description: "Engram/engram-memory appears only because Adaptive Memory = Engram is selected.",
      toolId: "engram-memory",
      source: getPiInstallableTool("engram-memory")?.source,
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
    diagnostics: ["Supermemory tokens must be handed off through Pi MCP config, not Deck config."],
  });
  groups.configWrites.push({
    id: "adaptive-memory.supermemory.pi-mcp-config",
    kind: "write-pi-mcp-config",
    title: "Configure Supermemory Pi MCP credentials",
    description: "Writes/validates redacted Pi MCP credential handoff for Supermemory.",
    status: hasToken ? "ready" : "pending",
    required: true,
    diagnostics: ["Credential value must be redacted and never persisted in Deck config."],
  });
  groups.validations.push({
    id: "adaptive-memory.supermemory.validate",
    kind: "validate",
    title: "Validate Supermemory provider configuration",
    description: "Validate non-secret config and Pi MCP server before provider injection.",
    status: supermemoryReady ? "ready" : "pending",
    required: true,
  });
  diagnostics.push({
    code: "SUPERMEMORY_CONFIGURATION_REQUIRED",
    severity: supermemoryReady ? "info" : "warning",
    message: supermemoryReady
      ? "Supermemory uses config/validation/provider handoff only; no package install action is generated."
      : "Supermemory requires non-secret userId config plus Pi MCP token handoff before provider injection; no package install action is generated.",
    actionId: "adaptive-memory.supermemory.deck-config",
  });
}

function addTeamActions(
  groups: PiRunnerReviewPlan["groups"],
  diagnostics: PiRunnerPlanDiagnostic[],
  state: BuildPiRunnerReviewPlanState,
  inventory: PiRunnerCapabilityInventory,
): void {
  const developerTeam = state.teams?.["developer-team"];
  if (!developerTeam?.selected) return;

  // REQ-TEAMINSTALL-003: Developer Team must not be blocked by visual support status.
  // runner-mermaid is handled silently via pi-mermaid internal runner packages.
  // Only check user-facing unresolved capabilities.
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

function addValidationActions(groups: PiRunnerReviewPlan["groups"]): void {
  groups.validations.push({
    id: "validation.pi-runner-capabilities",
    kind: "validate",
    title: "Validate Pi runner capability state",
    description: "Re-run environment/tool checks after executable actions complete.",
    status: "ready",
  });
}

function buildManualExternalAction(capabilityId: CapabilityId, toolId: InstallablePiToolId | undefined, source: string | undefined): PiRunnerAction {
  const capability = getUserFacingCapability(capabilityId);
  return {
    id: `capability.${capabilityId}.manual`,
    kind: "manual-external-install",
    title: `Manual setup: ${capability?.label ?? capabilityId}`,
    description: capability?.description,
    capabilityId,
    toolId,
    source,
    status: "manual",
    diagnostics: [`${capability?.label ?? capabilityId} is external/manual; it is not treated as a failed automatic install.`],
  };
}

function buildPendingSourceAction(
  capabilityId: CapabilityId,
  status: CapabilityStatus,
  source: string | undefined,
  implementationId: CapabilityImplementationId | undefined,
  required: boolean,
): PiRunnerAction {
  const capability = getUserFacingCapability(capabilityId);
  return {
    id: `capability.${capabilityId}.pending-source`,
    kind: "pending-source",
    title: `${capability?.label ?? capabilityId}: source pending`,
    description: capability?.description,
    capabilityId,
    implementationId,
    source: source ?? "TBD",
    status: status === "blocked" ? "blocked" : "pending",
    required,
    diagnostics: [`${capability?.label ?? capabilityId} has no confirmed source/detector yet.`],
  };
}

function addCapabilityDiagnostic(
  diagnostics: PiRunnerPlanDiagnostic[],
  capabilityId: CapabilityId,
  status: CapabilityStatus,
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

function getCapabilityToolMetadata(capabilityId: CapabilityId): CapabilityToolPlanMetadata | undefined {
  return getCapabilityInstallableToolMappings().find((mapping) => mapping.capabilityId === capabilityId);
}

/**
 * Returns user-facing capability IDs that are unresolved.
 * Excludes `runner-mermaid` — visual support is handled silently via
 * internal runner packages (pi-mermaid), not as a blocking user-facing capability.
 *
 * REQ-TEAMINSTALL-003: Developer Team must not be blocked by visual support status.
 */
function getUnresolvedTeamCapabilities(inventory: PiRunnerCapabilityInventory): CapabilityId[] {
  const userFacingIds = ALL_PI_RUNNER_CAPABILITY_IDS.filter((id) => {
    const entry = getUserFacingCapability(id);
    return entry && entry.requirementLevel === "required";
  });

  return userFacingIds.filter((capabilityId) => {
    const status = inventory[capabilityId]?.status;
    return status !== "ready";
  });
}

function removeExcludedActions(groups: PiRunnerReviewPlan["groups"]): PiRunnerReviewPlan["groups"] {
  return {
    automaticInstalls: groups.automaticInstalls.filter((action) => !actionContainsExcludedTerm(action)),
    manualSteps: groups.manualSteps.filter((action) => !actionContainsExcludedTerm(action)),
    configWrites: groups.configWrites.filter((action) => !actionContainsExcludedTerm(action)),
    teamApplications: groups.teamApplications.filter((action) => !actionContainsExcludedTerm(action)),
    validations: groups.validations.filter((action) => !actionContainsExcludedTerm(action)),
  };
}

function actionContainsExcludedTerm(action: PiRunnerAction): boolean {
  return [action.id, action.title, action.description, action.source, action.toolId, ...(action.diagnostics ?? [])]
    .filter((value): value is string => Boolean(value))
    .some(containsExcludedTerm);
}

function containsExcludedTerm(value: string): boolean {
  const normalized = value.toLowerCase();
  return EXCLUDED_PLAN_TERMS.some((term) => normalized.includes(term.toLowerCase()));
}

function buildInstalledNameSet(review: PiRequiredToolsReview | undefined): Set<string> {
  return new Set([
    ...(review?.installedPackages ?? []),
    ...(review?.requiredTools.filter((tool) => tool.installed).map((tool) => tool.name) ?? []),
  ].map(normalizeName));
}

function normalizeName(value: string): string {
  return value
    .replace(/^npm:/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}