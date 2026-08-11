import { readDeckConfig } from "@deck/core/config/deck-config";
import { runPiLaunch, type PiLaunchResult, type RunPiLaunchOptions } from "./pi-launch-command";

export type RunPiLaunchLegacyCompatibilityOptions = Omit<RunPiLaunchOptions, "deckConfig"> & { deckConfig?: unknown };

export async function runPiLaunchLegacyCompatibility(options: RunPiLaunchLegacyCompatibilityOptions): Promise<PiLaunchResult> {
  if (options.memoryProvider && options.deckConfig === undefined) return runPiLaunch(options as RunPiLaunchOptions);
  const deckConfig = options.deckConfig ?? readDeckConfig(options.projectRoot);
  return runPiLaunch({ ...options, deckConfig });
}
