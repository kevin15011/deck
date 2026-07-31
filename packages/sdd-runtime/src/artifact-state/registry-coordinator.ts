import { randomUUID } from "node:crypto";

import {
  applyRegistryIntentToDocumentsV1,
  applyRegistryIntentChainToDocumentsV1,
  parseRegistryDocumentPairV1,
  RegistryDocumentMutationError,
} from "@deck/core/spec-registry";

import { parseRegistryIntentV1, type RegistryIntentV1 } from "../contracts/registry-intent";
import { buildRegistryAtomicCommitReceiptV1, type RegistryAtomicCommitReceiptV1 } from "../contracts/registry-atomic-commit";
import { sha256Digest } from "../contracts/canonical";
import type { Sha256Digest } from "../contracts/canonical";
import { buildRegistryPairTransactionV1 } from "./registry-transaction";
import type { RegistryPairStoreAdapterV1, RegistryWriterModeV1 } from "./registry-pair-store";

export type RegistryCoordinatorCodeV1 =
  | "committed"
  | "replayed"
  | "distributed-compatible"
  | "invalid-evidence"
  | "registry-intent-conflict"
  | "registry-recovery-required";

export interface RegistryCoordinatorResultV1 {
  readonly code: RegistryCoordinatorCodeV1;
  readonly intentId?: string;
  readonly transactionId?: string;
  readonly stateDigest?: Sha256Digest;
  readonly eventsDigest?: Sha256Digest;
}

export interface RegistryCoordinatorV1 {
  readonly mode: RegistryWriterModeV1;
  commit(intent: unknown): Promise<RegistryCoordinatorResultV1>;
  commitAll(intents: readonly unknown[]): Promise<readonly RegistryCoordinatorResultV1[]>;
  commitAtomicChain(intents: readonly unknown[]): Promise<{
    readonly outcomes: readonly RegistryCoordinatorResultV1[];
    readonly receipt?: RegistryAtomicCommitReceiptV1;
  }>;
  recover(changeId: string): Promise<RegistryCoordinatorResultV1>;
}

export interface RegistryCoordinatorOptionsV1 {
  readonly mode: RegistryWriterModeV1;
  readonly store: RegistryPairStoreAdapterV1;
  readonly createTransactionId?: (intent: RegistryIntentV1) => string;
}

const result = (code: RegistryCoordinatorCodeV1, fields: Omit<RegistryCoordinatorResultV1, "code"> = {}):
  RegistryCoordinatorResultV1 => Object.freeze({ code, ...fields });
const trustedCoordinators = new WeakSet<object>();

export function isTrustedRegistryCoordinatorV1(value: unknown): value is RegistryCoordinatorV1 {
  return typeof value === "object" && value !== null && trustedCoordinators.has(value);
}

