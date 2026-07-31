import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { parseYaml } from "./yaml";

export type SemanticLifecycleV1 = "active" | "parked" | "terminal" | "malformed";
export type RegistryPlacementV1 = "changes" | "archive";

export interface LifecycleDiscoveryInputV1 {
  readonly changeId: string;
  readonly placement: RegistryPlacementV1;
  readonly state?: { readonly currentPhase?: unknown; readonly status?: unknown };
}
export interface LifecycleRecordV1 extends LifecycleDiscoveryInputV1 {
  readonly lifecycle: SemanticLifecycleV1;
}
export interface RegistryLifecycleDiscoveryV1 {
  readonly schema: "registry-lifecycle-discovery-v1";
  readonly digest: `sha256:${string}`;
  readonly records: readonly LifecycleRecordV1[];
  readonly groups: Readonly<Record<SemanticLifecycleV1, readonly LifecycleRecordV1[]>>;
  readonly placementDiagnostics: readonly { readonly code: "terminal-in-changes" | "nonterminal-in-archive" | "duplicate-change-id"; readonly changeId: string }[];
}

const digest = (value: unknown) => `sha256:${createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex")}` as const;
const state = (value: LifecycleDiscoveryInputV1["state"]) => ({ currentPhase: value?.currentPhase, status: value?.status });

/** Lifecycle is authority; placement is reported separately as a diagnostic. */
export function classifySemanticLifecycleV1(value: LifecycleDiscoveryInputV1["state"]): SemanticLifecycleV1 {
  const { currentPhase, status } = state(value);
  if (typeof currentPhase !== "string" || typeof status !== "string") return "malformed";
  if (currentPhase === "archive" && (status === "archive" || status === "archived")) return "terminal";
  if (currentPhase === "closed" && (status === "incomplete" || status === "abandoned" || status === "superseded")) return "terminal";
  if (status === "parked") return "parked";
  if (currentPhase === "closed" || status === "archived" || status === "abandoned" || status === "incomplete" || status === "superseded") return "malformed";
  return "active";
}

export function discoverRegistryLifecycleV1(inputs: readonly LifecycleDiscoveryInputV1[]): RegistryLifecycleDiscoveryV1 {
  const occurrences = new Map<string, number>();
  for (const input of inputs) occurrences.set(input.changeId, (occurrences.get(input.changeId) ?? 0) + 1);
  const records = inputs.map((input) => Object.freeze({ ...input, lifecycle: occurrences.get(input.changeId)! > 1 ? "malformed" as const : classifySemanticLifecycleV1(input.state) }));
  const groups: Record<SemanticLifecycleV1, LifecycleRecordV1[]> = { active: [], parked: [], terminal: [], malformed: [] };
  const placementDiagnostics: Array<{ code: "terminal-in-changes" | "nonterminal-in-archive" | "duplicate-change-id"; changeId: string }> = [];
  for (const record of records) {
    groups[record.lifecycle].push(record);
    if (occurrences.get(record.changeId)! > 1) placementDiagnostics.push({ code: "duplicate-change-id", changeId: record.changeId });
    else if (record.placement === "changes" && record.lifecycle === "terminal") placementDiagnostics.push({ code: "terminal-in-changes", changeId: record.changeId });
    else if (record.placement === "archive" && record.lifecycle !== "terminal") placementDiagnostics.push({ code: "nonterminal-in-archive", changeId: record.changeId });
  }
  const canonical = { records: records.map(({ changeId, placement, state: item, lifecycle }) => ({ changeId, placement, state: state(item), lifecycle })), placementDiagnostics };
  return Object.freeze({ schema: "registry-lifecycle-discovery-v1", digest: digest(canonical), records: Object.freeze(records), groups: Object.freeze(Object.fromEntries(Object.entries(groups).map(([key, value]) => [key, Object.freeze(value)])) as Record<SemanticLifecycleV1, readonly LifecycleRecordV1[]>), placementDiagnostics: Object.freeze(placementDiagnostics) });
}

/** Reads existing state only; it neither creates registry files nor infers events. */
export async function discoverRegistryLifecycleFromFilesystemV1(rootDir: string): Promise<RegistryLifecycleDiscoveryV1> {
  const entries: LifecycleDiscoveryInputV1[] = [];
  for (const placement of ["changes", "archive"] as const) {
    const directory = path.join(rootDir, "openspec", placement);
    let names: string[] = [];
    try { names = await fs.readdir(directory); } catch { continue; }
    for (const name of names.sort()) {
      const location = path.join(directory, name);
      try {
        if (!(await fs.stat(location)).isDirectory()) continue;
        const parsed = parseYaml(await fs.readFile(path.join(location, "state.yaml"), "utf8"));
        const data = parsed.ok && parsed.data && typeof parsed.data === "object" && !Array.isArray(parsed.data) ? parsed.data as Record<string, unknown> : undefined;
        entries.push({ changeId: name, placement, state: data && { currentPhase: data.currentPhase, status: data.status } });
      } catch { entries.push({ changeId: name, placement }); }
    }
  }
  return discoverRegistryLifecycleV1(entries);
}

export interface RegistryReconciliationPlanV1 {
  readonly schema: "registry-reconciliation-plan-v1";
  readonly digest: `sha256:${string}`;
  readonly discoveryDigest: `sha256:${string}`;
  readonly actions: readonly { readonly kind: "review-placement" | "resolve-duplicate"; readonly changeId: string }[];
}

/** Produces a review plan only; applying any cleanup is deliberately separate. */
export function planRegistryReconciliationV1(discovery: RegistryLifecycleDiscoveryV1): RegistryReconciliationPlanV1 {
  const actions = discovery.placementDiagnostics.map((diagnostic) => Object.freeze({ kind: diagnostic.code === "duplicate-change-id" ? "resolve-duplicate" as const : "review-placement" as const, changeId: diagnostic.changeId }));
  const payload = { schema: "registry-reconciliation-plan-v1" as const, discoveryDigest: discovery.digest, actions };
  return Object.freeze({ ...payload, digest: digest(payload), actions: Object.freeze(actions) });
}
