import { isMap, isSeq, parseDocument, stringify } from "yaml";

import { isKnownRegistryEventName } from "./validator";
import {
  parseRegistryDocumentPairV1,
  type RegistryDocumentPairV1,
} from "./documents";

export interface RegistrySemanticIntentV1 {
  readonly schema: "registry-intent-v1";
  readonly intentId: string;
  readonly digest?: string;
  readonly idempotencyKey: string;
  readonly changeId: string;
  readonly batchId?: string;
  readonly batchDigest?: string;
  readonly base: { readonly stateDigest: string; readonly eventsDigest: string };
  readonly phase: string;
  readonly status: string;
  readonly artifact: { readonly kind: string; readonly path: string; readonly digest?: string };
  readonly provenance: {
    readonly agent: string;
    readonly model: string;
    readonly timestamp: string;
    readonly note?: string;
  };
  readonly decisionDigest?: string;
  readonly approvalReceipt?: {
    readonly schema: "approval-receipt-v1";
    readonly receiptId: string;
    readonly digest: string;
    readonly changeId: string;
    readonly gate: string;
    readonly subjectDigest: string;
    readonly decision: "approved" | "rejected";
    readonly actor: string;
    readonly timestamp: string;
    readonly transitionId: string;
  };
  readonly approvalConsumption?: {
    readonly receiptId: string;
    readonly receiptDigest: string;
    readonly transitionId: string;
  };
  readonly event: {
    readonly name: string;
    readonly actor: string;
    readonly timestamp: string;
    readonly notes: readonly string[];
  };
}

export interface RegistryIntentApplicationOptionsV1 {
  readonly transactionId: string;
  readonly artifactExists: boolean;
}

export interface RegistryIntentApplicationV1 {
  readonly status: "applied" | "replayed";
  readonly pair: RegistryDocumentPairV1;
  readonly edits: {
    readonly state: readonly RegistryDocumentEditV1[];
    readonly events: readonly RegistryDocumentEditV1[];
  };
}

export class RegistryDocumentMutationError extends Error {
  readonly code: "invalid-evidence" | "registry-intent-conflict";

  constructor(code: "invalid-evidence" | "registry-intent-conflict") {
    super(code);
    this.name = "RegistryDocumentMutationError";
    this.code = code;
  }
}

export interface RegistryDocumentEditV1 {
  readonly start: number;
  readonly end: number;
  readonly value: string;
}

type Patch = RegistryDocumentEditV1;

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function ast(source: string) {
  const document = parseDocument(source, { keepSourceTokens: true });
  if (document.errors.length > 0 || !isMap(document.contents)) throw new RegistryDocumentMutationError("invalid-evidence");
  return document.contents;
}

function pairFor(root: ReturnType<typeof ast>, key: string) {
  return root.items.find((item) => String(item.key) === key);
}

function rangeOf(value: unknown): readonly [number, number, number?] {
  const range = record(value)?.range;
  if (!Array.isArray(range) || typeof range[0] !== "number" || typeof range[1] !== "number") {
    throw new RegistryDocumentMutationError("invalid-evidence");
  }
  return range as unknown as readonly [number, number, number?];
}

function rootScalarPatch(root: ReturnType<typeof ast>, key: string, value: string): Patch | undefined {
  const item = pairFor(root, key);
  if (!item?.value || String(item.value) === value) return undefined;
  const range = rangeOf(item.value);
  return { start: range[0], end: range[1], value: stringify(value).trimEnd() };
}

function indent(value: string, spaces: number): string {
  const prefix = " ".repeat(spaces);
  return value.split("\n").map((line) => `${prefix}${line}`).join("\n");
}

function appendMapPatch(source: string, root: ReturnType<typeof ast>, rootKey: string, key: string, value: string): Patch | undefined {
  const item = pairFor(root, rootKey);
  if (!item?.value || !isMap(item.value)) throw new RegistryDocumentMutationError("invalid-evidence");
  if (item.value.flow === true) throw new RegistryDocumentMutationError("invalid-evidence");
  const existing = item.value.items.find((candidate) => String(candidate.key) === key);
  if (existing) {
    if (String(existing.value) !== value) throw new RegistryDocumentMutationError("registry-intent-conflict");
    return undefined;
  }
  const rendered = indent(stringify({ [key]: value }).trimEnd(), 2);
  const range = rangeOf(item.value);
  if (item.value.items.length === 0) return { start: range[0], end: range[1], value: `\n${rendered}` };
  const prefix = source[range[1] - 1] === "\n" ? "" : "\n";
  return { start: range[1], end: range[1], value: `${prefix}${rendered}\n` };
}

