import {
  resolveRunnerParity,
  type ParityReport,
  type ParityReportEntry,
  type ParityRuntimeHints,
} from "@deck/core";

import { PI_RUNNER_CAPABILITY_CONTRIBUTION } from "./capability-catalog";

export type PiParityReportEntry = Omit<ParityReportEntry, "code"> & { code?: string };
export type PiParityReport = Omit<ParityReport, "capabilities" | "gaps" | "blockers" | "silentPackages"> & {
  capabilities: readonly PiParityReportEntry[];
  gaps: readonly PiParityReportEntry[];
  blockers: readonly PiParityReportEntry[];
  silentPackages: readonly PiParityReportEntry[];
};

function legacyPiCode(entry: ParityReportEntry): string | undefined {
  switch (entry.code) {
    case "capability-binary-not-usable":
      return "shared-binary-not-usable";
    case "capability-index-unverified":
      return entry.capabilityId === "codebase-memory" ? "codebase-memory-index-unverified" : entry.code;
    case "capability-configuration-unverified":
      return entry.capabilityId === "supermemory-tool-bindings" ? "memory-tools-unverified" : entry.code;
    case "capability-mapping-gap":
      return entry.capabilityId === "rtk" ? "pi-rtk-mapping-missing" : entry.code;
    case "capability-mcp-not-configured":
      if (entry.capabilityId === "context-mode") return "pi-context-mode-mcp-missing";
      if (entry.capabilityId === "codebase-memory" || entry.capabilityId === "codebase-memory-mcp") return "codebase-memory-mcp-missing";
      if (entry.capabilityId === "context7") return "mcp-standard-blocked";
      if (entry.capabilityId === "supermemory-tool-bindings") return "memory-tools-unverified";
      return entry.code;
    default:
      return entry.code;
  }
}

function translateEntry(entry: ParityReportEntry): PiParityReportEntry {
  const code = legacyPiCode(entry);
  return code === undefined ? { ...entry } : { ...entry, code };
}

/** Compatibility projection for Pi consumers that still inspect legacy parity codes. */
export function resolvePiRunnerParity(runtimeHints?: ParityRuntimeHints): PiParityReport {
  const report = resolveRunnerParity("pi", runtimeHints, [PI_RUNNER_CAPABILITY_CONTRIBUTION]);
  return {
    runnerId: report.runnerId,
    capabilities: report.capabilities.map(translateEntry),
    gaps: report.gaps.map(translateEntry),
    blockers: report.blockers.map(translateEntry),
    silentPackages: report.silentPackages.map(translateEntry),
  };
}