export function createRegistryCoordinatorV1(options: RegistryCoordinatorOptionsV1): RegistryCoordinatorV1 {
  const createTransactionId = options.createTransactionId ?? (() => `registry-tx-${randomUUID()}`);

  async function commit(rawIntent: unknown): Promise<RegistryCoordinatorResultV1> {
    let intent: RegistryIntentV1;
    try { intent = parseRegistryIntentV1(rawIntent); }
    catch { return result("invalid-evidence"); }
    if (options.mode !== "centralized") return result("distributed-compatible", { intentId: intent.intentId });
    let snapshot;
    try { snapshot = await options.store.read(intent.changeId); }
    catch (error) {
      return result(error instanceof Error && error.message === "registry-intent-conflict" ? "registry-intent-conflict" : "registry-recovery-required", {
        intentId: intent.intentId,
      });
    }
    const pair = parseRegistryDocumentPairV1({
      stateSource: snapshot.stateSource,
      eventsSource: snapshot.eventsSource,
      expectedChangeId: intent.changeId,
    });
    if (!pair.writable) return result("invalid-evidence", { intentId: intent.intentId });
    let artifact;
    try { artifact = await options.store.inspectArtifact(intent.changeId, intent.artifact.path); }
    catch { return result("registry-recovery-required", { intentId: intent.intentId }); }
    if (!artifact.exists || intent.artifact.digest !== undefined && artifact.digest !== intent.artifact.digest) {
      return result("invalid-evidence", { intentId: intent.intentId });
    }
    let transactionId: string;
    try { transactionId = createTransactionId(intent); }
    catch { return result("invalid-evidence", { intentId: intent.intentId }); }
    let transaction: ReturnType<typeof buildRegistryPairTransactionV1>;
    try {
      const application = applyRegistryIntentToDocumentsV1(pair, intent, { transactionId, artifactExists: true });
      if (application.status === "replayed") {
        return result("replayed", {
          intentId: intent.intentId,
          transactionId,
          stateDigest: pair.state.digest as Sha256Digest,
          eventsDigest: pair.events.digest as Sha256Digest,
        });
      }
      transaction = buildRegistryPairTransactionV1({
        transactionId,
        intentId: intent.intentId,
        idempotencyKey: intent.idempotencyKey,
        artifact: { path: intent.artifact.path, digest: artifact.digest! },
        base: snapshot,
        stateSource: application.pair.state.source,
        eventsSource: application.pair.events.source,
        stateEdits: application.edits.state,
        eventsEdits: application.edits.events,
      });
    } catch (error) {
      if (error instanceof RegistryDocumentMutationError) return result(error.code, { intentId: intent.intentId });
      return result("invalid-evidence", { intentId: intent.intentId });
    }
    let committed;
    try { committed = await options.store.commit(transaction); }
    catch { return result("registry-recovery-required", { intentId: intent.intentId, transactionId }); }
    if (committed.code !== "committed" && committed.code !== "replayed") {
      return result(committed.code === "registry-intent-conflict" ? "registry-intent-conflict" : "registry-recovery-required", {
        intentId: intent.intentId,
        transactionId,
      });
    }
    return result(committed.code, {
      intentId: intent.intentId,
      transactionId,
      stateDigest: transaction.next.stateDigest,
      eventsDigest: transaction.next.eventsDigest,
    });
  }

  async function commitAll(intents: readonly unknown[]): Promise<readonly RegistryCoordinatorResultV1[]> {
    if (intents.length > 1 && options.mode === "centralized") {
      let chain: RegistryIntentV1[];
      try { chain = intents.map(parseRegistryIntentV1); } catch { return Object.freeze([result("invalid-evidence")]); }
      if (new Set(chain.map((intent) => intent.changeId)).size !== 1) return Object.freeze([result("invalid-evidence")]);
      const first = chain[0]!;
      const artifacts: { path: string; digest: Sha256Digest }[] = [];
      let snapshot;
      try { snapshot = await options.store.read(first.changeId); } catch { return Object.freeze([result("registry-recovery-required", { intentId: first.intentId })]); }
      const pair = parseRegistryDocumentPairV1({ stateSource: snapshot.stateSource, eventsSource: snapshot.eventsSource, expectedChangeId: first.changeId });
      if (!pair.writable) return Object.freeze([result("invalid-evidence", { intentId: first.intentId })]);
      for (const intent of chain) {
        try {
          const artifact = await options.store.inspectArtifact(intent.changeId, intent.artifact.path);
          if (!artifact.exists || intent.artifact.digest !== undefined && artifact.digest !== intent.artifact.digest) return Object.freeze([result("invalid-evidence", { intentId: intent.intentId })]);
          artifacts.push({ path: intent.artifact.path, digest: artifact.digest! });
        } catch { return Object.freeze([result("registry-recovery-required", { intentId: intent.intentId })]); }
      }
      let transactionId: string;
      try { transactionId = createTransactionId(first); } catch { return Object.freeze([result("invalid-evidence", { intentId: first.intentId })]); }
      try {
        const application = applyRegistryIntentChainToDocumentsV1(pair, chain, { transactionId, artifactExists: true });
        const last = chain.at(-1)!;
        const artifact = artifacts.at(-1)!;
        const chainId = `registry-chain-${sha256Digest(chain.map((intent) => intent.intentId)).slice(7, 31)}`;
        const transaction = buildRegistryPairTransactionV1({ transactionId, intentId: chainId, idempotencyKey: sha256Digest(chain.map((intent) => intent.idempotencyKey)), artifact, artifacts, base: snapshot, stateSource: application.pair.state.source, eventsSource: application.pair.events.source, stateEdits: application.edits.state, eventsEdits: application.edits.events });
        const committed = await options.store.commit(transaction);
        if (committed.code !== "committed" && committed.code !== "replayed") return Object.freeze([result(committed.code === "registry-intent-conflict" ? "registry-intent-conflict" : "registry-recovery-required", { intentId: first.intentId, transactionId })]);
        const code = committed.code as "committed" | "replayed";
        return Object.freeze(chain.map((intent) => result(code, { intentId: intent.intentId, transactionId, stateDigest: transaction.next.stateDigest, eventsDigest: transaction.next.eventsDigest })));
      } catch (error) {
        return Object.freeze([result(error instanceof RegistryDocumentMutationError ? error.code : "invalid-evidence", { intentId: first.intentId, transactionId })]);
      }
    }
    const outcomes: RegistryCoordinatorResultV1[] = [];
    for (const intent of intents) {
      const outcome = await commit(intent);
      outcomes.push(outcome);
      if (outcome.code !== "committed" && outcome.code !== "replayed" && outcome.code !== "distributed-compatible") break;
    }
    return Object.freeze(outcomes);
  }

  async function commitAtomicChain(intents: readonly unknown[]) {
    let chain: RegistryIntentV1[];
    try { chain = intents.map(parseRegistryIntentV1); }
    catch { return Object.freeze({ outcomes: Object.freeze([result("invalid-evidence")]) }); }
    if (chain.length === 0 || new Set(chain.map((intent) => intent.changeId)).size !== 1) {
      return Object.freeze({ outcomes: Object.freeze([result("invalid-evidence")]) });
    }
    const outcomes = await commitAll(chain);
    if (
      outcomes.length !== chain.length ||
      outcomes.some((outcome, index) => outcome.intentId !== chain[index]!.intentId || !["committed", "replayed", "distributed-compatible"].includes(outcome.code))
    ) return Object.freeze({ outcomes });
    const transactionIds = [...new Set(outcomes.map((outcome) => outcome.transactionId).filter((value): value is string => value !== undefined))];
    if (options.mode === "centralized" && transactionIds.length !== 1) return Object.freeze({ outcomes });
    const last = outcomes.at(-1)!;
    if (options.mode === "centralized" && (last.stateDigest === undefined || last.eventsDigest === undefined)) return Object.freeze({ outcomes });
    const outcome = outcomes.every((entry) => entry.code === "replayed")
      ? "replayed" as const
      : outcomes.some((entry) => entry.code === "distributed-compatible")
        ? "distributed-compatible" as const
        : "committed" as const;
    const receipt = buildRegistryAtomicCommitReceiptV1({
      transactionId: transactionIds[0] ?? `registry-distributed-${sha256Digest(chain.map((intent) => intent.digest)).slice(7, 31)}`,
      changeId: chain[0]!.changeId,
      orderedIntentIds: chain.map((intent) => intent.intentId),
      orderedIntentDigests: chain.map((intent) => intent.digest),
      base: chain[0]!.base,
      next: {
        stateDigest: last.stateDigest ?? chain[0]!.base.stateDigest,
        eventsDigest: last.eventsDigest ?? chain[0]!.base.eventsDigest,
      },
      outcome,
    });
    return Object.freeze({ outcomes, receipt });
  }

  async function recover(changeId: string): Promise<RegistryCoordinatorResultV1> {
    if (options.mode !== "centralized") return result("distributed-compatible");
    let outcome;
    try { outcome = await options.store.recover(changeId); }
    catch { return result("registry-recovery-required"); }
    if (outcome.code === "recovered" || outcome.code === "none" || outcome.code === "committed" || outcome.code === "replayed") {
      return result("replayed");
    }
    return result(outcome.code === "registry-intent-conflict" ? "registry-intent-conflict" : "registry-recovery-required");
  }

  const coordinator = Object.freeze({ mode: options.mode, commit, commitAll, commitAtomicChain, recover });
  trustedCoordinators.add(coordinator);
  return coordinator;
}
