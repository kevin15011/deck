import type{FindingId,FailureManifestV1}from"./failure-manifest";import type{Sha256Digest}from"./canonical";import{assertDigest,assertExactKeys,assertId,cloneCanonical,deepFreeze,enumValue,integerValue,numberValue,sha256Digest,stringArray}from"./canonical";
export interface RiskVectorV1{securityHardStops:number;critical:number;high:number;medium:number;low:number;uncoveredRequirements:number;weighted:number}export interface FailureDeltaV1{schema:"failure-delta-v1";deltaId:`delta:v1:${string}`;digest:Sha256Digest;previousManifestDigest?:Sha256Digest;currentManifestDigest:Sha256Digest;resolved:readonly FindingId[];added:readonly FindingId[];newRelated:readonly FindingId[];newUnrelatedBaseline:readonly FindingId[];persistent:readonly FindingId[];regressed:readonly FindingId[];reclassified:readonly FindingId[];priorRisk:RiskVectorV1;currentRisk:RiskVectorV1;weightedMovement:number;progress:"positive"|"none"|"negative"}
const buckets=["resolved","newRelated","newUnrelatedBaseline","persistent","regressed","reclassified"]as const;
function risk(v:unknown,f:string):RiskVectorV1{assertExactKeys(v,["securityHardStops","critical","high","medium","low","uncoveredRequirements","weighted"],f);const r={}as Record<string,number>;for(const k of["securityHardStops","critical","high","medium","low","uncoveredRequirements","weighted"])r[k]=integerValue(v[k],`${f}.${k}`);if(r.weighted!==r.critical!*1000+r.high!*100+r.medium!*10+r.low!)throw new Error(`invalid-evidence: ${f}.weighted`);return r as unknown as RiskVectorV1;}
export function parseFailureDeltaV1(
  value: unknown,
  previous: FailureManifestV1 | undefined,
  current: FailureManifestV1,
): FailureDeltaV1 {
  if (arguments.length < 3 || current === undefined) {
    throw new Error("invalid-evidence: failure delta authority");
  }
  assertExactKeys(value, ["schema", "deltaId", "digest", "previousManifestDigest", "currentManifestDigest", "resolved", "added", "newRelated", "newUnrelatedBaseline", "persistent", "regressed", "reclassified", "priorRisk", "currentRisk", "weightedMovement", "progress"], "failure delta fields");
  if (value.schema !== "failure-delta-v1") throw new Error("unsupported-contract-version");
  assertId(value.deltaId, "delta:v1:", "delta.deltaId");
  assertDigest(value.digest, "delta.digest");
  assertDigest(value.currentManifestDigest, "delta.currentManifestDigest");
  if (value.previousManifestDigest !== undefined) assertDigest(value.previousManifestDigest, "delta.previousManifestDigest");

  const parsed = {} as Record<string, string[]>;
  for (const bucket of buckets) {
    parsed[bucket] = stringArray(value[bucket], `delta.${bucket}`, true);
    if (JSON.stringify(value[bucket]) !== JSON.stringify(parsed[bucket])) throw new Error(`invalid-evidence: delta.${bucket}`);
  }
  const seen = new Set<string>();
  for (const bucket of buckets) {
    for (const id of parsed[bucket]!) {
      if (seen.has(id)) throw new Error("invalid-evidence: delta.bucket-overlap");
      seen.add(id);
    }
  }
  const added = stringArray(value.added, "delta.added", true);
  const expectedAdded = [...parsed.newRelated!, ...parsed.newUnrelatedBaseline!].sort();
  if (JSON.stringify(added) !== JSON.stringify(expectedAdded)) throw new Error("invalid-evidence: delta.added");
  const priorRisk = risk(value.priorRisk, "delta.priorRisk");
  const currentRisk = risk(value.currentRisk, "delta.currentRisk");
  const weightedMovement = numberValue(value.weightedMovement, "delta.weightedMovement");
  const progress = enumValue(value.progress, ["positive", "none", "negative"], "delta.progress");
  const payload = cloneCanonical({
    schema: "failure-delta-v1" as const,
    ...(value.previousManifestDigest === undefined ? {} : { previousManifestDigest: value.previousManifestDigest }),
    currentManifestDigest: value.currentManifestDigest,
    ...parsed,
    added,
    priorRisk,
    currentRisk,
    weightedMovement,
    progress,
  });
  const expectedDigest = sha256Digest(payload);
  if (value.digest !== expectedDigest || value.deltaId !== `delta:v1:${expectedDigest.slice(7, 39)}`) {
    throw new Error("invalid-evidence: failure delta");
  }

  const { computeFailureDeltaV1 } = require("../orchestrator/failure-delta") as typeof import("../orchestrator/failure-delta");
  const computed = computeFailureDeltaV1(previous, current);
  if (computed.digest !== value.digest) throw new Error("invalid-evidence: failure delta algebra");
  return deepFreeze({ ...payload, deltaId: value.deltaId, digest: value.digest }) as unknown as FailureDeltaV1;
}
