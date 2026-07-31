export type CoordinationClassificationV1 = "independent" | "advisory" | "serialize" | "blocking";
export interface CoordinationModifyingEffectV1 {
  readonly target: string;
  readonly start: number;
  readonly end: number;
  readonly effectDigest: `sha256:${string}`;
}
export interface CoordinationWorkItemV1 { readonly id: string; readonly reads?: readonly string[]; readonly writes?: readonly string[]; readonly modifyingEffects?: readonly CoordinationModifyingEffectV1[]; readonly mentions?: readonly string[]; readonly dependsOn?: readonly string[]; readonly base?: string; readonly unattributedDirtyTargets?: readonly string[]; readonly generatedTargets?: readonly string[]; }
export interface CoordinationAssessmentV1 { readonly schema: "coordination-assessment-v1"; readonly classification: CoordinationClassificationV1; readonly reasonCodes: readonly string[]; readonly grantsModificationAuthority: false; }

export function assessCoordinationV1(input: Readonly<{ work: readonly CoordinationWorkItemV1[]; registryRecoveryRequired?: boolean }>): CoordinationAssessmentV1 {
  if (!input || !Array.isArray(input.work) || input.work.some((item) => !item?.id)) throw new Error("invalid-coordination-assessment");
  const reasons: string[] = [], advisoryReasons: string[] = [], writes = new Map<string, CoordinationWorkItemV1>(), bases = new Set(input.work.map((item) => item.base).filter((base): base is string => Boolean(base)));
  const validEffect = (effect: CoordinationModifyingEffectV1) =>
    typeof effect.target === "string"
    && Number.isSafeInteger(effect.start)
    && Number.isSafeInteger(effect.end)
    && effect.start >= 0
    && effect.end > effect.start
    && /^sha256:[a-f0-9]{64}$/.test(effect.effectDigest);
  if (input.work.some((item) => (item.modifyingEffects ?? []).some((effect: CoordinationModifyingEffectV1) => !validEffect(effect)))) throw new Error("invalid-coordination-assessment");
  for (const item of input.work) {
    for (const target of item.unattributedDirtyTargets ?? []) reasons.push(`UNATTRIBUTED_DIRTY_TARGET:${target}`);
    for (const target of item.writes ?? []) {
      const owner = writes.get(target);
      if (owner && owner.id !== item.id) {
        const ownerEffects = (owner.modifyingEffects ?? []).filter((effect: CoordinationModifyingEffectV1) => effect.target === target);
        const itemEffects = (item.modifyingEffects ?? []).filter((effect: CoordinationModifyingEffectV1) => effect.target === target);
        const generated = (item.generatedTargets ?? []).includes(target) || (owner.generatedTargets ?? []).includes(target);
        if (generated) reasons.push(`GENERATED_CONFLICT:${target}`);
        else if (ownerEffects.length === 0 || itemEffects.length === 0) reasons.push(`INCOMPATIBLE_CONCURRENT_WRITE:${target}`);
        else {
          const incompatible = ownerEffects.some((left: CoordinationModifyingEffectV1) => itemEffects.some((right: CoordinationModifyingEffectV1) =>
            left.effectDigest !== right.effectDigest
            && left.start < right.end
            && right.start < left.end
          ));
          if (incompatible) reasons.push(`INCOMPATIBLE_CONCURRENT_WRITE:${target}`);
          else advisoryReasons.push(`COMPATIBLE_SHARED_TARGET:${target}`);
        }
      }
      writes.set(target, item);
    }
  }
  if (bases.size > 1) reasons.push("STALE_BASE");
  if (input.registryRecoveryRequired) reasons.push("REGISTRY_RECOVERY_REQUIRED");
  if (reasons.length > 0) return Object.freeze({ schema: "coordination-assessment-v1", classification: "blocking", reasonCodes: Object.freeze(reasons), grantsModificationAuthority: false });
  if (input.work.some((item) => (item.dependsOn?.length ?? 0) > 0)) return Object.freeze({ schema: "coordination-assessment-v1", classification: "serialize", reasonCodes: Object.freeze(["DECLARED_DEPENDENCY"]), grantsModificationAuthority: false });
  const advisory = advisoryReasons.length > 0 || input.work.some((item) => (item.reads?.length ?? 0) > 0 || (item.mentions?.length ?? 0) > 0);
  return Object.freeze({ schema: "coordination-assessment-v1", classification: advisory ? "advisory" : "independent", reasonCodes: Object.freeze(advisory ? [...advisoryReasons, ...(input.work.some((item) => (item.reads?.length ?? 0) > 0 || (item.mentions?.length ?? 0) > 0) ? ["READ_OR_MENTION_OVERLAP"] : [])] : []), grantsModificationAuthority: false });
}
