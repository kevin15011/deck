import { deepFreeze, type Sha256Digest } from "../contracts/canonical";
import type {
  ExecutionPlanV1,
  GitSafetyStateV1,
} from "./execution-control-plane";
import { parseActiveExecutionPlanV1 } from "./execution-control-plane";
import {
  parseTargetedRepairCapabilityDescriptorV1,
  type TargetedRepairCapabilityDescriptorV1,
} from "./execution-capability";

export {
  capabilityDescriptorDigestV1,
  parseTargetedRepairCapabilityDescriptorV1,
} from "./execution-capability";
export type { TargetedRepairCapabilityDescriptorV1 } from "./execution-capability";

export interface TargetedRepairRequestV1 {
  readonly target: string;
  readonly dossierDigest: Sha256Digest;
  readonly decisionDigest: Sha256Digest;
  readonly inputDigest: Sha256Digest;
  readonly rationaleCodes: readonly string[];
}
export interface TargetedRepairCapabilityV1 {
  readonly descriptor: TargetedRepairCapabilityDescriptorV1;
  invoke(request: TargetedRepairRequestV1): Promise<{ invoked: true }>;
}
export type EffectResultV1 =
  | { invoked: true }
  | {
      invoked: false;
      reasonCode:
        | "invalid-evidence"
        | "modification-not-authorized"
        | "effect-not-permitted"
        | "adapter-error";
    };
function targetAllowed(
  target: string,
  allowed: readonly string[],
  blocked: readonly string[],
): boolean {
  return (
    allowed.includes(target) &&
    !blocked.some(
      (path) =>
        target === path ||
        target.startsWith(`${path}/`) ||
        path.startsWith(`${target}/`),
    )
  );
}
export async function executeTargetedRepairV1(
  plan: ExecutionPlanV1,
  capability: TargetedRepairCapabilityV1 | undefined,
): Promise<EffectResultV1> {
  if (!plan || typeof plan !== "object" || plan.reasonCode)
    return { invoked: false, reasonCode: "invalid-evidence" };
  if (plan.mode !== "active")
    return { invoked: false, reasonCode: "effect-not-permitted" };
  let safePlan: ExecutionPlanV1;
  try {
    safePlan = parseActiveExecutionPlanV1(plan);
  } catch {
    return { invoked: false, reasonCode: "invalid-evidence" };
  }
  if (
    !safePlan.decision ||
    !safePlan.dossier ||
    safePlan.decision.action !== "targeted_repair" ||
    !capability
  ) {
    return { invoked: false, reasonCode: "effect-not-permitted" };
  }
  let d: TargetedRepairCapabilityDescriptorV1;
  try {
    d = parseTargetedRepairCapabilityDescriptorV1(capability.descriptor);
  } catch {
    return { invoked: false, reasonCode: "modification-not-authorized" };
  }
  const authority =
      safePlan.replayRecord.outcome === "valid"
        ? safePlan.replayRecord.authority
        : undefined,
    git =
      safePlan.replayRecord.outcome === "valid"
        ? safePlan.replayRecord.gitSafety
        : undefined,
    binding =
      safePlan.replayRecord.outcome === "valid"
        ? safePlan.replayRecord.effectBinding
        : undefined;
  if (
    !authority ||
    !git ||
    !binding ||
    binding.kind === "none" ||
    binding.capabilityDigest !== d.capabilityDigest ||
    authority.state !== "authorized" ||
    authority.capabilityDigest !== d.capabilityDigest ||
    d.batchId !== safePlan.dossier.batch.batchId ||
    d.batchDigest !== safePlan.dossier.batch.digest ||
    d.dossierDigest !== safePlan.dossier.digest ||
    d.decisionDigest !== safePlan.decision.digest ||
    d.action !== "targeted_repair" ||
    !targetAllowed(
      d.target,
      safePlan.dossier.batch.allowedTargets,
      safePlan.dossier.batch.blockedTargets,
    )
  )
    return { invoked: false, reasonCode: "modification-not-authorized" };
  if (!gitPermits(git, d))
    return { invoked: false, reasonCode: "modification-not-authorized" };
  try {
    await capability.invoke(
      deepFreeze({
        target: d.target,
        dossierDigest: safePlan.dossier.digest,
        decisionDigest: safePlan.decision.digest,
        inputDigest: safePlan.inputDigest,
        rationaleCodes: safePlan.decision.rationaleCodes,
      }),
    );
    return { invoked: true };
  } catch {
    return { invoked: false, reasonCode: "adapter-error" };
  }
}
function gitPermits(
  state: Exclude<GitSafetyStateV1, { state: "not-applicable" }>,
  descriptor: TargetedRepairCapabilityDescriptorV1,
): boolean {
  if (descriptor.gitEffect.kind === "non-destructive")
    return state.state === "not-required" || state.state === "confirmed";
  return (
    state.state === "confirmed" &&
    state.commandDigest === descriptor.gitEffect.commandDigest
  );
}
/** @deprecated Compatibility facade; it accepts only the narrow pre-bound capability. */
export const executeDeveloperTeamStepV1 = executeTargetedRepairV1;
export type ExecutionAdapterPortV1 = TargetedRepairCapabilityV1;
