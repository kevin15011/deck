import { validateDeckConfig, type CrossRunnerConfig, type NormalizedDeckConfig, type RunnerAdapter, type RunnerModelInventory } from "@deck/core";
import type { DeckConfigStore } from "../deck-config-store";

export const CROSS_MEMBERS = ["lead", "investigate", "architect", "apply-fast", "apply-deep", "quality", "setup"] as const;
export type ModelPickerTarget = { kind: "runner-native"; runnerId: string } | { kind: "cross-member"; memberId: string; runnerId: string };
export const pickerRunner = (target: ModelPickerTarget): string => target.runnerId;
export type CrossRunnerReadiness = { runnerId: string; label: string; ready: boolean; reason?: string };
export function createCrossDraft(config: NormalizedDeckConfig): CrossRunnerConfig {
  return structuredClone(config.crossRunner ?? validateDeckConfig({ crossRunner: {} }).crossRunner!);
}
export async function inspectCrossRunner(adapter: RunnerAdapter, projectRoot: string): Promise<CrossRunnerReadiness> {
  const base = { runnerId: adapter.runnerId, label: adapter.displayName };
  if (!adapter.getSessionDriver) return { ...base, ready: false, reason: "No session driver" };
  try {
    const runtimes = await adapter.detectRuntimes({ projectRoot, environmentId: adapter.environmentIds[0]! });
    if (!runtimes.some(runtime => runtime.isAvailable)) return { ...base, ready: false, reason: "Runner not installed" };
    return { ...base, ready: true };
  } catch { return { ...base, ready: false, reason: "Runner detection failed; retry" }; }
}
export function buildCrossReview(draft: CrossRunnerConfig, runners: readonly CrossRunnerReadiness[]) {
  const blockers: string[] = [];
  if (!draft.members.lead) blockers.push("Lead assignment is required.");
  for (const [member, assignment] of Object.entries(draft.members)) {
    if (assignment.runnerId === "claude" && assignment.modelId === "inherit") blockers.push(`${member}: Select an explicit Claude model; inherit is available only to native subagents.`);
    const runner = runners.find(row => row.runnerId === assignment.runnerId);
    if (!runner?.ready) blockers.push(`${member}: ${runner?.reason ?? "Runner is unavailable"} (${assignment.runnerId}).`);
  }
  return { blockers, installActions: [] as const };
}
export function saveCrossConfiguration(store: Pick<DeckConfigStore, "patch">, draft: CrossRunnerConfig, runners: readonly CrossRunnerReadiness[]) {
  const review = buildCrossReview(draft, runners);
  if (review.blockers.length) throw new Error(review.blockers.join(" "));
  return store.patch(current => ({ ...current, crossRunner: { ...createCrossDraft(current), members: draft.members, enabled: true } }));
}
export function inventoryModels(inventory: RunnerModelInventory, providerId: string, target: ModelPickerTarget) {
  return (inventory.modelsByProvider[providerId] ?? []).filter(model => model.visibility !== "hidden"
    && !(target.kind === "cross-member" && target.runnerId === "claude" && model.id === "inherit"));
}
