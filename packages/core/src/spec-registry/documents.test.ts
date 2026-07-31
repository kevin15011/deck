import { describe, expect, test } from "bun:test";

import { parseRegistryDocumentPairV1 } from "./documents";
import { applyRegistryIntentToDocumentsV1, RegistryDocumentMutationError } from "./serializer";

const STATE = `# state header
schema: spec-registry-v1
changeId: registry-fixture
currentPhase: design
status: completed
x-unknown: keep # unknown comment
artifacts:
  design: design.md
  # artifact comment
provenance:
  - phase: design
    agent: designer
    model: model
    timestamp: "2026-07-16T00:00:00.000Z"
    registryWrite: non-deferred
tail: keep
`;

const EVENTS = `# events header
schema: spec-registry-events-v1
events:
  - phase: design
    status: completed
    event: design.completed
    artifact: design.md
    timestamp: "2026-07-16T00:00:00.000Z"
    actor: designer
x-events-unknown: keep
`;

function fixture() {
  const pair = parseRegistryDocumentPairV1({ stateSource: STATE, eventsSource: EVENTS, expectedChangeId: "registry-fixture" });
  const intent = {
    schema: "registry-intent-v1" as const,
    intentId: "registry-intent:v1:fixture",
    idempotencyKey: `sha256:${"a".repeat(64)}`,
    changeId: "registry-fixture",
    batchDigest: `sha256:${"b".repeat(64)}`,
    base: { stateDigest: pair.state.digest, eventsDigest: pair.events.digest },
    phase: "apply",
    status: "completed",
    artifact: { kind: "apply-progress", path: "apply-progress.md" },
    provenance: { agent: "apply", model: "model", timestamp: "2026-07-16T01:00:00.000Z", note: "Applied safely" },
    event: { name: "apply.completed", actor: "apply", timestamp: "2026-07-16T01:00:00.000Z", notes: ["Complete"] },
  };
  return { pair, intent };
}

function expectExactLineSubsequence(original: string, updated: string, omittedPrefixes: readonly string[] = []) {
  const lines = updated.split("\n");
  let cursor = 0;
  for (const line of original.split("\n").filter((candidate) => !omittedPrefixes.some((prefix) => candidate.startsWith(prefix)))) {
    const index = lines.indexOf(line, cursor);
    expect(index).toBeGreaterThanOrEqual(cursor);
    cursor = index + 1;
  }
}

