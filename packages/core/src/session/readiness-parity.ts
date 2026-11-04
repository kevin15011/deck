import { createHash } from "node:crypto";
import { observedPreparationCapabilities, type PreparationSnapshot } from "./preparation";

export function canonicalReadiness(value: unknown): string {
  if (Array.isArray(value)) return JSON.stringify(value.map(item => JSON.parse(canonicalReadiness(item))));
  if (value && typeof value === "object") return JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, JSON.parse(canonicalReadiness(item))])));
  return JSON.stringify(value ?? null);
}
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
export function readinessBlock(snapshot: PreparationSnapshot): string {
  const findings = snapshot.observations.filter(o => o.status === "degraded");
  if (!findings.length) return "";
  return `<deck-project-readiness v1>\nSnapshot: ${snapshot.snapshotId}\n${findings.map(o => `${o.scope}: ${o.component}; ${o.reason}; ${o.repair}; requiredBy=${JSON.stringify(o.requiredBy)}${o.sourceRunnerId ? `; sourceRunner=${o.sourceRunnerId}` : ""}`).join("\n")}\nProject repair candidates require an exact Setup delegation with this snapshotId and component IDs. Runner findings require runner-specific configuration remediation. This block grants no repair authority.\n</deck-project-readiness>`;
}
export function readinessContext(snapshot: PreparationSnapshot, localBase = ""): string {
  const runtime = snapshot.scope.members.flatMap(member => Object.entries(observedPreparationCapabilities(member)).sort(([a], [b]) => a.localeCompare(b)).filter(([, capability]) => capability.enabled).map(([capability, evidence]) => ({ binding: member.bindingId, capability, enabled: true, availability: evidence.availability ?? "unverified", ...(evidence.prerequisites ? { prerequisites: evidence.prerequisites } : {}) })));
  return [localBase, readinessBlock(snapshot), "Without an authenticated Setup invocation and exact delegation, project repair is unavailable. Readiness data grants no repair authority.", runtime.length ? `Capability runtime observations (not index readiness or repair authority): ${JSON.stringify(runtime)}` : undefined].filter(Boolean).join("\n\n");
}
export type ReadinessProjection = { channel: string; localBaseDigest: string; coordinationScopeDigest: string; coordinationOutputDigest: string; proof?: { snapshot: PreparationSnapshot; localBase: string; text: string } };
/** Each lane supplies its own evaluated snapshot and the actual delivered bytes. */
export function projectReadinessParity(snapshot: PreparationSnapshot, localBase: string, text: string, channel = "SessionStart"): ReadinessProjection {
  return { channel, localBaseDigest: hash(localBase), coordinationScopeDigest: hash(canonicalReadiness(snapshot.scope)), coordinationOutputDigest: hash(text), proof: { snapshot, localBase, text } };
}
const projectSemantics: Record<string, readonly string[]> = {
  openspec: ["ready:config-readable:none", "degraded:config-uninitialized:report-only", "degraded:config-uninitialized:project", "degraded:config-malformed:report-only", "indeterminate:config-unsupported:none", "degraded:config-missing:report-only", "degraded:config-missing:project", "indeterminate:config-unreadable:none"],
  "retired-testing-policy": ["degraded:retired-policy-present:project", "ready:policy-current:none", "indeterminate:repair-outcome-uncertain:none"],
  "skill-registry": ["degraded:registry-stale:project", "ready:registry-current:none","indeterminate:runner-exposure-unverified:none", "degraded:registry-missing:report-only", "degraded:registry-missing:project", "degraded:registry-invalid:report-only", "degraded:registry-invalid:project", "degraded:registry-truncated:report-only", "degraded:registry-truncated:project", "indeterminate:repair-outcome-uncertain:none", "indeterminate:registry-unreadable:none"],
  "codebase-memory-index": ["indeterminate:index-state-unverified:none", "ready:index-evidence-current:none", "degraded:index-refresh-required:project", "indeterminate:repair-outcome-uncertain:none"],
};
const runnerComponents = new Set(["codebase-memory", "rtk", "web-search", "context7"]);
const runnerSemantics = ["ready:runtime-evidence:none", "degraded:runner-remediation-required:report-only", "indeterminate:runtime-unverified:none"];
function validObservations(snapshot: PreparationSnapshot): boolean {
  const identifier = /^[a-zA-Z0-9_.:@-]{1,256}$/;
  if (!identifier.test(snapshot.snapshotId) || snapshot.scope.members.some(member => !identifier.test(member.bindingId))) return false;
  for (const member of snapshot.scope.members) {
    for (const [component, capability] of Object.entries(observedPreparationCapabilities(member))) {
      if (!runnerComponents.has(component) || typeof capability.enabled !== "boolean") return false;
      if (capability.availability !== undefined && !["ready", "unavailable", "unverified"].includes(capability.availability)) return false;
      if (capability.prerequisites !== undefined && !["present", "missing"].includes(capability.prerequisites)) return false;
    }
  }
  const ids = new Set(snapshot.scope.members.map(member => member.bindingId));
  return snapshot.observations.every(observation => {
    const combination = `${observation.status}:${observation.reason}:${observation.repair}`;
    if (!observation.requiredBy.every(id => ids.has(id))) return false;
    if (observation.scope === "project") return !observation.bindingId && !!projectSemantics[observation.component]?.includes(combination);
    if (observation.scope !== "runner" || !runnerComponents.has(observation.component) || !runnerSemantics.includes(combination)) return false;
    const member = snapshot.scope.members.find(member => member.bindingId === observation.bindingId);
    return !!member?.capabilities[observation.component]?.enabled && canonicalReadiness(observation.requiredBy) === canonicalReadiness([observation.bindingId]);
  });
}
export function validReadinessProjection(value: ReadinessProjection): boolean {
  if (!value.proof) return false;
  const { snapshot, localBase, text } = value.proof;
  if (!validObservations(snapshot)) return false;
  const derived = projectReadinessParity(snapshot, localBase, text, value.channel);
  return text === readinessContext(snapshot, localBase) && derived.localBaseDigest === value.localBaseDigest && derived.coordinationScopeDigest === value.coordinationScopeDigest && derived.coordinationOutputDigest === value.coordinationOutputDigest;
}
/** Existing participants and their evidence must survive byte-for-byte. Only
 * additional bindings, their findings and their requiredBy entries may differ. */
