import { piAgentPaths } from "./agent-dir";
import {
  buildDeveloperTeamInstallPlan,
  type DeveloperTeamInstallOptions,
  type DeveloperTeamInstallPlan,
  type MemoryDiagnostic,
} from "./developer-team-install";
import { buildDeckPiPackageFiles } from "./package-layout";
import type { PiGlobalDesiredState } from "./pi-global-install";
import { adaptBunBundleForNode } from "./pi-bundle-compat";
import { buildTeamSystemPrompt, readPiExecutionExtensionSource } from "./pi-team-profile";

export const PI_DEVELOPER_TEAM_ID = "developer-team";
export const PI_EXECUTION_EXTENSION_NAME = "developer-team-execution";

export type PiGlobalMaterializationInput = {
  agentDir: string;
  /** Used only to derive project identity (memory scope) and never written to. */
  projectRoot: string;
  installOptions?: Omit<DeveloperTeamInstallOptions, "layout">;
  /** Deck MCP server entries to register in the global `mcp.json` (full entries; see `pi-deck-mcp`). */
  mcpServers?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  /** Evidence that earlier Deck versions installed pi-subagents / pi-mcp-adapter. */
  legacyDeckEvidence: boolean;
  /** Override for tests; defaults to the packaged generated bundle. */
  executionExtensionSource?: string;
  teamId?: string;
};

export type PiGlobalMaterialization = {
  /** Native plan (global layout) — source of agents, skills and memory diagnostics. */
  nativePlan: DeveloperTeamInstallPlan & { memoryDiagnostics: MemoryDiagnostic[] };
  desired: PiGlobalDesiredState;
  /** Absolute path of the lead system prompt profile passed through `--system-prompt`. */
  profilePath: string;
};

/**
 * Composes everything Deck materializes for Pi into one desired state under the agent dir: the Deck package
 * (agents, skills, guarded extensions), the lead profile, the `packages` registration and MCP servers.
 * Pure: performs no I/O (the install engine applies it transactionally).
 */
export function buildPiGlobalMaterialization(input: PiGlobalMaterializationInput): PiGlobalMaterialization {
  const teamId = input.teamId ?? PI_DEVELOPER_TEAM_ID;
  const paths = piAgentPaths(input.agentDir);
  const installOptions = input.installOptions ?? {};

  const nativePlan = buildDeveloperTeamInstallPlan(input.projectRoot, {
    ...installOptions,
    layout: { packageRoot: paths.packageRoot },
  });

  const profile = buildTeamSystemPrompt(teamId, {
    ...(nativePlan.memoryBundle ? { memoryInjection: nativePlan.memoryBundle, trustedMemoryInjection: true } : {}),
    ...(installOptions.capabilityInstructions ? { capabilityInstructions: installOptions.capabilityInstructions } : {}),
    ...(installOptions.orchestratorPersonality ? { orchestratorPersonality: installOptions.orchestratorPersonality } : {}),
    ...(installOptions.supportedMemoryProviderIds ? { supportedMemoryProviderIds: installOptions.supportedMemoryProviderIds } : {}),
    projectRoot: input.projectRoot,
  });

  const skills = [...nativePlan.skills, ...nativePlan.sddSkillFiles, ...nativePlan.standaloneSkills].map((file) => ({
    relPath: file.relativePath.replace(/^skills\//, ""),
    content: file.content,
  }));

  const files = buildDeckPiPackageFiles({
    agents: nativePlan.agents.map((agent) => ({ id: agent.agent.id, content: agent.content })),
    skills,
    extensions: [{
      name: PI_EXECUTION_EXTENSION_NAME,
      // Pi runs on Node; the packaged bundle is built for Bun, so emit a Node-loadable copy.
      implementation: adaptBunBundleForNode(input.executionExtensionSource ?? readPiExecutionExtensionSource()),
      // The execution-authorization hooks belong to the lead; subagent children never register them.
      scope: "lead",
    }],
    profile: { teamId, content: profile.content },
  });

  return {
    nativePlan: { ...nativePlan, memoryDiagnostics: [...nativePlan.memoryDiagnostics, ...profile.memoryDiagnostics] },
    desired: {
      agentDir: input.agentDir,
      files,
      packageEntry: paths.packageSettingsEntry,
      mcpServers: input.mcpServers ?? {},
      legacyDeckEvidence: input.legacyDeckEvidence,
    },
    profilePath: `${paths.profilesRoot}/${teamId}/system-prompt.md`,
  };
}