function appendSequencePatch(source: string, root: ReturnType<typeof ast>, rootKey: string, value: Record<string, unknown>): Patch {
  const item = pairFor(root, rootKey);
  if (!item?.value || !isSeq(item.value)) throw new RegistryDocumentMutationError("invalid-evidence");
  if (item.value.flow === true) throw new RegistryDocumentMutationError("invalid-evidence");
  const rendered = indent(stringify([value]).trimEnd(), 2);
  const range = rangeOf(item.value);
  if (item.value.items.length === 0) return { start: range[0], end: range[1], value: `\n${rendered}` };
  const prefix = source[range[1] - 1] === "\n" ? "" : "\n";
  return { start: range[1], end: range[1], value: `${prefix}${rendered}\n` };
}

function applyPatches(source: string, patches: readonly (Patch | undefined)[]): string {
  return patches.filter((patch): patch is Patch => patch !== undefined)
    .sort((left, right) => right.start - left.start)
    .reduce((result, patch) => `${result.slice(0, patch.start)}${patch.value}${result.slice(patch.end)}`, source);
}

function freezePatches(patches: readonly (Patch | undefined)[]): readonly RegistryDocumentEditV1[] {
  return Object.freeze(patches.filter((patch): patch is Patch => patch !== undefined)
    .sort((left, right) => left.start - right.start)
    .map((patch) => Object.freeze({ ...patch })));
}

function assertIntent(intent: RegistrySemanticIntentV1, pair: RegistryDocumentPairV1, options: RegistryIntentApplicationOptionsV1): void {
  const nonEmpty = (value: unknown): value is string => typeof value === "string" && value.length > 0;
  const digest = (value: unknown): value is string => typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
  const exact = (value: unknown, allowed: readonly string[]) => {
    const source = record(value);
    if (!source) return false;
    const prototype = Object.getPrototypeOf(source);
    return (prototype === Object.prototype || prototype === null) && Object.keys(source).every((key) => allowed.includes(key));
  };
  const approvalReceipt = intent.approvalReceipt;
  const approvalConsumption = intent.approvalConsumption;
  const validApprovalReceipt = approvalReceipt === undefined || (
    exact(approvalReceipt, ["schema", "receiptId", "digest", "changeId", "gate", "subjectDigest", "decision", "actor", "timestamp", "transitionId"]) &&
    approvalReceipt.schema === "approval-receipt-v1" && nonEmpty(approvalReceipt.receiptId) &&
    digest(approvalReceipt.digest) && approvalReceipt.changeId === intent.changeId &&
    nonEmpty(approvalReceipt.gate) && digest(approvalReceipt.subjectDigest) &&
    (approvalReceipt.decision === "approved" || approvalReceipt.decision === "rejected") &&
    nonEmpty(approvalReceipt.actor) && nonEmpty(approvalReceipt.timestamp) && nonEmpty(approvalReceipt.transitionId)
  );
  const validApprovalConsumption = approvalConsumption === undefined || (
    approvalReceipt !== undefined && approvalReceipt.decision === "approved" &&
    exact(approvalConsumption, ["receiptId", "receiptDigest", "transitionId"]) &&
    approvalConsumption.receiptId === approvalReceipt.receiptId &&
    approvalConsumption.receiptDigest === approvalReceipt.digest &&
    approvalConsumption.transitionId === approvalReceipt.transitionId
  );
  if (intent.schema !== "registry-intent-v1" || intent.changeId !== pair.changeId || !options.artifactExists ||
    !nonEmpty(intent.intentId) || !digest(intent.idempotencyKey) || !nonEmpty(intent.phase) || !nonEmpty(intent.status) ||
    !nonEmpty(intent.artifact.kind) || !nonEmpty(intent.artifact.path) || !nonEmpty(intent.provenance.agent) ||
    !nonEmpty(intent.provenance.model) || !nonEmpty(intent.provenance.timestamp) || !nonEmpty(intent.event.actor) ||
    !nonEmpty(intent.event.timestamp) || !nonEmpty(intent.event.name) || !isKnownRegistryEventName(intent.event.name) ||
    !nonEmpty(options.transactionId) || options.transactionId.length > 200 || !Array.isArray(intent.event.notes) ||
    !intent.event.notes.every((note) => typeof note === "string") || !digest(intent.base.stateDigest) ||
    !digest(intent.base.eventsDigest) || intent.batchDigest !== undefined && !digest(intent.batchDigest) ||
    intent.digest !== undefined && !digest(intent.digest) || intent.batchId !== undefined && !nonEmpty(intent.batchId) ||
    intent.decisionDigest !== undefined && !digest(intent.decisionDigest) ||
    !validApprovalReceipt || !validApprovalConsumption ||
    intent.artifact.digest !== undefined && !digest(intent.artifact.digest) ||
    intent.provenance.note !== undefined && typeof intent.provenance.note !== "string" ||
    !exact(intent, ["schema", "intentId", "digest", "idempotencyKey", "changeId", "batchId", "batchDigest", "base", "phase", "status", "artifact", "provenance", "event", "decisionDigest", "approvalReceipt", "approvalConsumption"]) ||
    !exact(intent.base, ["stateDigest", "eventsDigest"]) || !exact(intent.artifact, ["kind", "path", "digest"]) ||
    !exact(intent.provenance, ["agent", "model", "timestamp", "note"]) ||
    !exact(intent.event, ["name", "actor", "timestamp", "notes"])) {
    throw new RegistryDocumentMutationError("invalid-evidence");
  }
}

