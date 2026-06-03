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
import { writeOpenCodeMcpConfig } from "./opencode-mcp-config";
import { appendFileSync } from "node:fs";

const LOG = "/tmp/deck-tui.log";
function _ts() { return new Date().toISOString().slice(11, 23); }
function log(msg: string) { if (!process.env.DECK_DEBUG) return; try { appendFileSync(LOG, `${_ts()} [capability-plan] ${msg}\n`); } catch {} }

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

export type BuildOpenCodeRunnerReviewPlanState = {
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
  log(`buildOpenCodeRunnerReviewPlan: START. inventoryKeys=${Object.keys(inventory).join(",")} selectedCaps=${JSON.stringify(state.selectedCapabilities ?? {})}`);
  const groups: OpenCodeRunnerReviewPlan["groups"] = {
    automaticInstalls: [],
    manualSteps: [],
    configWrites: [],
    teamApplications: [],
    validations: [],
  };
  const diagnostics: OpenCodeRunnerPlanDiagnostic[] = [];

  try {
  addCapabilityActions(groups, diagnostics, state, inventory);
  log(`buildOpenCodeRunnerReviewPlan: addCapabilityActions done`);
  addAdaptiveMemoryActions(groups, diagnostics, state);
  log(`buildOpenCodeRunnerReviewPlan: addAdaptiveMemoryActions done`);
  addTeamActions(groups, diagnostics, state, inventory);
  log(`buildOpenCodeRunnerReviewPlan: addTeamActions done`);
  addPackageInstructionActions(groups, diagnostics, state);
  log(`buildOpenCodeRunnerReviewPlan: addPackageInstructionActions done`);
  addValidationActions(groups);
  log(`buildOpenCodeRunnerReviewPlan: addValidationActions done`);

  const unresolved = [
    ...groups.manualSteps,
    ...groups.configWrites,
    ...groups.teamApplications,
    ...groups.validations,
  ].some((action) => action.status === "manual" || action.status === "pending" || action.status === "blocked" || action.kind === "pending-source");

  log(`buildOpenCodeRunnerReviewPlan: SUCCESS. ready=${!unresolved}`);
  return {
    groups,
    diagnostics,
    ready: !unresolved,
  };
  } catch (error) {
    const msg = error instanceof Error ? `${error.message}\n${error.stack}` : String(error);
    log(`buildOpenCodeRunnerReviewPlan: FAILED: ${msg}`);
    throw error;
  }
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

    if (capability.installKind === "mcp-server" && entry.status === "missing") {
      // For MCP servers, we need to generate a config write action
      // Determine the config based on the capability
      const mcpConfig = getMcpServerConfig(capabilityId, capability.source);
      if (mcpConfig) {
        groups.automaticInstalls.push({
          id: `capability.${capabilityId}.mcp-config`,
          kind: "write-mcp-config",
          title: `Configure ${capability.label} MCP`,
          description: `Writes ${capability.label} MCP server config to opencode.json.`,
          capabilityId,
          toolId: capability.toolId,
          source: capability.source,
          status: "ready",
        });
        continue;
      }
    }

    if (capability.installKind === "npm-package" && tool && entry.status === "missing") {
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

    // shell-script: binary installed via curl | sh (e.g., codebase-memory)
    if (capability.installKind === "shell-script" && tool && entry.status === "missing") {
      groups.automaticInstalls.push({
        id: `capability.${capabilityId}.install`,
        kind: "install-opencode-plugin",
        title: `Install ${capability.label}`,
        description: capability.description,
        capabilityId,
        toolId: tool.id,
        source: tool.id,
        status: "ready",
      });
      continue;
    }

// shell-script-plus-mcp: runs shell install AND writes MCP config (for tools like rtk and codebase-memory)
    if (capability.installKind === "shell-script-plus-mcp" && tool && entry.status === "missing") {
      const mcpConfig = getMcpServerConfig(capabilityId, capability.source);
      // Generate shell install action — source is the tool ID (not the URL) so the action-runner can identify the tool
      groups.automaticInstalls.push({
        id: `capability.${capabilityId}.install`,
        kind: "install-opencode-plugin",
        title: `Install ${capability.label}`,
        description: capability.description,
        capabilityId,
        toolId: tool.id,
        source: tool.id,
        status: "ready",
      });
      // Also generate MCP config write action if MCP config is known
      if (mcpConfig) {
        groups.automaticInstalls.push({
          id: `capability.${capabilityId}.mcp-config`,
          kind: "write-mcp-config",
          title: `Configure ${capability.label} MCP`,
          description: `Writes ${capability.label} MCP server config to opencode.json.`,
          capabilityId,
          toolId: capability.toolId,
          source: capability.source,
          status: "ready",
        });
      }
      continue;
    }

    // npm-package-plus-mcp: npm global install + MCP config (e.g., context-mode)
    // NOTE: We check MCP config even when status is "ready" because the binary may exist
    // but the MCP config may not have been written yet (e.g., prior plugin-only install).
    if (capability.installKind === "npm-package-plus-mcp" && tool) {
      const mcpConfig = getMcpServerConfig(capabilityId, capability.source);
      // Generate npm install -g action ONLY if the binary is actually missing
      if (entry.status === "missing") {
        groups.automaticInstalls.push({
          id: `capability.${capabilityId}.install`,
          kind: "npm-install",
          title: `Install ${capability.label}`,
          description: capability.description,
          capabilityId,
          toolId: tool.id,
          source: tool.module,
          status: "ready",
        });
      }
      // Always generate MCP config write action if MCP config is known.
      // This handles the case where binary exists but MCP config was never written.
      if (mcpConfig) {
        groups.automaticInstalls.push({
          id: `capability.${capabilityId}.mcp-config`,
          kind: "write-mcp-config",
          title: `Configure ${capability.label} MCP`,
          description: `Writes ${capability.label} MCP server config to opencode.json.`,
          capabilityId,
          toolId: capability.toolId,
          source: capability.source,
          status: "ready",
        });
      }
      // Check for legacy plugin detection in diagnostics - if present, generate migration/cleanup action
      const hasLegacyPluginDiagnostic = entry.diagnostics?.some((d) => d.toLowerCase().includes("legacy plugin detected"));
      if (hasLegacyPluginDiagnostic) {
        groups.automaticInstalls.push({
          id: `capability.${capabilityId}.migrate`,
          kind: "migrate-plugin-to-mcp",
          title: `Migrate ${capability.label} from plugin to MCP`,
          description: `Removes legacy plugin entry and ensures clean MCP-only configuration.`,
          capabilityId,
          toolId: tool.id,
          status: "ready",
          diagnostics: ["legacy-plugin-detected"],
        });
      }
      continue;
    }

    // python-tool: Python-based tools like serena that need uv/pipx for installation
    // This handles the case where serena is selected but not installed
    if (capability.installKind === "python-tool" && tool && entry.status === "missing") {
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
      // Also generate MCP config write action (will verify serena exists before writing)
      const mcpConfig = getMcpServerConfig(capabilityId, capability.source);
      if (mcpConfig) {
        groups.automaticInstalls.push({
          id: `capability.${capabilityId}.mcp-config`,
          kind: "write-mcp-config",
          title: `Configure ${capability.label} MCP`,
          description: `Writes ${capability.label} MCP server config (requires ${tool.id} in PATH).`,
          capabilityId,
          toolId: capability.toolId,
          source: capability.source,
          status: "ready",
        });
      }
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
    // Engram is handled as adaptive memory; no tool installation needed
    return;
  }

  const supermemory = state.adaptiveMemory?.supermemory;
  const configured = Boolean(supermemory?.configured);
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
      : "Supermemory requires token configuration before provider injection; no package install action is generated.",
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
  if (!opencodeBundle || !opencodeBundle.instructions || opencodeBundle.instructions.length === 0) return;

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

/**
 * Returns MCP server configuration for a given capability.
 * Returns null if the capability doesn't have a known MCP server config.
 */
function getMcpServerConfig(capabilityId: string, source: string | undefined): { type: "local" | "remote"; command?: string[]; url?: string; headers?: Record<string, string> } | null {
  switch (capabilityId) {
    case "context7":
      return {
        type: "local",
        command: ["npx", "-y", "@upstash/context7-mcp"],
      };
    case "context-mode":
      return {
        type: "local",
        command: ["context-mode"],
      };
    case "serena":
      return {
        type: "local",
        command: ["serena", "start-mcp-server", "--context", "ide", "--project-from-cwd"],
      };
    default:
      return null;
  }
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
