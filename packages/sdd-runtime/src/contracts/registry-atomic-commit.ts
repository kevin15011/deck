import { assertDigest, assertExactKeys, codeValue, deepFreeze, enumValue, sha256Digest, stringArray, type Sha256Digest } from "./canonical";

export interface RegistryAtomicCommitReceiptV1 {
  readonly schema: "registry-atomic-commit-receipt-v1";
  readonly transactionId: string;
  readonly changeId: string;
  readonly orderedIntentIds: readonly string[];
  readonly orderedIntentDigests: readonly Sha256Digest[];
  readonly base: { readonly stateDigest: Sha256Digest; readonly eventsDigest: Sha256Digest };
  readonly next: { readonly stateDigest: Sha256Digest; readonly eventsDigest: Sha256Digest };
  readonly outcome: "committed" | "replayed" | "distributed-compatible";
  readonly digest: Sha256Digest;
}

export function buildRegistryAtomicCommitReceiptV1(
  input: Omit<RegistryAtomicCommitReceiptV1, "schema" | "digest">,
): RegistryAtomicCommitReceiptV1 {
  assertExactKeys(input, ["transactionId", "changeId", "orderedIntentIds", "orderedIntentDigests", "base", "next", "outcome"], "registry atomic commit receipt input");
  const orderedIntentIds = stringArray(input.orderedIntentIds, "atomicCommit.orderedIntentIds");
  const orderedIntentDigests = [...input.orderedIntentDigests];
  if (!orderedIntentIds.length || orderedIntentIds.length !== orderedIntentDigests.length || new Set(orderedIntentIds).size !== orderedIntentIds.length) {
    throw new Error("REGISTRY_ATOMIC_COMMIT_INVALID");
  }
  orderedIntentDigests.forEach((digest) => assertDigest(digest, "atomicCommit.intentDigest"));
  assertExactKeys(input.base, ["stateDigest", "eventsDigest"], "atomic commit base");
  assertExactKeys(input.next, ["stateDigest", "eventsDigest"], "atomic commit next");
  for (const digest of [input.base.stateDigest, input.base.eventsDigest, input.next.stateDigest, input.next.eventsDigest]) assertDigest(digest, "atomicCommit.registryDigest");
  const payload = {
    schema: "registry-atomic-commit-receipt-v1" as const,
    transactionId: codeValue(input.transactionId, "atomicCommit.transactionId"),
    changeId: codeValue(input.changeId, "atomicCommit.changeId"),
    orderedIntentIds,
    orderedIntentDigests,
    base: { ...input.base },
    next: { ...input.next },
    outcome: enumValue(input.outcome, ["committed", "replayed", "distributed-compatible"] as const, "atomicCommit.outcome"),
  };
  return deepFreeze({ ...payload, digest: sha256Digest(payload) });
}

export function parseRegistryAtomicCommitReceiptV1(value: unknown): RegistryAtomicCommitReceiptV1 {
  assertExactKeys(value, ["schema", "transactionId", "changeId", "orderedIntentIds", "orderedIntentDigests", "base", "next", "outcome", "digest"], "registry atomic commit receipt");
  const raw = value as unknown as RegistryAtomicCommitReceiptV1;
  if (raw.schema !== "registry-atomic-commit-receipt-v1") throw new Error("unsupported-contract-version");
  const rebuilt = buildRegistryAtomicCommitReceiptV1({
    transactionId: raw.transactionId,
    changeId: raw.changeId,
    orderedIntentIds: raw.orderedIntentIds,
    orderedIntentDigests: raw.orderedIntentDigests,
    base: raw.base,
    next: raw.next,
    outcome: raw.outcome,
  });
  if (raw.digest !== rebuilt.digest) throw new Error("REGISTRY_ATOMIC_COMMIT_INVALID");
  return rebuilt;
}
