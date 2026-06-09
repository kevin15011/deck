import type { OpenCodeToolStatus } from "./required-tools";
import type { CanonicalCapabilityId } from "./capability-catalog";

export type InstallableOpenCodeToolId = "rtk" | "context-mode" | "codebase-memory" | "context7" | "serena";

/** Input for buildOpenCodeInstallationPlan */
export type BuildOpenCodeInstallationPlanOptions = {
  /** Tools to consider with their installation status */
  tools: readonly { name: string; installed: boolean }[];
  /** IDs of tools to include in the plan */
  selectedToolIds: readonly string[];
};

export type InstallableOpenCodeTool = {
  id: InstallableOpenCodeToolId;
  name: string;
  module: string;
  required: boolean;
  installKind: "opencode-plugin" | "external" | "mcp-server" | "npm-package" | "npm-package-plus-mcp" | "shell-script" | "shell-script-plus-mcp" | "python-tool";
  /** Canonical capability ID from Core registry - used for registry validation and parity reporting */
  capabilityId?: CanonicalCapabilityId;
  /** For shell-script: curl URL to pipe to shell */
  shellInstallUrl?: string;
  /** For shell-script: command to run after successful shell install (e.g., ["rtk", "init", "-g", "--opencode"]) */
  postInstallCommand?: string[];
};

export const OPENCODE_INSTALLABLE_TOOLS: InstallableOpenCodeTool[] = [
  {
    id: "rtk",
    name: "RTK",
    module: "rtk-ai/rtk",
    required: false,
    installKind: "shell-script-plus-mcp",
    capabilityId: "rtk",
    shellInstallUrl: "https://raw.githubusercontent.com/rtk-ai/rtk/refs/heads/master/install.sh",
    postInstallCommand: ["rtk", "init", "-g", "--opencode"],
  },
  { id: "context-mode", name: "context-mode", module: "context-mode", required: false, installKind: "npm-package-plus-mcp", capabilityId: "context-mode" },
  {
    id: "codebase-memory",
    name: "codebase-memory",
    module: "DeusData/codebase-memory-mcp",
    required: false,
    installKind: "shell-script",
    capabilityId: "codebase-memory",
    shellInstallUrl: "https://raw.githubusercontent.com/DeusData/codebase-memory-mcp/main/install.sh",
  },
  { id: "context7", name: "Context7", module: "@upstash/context7-mcp", required: false, installKind: "mcp-server", capabilityId: "context7" },
  {
    id: "serena",
    name: "Serena",
    module: "oraios/serena",
    required: false,
    installKind: "python-tool",
    capabilityId: "serena",
  },
];

export function buildOpenCodeInstallationPlan(options: BuildOpenCodeInstallationPlanOptions): InstallableOpenCodeTool[] {
  const installedToolNames = new Set(options.tools.filter((tool) => tool.installed).map((tool) => normalizeToolName(tool.name)));
  const selectedToolIds = new Set(options.selectedToolIds);

  return OPENCODE_INSTALLABLE_TOOLS.filter((tool) => {
    if (installedToolNames.has(normalizeToolName(tool.name))) {
      return false;
    }

    return selectedToolIds.has(tool.id);
  });
}

export function getSelectableOpenCodeTools(): InstallableOpenCodeTool[] {
  return OPENCODE_INSTALLABLE_TOOLS;
}

function normalizeToolName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
