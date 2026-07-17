import{deepFreeze,sha256Digest}from"../contracts/canonical";import type{FailureDeltaV1,RiskVectorV1}from"../contracts/failure-delta";import type{FindingId,FailureFindingV1,FailureManifestV1}from"../contracts/failure-manifest";import{classifyProtectedRiskV1}from"./protected-risk";
const W={critical:1000,high:100,medium:10,low:1}as const,S={low:0,medium:1,high:2,critical:3}as const;
const active=(f:FailureFindingV1)=>f.status==="open"&&f.relationship!=="unrelated_baseline";
const protectedFinding=(f:FailureFindingV1)=>classifyProtectedRiskV1(f).blocksAutomaticRepair;
function risk(fs:readonly FailureFindingV1[]):RiskVectorV1{const r:RiskVectorV1={securityHardStops:0,critical:0,high:0,medium:0,low:0,uncoveredRequirements:0,weighted:0};for(const f of fs.filter(active)){const classification=classifyProtectedRiskV1(f);r[f.severity]++;r.weighted+=W[f.severity];if(classification.securityOrDataLoss||classification.authorizationOrGitSafety)r.securityHardStops++;if(classification.uncoveredRequirement)r.uncoveredRequirements++;}return r;}
function regression(a:FailureFindingV1,b:FailureFindingV1){return!active(a)&&active(b)||S[b.severity]>S[a.severity]||!protectedFinding(a)&&protectedFinding(b)||a.rootCause!=="requirement"&&b.rootCause==="requirement"||a.requirementIds.some(id=>!b.requirementIds.includes(id));}
function reclassified(a:FailureFindingV1,b:FailureFindingV1){return a.severity!==b.severity||a.rootCause!==b.rootCause||a.category!==b.category||a.isSecurityRelevant!==b.isSecurityRelevant||a.relationship!==b.relationship;}
export function computeFailureDeltaV1(previous: FailureManifestV1 | undefined, current: FailureManifestV1): FailureDeltaV1 {
  if (previous && (previous.batchId !== current.batchId || previous.batchDigest !== current.batchDigest)) {
    throw new Error("batch-reference-mismatch");
  }

  const priorById = new Map(previous?.findings.map((finding) => [finding.findingId, finding]) ?? []);
  const currentById = new Map(current.findings.map((finding) => [finding.findingId, finding]));
  const out = {
    resolved: [] as FindingId[],
    newRelated: [] as FindingId[],
    newUnrelatedBaseline: [] as FindingId[],
    persistent: [] as FindingId[],
    regressed: [] as FindingId[],
    reclassified: [] as FindingId[],
  };

  for (const [id, before] of priorById) {
    const after = currentById.get(id);
    if (!active(before)) {
      // B-B2-RELATIONSHIP-TRANSITION-DROPS-IDENTITY-v1: reject any
      // relationship change for the same finding identity.
      if (after && before.relationship !== after.relationship) {
        throw new Error("invalid-evidence: finding relationship transition");
      }
      if (before.relationship !== "unrelated_baseline" && after && active(after)) out.regressed.push(id);
      continue;
    }
    // B-B2-RELATIONSHIP-TRANSITION-DROPS-IDENTITY-v1: reject any
    // relationship change when the same identity stays active.
    if (after && before.relationship !== after.relationship) {
      throw new Error("invalid-evidence: finding relationship transition");
    }
    if (!after || !active(after)) out.resolved.push(id);
    else if (regression(before, after)) out.regressed.push(id);
    else if (reclassified(before, after)) out.reclassified.push(id);
    else out.persistent.push(id);
  }

  for (const [id, finding] of currentById) {
    const before = priorById.get(id);
    if (!before && finding.relationship === "unrelated_baseline" && finding.status === "pre_existing") {
      out.newUnrelatedBaseline.push(id);
    } else if (active(finding) && !before) {
      out.newRelated.push(id);
    }
  }

  for (const bucket of Object.values(out)) bucket.sort();
  const priorRisk = risk(previous?.findings ?? []);
  const currentRisk = risk(current.findings);
  const regressionPenalty = out.regressed.reduce((sum, id) => sum + W[currentById.get(id)!.severity], 0);
  const weightedMovement = priorRisk.weighted - currentRisk.weighted - regressionPenalty;
  const precedence = (vector: RiskVectorV1) => [
    vector.securityHardStops,
    vector.critical,
    vector.high,
    vector.uncoveredRequirements,
    vector.medium,
    vector.low,
  ] as const;
  const priorPrecedence = precedence(priorRisk);
  const currentPrecedence = precedence(currentRisk);
  let lexicographic = 0;
  for (let index = 0; index < priorPrecedence.length; index++) {
    if (currentPrecedence[index] !== priorPrecedence[index]) {
      lexicographic = currentPrecedence[index]! > priorPrecedence[index]! ? 1 : -1;
      break;
    }
  }

  const protectedRegression = out.newRelated.some((id) => {
    const finding = currentById.get(id)!;
    return protectedFinding(finding) || finding.severity === "critical" || finding.severity === "high" || finding.rootCause === "requirement";
  }) || out.regressed.length > 0;
  const progress = protectedRegression || lexicographic > 0 || weightedMovement < 0
    ? "negative"
    : lexicographic < 0 && weightedMovement > 0
      ? "positive"
      : "none";
  const added = [...out.newRelated, ...out.newUnrelatedBaseline].sort();
  const payload = {
    schema: "failure-delta-v1" as const,
    ...(previous ? { previousManifestDigest: previous.digest } : {}),
    currentManifestDigest: current.digest,
    ...out,
    added,
    priorRisk,
    currentRisk,
    weightedMovement,
    progress,
  };
  const digest = sha256Digest(payload);
  return deepFreeze({ ...payload, deltaId: `delta:v1:${digest.slice(7, 39)}`, digest }) as FailureDeltaV1;
}