export function applyRegistryIntentToDocumentsV1(
  pair: RegistryDocumentPairV1,
  intent: RegistrySemanticIntentV1,
  options: RegistryIntentApplicationOptionsV1,
): RegistryIntentApplicationV1 {
  if (!pair.writable) throw new RegistryDocumentMutationError("invalid-evidence");
  assertIntent(intent, pair, options);
  const stateData = record(pair.state.data)!;
  const eventsData = record(pair.events.data)!;
  const events = eventsData.events as readonly unknown[];
  const existingByKey = events.find((item) => record(item)?.idempotency_key === intent.idempotencyKey);
  const existingById = events.find((item) => record(item)?.intent_id === intent.intentId);
  if (existingByKey) {
    const event = record(existingByKey)!;
    if (event.intent_id !== intent.intentId) {
      throw new RegistryDocumentMutationError("registry-intent-conflict");
    }
    return Object.freeze({ status: "replayed", pair, edits: Object.freeze({ state: Object.freeze([]), events: Object.freeze([]) }) });
  }
  if (existingById) {
    const event = record(existingById)!;
    if (event.idempotency_key !== undefined && event.idempotency_key !== intent.idempotencyKey) {
      throw new RegistryDocumentMutationError("registry-intent-conflict");
    }
    return Object.freeze({ status: "replayed", pair, edits: Object.freeze({ state: Object.freeze([]), events: Object.freeze([]) }) });
  }
  if (intent.base.stateDigest !== pair.state.digest || intent.base.eventsDigest !== pair.events.digest) {
    throw new RegistryDocumentMutationError("registry-intent-conflict");
  }

  const stateRoot = ast(pair.state.source);
  const eventsRoot = ast(pair.events.source);
  const provenance = {
    phase: intent.phase,
    agent: intent.provenance.agent,
    model: intent.provenance.model,
    timestamp: intent.provenance.timestamp,
    registryWrite: "non-deferred",
    ...(intent.provenance.note === undefined ? {} : { note: intent.provenance.note }),
    intentId: intent.intentId,
    idempotencyKey: intent.idempotencyKey,
    transactionId: options.transactionId,
    ...(intent.batchDigest === undefined ? {} : { batchDigest: intent.batchDigest }),
    ...(intent.approvalReceipt === undefined ? {} : { approvalReceipt: intent.approvalReceipt }),
    ...(intent.approvalConsumption === undefined ? {} : { approvalConsumption: intent.approvalConsumption }),
  };
  const event = {
    phase: intent.phase,
    status: intent.status,
    event: intent.event.name,
    artifact: intent.artifact.path,
    timestamp: intent.event.timestamp,
    actor: intent.event.actor,
    registry_write: "non-deferred",
    intent_id: intent.intentId,
    idempotency_key: intent.idempotencyKey,
    transaction_id: options.transactionId,
    ...(intent.batchDigest === undefined ? {} : { batch_digest: intent.batchDigest }),
    ...(intent.approvalReceipt === undefined ? {} : { approval_receipt: intent.approvalReceipt }),
    ...(intent.approvalConsumption === undefined ? {} : { approval_consumption: intent.approvalConsumption }),
    notes: [...intent.event.notes],
  };

  const statePatches = [
    rootScalarPatch(stateRoot, "currentPhase", intent.phase),
    rootScalarPatch(stateRoot, "status", intent.status),
    appendMapPatch(pair.state.source, stateRoot, "artifacts", intent.artifact.kind, intent.artifact.path),
    appendSequencePatch(pair.state.source, stateRoot, "provenance", provenance),
  ];
  const eventsPatches = [
    appendSequencePatch(pair.events.source, eventsRoot, "events", event),
  ];
  const stateSource = applyPatches(pair.state.source, statePatches);
  const eventsSource = applyPatches(pair.events.source, eventsPatches);
  const next = parseRegistryDocumentPairV1({ stateSource, eventsSource, expectedChangeId: intent.changeId });
  if (!next.writable || record(next.state.data)?.currentPhase !== intent.phase ||
    record(next.state.data)?.status !== intent.status || record(stateData.artifacts)?.[intent.artifact.kind] !== undefined &&
    record(stateData.artifacts)?.[intent.artifact.kind] !== intent.artifact.path) {
    throw new RegistryDocumentMutationError("invalid-evidence");
  }
  return Object.freeze({
    status: "applied",
    pair: next,
    edits: Object.freeze({ state: freezePatches(statePatches), events: freezePatches(eventsPatches) }),
  });
}

