import type { CapabilityToolMapping } from "./capability-catalog";
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
  // Legacy technical tool kept for backward compatibility. The capability dashboard must not
  // expose Engram as a global selectable capability; engram-memory is only derived when
  // Adaptive Memory provider === "engram".
  { id: "engram-memory", name: "Engram memory", source: "Gentleman-Programming/engram", required: false, installKind: "external" },
];

export type CapabilityPlanToolMetadata = Pick<CapabilityToolMapping, "capabilityId" | "toolId" | "source" | "installKind" | "runnerScope" | "requirementLevel"> & {
  name: string;
};

const TOOL_TO_CAPABILITY: Partial<Record<InstallablePiToolId, CapabilityToolMapping["capabilityId"]>> = {
  "context-mode": "context-mode",
  "codebase-memory": "codebase-memory",
  rtk: "rtk",
};

export function getPiInstallableTool(toolId: InstallablePiToolId): InstallablePiTool | undefined {
  return PI_INSTALLABLE_TOOLS.find((tool) => tool.id === toolId);
}

export function getPiPrerequisiteInstallableTools(): InstallablePiTool[] {
  return PI_INSTALLABLE_TOOLS.filter((tool) => tool.required);
}

export function getCapabilityInstallableToolMappings(): CapabilityPlanToolMetadata[] {
  return PI_INSTALLABLE_TOOLS.flatMap((tool) => {
    const capabilityId = TOOL_TO_CAPABILITY[tool.id];
    if (!capabilityId) return [];

    return [{
      capabilityId,
      toolId: tool.id,
      name: tool.name,
      source: tool.source,
      installKind: tool.installKind,
      runnerScope: "all",
      requirementLevel: "configurable",
    } satisfies CapabilityPlanToolMetadata];
  });
}

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
