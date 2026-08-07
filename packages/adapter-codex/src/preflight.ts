import type { RunnerProjectInspection } from "@deck/core";
import { parseTOML } from "toml-eslint-parser";

export const MINIMUM_CODEX_VERSION = "0.145.0";

export type CodexProbeResult = { found: false } | { found: true; version: string; help: string; execHelp?: string; resumeHelp?: string };
export type CodexProjectSnapshot = {
  config: string | null;
  roles: readonly string[];
  skills: readonly string[];
  agentsInstructions: boolean;
};
export type CodexPreflightEffects = {
  probe(): Promise<CodexProbeResult>;
  inspectTrust?(projectRoot: string): Promise<"trusted" | "untrusted" | "indeterminate">;
  readProject?(projectRoot: string): Promise<CodexProjectSnapshot>;
};

function versionAtLeast(actual: string, minimum: string): boolean {
  const left = actual.split(".").map(Number);
  const right = minimum.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if ((left[index] ?? 0) !== (right[index] ?? 0)) return (left[index] ?? 0) > (right[index] ?? 0);
  }
  return true;
}

export async function inspectCodexProject(projectRoot: string, effects: CodexPreflightEffects): Promise<RunnerProjectInspection> {
  const probe = await effects.probe();
  if (!probe.found) {
    return { projectRoot, state: "blocked", evidence: { binary: false }, diagnostics: [{ code: "codex-binary-missing", severity: "error", message: "Codex CLI was not found on PATH." }] };
  }
  if (!versionAtLeast(probe.version, MINIMUM_CODEX_VERSION)) {
    return { projectRoot, state: "unsupported", evidence: { binary: true, version: probe.version }, diagnostics: [{ code: "codex-version-unsupported", severity: "error", message: `Codex ${probe.version} is older than supported ${MINIMUM_CODEX_VERSION}.` }] };
  }
  const trust = await effects.inspectTrust?.(projectRoot) ?? "indeterminate";
  const snapshot = await effects.readProject?.(projectRoot) ?? { config: null, roles: [], skills: [], agentsInstructions: false };
  const diagnostics = [];
  if (snapshot.config !== null) {
    try {
      parseTOML(snapshot.config, { tomlVersion: "1.0.0" });
    } catch {
      return {
        projectRoot,
        state: "blocked",
        evidence: { binary: true, version: probe.version, trust, projectConfig: true },
        diagnostics: [{ code: "codex-config-malformed", severity: "error", message: "Project-local Codex TOML is malformed and cannot be inspected safely." }],
      };
    }
  }
  if (snapshot.config !== null && trust !== "trusted") {
    diagnostics.push({ code: "materialized-but-inactive", severity: "warning" as const, message: "Project-local Codex configuration is materialized but trust is absent or indeterminate; Deck did not change trust." });
  }
  return {
    projectRoot,
    state: diagnostics.length > 0 ? "degraded" : "ready",
    evidence: {
      binary: true,
      version: probe.version,
      trust,
      projectConfig: snapshot.config !== null,
      roles: snapshot.roles,
      skills: snapshot.skills,
      agentsInstructions: snapshot.agentsInstructions,
      interactive: /Usage: codex/.test(probe.help),
      exec: /Usage: codex exec/.test(probe.execHelp ?? ""),
      resume: /\[SESSION_ID\]/.test(probe.resumeHelp ?? ""),
      resumeLatest: /--last/.test(probe.resumeHelp ?? ""),
      executionClass: "static-compatible",
    },
    diagnostics,
  };
}
