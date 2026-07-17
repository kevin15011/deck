import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";

import { buildApplyBatchContractV1 } from "../contracts/apply-batch";
import { createExecutionDossierV1 } from "../contracts/execution-dossier";
import { buildRegistryIntentV1 } from "../contracts/registry-intent";
import { commitExecutionRegistryIntentsV1, planExecutionDecisionV1 } from "./execution-control-plane";

const sha = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}` as const;

function plan(mode: "shadow" | "active") {
  const batch = buildApplyBatchContractV1({
    schema: "apply-batch-v1",
    changeId: "registry-port",
    taskIds: ["EG5-T2"],
    dependencies: [],
    ownerRole: "apply-general",
    allowedTargets: ["packages/sdd-runtime/src/artifact-state/registry-coordinator.ts"],
    blockedTargets: ["openspec/archive"],
    acceptanceObligations: ["REQ-REGISTRY-001"],
    verificationPlan: [{ stage: "targeted", checkIds: ["registry-port"] }],
    artifactDigests: { "tasks.md": sha("tasks") },
    authorizationGrantRef: sha("authorization"),
    provenance: { actor: "apply-general", issuedAt: "2026-07-16T00:00:00.000Z" },
  });
  const intent = buildRegistryIntentV1({
    schema: "registry-intent-v1",
    idempotencyKey: sha("registry-port-intent"),
    changeId: batch.changeId,
    batchId: batch.batchId,
    batchDigest: batch.digest,
    base: { stateDigest: sha("state"), eventsDigest: sha("events") },
    phase: "apply",
    status: "completed",
    artifact: { kind: "apply-progress", path: "apply-progress.md" },
    provenance: { agent: "apply-general", model: "model", timestamp: "2026-07-16T01:00:00.000Z" },
    event: { name: "apply.completed", actor: "apply-general", timestamp: "2026-07-16T01:00:00.000Z", notes: [] },
  });
  const dossier = createExecutionDossierV1({
    schema: "execution-dossier-v1",
    batch,
    lane: { schema: "lane-decision-v1", lane: "guarded", riskScore: 1, floorReasons: [], policyOverrides: [], shadowOnly: mode === "shadow" },
    verification: { schema: "staged-verification-state-v1", batchId: batch.batchId, stages: [] },
    causalContext: { schema: "causal-context-v1", batchDigest: batch.digest, priorDecisionDigests: [], activeFindingIds: [], evidenceRefs: [], attemptSummaries: [] },
    registryIntents: [intent],
  });
  return { intent, value: planExecutionDecisionV1(
    mode,
    dossier,
    { state: "authorized", capabilityDigest: sha("capability"), reference: { validation: "accepted" } },
    { state: "not-required", policyDigest: sha("policy") },
    { kind: "none" },
    { kind: "none" },
  ) };
}

describe("execution registry coordinator port", () => {
  test("commits active dossier intents in order through the coordinator boundary", async () => {
    const active = plan("active");
    const received: unknown[] = [];
    const outcome = await commitExecutionRegistryIntentsV1(active.value, {
      commit: async (intent) => {
        received.push(intent);
        return { code: "committed", intentId: active.intent.intentId };
      },
    });
    expect(received).toEqual([active.intent]);
    expect(outcome).toEqual({ status: "committed", outcomes: [{ intentId: active.intent.intentId, code: "committed" }] });
    expect(Object.isFrozen(outcome)).toBe(true);
    expect(Object.isFrozen(outcome.outcomes)).toBe(true);
  });

  test("does not write shadow plans and blocks on safe coordinator failures", async () => {
    const shadow = plan("shadow");
    let calls = 0;
    expect(await commitExecutionRegistryIntentsV1(shadow.value, { commit: async () => { calls++; return { code: "committed" }; } }))
      .toEqual({ status: "not-applicable", outcomes: [] });
    expect(calls).toBe(0);

    const active = plan("active");
    const blocked = await commitExecutionRegistryIntentsV1(active.value, {
      commit: async () => ({ code: "registry-intent-conflict", intentId: active.intent.intentId }),
    });
    expect(blocked).toEqual({
      status: "blocked",
      outcomes: [{ intentId: active.intent.intentId, code: "registry-intent-conflict" }],
    });
  });
});
