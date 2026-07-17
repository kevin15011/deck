import { randomUUID } from "node:crypto";

import {
  applyRegistryIntentToDocumentsV1,
  parseRegistryDocumentPairV1,
  RegistryDocumentMutationError,
} from "@deck/core/spec-registry";

import { parseRegistryIntentV1, type RegistryIntentV1 } from "../contracts/registry-intent";
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
  recover(changeId: string): Promise<RegistryCoordinatorResultV1>;
}

export interface RegistryCoordinatorOptionsV1 {
  readonly mode: RegistryWriterModeV1;
  readonly store: RegistryPairStoreAdapterV1;
  readonly createTransactionId?: (intent: RegistryIntentV1) => string;
}

const result = (code: RegistryCoordinatorCodeV1, fields: Omit<RegistryCoordinatorResultV1, "code"> = {}):
  RegistryCoordinatorResultV1 => Object.freeze({ code, ...fields });

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
    const outcomes: RegistryCoordinatorResultV1[] = [];
    for (const intent of intents) {
      const outcome = await commit(intent);
      outcomes.push(outcome);
      if (outcome.code !== "committed" && outcome.code !== "replayed" && outcome.code !== "distributed-compatible") break;
    }
    return Object.freeze(outcomes);
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

  return Object.freeze({ mode: options.mode, commit, commitAll, recover });
}
