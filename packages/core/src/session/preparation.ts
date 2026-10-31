/** Host-only scope and invocation contracts. None of these bindings are model arguments. */
export type PreparationMember = {
  memberId: string; runnerId: string; taskId?: string; bindingId: string;
  runtimeEvidence?: { taskId: string; attempt: number; bindingId: string; generation: string; epoch: string; capabilities: PreparationMember["capabilities"] };
  runtimeEvidencePeers?: readonly NonNullable<PreparationMember["runtimeEvidence"]>[];
  capabilities: Readonly<Record<string, { enabled: boolean; route?: "native" | "fallback" | "disabled" | "managed" | "runner-plugin"; inputDigest?: string; prerequisites?: "present" | "missing"; availability?: "ready" | "unavailable" | "unverified" }>>;
};
export type PreparationScope = {
  projectRoot: string; sessionId: string; epoch: string; policyDigest: string;
  members: readonly PreparationMember[];
};
export type PreparationRequest = { snapshotId: string; components: string[] };
export type PreparationObservation = {
  component: string; scope: "project" | "runner"; bindingId?: string; sourceRunnerId?: string;
  status: "ready" | "degraded" | "indeterminate"; reason: string;
  evidenceDigest: string; requiredBy: readonly string[]; repair: "project" | "report-only" | "none";
};
export type PreparationSnapshot = {
  snapshotId: string; scope: PreparationScope; observations: readonly PreparationObservation[];
};
export type PreparationDelegation = PreparationRequest & {
  id: string; sessionId: string; epoch: string; projectRoot: string; taskId: string; attempt: number;
  evidence: Readonly<Record<string, string>>; expiresAt: number;
};
export type PreparationInvocation = {
  delegation: PreparationDelegation; roleId: string; generation: string; runnerId: string;
  nativeSessionId: string; launchId: string;
  /** Must revalidate credential, exact turn, dependencies and current scope on every call. */
  current(): PreparationScope | undefined;
  /** Host-only diagnostic sink. Reasons are never repair authority; hosts may expose only allow-listed recovery causes. */
  rejected?(reason: string): void;
  record(record: PreparationEffectRecord): void;
  previous(): readonly PreparationEffectRecord[];
};
export type PreparationEffectRecord = {
  executorBindingId?: string;
  backendId?: string;
  effectId: string; delegationId: string; component: string; before: string; after: string;
  state: "intent" | "completed" | "uncertain" | "reconciled";
};
export interface PreparationPort {
  prepareRegistryEvidence?(scope: PreparationScope, runnerId: string): Promise<void>;
  reconcile(scope: PreparationScope, records: readonly PreparationEffectRecord[]): readonly PreparationEffectRecord[];
  status(scope: PreparationScope): PreparationSnapshot;
  delegate(request: unknown, scope: PreparationScope, task: { taskId: string; attempt: number }): PreparationDelegation;
  repair(request: unknown, invocation: PreparationInvocation): Promise<{ status: string; snapshot?: PreparationSnapshot; diff?: string }>;
}
export const PREPARATION_REQUEST_SCHEMA = {
  type: "object", additionalProperties: false, required: ["snapshotId", "components"], properties: {
    snapshotId: { type: "string", minLength: 1, maxLength: 128 },
    components: { type: "array", minItems: 1, maxItems: 16, uniqueItems: true, items: { type: "string", minLength: 1, maxLength: 80 } },
  },
} as const;
export function parsePreparationRequest(value: unknown): PreparationRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("preparation-request-invalid");
  const v = value as Record<string, unknown>;
  if (Object.keys(v).sort().join() !== "components,snapshotId" || typeof v.snapshotId !== "string" || !/^[a-zA-Z0-9:-]{1,128}$/.test(v.snapshotId)
    || !Array.isArray(v.components) || !v.components.length || v.components.length > 16 || new Set(v.components).size !== v.components.length
    || v.components.some(c => typeof c !== "string" || !/^[a-z0-9-]{1,80}$/.test(c))) throw new Error("preparation-request-invalid");
  return { snapshotId: v.snapshotId, components: [...v.components] };
}

/** Runtime observations are not repair authority. Intent, roster and input digests
 * remain exact; collecting evidence at Setup launch cannot revoke itself. */
export function preparationAuthorityScope(scope: PreparationScope): PreparationScope {
  return { ...scope, members: scope.members.map(({ runtimeEvidence: _runtime, runtimeEvidencePeers: _peers, ...member }) => ({
    ...member,
    capabilities: Object.fromEntries(Object.entries(member.capabilities).map(([id, { availability: _availability, prerequisites: _prerequisites, ...intent }]) => [id, intent])),
  })) };
}
export function observedPreparationCapabilities(member: PreparationMember): PreparationMember["capabilities"] {
  const records = member.runtimeEvidencePeers ?? (member.runtimeEvidence ? [member.runtimeEvidence] : []);
  return Object.fromEntries(Object.entries(member.capabilities).map(([id, intent]) => {
    if (!intent.enabled || !records.length) return [id, intent];
    const observations = records.map(record => record.capabilities[id]);
    const first = observations[0];
    // Distinct task bindings cannot lend one another ready status.
    if (!first || observations.some(observation => JSON.stringify(observation) !== JSON.stringify(first))) return [id, { ...intent, availability: "unverified" }];
    return [id, { ...intent, ...first, enabled: true }];
  }));
}
