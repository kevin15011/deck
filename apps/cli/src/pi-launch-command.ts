import type { PiTeamLaunchPlan } from "@deck/adapter-pi";

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

/** @deprecated Use the composed RunnerAdapter launch workflow with admission and installation leases. */
export async function runPiLaunch(options: RunPiLaunchOptions): Promise<PiLaunchResult> {
  return { status: "error", message: "Legacy Pi launch is disabled; use the RunnerAdapter launch workflow (deck pi developer)." };
}
