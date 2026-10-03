import { buildDeveloperTeamInstallPlan, type DeveloperTeamInstallOptions } from "./developer-team-install";
import { PI_DEVELOPER_TEAM_ID } from "./global-materialization";
import { legacyContentHash, type PiLegacyTemplates } from "./pi-legacy";
import { buildTeamSystemPrompt, readPiExecutionExtensionSource } from "./pi-team-profile";

function stripScopePrefix(relativePath: string): string {
  return relativePath.replace(/^\.pi\//, "");
}

/**
 * Hashes of what the current Deck templates would have written for the project-local layout (`.pi/agents`,
 * `.pi/skills`, `.deck/pi/profiles`) and the pre-package global layout (`<agentDir>/agents|skills`).
 * Older Deck versions whose templates differ are not matched (their files are reported and kept).
 */
export function buildPiLegacyTemplates(input: { projectRoot: string; packageRoot: string; installOptions: DeveloperTeamInstallOptions }): PiLegacyTemplates {
  const hashes = new Map<string, Set<string>>();
  const add = (key: string, content: string) => {
    const set = hashes.get(key) ?? new Set<string>();
    set.add(legacyContentHash(key, content));
    hashes.set(key, set);
  };
  for (const layout of [undefined, { packageRoot: input.packageRoot }] as const) {
    const plan = buildDeveloperTeamInstallPlan(input.projectRoot, { ...input.installOptions, ...(layout ? { layout } : {}) });
    for (const file of [...plan.agents, ...plan.skills, ...plan.sddSkillFiles, ...plan.standaloneSkills]) add(stripScopePrefix(file.relativePath), file.content);
  }
  try {
    const profile = buildTeamSystemPrompt(PI_DEVELOPER_TEAM_ID, {
      ...(input.installOptions.capabilityInstructions ? { capabilityInstructions: input.installOptions.capabilityInstructions } : {}),
      ...(input.installOptions.orchestratorPersonality ? { orchestratorPersonality: input.installOptions.orchestratorPersonality } : {}),
      projectRoot: input.projectRoot,
    });
    add(`profiles/${PI_DEVELOPER_TEAM_ID}/system-prompt.md`, profile.content);
  } catch { /* the profile is then reported as modified and kept */ }
  try {
    add(`profiles/${PI_DEVELOPER_TEAM_ID}/extensions/developer-team-execution.js`, readPiExecutionExtensionSource());
  } catch { /* idem */ }
  return new Map([...hashes].map(([key, set]) => [key, [...set]]));
}
