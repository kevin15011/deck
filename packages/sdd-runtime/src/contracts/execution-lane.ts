import {
  assertDigest,
  assertExactKeys,
  cloneCanonical,
  codeValue,
  deepFreeze,
  enumValue,
  numberValue,
  sha256Digest,
  stringArray,
  type Sha256Digest,
} from "./canonical";

export type ExecutionLane = "fast" | "guarded" | "full_sdd";

export interface LaneDecisionV1 {
  readonly schema: "lane-decision-v1";
  readonly digest: Sha256Digest;
  readonly lane: ExecutionLane;
  readonly riskScore: number;
  readonly floorReasons: readonly string[];
  readonly policyOverrides: readonly string[];
  readonly policyVersion?: "execution-lane-policy-v1";
  readonly evidenceDigest?: Sha256Digest;
  readonly legacyRecommendation?: string;
  readonly shadowOnly: boolean;
}

export type LaneDecisionInputV1 = Omit<LaneDecisionV1, "digest">;

function read(value: unknown) {
  assertExactKeys(value, [
    "schema", "lane", "riskScore", "floorReasons", "policyOverrides", "policyVersion",
    "evidenceDigest", "legacyRecommendation", "shadowOnly",
  ], "lane decision");
  if (value.schema !== "lane-decision-v1") throw new Error("unsupported-contract-version");
  if (typeof value.shadowOnly !== "boolean") throw new Error("invalid-evidence: lane.shadowOnly");
  if ((value.policyVersion === undefined) !== (value.evidenceDigest === undefined)) {
    throw new Error("invalid-evidence: lane.policyReference");
  }
  if (value.policyVersion !== undefined && value.policyVersion !== "execution-lane-policy-v1") {
    throw new Error("unsupported-contract-version");
  }
  if (value.evidenceDigest !== undefined) assertDigest(value.evidenceDigest, "lane.evidenceDigest");
  return cloneCanonical({
    schema: "lane-decision-v1" as const,
    lane: enumValue(value.lane, ["fast", "guarded", "full_sdd"], "lane.lane"),
    riskScore: numberValue(value.riskScore, "lane.riskScore"),
    floorReasons: stringArray(value.floorReasons, "lane.floorReasons", true),
    policyOverrides: stringArray(value.policyOverrides, "lane.policyOverrides", true),
    ...(value.policyVersion === undefined ? {} : {
      policyVersion: "execution-lane-policy-v1" as const,
      evidenceDigest: value.evidenceDigest as Sha256Digest,
    }),
    ...(value.legacyRecommendation === undefined ? {} : { legacyRecommendation: codeValue(value.legacyRecommendation, "lane.legacyRecommendation") }),
    shadowOnly: value.shadowOnly,
  });
}

export function buildLaneDecisionV1(value: LaneDecisionInputV1): LaneDecisionV1 {
  const payload = read(value), digest = sha256Digest(payload);
  return deepFreeze({ ...payload, digest });
}

export function parseLaneDecisionV1(value: unknown): LaneDecisionV1 {
  assertExactKeys(value, [
    "schema", "digest", "lane", "riskScore", "floorReasons", "policyOverrides", "policyVersion",
    "evidenceDigest", "legacyRecommendation", "shadowOnly",
  ], "lane decision");
  assertDigest(value.digest, "lane.digest");
  const { digest, ...payload } = value;
  const parsed = read(payload);
  if (digest !== sha256Digest(parsed)) throw new Error("invalid-evidence: lane decision");
  return deepFreeze({ ...parsed, digest });
}
