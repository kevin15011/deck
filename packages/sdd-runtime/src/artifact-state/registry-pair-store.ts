export type RegistryWriterModeV1 = "distributed-compatible" | "centralized";

export interface RegistryPairSnapshotV1 {
  readonly changeId: string;
  readonly changeDirectory: string;
  readonly stateSource: string;
  readonly eventsSource: string;
  readonly stateDigest: `sha256:${string}`;
  readonly eventsDigest: `sha256:${string}`;
  readonly stateMode: number;
  readonly eventsMode: number;
}

export interface RegistryPairCommitRequestV1 {
  readonly schema: "registry-pair-transaction-v1";
  readonly transactionId: string;
  readonly changeId: string;
  readonly intentId: string;
  readonly idempotencyKey: string;
  readonly status: "prepared" | "committed";
  readonly journalDigest: `sha256:${string}`;
  readonly artifact: {
    readonly path: string;
    readonly digest: `sha256:${string}`;
  };
  readonly base: {
    readonly stateDigest: `sha256:${string}`;
    readonly eventsDigest: `sha256:${string}`;
  };
  readonly next: {
    readonly stateDigest: `sha256:${string}`;
    readonly eventsDigest: `sha256:${string}`;
  };
  readonly target: {
    readonly stateEdits: readonly RegistryDocumentEditV1[];
    readonly eventsEdits: readonly RegistryDocumentEditV1[];
  };
  readonly fileMode: {
    readonly state: number;
    readonly events: number;
  };
}

export type RegistryStoreReasonV1 =
  | "none"
  | "lock-contention"
  | "stale-lock-invalid"
  | "journal-invalid"
  | "artifact-mismatch"
  | "third-digest"
  | "io-interrupted";

export interface RegistryPairStoreResultV1 {
  readonly code: "committed" | "replayed" | "recovered" | "none" | "registry-intent-conflict" | "registry-recovery-required";
  readonly reason: RegistryStoreReasonV1;
}

export interface RegistryArtifactInspectionV1 {
  readonly exists: boolean;
  readonly digest?: `sha256:${string}`;
}

export interface RegistryPairStoreAdapterV1 {
  read(changeId: string): Promise<RegistryPairSnapshotV1>;
  inspectArtifact(changeId: string, artifactPath: string): Promise<RegistryArtifactInspectionV1>;
  commit(transaction: RegistryPairCommitRequestV1): Promise<RegistryPairStoreResultV1>;
  recover(changeId: string): Promise<RegistryPairStoreResultV1>;
}
import type { RegistryDocumentEditV1 } from "@deck/core/spec-registry";
