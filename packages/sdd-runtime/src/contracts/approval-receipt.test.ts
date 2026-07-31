import { describe, expect, test } from "bun:test";

import { buildApprovalReceiptV1, consumeApprovalReceiptV1 } from "./approval-receipt";
import { buildRegistryIntentV1, parseRegistryIntentV1 } from "./registry-intent";

const digest = (char: string) => `sha256:${char.repeat(64)}` as const;

describe("durable approval receipts", () => {
  const receipt = buildApprovalReceiptV1({
    schema: "approval-receipt-v1", changeId: "change", gate: "archive", subjectDigest: digest("a"), decision: "approved",
    actor: "user", timestamp: "2026-07-30T00:00:00.000Z", transitionId: "transition-1",
  });

  test("accepts exact replay but rejects stale, wrong, and reused consumption", () => {
    const first = consumeApprovalReceiptV1(receipt, { changeId: "change", gate: "archive", subjectDigest: digest("a"), transitionId: "transition-1" });
    expect(first.status).toBe("consumed");
    if (first.status !== "consumed") throw new Error("expected consumption");
    expect(consumeApprovalReceiptV1(receipt, { changeId: "change", gate: "archive", subjectDigest: digest("a"), transitionId: "transition-1" }, first.record).status).toBe("replayed");
    expect(consumeApprovalReceiptV1(receipt, { changeId: "change", gate: "archive", subjectDigest: digest("b"), transitionId: "transition-1" }).status).toBe("stale");
    expect(consumeApprovalReceiptV1(receipt, { changeId: "other", gate: "archive", subjectDigest: digest("a"), transitionId: "transition-1" }).status).toBe("wrong-subject");
    expect(consumeApprovalReceiptV1(receipt, { changeId: "change", gate: "archive", subjectDigest: digest("a"), transitionId: "transition-2" }, first.record).status).toBe("reused");
  });

  test("binds the receipt and its one-use consumption to a durable registry intent", () => {
    const consumption = consumeApprovalReceiptV1(receipt, {
      changeId: "change",
      gate: "archive",
      subjectDigest: digest("a"),
      transitionId: "transition-1",
    });
    if (consumption.status !== "consumed") throw new Error("expected consumption");
    const intent = buildRegistryIntentV1({
      schema: "registry-intent-v1",
      idempotencyKey: digest("b"),
      changeId: "change",
      base: { stateDigest: digest("c"), eventsDigest: digest("d") },
      phase: "archive",
      status: "completed",
      artifact: { kind: "archive", path: "archive.md" },
      provenance: { agent: "orchestrator", model: "model", timestamp: "2026-07-30T00:01:00.000Z" },
      event: { name: "archive.completed", actor: "orchestrator", timestamp: "2026-07-30T00:01:00.000Z", notes: [] },
      approvalReceipt: receipt,
      approvalConsumption: consumption.record,
    });

    const restored = parseRegistryIntentV1(structuredClone(intent));
    expect(restored.approvalReceipt).toEqual(receipt);
    expect(restored.approvalConsumption).toEqual(consumption.record);
    expect(() => parseRegistryIntentV1({
      ...structuredClone(intent),
      approvalConsumption: { ...consumption.record, transitionId: "transition-other" },
    })).toThrow("invalid-evidence: intent.approvalConsumption");
  });
});