/** Simulates ordered intents against one base and emits one compact, replayable edit set. */
export function applyRegistryIntentChainToDocumentsV1(
  pair: RegistryDocumentPairV1,
  intents: readonly RegistrySemanticIntentV1[],
  options: RegistryIntentApplicationOptionsV1,
): RegistryIntentApplicationV1 {
  if (!intents.length) throw new RegistryDocumentMutationError("invalid-evidence");
  const base = { stateDigest: pair.state.digest, eventsDigest: pair.events.digest };
  let current = pair;
  for (const intent of intents) {
    if (intent.base.stateDigest !== base.stateDigest || intent.base.eventsDigest !== base.eventsDigest) {
      throw new RegistryDocumentMutationError("registry-intent-conflict");
    }
    const rebased = { ...intent, base: { stateDigest: current.state.digest, eventsDigest: current.events.digest } };
    const applied = applyRegistryIntentToDocumentsV1(current, rebased, options);
    current = applied.pair;
  }
  return Object.freeze({
    status: "applied",
    pair: current,
    edits: Object.freeze({ state: lineEdits(pair.state.source, current.state.source), events: lineEdits(pair.events.source, current.events.source) }),
  });
}

function lineEdits(source: string, target: string): readonly RegistryDocumentEditV1[] {
  if (source === target) return Object.freeze([]);
  const sourceLines = source.match(/.*(?:\n|$)/g)?.filter((line) => line !== "") ?? [];
  const targetLines = target.match(/.*(?:\n|$)/g)?.filter((line) => line !== "") ?? [];
  if (sourceLines.length * targetLines.length > 1_000_000) throw new RegistryDocumentMutationError("invalid-evidence");
  const table = Array.from({ length: sourceLines.length + 1 }, () => new Uint32Array(targetLines.length + 1));
  for (let left = sourceLines.length - 1; left >= 0; left--) for (let right = targetLines.length - 1; right >= 0; right--) table[left]![right] = sourceLines[left] === targetLines[right] ? table[left + 1]![right + 1]! + 1 : Math.max(table[left + 1]![right]!, table[left]![right + 1]!);
  const edits: RegistryDocumentEditV1[] = []; let left = 0, right = 0, offset = 0, start = 0, removed = "", added = "";
  const flush = () => { if (removed || added) edits.push(Object.freeze({ start, end: start + removed.length, value: added })); removed = ""; added = ""; };
  while (left < sourceLines.length || right < targetLines.length) {
    if (left < sourceLines.length && right < targetLines.length && sourceLines[left] === targetLines[right]) { flush(); offset += sourceLines[left]!.length; left++; right++; continue; }
    if (left >= sourceLines.length || right < targetLines.length && table[left]![right + 1]! >= table[left + 1]![right]!) { if (!removed && !added) start = offset; added += targetLines[right++]!; }
    else { if (!removed && !added) start = offset; removed += sourceLines[left]!; offset += sourceLines[left++]!.length; }
  }
  flush();
  return Object.freeze(edits);
}
