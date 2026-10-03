import { piAgentPaths } from "./agent-dir";
import {
  buildDeveloperTeamInstallPlan,
  type DeveloperTeamInstallOptions,
  type DeveloperTeamInstallPlan,
  type MemoryDiagnostic,
} from "./developer-team-install";
import { renderToolPolicyConfig } from "./pi-extensions/tool-policy/config";
import { buildDeckPiPackageFiles } from "./package-layout";
import type { PiGlobalDesiredState } from "./pi-global-install";
import { adaptBunBundleForNode } from "./pi-bundle-compat";
import { DECK_PI_MCP_SERVER_IDS, piReadOnlyToolAllowlist, renderPiMcpToolNamesSection } from "./pi-mcp-catalog";
import { readDeckPiExtensionBundle } from "./pi-extension-assets";
import { buildTeamSystemPrompt, readPiExecutionExtensionSource } from "./pi-team-profile";

export const PI_DEVELOPER_TEAM_ID = "developer-team";
export const PI_EXECUTION_EXTENSION_NAME = "developer-team-execution";
export const PI_SUBAGENTS_EXTENSION_NAME = "deck-subagents";
export const PI_MEMORY_EXTENSION_NAME = "deck-memory";
export const PI_TOOL_POLICY_EXTENSION_NAME = "deck-tool-policy";
/** Roles that never mutate the workspace (enforced by `--tools` and by the tool-policy extension). */
export const PI_READ_ONLY_ROLE_AGENT_IDS: readonly string[] = ["deck-investigate", "deck-quality"];

function configuredServerIds(mcpServers: Readonly<Record<string, unknown>>): string[] {
  return DECK_PI_MCP_SERVER_IDS.filter((id) => id in mcpServers);
}

/** Appends the Pi tool-name section and, for read-only roles, replaces the frontmatter `tools:` allowlist. */
function applyPiRoleContent(agentId: string, content: string, servers: readonly string[], section: string): string {
  let next = content;
  if (PI_READ_ONLY_ROLE_AGENT_IDS.includes(agentId)) {
    const allowlist = piReadOnlyToolAllowlist(servers).join(",");
    next = next.replace(/^(---\n[\s\S]*?)^tools: .*$/m, (_match, head: string) => `${head}tools: ${allowlist}`);
  }
  if (section) next = `${next.trimEnd()}\n\n${section}`;
  return next.endsWith("\n") ? next : `${next}\n`;
}

export type PiGlobalMaterializationInput = {
  agentDir: string;
  /** Used only to derive project identity (memory scope) and never written to. */
  projectRoot: string;
  installOptions?: Omit<DeveloperTeamInstallOptions, "layout">;
  /** Deck MCP server entries to register in the global `mcp.json` (full entries; see `pi-deck-mcp`). */
  mcpServers?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  /** Evidence that earlier Deck versions installed pi-subagents / pi-mcp-adapter. */
  legacyDeckEvidence: boolean;
  /** Absolute path of the Deck-owned RTK binary when RTK is selected and usable (enables the bash rewrite). */
  rtkBinary?: string | null;
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

  const selectedServers = configuredServerIds(input.mcpServers ?? {});
  const toolNamesSection = renderPiMcpToolNamesSection(selectedServers);

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
    agents: nativePlan.agents.map((agent) => ({ id: agent.agent.id, content: applyPiRoleContent(agent.agent.id, agent.content, selectedServers, toolNamesSection) })),
    skills,
    extensions: [{
      name: PI_EXECUTION_EXTENSION_NAME,
      // Pi runs on Node; the packaged bundle is built for Bun, so emit a Node-loadable copy.
      implementation: adaptBunBundleForNode(input.executionExtensionSource ?? readPiExecutionExtensionSource()),
      // The execution-authorization hooks belong to the lead; subagent children never register them.
      scope: "lead",
    }, {
      // Adaptive memory over the Deck loopback host: lead recall/capture and child role recall (inert without the endpoint).
      name: PI_MEMORY_EXTENSION_NAME,
      implementation: readDeckPiExtensionBundle("deck-memory"),
      scope: "any",
    }, {
      // Role tool policy, RTK rewrite and graph redirection through one ordered tool_call handler (lead and children).
      name: PI_TOOL_POLICY_EXTENSION_NAME,
      implementation: readDeckPiExtensionBundle("deck-tool-policy"),
      scope: "any",
      extraFiles: [{ name: "config.json", content: renderToolPolicyConfig({ rtkBinary: input.rtkBinary ?? null, graphRedirect: selectedServers.includes("codebase-memory") }) }],
    }, {
      // Delegation tool: registered in the lead only; children are marked DECK_PI_CHILD=1 and never get it.
      name: PI_SUBAGENTS_EXTENSION_NAME,
      implementation: readDeckPiExtensionBundle("deck-subagents"),
      scope: "lead",
    }],
    profile: { teamId, content: toolNamesSection ? `${profile.content.trimEnd()}\n\n${toolNamesSection}` : profile.content },
  });

  return {
    nativePlan: { ...nativePlan, memoryDiagnostics: [...nativePlan.memoryDiagnostics, ...profile.memoryDiagnostics] },
    desired: {
      agentDir: input.agentDir,
      files,
      packageEntry: paths.packageSettingsEntry,
      skillExclusions: [...new Set(skills.map((skill) => skill.relPath.split("/")[0] as string))].sort(),
      mcpServers: input.mcpServers ?? {},
      legacyDeckEvidence: input.legacyDeckEvidence,
    },
    profilePath: `${paths.profilesRoot}/${teamId}/system-prompt.md`,
  };
}