describe("registry AST-preserving documents", () => {
  test("appends one semantic transition without rewriting comments or unknown nodes", () => {
    const { pair, intent } = fixture();
    const result = applyRegistryIntentToDocumentsV1(pair, intent, { transactionId: "tx-1", artifactExists: true });
    expect(result.status).toBe("applied");
    expect(result.pair.state.source).toContain("# state header");
    expect(result.pair.state.source).toContain("x-unknown: keep # unknown comment");
    expect(result.pair.state.source).toContain("  # artifact comment");
    expect(result.pair.state.source).toContain("tail: keep");
    expect(result.pair.events.source).toContain("x-events-unknown: keep");
    expect(result.pair.state.source).toContain("  apply-progress: apply-progress.md");
    expect(result.pair.events.source).toContain("intent_id: registry-intent:v1:fixture");
    expect(result.pair.events.source).toContain("transaction_id: tx-1");
    expect(result.pair.writable).toBe(true);
    expectExactLineSubsequence(STATE, result.pair.state.source, ["currentPhase:", "status:"]);
    expectExactLineSubsequence(EVENTS, result.pair.events.source);
  });

  test("treats exact replay as a byte-identical no-op", () => {
    const { pair, intent } = fixture();
    const first = applyRegistryIntentToDocumentsV1(pair, intent, { transactionId: "tx-1", artifactExists: true });
    const replay = applyRegistryIntentToDocumentsV1(first.pair, intent, { transactionId: "tx-2", artifactExists: true });
    expect(replay.status).toBe("replayed");
    expect(replay.pair.state.source).toBe(first.pair.state.source);
    expect(replay.pair.events.source).toBe(first.pair.events.source);
  });

  test("persists a durable approval and its one-use consumption across handoffs", () => {
    const { pair, intent } = fixture();
    const approvalReceipt = {
      schema: "approval-receipt-v1" as const,
      receiptId: "approval-receipt:v1:fixture",
      digest: `sha256:${"c".repeat(64)}`,
      changeId: "registry-fixture",
      gate: "archive",
      subjectDigest: `sha256:${"d".repeat(64)}`,
      decision: "approved" as const,
      actor: "user",
      timestamp: "2026-07-16T00:30:00.000Z",
      transitionId: "transition-1",
    };
    const approvalConsumption = {
      receiptId: approvalReceipt.receiptId,
      receiptDigest: approvalReceipt.digest,
      transitionId: approvalReceipt.transitionId,
    };
    const result = applyRegistryIntentToDocumentsV1(pair, {
      ...intent,
      approvalReceipt,
      approvalConsumption,
    }, { transactionId: "tx-approved", artifactExists: true });

    expect(result.pair.state.source).toContain("approvalReceipt:");
    expect(result.pair.state.source).toContain("receiptId: approval-receipt:v1:fixture");
    expect(result.pair.state.source).toContain("approvalConsumption:");
    expect(result.pair.events.source).toContain("approval_receipt:");
    expect(result.pair.events.source).toContain("approval_consumption:");
  });

  test("rejects a non-identical intent reusing the transition key", () => {
    const { pair, intent } = fixture();
    const first = applyRegistryIntentToDocumentsV1(pair, intent, { transactionId: "tx-1", artifactExists: true });
    expect(() => applyRegistryIntentToDocumentsV1(first.pair, { ...intent, intentId: "registry-intent:v1:other" }, {
      transactionId: "tx-2",
      artifactExists: true,
    })).toThrow(new RegistryDocumentMutationError("registry-intent-conflict"));
  });

  test("rejects stale bases and absent artifacts", () => {
    const { pair, intent } = fixture();
    expect(() => applyRegistryIntentToDocumentsV1(pair, { ...intent, base: { ...intent.base, stateDigest: `sha256:${"c".repeat(64)}` } }, {
      transactionId: "tx-1",
      artifactExists: true,
    })).toThrow(new RegistryDocumentMutationError("registry-intent-conflict"));
    expect(() => applyRegistryIntentToDocumentsV1(pair, intent, { transactionId: "tx-1", artifactExists: false }))
      .toThrow(new RegistryDocumentMutationError("invalid-evidence"));
  });

  test("exposes no arbitrary patch or removal surface", () => {
    const { pair, intent } = fixture();
    const removal = { ...intent, removeArtifacts: ["design"] };
    expect(() => applyRegistryIntentToDocumentsV1(pair, removal, { transactionId: "tx-remove", artifactExists: true }))
      .toThrow(new RegistryDocumentMutationError("invalid-evidence"));
    expect(pair.state.source).toBe(STATE);
    expect(pair.events.source).toBe(EVENTS);
  });

  test("keeps warning-compatible state/event mismatch readable", () => {
    const pair = parseRegistryDocumentPairV1({
      stateSource: STATE,
      eventsSource: EVENTS.replace("phase: design", "phase: proposal"),
    });
    expect(pair.valid).toBe(true);
    expect(pair.writable).toBe(true);
    expect(pair.issues).toContainEqual({
      severity: "warning",
      code: "registry-state-event-mismatch",
      document: "pair",
      field: "currentPhase",
    });
  });

  test("keeps legacy documents readable but not writable", () => {
    const pair = parseRegistryDocumentPairV1({
      stateSource: STATE.replace("schema: spec-registry-v1\n", ""),
      eventsSource: EVENTS.replace("schema: spec-registry-events-v1\n", ""),
    });
    expect(pair.valid).toBe(true);
    expect(pair.writable).toBe(false);
    expect(pair.issues.filter((issue) => issue.code === "registry-document-legacy")).toHaveLength(2);
  });

  test("reads legacy aliases and flat event history without normalization", () => {
    const stateSource = `current_phase: apply\nstatus: in_progress\nartifacts: {}\nprovenance: {}\n`;
    const eventsSource = `- phase: design\n  status: completed\n  event: design.completed\n  artifact: design.md\n  timestamp: "2026-07-16"\n  actor: design\n`;
    const pair = parseRegistryDocumentPairV1({ stateSource, eventsSource, expectedChangeId: "legacy-change" });
    expect(pair.valid).toBe(true);
    expect(pair.writable).toBe(false);
    expect(pair.changeId).toBe("legacy-change");
    expect(pair.state.source).toBe(stateSource);
    expect(pair.events.source).toBe(eventsSource);
  });
});
