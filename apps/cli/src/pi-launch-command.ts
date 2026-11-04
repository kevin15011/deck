import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";
import { buildPiTeamLaunchPlan, materializeTeamProfile, type PiTeamLaunchPlan } from "@deck/adapter-pi";
import { validateDeckConfig } from "@deck/core/config/deck-config";
import { buildCapabilityInstructionBundle, getEnabledCapabilityInstructionIds } from "@deck/core/teams/developer/instruction-bundles";

export type RunPiLaunchOptions = {
  teamId: string;
  projectRoot: string;
  flags: { continue?: boolean; resume?: boolean };
  deckConfig: unknown;
  commandExists?: (command: string) => boolean;
  piCommand?: string;
  dryRun?: boolean;
};

export type PiLaunchResult =
  | { status: "error"; message: string }
  | { status: "ready"; plan: PiTeamLaunchPlan; profileDir: string }
  | { status: "launched"; plan: PiTeamLaunchPlan };

export async function runPiLaunch(options: RunPiLaunchOptions): Promise<PiLaunchResult> {
  if (options.deckConfig === undefined) return { status: "error", message: "Pi launch requires a valid caller-resolved global Deck config." };
  const { teamId, projectRoot, flags, dryRun = false } = options;
  const piCommand = options.piCommand ?? "pi";
  if (!(options.commandExists ?? defaultCommandExists)(piCommand)) {
    return { status: "error", message: `Pi command not found: "${piCommand}". Install Pi first or check your PATH.` };
  }
  let capabilityInstructions: ReturnType<typeof buildCapabilityInstructionBundle> | undefined;
  try {
    const enabledIds = getEnabledCapabilityInstructionIds(validateDeckConfig(options.deckConfig), "pi");
    if (enabledIds.length) capabilityInstructions = buildCapabilityInstructionBundle(enabledIds);
  } catch {
    // The caller owns config readiness; preserve profile materialization behavior.
  }
  materializeTeamProfile({ teamId, projectRoot, ...(capabilityInstructions ? { capabilityInstructions } : {}) });
  const plan = buildPiTeamLaunchPlan({ teamId, projectRoot, flags, piCommand });
  return dryRun ? { status: "ready", plan, profileDir: plan.profileDir } : { status: "launched", plan };
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