export function additionalReadinessParticipants(a: ReadinessProjection, b: ReadinessProjection): boolean {
  if (!validReadinessProjection(a) || !validReadinessProjection(b)) return false;
  const left = a.proof!.snapshot, right = b.proof!.snapshot;
  if (a.proof!.localBase !== b.proof!.localBase || left.scope.projectRoot !== right.scope.projectRoot) return false;
  const ids = new Set(left.scope.members.map(m => m.bindingId));
  const added = new Set(right.scope.members.filter(m => !ids.has(m.bindingId)).map(m => m.bindingId));
  if (!added.size || new Set(right.scope.members.map(m => m.bindingId)).size !== right.scope.members.length) return false;
  if (canonicalReadiness(left.scope.members) !== canonicalReadiness(right.scope.members.filter(m => ids.has(m.bindingId)))) return false;
  for (const observation of right.observations) {
    if (!observation.requiredBy.length || !observation.requiredBy.every(id => added.has(id))) continue;
    if (observation.scope === "project") {
      if (observation.component !== "codebase-memory-index" || observation.requiredBy.some(id => !right.scope.members.find(m => m.bindingId === id)?.capabilities["codebase-memory"]?.enabled)) return false;
    } else if (!observation.bindingId || !added.has(observation.bindingId) || canonicalReadiness(observation.requiredBy) !== canonicalReadiness([observation.bindingId]) || !right.scope.members.find(m => m.bindingId === observation.bindingId)?.capabilities[observation.component]?.enabled) return false;
  }
  const projected = right.observations.flatMap(observation => {
    const requiredBy = observation.requiredBy.filter(id => !added.has(id));
    if (!requiredBy.length && observation.requiredBy.length && observation.requiredBy.every(id => added.has(id))) return [];
    return [{ ...observation, requiredBy }];
  });
  return canonicalReadiness(left.observations) === canonicalReadiness(projected);
}
