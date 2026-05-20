import {
  getPiRunnerCapability,
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
  selectedCapabilities?: Partial<Record<Exclude<CapabilityId, "runner-mermaid">, boolean>>;
  requiredCapabilities?: Partial<Record<Extract<CapabilityId, "runner-mermaid">, true>>;
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

  for (const [capabilityId, selected] of Object.entries(selectedCapabilities) as [Exclude<CapabilityId, "runner-mermaid">, boolean][]) {
    if (!selected) continue;
    const entry = inventory[capabilityId];
    const capability = getPiRunnerCapability(capabilityId);
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

  if (state.requiredCapabilities?.["runner-mermaid"] ?? true) {
    const entry = inventory["runner-mermaid"];
    const status = entry?.status ?? (runnerScope === "pi" ? "pending-source" : "blocked");

    if (status === "ready") {
      groups.validations.push({
        id: "capability.runner-mermaid.validate",
        kind: "validate",
        title: "Validate Mermaid runner capability",
        description: "Mermaid is required and already satisfied for the selected runner.",
        capabilityId: "runner-mermaid",
        implementationId: entry?.implementationId as CapabilityImplementationId | undefined,
        source: entry?.source,
        status: "ready",
        required: true,
      });
      return;
    }

    const action = buildPendingSourceAction(
      "runner-mermaid",
      status,
      entry?.source ?? "TBD",
      (entry?.implementationId as CapabilityImplementationId | undefined) ?? (runnerScope === "pi" ? "pi-mermaid" : "TBD"),
      true,
    );
    groups.manualSteps.push(action);
    addCapabilityDiagnostic(
      diagnostics,
      "runner-mermaid",
      status,
      action.id,
      runnerScope === "pi"
        ? "Mermaid is required; pi-mermaid is the Pi implementation and source/detection are pending."
        : "Mermaid is required; OpenCode implementation mapping is TBD.",
    );
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
    dependencies: ["runner-mermaid"],
    unresolvedCapabilities,
    diagnostics: unresolvedCapabilities.length > 0
      ? ["Developer Team depends on Mermaid runner capability; resolve pending/blocking capability actions first."]
      : undefined,
  });

  const mermaidStatus = inventory["runner-mermaid"]?.status;
  if (mermaidStatus && mermaidStatus !== "ready") {
    diagnostics.push({
      code: "TEAM_CAPABILITY_UNSATISFIED",
      severity: mermaidStatus === "blocked" ? "error" : "warning",
      message: "Developer Team consumes runner capabilities while Mermaid remains unresolved for the runner.",
      capabilityId: "runner-mermaid",
      actionId: "team.developer-team.apply",
    });
  }
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
  const capability = getPiRunnerCapability(capabilityId);
  return {
    id: `capability.${capabilityId}.manual`,
    kind: "manual-external-install",
    title: `Manual setup: ${capability.label}`,
    description: capability.description,
    capabilityId,
    toolId,
    source,
    status: "manual",
    diagnostics: [`${capability.label} is external/manual; it is not treated as a failed automatic install.`],
  };
}

function buildPendingSourceAction(
  capabilityId: CapabilityId,
  status: CapabilityStatus,
  source: string | undefined,
  implementationId: CapabilityImplementationId | undefined,
  required: boolean,
): PiRunnerAction {
  const capability = getPiRunnerCapability(capabilityId);
  return {
    id: `capability.${capabilityId}.pending-source`,
    kind: "pending-source",
    title: `${capability.label}: source pending`,
    description: capability.description,
    capabilityId,
    implementationId,
    source: source ?? "TBD",
    status: status === "blocked" ? "blocked" : "pending",
    required,
    diagnostics: [
      capabilityId === "runner-mermaid"
        ? `Mermaid is required; ${implementationId ?? "TBD"} is the runner implementation placeholder.`
        : `${capability.label} has no confirmed source/detector yet.`,
    ],
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

function getUnresolvedTeamCapabilities(inventory: PiRunnerCapabilityInventory): CapabilityId[] {
  const requiredCapabilities: CapabilityId[] = ["runner-mermaid"];
  return requiredCapabilities.filter((capabilityId) => {
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
