import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";

import {
  applyOpenCodeDeveloperTeamInstall,
  buildOpenCodeDeveloperTeamInstallPlan,
} from "@deck/adapter-opencode";
import { validateDeckConfig } from "@deck/core/config/deck-config";
import { getStandaloneSkill, getStandaloneSkills } from "@deck/core/skills/external";
import {
  getEnabledCapabilityInstructionIds,
  buildCapabilityInstructionBundle,
  type CapabilityInstructionBundle,
} from "@deck/core/teams/developer/instruction-bundles";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RunOpenCodeLaunchOptions = {
  teamId: string;
  projectRoot: string;
  deckConfig: unknown;
  commandExists?: (command: string) => boolean;
  opencodeCommand?: string;
  configDir?: string;

  dryRun?: boolean;
};

export type OpenCodeLaunchResult =
  | { status: "error"; message: string }
  | { status: "ready"; plan: OpenCodeLaunchPlan }
  | { status: "launched"; plan: OpenCodeLaunchPlan };

export type OpenCodeLaunchPlan = {
  command: string;
  args: string[];
  cwd: string;
};

// ---------------------------------------------------------------------------
// Main launch
// ---------------------------------------------------------------------------

export async function runOpenCodeLaunch(options: RunOpenCodeLaunchOptions): Promise<OpenCodeLaunchResult> {
  const { teamId, projectRoot, dryRun = false } = options;
  const commandExists = options.commandExists ?? defaultCommandExists;
  const opencodeCommand = options.opencodeCommand ?? "opencode";
  const configDir = options.configDir ?? join(process.env.HOME ?? "/home/user", ".config", "opencode");

  // 1. Verify opencode is in PATH
  if (!commandExists(opencodeCommand)) {
    return {
      status: "error",
      message: `OpenCode command not found: "${opencodeCommand}". Install OpenCode first or check your PATH.`,
    };
  }

  // 3. Build capability instructions from config
  let capabilityInstructions: CapabilityInstructionBundle | undefined;
  if (options.deckConfig === undefined) {
    return {
      status: "error",
      message: "OpenCode launch requires a valid caller-resolved global Deck config.",
    };
  }
  let deckConfig;
  try {
    deckConfig = validateDeckConfig(options.deckConfig);
  } catch {
    return {
      status: "error",
      message: "OpenCode launch requires a valid caller-resolved global Deck config.",
    };
  }
  try {
    const enabledIds = getEnabledCapabilityInstructionIds(deckConfig, "opencode");
    if (enabledIds.length > 0) {
      capabilityInstructions = buildCapabilityInstructionBundle(enabledIds);
    }
  } catch {
    // Config not available or invalid — continue without capability instructions
  }

  // 4. Build the install plan with static-compatible standalone assets.
  const standaloneSkills = getStandaloneSkills().map((s: { skillId: string }) => {
    const bundle = getStandaloneSkill(s.skillId);
    return { skillId: s.skillId, body: bundle.SKILL, files: bundle.files };
  });
  const installPlan = buildOpenCodeDeveloperTeamInstallPlan(projectRoot, {
    configDir,
    capabilityInstructions,
    personality: deckConfig.orchestratorPersonality,
    standaloneSkills,

  });


  // 4. Apply install (config merge + prompt/command/skill files)
  const applyResult = applyOpenCodeDeveloperTeamInstall(installPlan, { configDir });

  if (applyResult.configMergeResult) {
    // Config merge succeeded
  }

  // 5. Build compatibility launch plan only. No host, bridge, spawn, persistence, or cleanup is owned here.
  const plan: OpenCodeLaunchPlan = {
    command: opencodeCommand,
    args: [projectRoot],
    cwd: projectRoot,
  };

  if (dryRun) {
    return { status: "ready", plan };
  }

  return { status: "launched", plan };
}

function defaultCommandExists(command: string): boolean {
  const path = process.env.PATH ?? "";
  return path.split(delimiter).some((dir) => {
    try {
      accessSync(join(dir, command), constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}
