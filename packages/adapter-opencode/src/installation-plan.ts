import type { OpenCodeToolStatus } from "./required-tools";

export type InstallableOpenCodeToolId = "rtk" | "context-mode" | "codebase-memory" | "context7";

export type InstallableOpenCodeTool = {
  id: InstallableOpenCodeToolId;
  name: string;
  module: string;
  required: boolean;
  installKind: "opencode-plugin" | "external";
};

type BuildOpenCodeInstallationPlanOptions = {
  tools: OpenCodeToolStatus[];
  selectedToolIds: InstallableOpenCodeToolId[];
};

export const OPENCODE_INSTALLABLE_TOOLS: InstallableOpenCodeTool[] = [
  { id: "rtk", name: "RTK", module: "rtk-ai/rtk", required: false, installKind: "external" },
  { id: "context-mode", name: "context-mode", module: "context-mode", required: false, installKind: "opencode-plugin" },
  { id: "codebase-memory", name: "codebase-memory", module: "DeusData/codebase-memory-mcp", required: false, installKind: "external" },
  { id: "context7", name: "Context7", module: "@upstash/context7-mcp", required: false, installKind: "opencode-plugin" },
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
