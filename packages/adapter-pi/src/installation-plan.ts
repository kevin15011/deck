import type { RequiredToolStatus } from "./required-tools";

export type InstallablePiToolId =
  | "sub-agents"
  | "mcp-packages"
  | "context-mode"
  | "codebase-memory"
  | "rtk"
  | "context7"
  | "engram-memory";

export type InstallablePiTool = {
  id: InstallablePiToolId;
  name: string;
  source: string;
  required: boolean;
  installKind: "pi-package" | "external";
};

type BuildPiInstallationPlanOptions = {
  requiredTools: RequiredToolStatus[];
  selectedOptionalToolIds: InstallablePiToolId[];
};

export const PI_INSTALLABLE_TOOLS: InstallablePiTool[] = [
  { id: "sub-agents", name: "sub-agents", source: "npm:pi-subagents", required: true, installKind: "pi-package" },
  { id: "mcp-packages", name: "MCP packages", source: "npm:pi-mcp-adapter", required: true, installKind: "pi-package" },
  { id: "context-mode", name: "context-mode", source: "npm:context-mode", required: false, installKind: "pi-package" },
  { id: "codebase-memory", name: "codebase-memory", source: "DeusData/codebase-memory-mcp", required: false, installKind: "external" },
  { id: "rtk", name: "RTK", source: "rtk-ai/rtk", required: false, installKind: "external" },
  { id: "context7", name: "Context7", source: "npm:@dreki-gg/pi-context7", required: false, installKind: "pi-package" },
  { id: "engram-memory", name: "Engram memory", source: "Gentleman-Programming/engram", required: false, installKind: "external" },
];

export function buildPiInstallationPlan(options: BuildPiInstallationPlanOptions): InstallablePiTool[] {
  const installedToolNames = new Set(
    options.requiredTools.filter((tool) => tool.installed).map((tool) => normalizeToolName(tool.name)),
  );
  const selectedOptionalToolIds = new Set(options.selectedOptionalToolIds);

  return PI_INSTALLABLE_TOOLS.filter((tool) => {
    if (installedToolNames.has(normalizeToolName(tool.name))) {
      return false;
    }

    return tool.required || selectedOptionalToolIds.has(tool.id);
  });
}

export function getOptionalPiTools(): InstallablePiTool[] {
  return PI_INSTALLABLE_TOOLS.filter((tool) => !tool.required);
}

function normalizeToolName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
