import type { CapabilityToolMapping } from "./capability-catalog";
import type { InternalRunnerPackageId } from "./internal-runner-packages";
import type { RequiredToolStatus } from "./required-tools";

export type { InternalRunnerPackageId } from "./internal-runner-packages";

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

// ---------------------------------------------------------------------------
// Internal runner package boundary
//
// Design decision: pi-mermaid is NOT in PI_INSTALLABLE_TOOLS. It lives in the
// internal runner packages catalog (internal-runner-packages.ts) and is installed
// silently without dashboard selection. This assertion exists to prevent accidental
// re-inclusion during future changes.
//
// REQ-DASH-001: Mermaid/runner-mermaid must not be a configurable dashboard option.
// REQ-PIINSTALL-003: Required internal support must not become a configuration decision.
// Fix #3: Uses Extract to correctly detect whether "pi-mermaid" is in the union.
// ---------------------------------------------------------------------------

/** Internal runner package IDs that must NOT appear in PI_INSTALLABLE_TOOLS. */
export const INTERNAL_INSTALLABLE_BOUNDARY: InternalRunnerPackageId[] = ["pi-mermaid"];

/**
 * Compile-time assertion: pi-mermaid must not be in the user-facing install catalog.
 * Fix #3: Uses Extract<..., "pi-mermaid"> extends never to correctly detect
 * whether "pi-mermaid" is a member of the union. If this fails, do NOT add pi-mermaid
 * to PI_INSTALLABLE_TOOLS — move it to internal-runner-packages.ts instead.
 */
type _AssertInternalBoundary = Extract<(typeof PI_INSTALLABLE_TOOLS)[number]["id"], "pi-mermaid"> extends never ? true : never;

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _boundaryAssertion: _AssertInternalBoundary = true;

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