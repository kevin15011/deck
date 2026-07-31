import { createHash } from "node:crypto";

export interface LegacyGenesisPlanV1 {
  readonly schema: "legacy-registry-genesis-plan-v1";
  readonly digest: `sha256:${string}`;
  readonly changeId: string;
  readonly placement: "changes" | "archive";
  readonly artifacts: readonly { readonly path: string; readonly digest: `sha256:${string}` }[];
  readonly observedStateDigest?: `sha256:${string}`;
  readonly observedEventsDigest?: `sha256:${string}`;
  readonly observedEvents: readonly [];
  readonly confidence: "high" | "medium" | "low";
}
const digest = (value: string) => `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}` as const;
const planDigest = (value: Omit<LegacyGenesisPlanV1, "digest">) => digest(JSON.stringify(value));

/** Captures observed bytes only. It never invents a historical event timeline. */
export function planLegacyGenesisV1(input: { readonly changeId: string; readonly placement: "changes" | "archive"; readonly artifacts: readonly { readonly path: string; readonly source: string }[]; readonly stateSource?: string; readonly eventsSource?: string }): LegacyGenesisPlanV1 {
  const payload: Omit<LegacyGenesisPlanV1, "digest"> = {
    schema: "legacy-registry-genesis-plan-v1", changeId: input.changeId, placement: input.placement,
    artifacts: input.artifacts.map((item) => Object.freeze({ path: item.path, digest: digest(item.source) })),
    ...(input.stateSource === undefined ? {} : { observedStateDigest: digest(input.stateSource) }),
    ...(input.eventsSource === undefined ? {} : { observedEventsDigest: digest(input.eventsSource) }),
    observedEvents: [], confidence: input.stateSource === undefined ? "low" : input.eventsSource === undefined ? "medium" : "high",
  };
  return Object.freeze({ ...payload, digest: planDigest(payload), artifacts: Object.freeze(payload.artifacts) });
}
export async function applyGenesisAtomicallyV1(plan: LegacyGenesisPlanV1, input: { readonly acceptPlanDigest: `sha256:${string}`; readonly commit: (plan: LegacyGenesisPlanV1) => Promise<void> }): Promise<void> {
  const { digest: actualDigest, ...payload } = plan;
  if (input.acceptPlanDigest !== actualDigest || planDigest(payload) !== actualDigest) throw new Error("invalid-genesis-plan");
  await input.commit(plan);
}
