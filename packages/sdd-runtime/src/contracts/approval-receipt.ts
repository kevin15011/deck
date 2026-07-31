import { assertDigest, assertExactKeys, assertId, cloneCanonical, codeValue, deepFreeze, enumValue, sha256Digest, timestampValue, type Sha256Digest } from "./canonical";

export interface ApprovalReceiptV1 {
  readonly schema: "approval-receipt-v1";
  readonly receiptId: `approval-receipt:v1:${string}`;
  readonly digest: Sha256Digest;
  readonly changeId: string;
  readonly gate: string;
  readonly subjectDigest: Sha256Digest;
  readonly decision: "approved" | "rejected";
  readonly actor: string;
  readonly timestamp: string;
  readonly transitionId: string;
}
export type ApprovalReceiptInputV1 = Omit<ApprovalReceiptV1, "receiptId" | "digest">;
export interface ApprovalConsumptionRecordV1 { readonly receiptId: string; readonly receiptDigest: Sha256Digest; readonly transitionId: string; }
export type ApprovalConsumptionResultV1 =
  | { readonly status: "consumed"; readonly record: ApprovalConsumptionRecordV1 }
  | { readonly status: "replayed"; readonly record: ApprovalConsumptionRecordV1 }
  | { readonly status: "stale" | "wrong-subject" | "reused" };

export function buildApprovalReceiptV1(input: ApprovalReceiptInputV1): ApprovalReceiptV1 {
  assertDigest(input.subjectDigest, "receipt.subjectDigest");
  const payload = cloneCanonical({
    schema: "approval-receipt-v1" as const,
    changeId: codeValue(input.changeId, "receipt.changeId"),
    gate: codeValue(input.gate, "receipt.gate"),
    subjectDigest: input.subjectDigest,
    decision: enumValue(input.decision, ["approved", "rejected"] as const, "receipt.decision"),
    actor: codeValue(input.actor, "receipt.actor"),
    timestamp: timestampValue(input.timestamp, "receipt.timestamp"),
    transitionId: codeValue(input.transitionId, "receipt.transitionId"),
  });
  const digest = sha256Digest(payload);
  return parseApprovalReceiptV1({ ...payload, receiptId: `approval-receipt:v1:${digest.slice(7, 39)}`, digest });
}
export function parseApprovalReceiptV1(value: unknown): ApprovalReceiptV1 {
  assertExactKeys(value, ["schema", "receiptId", "digest", "changeId", "gate", "subjectDigest", "decision", "actor", "timestamp", "transitionId"], "approval receipt fields");
  if (value.schema !== "approval-receipt-v1") throw new Error("unsupported-contract-version");
  assertId(value.receiptId, "approval-receipt:v1:", "receipt.receiptId"); assertDigest(value.subjectDigest, "receipt.subjectDigest");
  const payload = { schema: "approval-receipt-v1" as const, changeId: codeValue(value.changeId, "receipt.changeId"), gate: codeValue(value.gate, "receipt.gate"), subjectDigest: value.subjectDigest, decision: enumValue(value.decision, ["approved", "rejected"] as const, "receipt.decision"), actor: codeValue(value.actor, "receipt.actor"), timestamp: timestampValue(value.timestamp, "receipt.timestamp"), transitionId: codeValue(value.transitionId, "receipt.transitionId") };
  const digest = sha256Digest(payload);
  if (value.digest !== digest || value.receiptId !== `approval-receipt:v1:${digest.slice(7, 39)}`) throw new Error("invalid-evidence: approval receipt");
  return deepFreeze({ ...payload, receiptId: value.receiptId, digest }) as ApprovalReceiptV1;
}
export function consumeApprovalReceiptV1(receipt: ApprovalReceiptV1, request: { readonly changeId: string; readonly gate: string; readonly subjectDigest: Sha256Digest; readonly transitionId: string }, prior?: ApprovalConsumptionRecordV1): ApprovalConsumptionResultV1 {
  if (receipt.changeId !== request.changeId || receipt.gate !== request.gate) return { status: "wrong-subject" };
  if (prior && prior.receiptId === receipt.receiptId && prior.transitionId !== request.transitionId) return { status: "reused" };
  if (receipt.subjectDigest !== request.subjectDigest || receipt.transitionId !== request.transitionId || receipt.decision !== "approved") return { status: "stale" };
  const record = Object.freeze({ receiptId: receipt.receiptId, receiptDigest: receipt.digest, transitionId: request.transitionId });
  if (!prior) return { status: "consumed", record };
  return prior.receiptId === record.receiptId && prior.receiptDigest === record.receiptDigest && prior.transitionId === record.transitionId ? { status: "replayed", record: prior } : { status: "reused" };
}
