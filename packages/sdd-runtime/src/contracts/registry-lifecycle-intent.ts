import { assertExactKeys, assertId, cloneCanonical, codeValue, deepFreeze, enumValue, sha256Digest, stringValue, timestampValue, type Sha256Digest } from "./canonical";

export type RegistryLifecycleTransitionV1 = "park" | "reactivate" | "close-incomplete" | "abandon" | "supersede";
export interface RegistryLifecycleIntentV1 {
  readonly schema: "registry-lifecycle-intent-v1";
  readonly intentId: `registry-lifecycle-intent:v1:${string}`;
  readonly digest: Sha256Digest;
  readonly changeId: string;
  readonly transition: RegistryLifecycleTransitionV1;
  readonly reason: string;
  readonly timestamp: string;
  readonly prior: { readonly phase: string; readonly status: string };
  readonly successorChangeId?: string;
}
export type RegistryLifecycleIntentInputV1 = Omit<RegistryLifecycleIntentV1, "intentId" | "digest">;

const transitions = ["park", "reactivate", "close-incomplete", "abandon", "supersede"] as const;

export function buildRegistryLifecycleIntentV1(input: RegistryLifecycleIntentInputV1): RegistryLifecycleIntentV1 {
  const payload = cloneCanonical(input);
  const digest = sha256Digest(payload);
  return parseRegistryLifecycleIntentV1({ ...payload, intentId: `registry-lifecycle-intent:v1:${digest.slice(7, 39)}`, digest });
}

export function parseRegistryLifecycleIntentV1(value: unknown): RegistryLifecycleIntentV1 {
  assertExactKeys(value, ["schema", "intentId", "digest", "changeId", "transition", "reason", "timestamp", "prior", "successorChangeId"], "registry lifecycle intent fields");
  if (value.schema !== "registry-lifecycle-intent-v1") throw new Error("unsupported-contract-version");
  assertId(value.intentId, "registry-lifecycle-intent:v1:", "lifecycle.intentId");
  const transition = enumValue(value.transition, transitions, "lifecycle.transition");
  assertExactKeys(value.prior, ["phase", "status"], "lifecycle.prior");
  if (transition === "supersede" && value.successorChangeId === undefined) throw new Error("invalid-evidence: lifecycle.successorChangeId");
  if (transition !== "supersede" && value.successorChangeId !== undefined) throw new Error("invalid-evidence: lifecycle.successorChangeId");
  const payload = {
    schema: "registry-lifecycle-intent-v1" as const,
    changeId: codeValue(value.changeId, "lifecycle.changeId"), transition,
    reason: stringValue(value.reason, "lifecycle.reason", 1_024), timestamp: timestampValue(value.timestamp, "lifecycle.timestamp"),
    prior: { phase: codeValue(value.prior.phase, "lifecycle.prior.phase"), status: codeValue(value.prior.status, "lifecycle.prior.status") },
    ...(value.successorChangeId === undefined ? {} : { successorChangeId: codeValue(value.successorChangeId, "lifecycle.successorChangeId") }),
  };
  const digest = sha256Digest(payload);
  if (value.digest !== digest || value.intentId !== `registry-lifecycle-intent:v1:${digest.slice(7, 39)}`) throw new Error("invalid-evidence: registry lifecycle intent");
  return deepFreeze({ ...payload, intentId: value.intentId, digest }) as RegistryLifecycleIntentV1;
}

/** Canonical event payload for serializers; legacy event records remain accepted by validation. */
export function registryLifecycleEventV1(intent: RegistryLifecycleIntentV1): Readonly<Record<string, string>> {
  const terminal = intent.transition === "close-incomplete" ? "incomplete" : intent.transition === "abandon" ? "abandoned" : intent.transition === "supersede" ? "superseded" : undefined;
  return Object.freeze({
    phase: terminal ? "closed" : intent.prior.phase,
    status: terminal ?? (intent.transition === "park" ? "parked" : "in_progress"),
    event: terminal ? `closed.${terminal}` : `lifecycle.${intent.transition === "park" ? "parked" : "reactivated"}`,
    timestamp: intent.timestamp, actor: "lifecycle", lifecycle_reason: intent.reason,
    ...(intent.successorChangeId === undefined ? {} : { successor_change_id: intent.successorChangeId }),
    prior_state: `${intent.prior.phase}:${intent.prior.status}`,
  });
}
