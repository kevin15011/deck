import { deepFreeze, type Sha256Digest } from "../contracts/canonical";
import type { ConvergenceLifecycleStateV1 } from "../contracts/execution-convergence";
import { parseQaAuthoritySnapshotV1, type QaAuthoritySnapshotV1 } from "../contracts/qa-authority";

export type QaConvergenceLifecycleV1 = ConvergenceLifecycleStateV1;
export type QaNextActionV1 =
  | { readonly kind: "run_verify_stage"; readonly stage: "targeted" | "affected_area" | "broad"; readonly authorityDigest: Sha256Digest }
  | { readonly kind: "run_review"; readonly authorityDigest: Sha256Digest }
  | { readonly kind: "commit_registry_chain"; readonly authorityDigest: Sha256Digest }
  | { readonly kind: "route_blockers"; readonly authorityDigest: Sha256Digest }
  | { readonly kind: "blocked"; readonly authorityDigest: Sha256Digest; readonly reasonCodes: readonly string[] };

/** Pure lifecycle projection. It deliberately has no caller-selected role parameter. */
export function decideQaNextActionV1(input: { readonly snapshot: QaAuthoritySnapshotV1 }): QaNextActionV1 {
  const snapshot = parseQaAuthoritySnapshotV1(input.snapshot);
  const authorityDigest = snapshot.digest;
  switch (snapshot.lifecycle) {
    case "targeted_pending": return deepFreeze({ kind: "run_verify_stage" as const, stage: "targeted" as const, authorityDigest });
    case "affected_pending": return deepFreeze({ kind: "run_verify_stage" as const, stage: "affected_area" as const, authorityDigest });
    case "review_pending": return deepFreeze({ kind: "run_review" as const, authorityDigest });
    case "broad_pending": return deepFreeze({ kind: "run_verify_stage" as const, stage: "broad" as const, authorityDigest });
    case "registry_commit_pending": return deepFreeze({ kind: "commit_registry_chain" as const, authorityDigest });
    case "routing_pending": case "repair_pending": case "diagnosis_pending": return deepFreeze({ kind: "route_blockers" as const, authorityDigest });
    default: return deepFreeze({ kind: "blocked" as const, authorityDigest, reasonCodes: ["QA_LIFECYCLE_NOT_SCHEDULABLE"] });
  }
}
