import type { BatchId } from "./apply-batch";
import {
  parseApprovalReceiptV1,
  type ApprovalConsumptionRecordV1,
  type ApprovalReceiptV1,
} from "./approval-receipt";
import type { Sha256Digest } from "./canonical";
import { assertDigest, assertExactKeys, assertId, assertSafeDiagnosticString, cloneCanonical, codeValue, deepFreeze, denseArray, repositoryPath, sha256Digest, stringValue, timestampValue } from "./canonical";
export interface RegistryIntentV1 {
  schema: "registry-intent-v1";
  intentId: `registry-intent:v1:${string}`;
  digest: Sha256Digest;
  idempotencyKey: Sha256Digest;
  changeId: string;
  batchId?: BatchId;
  batchDigest?: Sha256Digest;
  base: { stateDigest: Sha256Digest; eventsDigest: Sha256Digest };
  phase: string;
  status: string;
  artifact: { kind: string; path: string; digest?: Sha256Digest };
  provenance: { agent: string; model: string; timestamp: string; note?: string };
  event: { name: string; actor: string; timestamp: string; notes: readonly string[] };
  decisionDigest?: Sha256Digest;
  approvalReceipt?: ApprovalReceiptV1;
  approvalConsumption?: ApprovalConsumptionRecordV1;
}
export type RegistryIntentInputV1 = Omit<RegistryIntentV1, "intentId" | "digest">;
export function buildRegistryIntentV1(value: RegistryIntentInputV1): RegistryIntentV1 { const payload=cloneCanonical(value),digest=sha256Digest(payload);return parseRegistryIntentV1({...payload,intentId:`registry-intent:v1:${digest.slice(7,39)}`,digest}); }
export function parseRegistryIntentV1(value: unknown): RegistryIntentV1 {
  assertExactKeys(value, ["schema", "intentId", "digest", "idempotencyKey", "changeId", "batchId", "batchDigest", "base", "phase", "status", "artifact", "provenance", "event", "decisionDigest", "approvalReceipt", "approvalConsumption"], "registry intent fields");
  if (value.schema !== "registry-intent-v1") throw new Error("unsupported-contract-version");
  assertId(value.intentId, "registry-intent:v1:", "intent.intentId");
  assertDigest(value.digest, "intent.digest");
  assertDigest(value.idempotencyKey, "intent.idempotencyKey");
  if ((value.batchId === undefined) !== (value.batchDigest === undefined)) throw new Error("invalid-evidence: intent.batchReference");
  if (value.batchId !== undefined) assertId(value.batchId, "batch:v1:", "intent.batchId");
  if (value.batchDigest !== undefined) assertDigest(value.batchDigest, "intent.batchDigest");
  if (value.decisionDigest !== undefined) assertDigest(value.decisionDigest, "intent.decisionDigest");
  assertExactKeys(value.base, ["stateDigest", "eventsDigest"], "intent.base");
  assertDigest(value.base.stateDigest, "intent.base.stateDigest"); assertDigest(value.base.eventsDigest, "intent.base.eventsDigest");
  assertExactKeys(value.artifact, ["kind", "path", "digest"], "intent.artifact");
  if (value.artifact.digest !== undefined) assertDigest(value.artifact.digest, "intent.artifact.digest");
  assertExactKeys(value.provenance, ["agent", "model", "timestamp", "note"], "intent.provenance");
  assertExactKeys(value.event, ["name", "actor", "timestamp", "notes"], "intent.event");
  const approvalReceipt = value.approvalReceipt === undefined
    ? undefined
    : parseApprovalReceiptV1(value.approvalReceipt);
  if (approvalReceipt !== undefined && approvalReceipt.changeId !== value.changeId) {
    throw new Error("invalid-evidence: intent.approvalReceipt.changeId");
  }
  if (value.approvalConsumption !== undefined) {
    if (approvalReceipt === undefined || approvalReceipt.decision !== "approved") {
      throw new Error("invalid-evidence: intent.approvalConsumption");
    }
    assertExactKeys(value.approvalConsumption, ["receiptId", "receiptDigest", "transitionId"], "intent.approvalConsumption");
    assertDigest(value.approvalConsumption.receiptDigest, "intent.approvalConsumption.receiptDigest");
    if (value.approvalConsumption.receiptId !== approvalReceipt.receiptId ||
      value.approvalConsumption.receiptDigest !== approvalReceipt.digest ||
      value.approvalConsumption.transitionId !== approvalReceipt.transitionId) {
      throw new Error("invalid-evidence: intent.approvalConsumption");
    }
  }
  const payload = {
    schema: "registry-intent-v1" as const, idempotencyKey: value.idempotencyKey,
    changeId: codeValue(value.changeId, "intent.changeId"),
    ...(value.batchId === undefined ? {} : { batchId: value.batchId, batchDigest: value.batchDigest }),
    base: { stateDigest: value.base.stateDigest, eventsDigest: value.base.eventsDigest },
    phase: codeValue(value.phase, "intent.phase"), status: codeValue(value.status, "intent.status"),
    artifact: { kind: codeValue(value.artifact.kind, "intent.artifact.kind"), path: repositoryPath(value.artifact.path, { repositoryRoot: "." }, "intent.artifact.path"), ...(value.artifact.digest === undefined ? {} : { digest: value.artifact.digest }) },
    provenance: { agent: codeValue(value.provenance.agent, "intent.provenance.agent"), model: codeValue(value.provenance.model, "intent.provenance.model"), timestamp: timestampValue(value.provenance.timestamp, "intent.provenance.timestamp"), ...(value.provenance.note === undefined ? {} : { note: safeNote(value.provenance.note, "intent.provenance.note") }) },
    event: { name: codeValue(value.event.name, "intent.event.name"), actor: codeValue(value.event.actor, "intent.event.actor"), timestamp: timestampValue(value.event.timestamp, "intent.event.timestamp"), notes: denseArray(value.event.notes, "intent.event.notes").map((note, index) => safeNote(note, `intent.event.notes[${index}]`)) },
    ...(value.decisionDigest === undefined ? {} : { decisionDigest: value.decisionDigest }),
    ...(approvalReceipt === undefined ? {} : { approvalReceipt }),
    ...(value.approvalConsumption === undefined ? {} : {
      approvalConsumption: {
        receiptId: codeValue(value.approvalConsumption.receiptId, "intent.approvalConsumption.receiptId"),
        receiptDigest: value.approvalConsumption.receiptDigest,
        transitionId: codeValue(value.approvalConsumption.transitionId, "intent.approvalConsumption.transitionId"),
      },
    }),
  };
  const expected = sha256Digest(payload);
  if (value.digest !== expected || value.intentId !== `registry-intent:v1:${expected.slice(7, 39)}`) throw new Error("invalid-evidence: registry intent");
  return deepFreeze({ ...payload, intentId: value.intentId, digest: value.digest }) as RegistryIntentV1;
}

function safeNote(value: unknown, field: string): string {
  const note = stringValue(value, field, 1_024);
  assertSafeDiagnosticString(note, field, 1_024);
  return note;
}
