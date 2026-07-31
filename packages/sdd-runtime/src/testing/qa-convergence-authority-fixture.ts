import { sha256Digest, type Sha256Digest } from "../contracts/canonical";
import type { ExecutionDossierHistoryV1, ExecutionDossierV1 } from "../contracts/execution-dossier";
import {
  appendExecutionConvergenceRevisionWithAuthorityV1,
  buildConvergenceResultRecordV1,
  buildConvergenceStageEvidenceV1,
  createExecutionConvergenceDossierV1,
  parseExecutionConvergenceDossierWithAuthorityV1,
  type ConvergenceAuthorityRecordSetV1,
  type ConvergenceLifecycleStateV1,
  type ConvergenceTransitionReceiptV1,
  type ExecutionConvergenceDossierV1,
} from "../contracts/execution-convergence";

export interface QaConvergenceAuthorityFixtureV1 {
  readonly current: ExecutionConvergenceDossierV1;
  readonly history: readonly ExecutionConvergenceDossierV1[];
  readonly receipts: readonly ConvergenceTransitionReceiptV1[];
  readonly records: ConvergenceAuthorityRecordSetV1;
}

export function createQaConvergenceAuthorityFixtureV1(input: {
  readonly baseDossier: ExecutionDossierV1;
  readonly baseDossierHistory?: ExecutionDossierHistoryV1;
  readonly lifecycle: Extract<ConvergenceLifecycleStateV1, "targeted_pending" | "affected_pending" | "review_pending" | "broad_pending" | "registry_commit_pending">;
  readonly implementationSubjectDigest: Sha256Digest;
  readonly dependencySetDigest: Sha256Digest;
  readonly reviewDigest?: Sha256Digest;
  readonly broadDigest?: Sha256Digest;
  readonly stageEvidenceDigests?: Partial<Record<"targeted" | "affected_area" | "broad", Sha256Digest>>;
  readonly roleResultEnvelopeDigests?: Partial<Record<"targeted" | "affected_area" | "review" | "broad", Sha256Digest>>;
  readonly stageVerificationDigests?: Partial<Record<"targeted" | "affected_area" | "review" | "broad", Sha256Digest>>;
  readonly registryIntentDigests?: readonly Sha256Digest[];
}): QaConvergenceAuthorityFixtureV1 {
  const emptyActiveBlockingSetDigest = sha256Digest({ activeBlockingFindingIds: [] });
  let current = createExecutionConvergenceDossierV1({
    baseDossier: input.baseDossier,
    ...(input.baseDossierHistory === undefined ? {} : { baseDossierHistory: input.baseDossierHistory }),
    state: {
      lifecycle: "awaiting_apply_result",
      generation: 0,
      implementationSubjectDigest: sha256Digest({ before: input.implementationSubjectDigest }),
      activeBlockingSetDigest: emptyActiveBlockingSetDigest,
    },
  });
  const history: ExecutionConvergenceDossierV1[] = [];
  const receipts: ConvergenceTransitionReceiptV1[] = [];
  const stageEvidence: ReturnType<typeof buildConvergenceStageEvidenceV1>[] = [];
  const resultRecords: ReturnType<typeof buildConvergenceResultRecordV1>[] = [];

  const append = (
    event: "apply_result_accepted" | "targeted_accepted_no_blockers" | "affected_accepted_no_blockers" | "review_stable" | "broad_accepted",
    stage: "apply" | "targeted" | "affected_area" | "review" | "broad",
    evidenceDigest: Sha256Digest,
    extra: Partial<{ scopedStageDigest: Sha256Digest; reviewDigest: Sha256Digest; broadDigest: Sha256Digest; dispositionDigest: Sha256Digest; registryIntentDigests: readonly Sha256Digest[] }> = {},
  ) => {
    const result = buildConvergenceResultRecordV1({
      stage,
      evidenceDigest,
      generation: 1,
      implementationSubjectDigest: input.implementationSubjectDigest,
      dependencySetDigest: input.dependencySetDigest,
      activeBlockingSetDigest: emptyActiveBlockingSetDigest,
      ...(input.roleResultEnvelopeDigests?.[stage === "affected_area" ? "affected_area" : stage as "targeted" | "review" | "broad"] === undefined
        ? {}
        : { roleResultEnvelopeDigest: input.roleResultEnvelopeDigests[stage === "affected_area" ? "affected_area" : stage as "targeted" | "review" | "broad"] }),
      ...(input.stageVerificationDigests?.[stage === "affected_area" ? "affected_area" : stage as "targeted" | "review" | "broad"] === undefined
        ? {}
        : { verificationDigest: input.stageVerificationDigests[stage === "affected_area" ? "affected_area" : stage as "targeted" | "review" | "broad"] }),
    });
    resultRecords.push(result);
    const evidence = buildConvergenceStageEvidenceV1({
      stage,
      evidenceDigest,
      generation: 1,
      implementationSubjectDigest: input.implementationSubjectDigest,
      dependencySetDigest: input.dependencySetDigest,
      activeBlockingSetDigest: emptyActiveBlockingSetDigest,
      referencedResultDigest: result.digest,
    });
    stageEvidence.push(evidence);
    const next = appendExecutionConvergenceRevisionWithAuthorityV1(current, {
      event,
      activeBlockingSetDigest: emptyActiveBlockingSetDigest,
      implementationSubjectDigest: input.implementationSubjectDigest,
      stageEvidence: evidence,
      expectedDependencySetDigest: input.dependencySetDigest,
      ...extra,
    }, history);
    history.push(current);
    receipts.push(next.receipt);
    current = next.dossier;
  };

  append("apply_result_accepted", "apply", sha256Digest({ stage: "apply", subject: input.implementationSubjectDigest }));
  if (input.lifecycle !== "targeted_pending") {
    const targetedDigest = input.stageEvidenceDigests?.targeted ?? sha256Digest({ stage: "targeted", subject: input.implementationSubjectDigest });
    append("targeted_accepted_no_blockers", "targeted", targetedDigest, { scopedStageDigest: targetedDigest });
  }
  if (!(["targeted_pending", "affected_pending"] as const).includes(input.lifecycle as never)) {
    const affectedDigest = input.stageEvidenceDigests?.affected_area ?? sha256Digest({ stage: "affected_area", subject: input.implementationSubjectDigest });
    append("affected_accepted_no_blockers", "affected_area", affectedDigest, { scopedStageDigest: affectedDigest });
  }
  if (input.lifecycle === "broad_pending" || input.lifecycle === "registry_commit_pending") {
    if (input.reviewDigest === undefined) throw new Error("QA_REVIEW_BINDING_REQUIRED");
    append("review_stable", "review", input.reviewDigest, {
      scopedStageDigest: current.state.scopedStageDigest,
      reviewDigest: input.reviewDigest,
    });
  }
  if (input.lifecycle === "registry_commit_pending") {
    if (input.broadDigest === undefined || input.reviewDigest === undefined) throw new Error("QA_BROAD_BINDING_REQUIRED");
    const broadStageEvidenceDigest = input.stageEvidenceDigests?.broad ?? input.broadDigest;
    append("broad_accepted", "broad", broadStageEvidenceDigest, {
      scopedStageDigest: current.state.scopedStageDigest,
      reviewDigest: input.reviewDigest,
      broadDigest: broadStageEvidenceDigest,
      dispositionDigest: input.broadDigest,
      registryIntentDigests: input.registryIntentDigests ?? [],
    });
  }

  const records = { stageEvidence, invalidations: [], resultRecords };
  current = parseExecutionConvergenceDossierWithAuthorityV1(current, history, receipts, records);
  return { current, history, receipts, records };
}
