import { registryDocumentDigestV1 } from "@deck/core/spec-registry";
import type { RegistryDocumentEditV1 } from "@deck/core/spec-registry";

import { sha256Digest } from "../contracts/canonical";
import type { RegistryPairCommitRequestV1, RegistryPairSnapshotV1 } from "./registry-pair-store";

export type RegistryRecoveryActionV1 = "finalize" | "roll-forward-state" | "roll-forward-events" | "roll-forward-both" | "conflict";

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key)) && keys.every((key) => key in value);
}

function safeId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9:._-]{1,200}$/.test(value);
}

function changeId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(value);
}

function digest(value: unknown): value is `sha256:${string}` {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
}

function artifactPath(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 1_000 && !value.startsWith("/") &&
    !value.includes("\\") && !/[\u0000-\u001f]/.test(value) && value.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

function journalSafe(source: string): boolean {
  return !/^\s*(?:authorization(?:[_-]?proof)?|proof(?:[_-]?value)?|access[_-]?token|token|password|cookie|private[_-]?key)\s*:/im.test(source) &&
    !/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(source) &&
    !/\bBearer\s+[A-Za-z0-9._~-]{12,}/i.test(source) &&
    !/\b(?:api[_-]?key|password|token)\s*[:=]\s*[A-Za-z0-9._~-]{12,}/i.test(source);
}

function parseEdits(value: unknown): readonly RegistryDocumentEditV1[] {
  if (!Array.isArray(value) || value.length > 32) throw new Error("registry-recovery-required");
  const edits = value.map((item) => {
    const edit = record(item);
    if (!edit || !exact(edit, ["start", "end", "value"]) || !Number.isInteger(edit.start) ||
      !Number.isInteger(edit.end) || (edit.start as number) < 0 || (edit.end as number) < (edit.start as number) ||
      typeof edit.value !== "string" || Buffer.byteLength(edit.value, "utf8") > 1_048_576 || !journalSafe(edit.value)) {
      throw new Error("registry-recovery-required");
    }
    return Object.freeze({ start: edit.start as number, end: edit.end as number, value: edit.value });
  });
  for (let index = 1; index < edits.length; index++) {
    if (edits[index - 1].end > edits[index].start) throw new Error("registry-recovery-required");
  }
  return Object.freeze(edits);
}

export function applyRegistryDocumentEditsV1(
  source: string,
  editsValue: unknown,
  document: "state" | "events",
): string {
  const edits = parseEdits(editsValue);
  for (const edit of edits) {
    if (edit.end > source.length) throw new Error("registry-recovery-required");
    if (edit.end > edit.start) {
      if (document !== "state") throw new Error("registry-recovery-required");
      const lineStart = source.lastIndexOf("\n", edit.start - 1) + 1;
      const prefix = source.slice(lineStart, edit.start);
      if (!/^(?:currentPhase|status):[ \t]*$/.test(prefix) || source.slice(edit.start, edit.end).includes("\n") || edit.value.includes("\n")) {
        throw new Error("registry-recovery-required");
      }
    }
  }
  return [...edits].sort((left, right) => right.start - left.start)
    .reduce((result, edit) => `${result.slice(0, edit.start)}${edit.value}${result.slice(edit.end)}`, source);
}

function issueTransaction(
  payload: Omit<RegistryPairCommitRequestV1, "journalDigest">,
): RegistryPairCommitRequestV1 {
  return Object.freeze({ ...payload, journalDigest: sha256Digest(payload) });
}

export function buildRegistryPairTransactionV1(input: {
  readonly transactionId: string;
  readonly intentId: string;
  readonly idempotencyKey: string;
  readonly artifact: { readonly path: string; readonly digest: `sha256:${string}` };
  readonly base: RegistryPairSnapshotV1;
  readonly stateSource: string;
  readonly eventsSource: string;
  readonly stateEdits: readonly RegistryDocumentEditV1[];
  readonly eventsEdits: readonly RegistryDocumentEditV1[];
}): RegistryPairCommitRequestV1 {
  let stateEdits: readonly RegistryDocumentEditV1[], eventsEdits: readonly RegistryDocumentEditV1[];
  try { stateEdits = parseEdits(input.stateEdits); eventsEdits = parseEdits(input.eventsEdits); }
  catch { throw new Error("invalid-evidence"); }
  let renderedState: string, renderedEvents: string;
  try {
    renderedState = applyRegistryDocumentEditsV1(input.base.stateSource, stateEdits, "state");
    renderedEvents = applyRegistryDocumentEditsV1(input.base.eventsSource, eventsEdits, "events");
  } catch { throw new Error("invalid-evidence"); }
  if (!safeId(input.transactionId) || !safeId(input.intentId) || !safeId(input.idempotencyKey) || !changeId(input.base.changeId) ||
    !artifactPath(input.artifact.path) || !digest(input.artifact.digest) ||
    renderedState !== input.stateSource || renderedEvents !== input.eventsSource) throw new Error("invalid-evidence");
  return issueTransaction({
    schema: "registry-pair-transaction-v1",
    transactionId: input.transactionId,
    changeId: input.base.changeId,
    intentId: input.intentId,
    idempotencyKey: input.idempotencyKey,
    status: "prepared",
    artifact: Object.freeze({ ...input.artifact }),
    base: Object.freeze({ stateDigest: input.base.stateDigest, eventsDigest: input.base.eventsDigest }),
    next: Object.freeze({
      stateDigest: registryDocumentDigestV1(input.stateSource),
      eventsDigest: registryDocumentDigestV1(input.eventsSource),
    }),
    target: Object.freeze({ stateEdits, eventsEdits }),
    fileMode: Object.freeze({ state: input.base.stateMode, events: input.base.eventsMode }),
  });
}

export function parseRegistryPairTransactionV1(value: unknown): RegistryPairCommitRequestV1 {
  const root = record(value);
  if (!root || !exact(root, ["schema", "transactionId", "changeId", "intentId", "idempotencyKey", "status", "journalDigest", "artifact", "base", "next", "target", "fileMode"]) ||
    root.schema !== "registry-pair-transaction-v1" || !safeId(root.transactionId) || !changeId(root.changeId) ||
    !safeId(root.intentId) || !safeId(root.idempotencyKey) || !digest(root.journalDigest) ||
    (root.status !== "prepared" && root.status !== "committed")) {
    throw new Error("registry-recovery-required");
  }
  const artifact = record(root.artifact), base = record(root.base), next = record(root.next), target = record(root.target), fileMode = record(root.fileMode);
  if (!artifact || !base || !next || !target || !fileMode || !exact(artifact, ["path", "digest"]) ||
    !artifactPath(artifact.path) || !digest(artifact.digest) || !exact(base, ["stateDigest", "eventsDigest"]) ||
    !exact(next, ["stateDigest", "eventsDigest"]) || !exact(target, ["stateEdits", "eventsEdits"]) ||
    !exact(fileMode, ["state", "events"]) || !digest(base.stateDigest) || !digest(base.eventsDigest) ||
    !digest(next.stateDigest) || !digest(next.eventsDigest) || !Number.isInteger(fileMode.state) || !Number.isInteger(fileMode.events) ||
    (fileMode.state as number) < 0 || (fileMode.state as number) > 0o777 || (fileMode.events as number) < 0 || (fileMode.events as number) > 0o777 ||
    !Array.isArray(target.stateEdits) || !Array.isArray(target.eventsEdits)) {
    throw new Error("registry-recovery-required");
  }
  const stateEdits = parseEdits(target.stateEdits), eventsEdits = parseEdits(target.eventsEdits);
  const payload: Omit<RegistryPairCommitRequestV1, "journalDigest"> = {
    schema: "registry-pair-transaction-v1",
    transactionId: root.transactionId,
    changeId: root.changeId,
    intentId: root.intentId,
    idempotencyKey: root.idempotencyKey,
    status: root.status,
    artifact: Object.freeze({ path: artifact.path, digest: artifact.digest }),
    base: Object.freeze({ stateDigest: base.stateDigest, eventsDigest: base.eventsDigest }),
    next: Object.freeze({ stateDigest: next.stateDigest, eventsDigest: next.eventsDigest }),
    target: Object.freeze({ stateEdits, eventsEdits }),
    fileMode: Object.freeze({ state: fileMode.state as number, events: fileMode.events as number }),
  };
  if (sha256Digest(payload) !== root.journalDigest) throw new Error("registry-recovery-required");
  return Object.freeze({ ...payload, journalDigest: root.journalDigest });
}

export function classifyRegistryRecoveryV1(
  current: Pick<RegistryPairSnapshotV1, "stateDigest" | "eventsDigest">,
  transaction: Pick<RegistryPairCommitRequestV1, "base" | "next">,
): RegistryRecoveryActionV1 {
  const state = current.stateDigest === transaction.next.stateDigest ? "next" : current.stateDigest === transaction.base.stateDigest ? "base" : "third";
  const events = current.eventsDigest === transaction.next.eventsDigest ? "next" : current.eventsDigest === transaction.base.eventsDigest ? "base" : "third";
  if (state === "third" || events === "third") return "conflict";
  if (state === "next" && events === "next") return "finalize";
  if (state === "base" && events === "base") return "roll-forward-both";
  return state === "base" ? "roll-forward-state" : "roll-forward-events";
}

export function markRegistryTransactionCommittedV1(transaction: RegistryPairCommitRequestV1): RegistryPairCommitRequestV1 {
  const { journalDigest: _journalDigest, ...payload } = transaction;
  return issueTransaction({ ...payload, status: "committed" });
}
