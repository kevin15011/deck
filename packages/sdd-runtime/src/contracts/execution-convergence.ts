import type { ApplyBatchContractV1 } from "./apply-batch";
import {
  assertDigest,
  assertExactKeys,
  assertId,
  cloneCanonical,
  codeValue,
  deepFreeze,
  enumValue,
  integerValue,
  sha256Digest,
  stringValue,
  type Sha256Digest,
} from "./canonical";
import type { ExecutionDossierV1 } from "./execution-dossier";
import { parseExecutionDossierV1 } from "./execution-dossier";
import type { BlockingRepairProjectionV1 } from "./blocking-repair-projection";

/** Primary lifecycle states and branch substates (not OpenSpec phases). */
export type ConvergenceLifecycleStateV1 =
  | "awaiting_apply_result"
  | "targeted_pending"
  | "affected_pending"
  | "review_pending"
  | "broad_pending"
  | "registry_commit_pending"
  | "complete"
  | "routing_pending"
  | "repair_pending"
  | "diagnosis_pending"
  | "replan_required"
  | "escalated"
  | "stopped"
  | "recovery_required";

export type ConvergenceTransitionEventV1 =
  | "apply_result_accepted"
  | "apply_result_invalid"
  | "targeted_accepted_no_blockers"
  | "targeted_has_blockers"
  | "targeted_failed"
  | "affected_accepted_no_blockers"
  | "affected_has_blockers"
  | "affected_stale"
  | "review_stable"
  | "review_has_blockers"
  | "review_inconsistent"
  | "broad_accepted"
  | "broad_has_blockers"
  | "broad_stale"
  | "registry_committed"
  | "registry_conflict"
  | "registry_recovery_required"
  | "route_repair"
  | "route_diagnosis"
  | "route_replan"
  | "route_escalate"
  | "route_stop"
  | "repair_effect_succeeded"
  | "repair_effect_failed"
  | "diagnosis_resolved"
  | "diagnosis_exhausted"
  | "dependencies_invalidated";

export interface ExecutionConvergenceStateV1 {
  lifecycle: ConvergenceLifecycleStateV1;
  /** Incremented after every modifying Apply effect. */
  generation: number;
  implementationSubjectDigest: Sha256Digest;
  activeBlockingSetDigest: Sha256Digest;
  scopedStageDigest?: Sha256Digest;
  reviewDigest?: Sha256Digest;
  broadDigest?: Sha256Digest;
}

export interface ExecutionConvergenceDossierV1 {
  schema: "execution-convergence-dossier-v1";
  convergenceId: `convergence:v1:${string}`;
  digest: Sha256Digest;
  revision: number;
  previousDigest?: Sha256Digest;
  baseDossierDigest: Sha256Digest;
  baseBatchId: string;
  baseBatchDigest: Sha256Digest;
  state: ExecutionConvergenceStateV1;
  dispositionDigest?: Sha256Digest;
  routingDecisionDigest?: Sha256Digest;
  repairProjectionDigest?: Sha256Digest;
  retryLedgerDigests: readonly Sha256Digest[];
  invalidationRecordDigests: readonly Sha256Digest[];
  roleResultDigests: readonly Sha256Digest[];
  registryIntentDigests: readonly Sha256Digest[];
}

export interface ExecutionConvergenceDossierCreateInputV1 {
  baseDossier: ExecutionDossierV1;
  state: ExecutionConvergenceStateV1;
  dispositionDigest?: Sha256Digest;
  routingDecisionDigest?: Sha256Digest;
  repairProjectionDigest?: Sha256Digest;
  retryLedgerDigests?: readonly Sha256Digest[];
  invalidationRecordDigests?: readonly Sha256Digest[];
  roleResultDigests?: readonly Sha256Digest[];
  registryIntentDigests?: readonly Sha256Digest[];
}

export interface ConvergenceTransitionInputV1 {
  event: ConvergenceTransitionEventV1;
  activeBlockingSetDigest: Sha256Digest;
  implementationSubjectDigest: Sha256Digest;
  scopedStageDigest?: Sha256Digest;
  reviewDigest?: Sha256Digest;
  broadDigest?: Sha256Digest;
}

export type ConvergenceStageKindV1 =
  | "apply"
  | "targeted"
  | "affected_area"
  | "review"
  | "broad"
  | "registry_commit";

/** Typed stage evidence authority (additive; referenced via digest lists). */
export interface ConvergenceStageEvidenceV1 {
  schema: "convergence-stage-evidence-v1";
  stage: ConvergenceStageKindV1;
  evidenceDigest: Sha256Digest;
  generation: number;
  implementationSubjectDigest: Sha256Digest;
  dependencySetDigest: Sha256Digest;
  activeBlockingSetDigest: Sha256Digest;
  referencedResultDigest: Sha256Digest;
  digest: Sha256Digest;
}

/** Typed underlying role/commit result resolved by stage evidence. */
export interface ConvergenceResultRecordV1 {
  schema: "convergence-result-record-v1";
  stage: ConvergenceStageKindV1;
  evidenceDigest: Sha256Digest;
  generation: number;
  implementationSubjectDigest: Sha256Digest;
  dependencySetDigest: Sha256Digest;
  activeBlockingSetDigest: Sha256Digest;
  digest: Sha256Digest;
}

export interface ConvergenceInvalidationV1 {
  schema: "convergence-invalidation-v1";
  predecessorRevision: number;
  predecessorDigest: Sha256Digest;
  oldImplementationSubjectDigest: Sha256Digest;
  newImplementationSubjectDigest: Sha256Digest;
  oldDependencySetDigest: Sha256Digest;
  newDependencySetDigest: Sha256Digest;
  reason: string;
  invalidatedStageDigests: readonly Sha256Digest[];
  generation: number;
  digest: Sha256Digest;
}

export interface ConvergenceTransitionReceiptV1 {
  schema: "convergence-transition-receipt-v1";
  predecessorRevision: number;
  predecessorDigest: Sha256Digest;
  event: ConvergenceTransitionEventV1;
  stageEvidenceDigest?: Sha256Digest;
  invalidationDigest?: Sha256Digest;
  nextStateDigest: Sha256Digest;
  digest: Sha256Digest;
}

/** Complete retry-attempt record referenced by retryLedgerDigests (additive authority). */
export interface ConvergenceRetryAttemptRecordV1 {
  digest: Sha256Digest;
  retryIdentity: Sha256Digest;
  attemptNumber: number;
  projectionDigest: Sha256Digest;
  priorAttemptDigest?: Sha256Digest;
  convergenceRevision: number;
  convergenceDigest: Sha256Digest;
  terminalEffectResult: "succeeded" | "failed" | "rejected";
}

export interface ConvergenceAuthorityAppendInputV1 {
  event: ConvergenceTransitionEventV1;
  activeBlockingSetDigest: Sha256Digest;
  implementationSubjectDigest: Sha256Digest;
  scopedStageDigest?: Sha256Digest;
  reviewDigest?: Sha256Digest;
  broadDigest?: Sha256Digest;
  /** Typed stage evidence required for accepting/modifying events. */
  stageEvidence?: ConvergenceStageEvidenceV1;
  /** Typed invalidation required for dependencies_invalidated. */
  invalidation?: ConvergenceInvalidationV1;
  /**
   * Stage-specific dependency digest recomputed from current stage authority.
   * Required for accepting/modifying events; caller omission fails closed.
   */
  expectedDependencySetDigest?: Sha256Digest;
  dispositionDigest?: Sha256Digest;
  routingDecisionDigest?: Sha256Digest;
  repairProjectionDigest?: Sha256Digest;
  /**
   * Event-derived retry-attempt records to append on permitted effect outcomes.
   * Caller-selected digest lists are never a growth source; see retryLedgerDigests.
   */
  retryAttemptRecords?: readonly ConvergenceRetryAttemptRecordV1[];
  /**
   * Complete attempt records resolving predecessor.retryLedgerDigests in exact order.
   * Required when the predecessor ledger is non-empty so per-identity counters can be derived.
   */
  predecessorRetryAttemptRecords?: readonly ConvergenceRetryAttemptRecordV1[];
  /**
   * Optional exact-equality assertion against the event-derived retry ledger.
   * Not a source of ledger growth.
   */
  retryLedgerDigests?: readonly Sha256Digest[];
  registryIntentDigests?: readonly Sha256Digest[];
}

const LIFECYCLES: readonly ConvergenceLifecycleStateV1[] = [
  "awaiting_apply_result",
  "targeted_pending",
  "affected_pending",
  "review_pending",
  "broad_pending",
  "registry_commit_pending",
  "complete",
  "routing_pending",
  "repair_pending",
  "diagnosis_pending",
  "replan_required",
  "escalated",
  "stopped",
  "recovery_required",
];

const EVENTS: readonly ConvergenceTransitionEventV1[] = [
  "apply_result_accepted",
  "apply_result_invalid",
  "targeted_accepted_no_blockers",
  "targeted_has_blockers",
  "targeted_failed",
  "affected_accepted_no_blockers",
  "affected_has_blockers",
  "affected_stale",
  "review_stable",
  "review_has_blockers",
  "review_inconsistent",
  "broad_accepted",
  "broad_has_blockers",
  "broad_stale",
  "registry_committed",
  "registry_conflict",
  "registry_recovery_required",
  "route_repair",
  "route_diagnosis",
  "route_replan",
  "route_escalate",
  "route_stop",
  "repair_effect_succeeded",
  "repair_effect_failed",
  "diagnosis_resolved",
  "diagnosis_exhausted",
  "dependencies_invalidated",
];

const STATE_KEYS = [
  "lifecycle",
  "generation",
  "implementationSubjectDigest",
  "activeBlockingSetDigest",
  "scopedStageDigest",
  "reviewDigest",
  "broadDigest",
] as const;

const DOSSIER_KEYS = [
  "schema",
  "convergenceId",
  "digest",
  "revision",
  "previousDigest",
  "baseDossierDigest",
  "baseBatchId",
  "baseBatchDigest",
  "state",
  "dispositionDigest",
  "routingDecisionDigest",
  "repairProjectionDigest",
  "retryLedgerDigests",
  "invalidationRecordDigests",
  "roleResultDigests",
  "registryIntentDigests",
] as const;

function normalizeState(state: ExecutionConvergenceStateV1): ExecutionConvergenceStateV1 {
  assertExactKeys(state, STATE_KEYS, "convergence state");
  assertDigest(state.implementationSubjectDigest, "state.implementationSubjectDigest");
  assertDigest(state.activeBlockingSetDigest, "state.activeBlockingSetDigest");
  if (state.scopedStageDigest !== undefined) assertDigest(state.scopedStageDigest, "state.scopedStageDigest");
  if (state.reviewDigest !== undefined) assertDigest(state.reviewDigest, "state.reviewDigest");
  if (state.broadDigest !== undefined) assertDigest(state.broadDigest, "state.broadDigest");
  return cloneCanonical({
    lifecycle: enumValue(state.lifecycle, LIFECYCLES, "state.lifecycle"),
    generation: integerValue(state.generation, "state.generation", 0),
    implementationSubjectDigest: state.implementationSubjectDigest,
    activeBlockingSetDigest: state.activeBlockingSetDigest,
    ...(state.scopedStageDigest === undefined ? {} : { scopedStageDigest: state.scopedStageDigest }),
    ...(state.reviewDigest === undefined ? {} : { reviewDigest: state.reviewDigest }),
    ...(state.broadDigest === undefined ? {} : { broadDigest: state.broadDigest }),
  });
}

/** Digest of the empty active blocking set (no open blocking findings). */
const EMPTY_ACTIVE_BLOCKING_SET_DIGEST = sha256Digest({ activeBlockingFindingIds: [] });

const MODIFYING_EVENTS: ReadonlySet<ConvergenceTransitionEventV1> = new Set([
  "apply_result_accepted",
  "repair_effect_succeeded",
]);

/**
 * Deterministic state machine per design transition table.
 * Invalid/out-of-order events fail closed.
 * Modifying transitions clear prior scoped/Review/broad digests; accepting transitions
 * require current stage digests and an empty active blocking set.
 */
export function transitionExecutionConvergenceStateV1(
  current: ExecutionConvergenceStateV1,
  input: ConvergenceTransitionInputV1,
): ExecutionConvergenceStateV1 {
  const state = normalizeState(current);
  assertExactKeys(input, ["event", "activeBlockingSetDigest", "implementationSubjectDigest", "scopedStageDigest", "reviewDigest", "broadDigest"], "convergence transition");
  const event = enumValue(input.event, EVENTS, "transition.event");
  assertDigest(input.activeBlockingSetDigest, "transition.activeBlockingSetDigest");
  assertDigest(input.implementationSubjectDigest, "transition.implementationSubjectDigest");
  if (input.scopedStageDigest !== undefined) assertDigest(input.scopedStageDigest, "transition.scopedStageDigest");
  if (input.reviewDigest !== undefined) assertDigest(input.reviewDigest, "transition.reviewDigest");
  if (input.broadDigest !== undefined) assertDigest(input.broadDigest, "transition.broadDigest");

  const modifying = MODIFYING_EVENTS.has(event);

  // Modifying transitions mark prior stage evidence non-current (do not inherit old digests).
  // Non-modifying transitions may carry forward digests when replacements are omitted.
  const nextBase = modifying
    ? {
        generation: state.generation,
        implementationSubjectDigest: input.implementationSubjectDigest,
        activeBlockingSetDigest: input.activeBlockingSetDigest,
        ...(input.scopedStageDigest === undefined ? {} : { scopedStageDigest: input.scopedStageDigest }),
        ...(input.reviewDigest === undefined ? {} : { reviewDigest: input.reviewDigest }),
        ...(input.broadDigest === undefined ? {} : { broadDigest: input.broadDigest }),
      }
    : {
        generation: state.generation,
        implementationSubjectDigest: input.implementationSubjectDigest,
        activeBlockingSetDigest: input.activeBlockingSetDigest,
        ...(input.scopedStageDigest === undefined
          ? state.scopedStageDigest === undefined
            ? {}
            : { scopedStageDigest: state.scopedStageDigest }
          : { scopedStageDigest: input.scopedStageDigest }),
        ...(input.reviewDigest === undefined
          ? state.reviewDigest === undefined
            ? {}
            : { reviewDigest: state.reviewDigest }
          : { reviewDigest: input.reviewDigest }),
        ...(input.broadDigest === undefined
          ? state.broadDigest === undefined
            ? {}
            : { broadDigest: state.broadDigest }
          : { broadDigest: input.broadDigest }),
      };

  const go = (lifecycle: ConvergenceLifecycleStateV1, generation = state.generation): ExecutionConvergenceStateV1 =>
    normalizeState({
      lifecycle,
      generation,
      implementationSubjectDigest: nextBase.implementationSubjectDigest,
      activeBlockingSetDigest: nextBase.activeBlockingSetDigest,
      ...(nextBase.scopedStageDigest === undefined ? {} : { scopedStageDigest: nextBase.scopedStageDigest }),
      ...(nextBase.reviewDigest === undefined ? {} : { reviewDigest: nextBase.reviewDigest }),
      ...(nextBase.broadDigest === undefined ? {} : { broadDigest: nextBase.broadDigest }),
    });

  const fail = (): never => {
    throw new Error("invalid-evidence: convergence transition");
  };

  const requireEmptyActiveBlockers = (): void => {
    if (input.activeBlockingSetDigest !== EMPTY_ACTIVE_BLOCKING_SET_DIGEST) fail();
  };

  const requireCurrentScoped = (): void => {
    // Accepting scoped stages require an explicit current digest on the transition input
    // (cannot rely solely on inherited pre-repair evidence).
    if (input.scopedStageDigest === undefined) fail();
  };

  const requireCurrentReview = (): void => {
    if (input.reviewDigest === undefined) fail();
  };

  const requireCurrentBroad = (): void => {
    if (input.broadDigest === undefined) fail();
  };

  // dependencies_invalidated is valid from any non-terminal evidence-bearing state
  if (event === "dependencies_invalidated") {
    if (
      state.lifecycle === "complete" ||
      state.lifecycle === "stopped" ||
      state.lifecycle === "escalated" ||
      state.lifecycle === "replan_required" ||
      state.lifecycle === "recovery_required"
    ) {
      return fail();
    }
    return normalizeState({
      lifecycle: "targeted_pending",
      generation: state.generation,
      implementationSubjectDigest: input.implementationSubjectDigest,
      activeBlockingSetDigest: input.activeBlockingSetDigest,
    });
  }

  switch (state.lifecycle) {
    case "awaiting_apply_result":
      if (event === "apply_result_accepted") return go("targeted_pending", state.generation + 1);
      if (event === "apply_result_invalid") return go("stopped");
      return fail();
    case "targeted_pending":
      if (event === "targeted_accepted_no_blockers") {
        requireEmptyActiveBlockers();
        requireCurrentScoped();
        return go("affected_pending");
      }
      if (event === "targeted_has_blockers") return go("routing_pending");
      if (event === "targeted_failed") return go("diagnosis_pending");
      return fail();
    case "affected_pending":
      if (event === "affected_accepted_no_blockers") {
        requireEmptyActiveBlockers();
        requireCurrentScoped();
        return go("review_pending");
      }
      if (event === "affected_has_blockers") return go("routing_pending");
      if (event === "affected_stale") return go("diagnosis_pending");
      return fail();
    case "review_pending":
      if (event === "review_stable") {
        requireEmptyActiveBlockers();
        requireCurrentScoped();
        requireCurrentReview();
        return go("broad_pending");
      }
      if (event === "review_has_blockers") return go("routing_pending");
      if (event === "review_inconsistent") return go("stopped");
      return fail();
    case "routing_pending":
      if (event === "route_repair") return go("repair_pending");
      if (event === "route_diagnosis") return go("diagnosis_pending");
      if (event === "route_replan") return go("replan_required");
      if (event === "route_escalate") return go("escalated");
      if (event === "route_stop") return go("stopped");
      return fail();
    case "repair_pending":
      if (event === "repair_effect_succeeded") {
        // New generation + clear prior stage evidence (dependency-based invalidation).
        return go("targeted_pending", state.generation + 1);
      }
      if (event === "repair_effect_failed") return go("stopped");
      return fail();
    case "diagnosis_pending":
      if (event === "diagnosis_resolved") return go("routing_pending");
      if (event === "diagnosis_exhausted") return go("escalated");
      return fail();
    case "broad_pending":
      if (event === "broad_accepted") {
        requireEmptyActiveBlockers();
        requireCurrentScoped();
        requireCurrentReview();
        requireCurrentBroad();
        return go("registry_commit_pending");
      }
      if (event === "broad_has_blockers") return go("routing_pending");
      if (event === "broad_stale") return go("targeted_pending");
      return fail();
    case "registry_commit_pending":
      if (event === "registry_committed") {
        requireEmptyActiveBlockers();
        // Completion requires current scoped + Review + broad evidence bindings on state.
        if (
          nextBase.scopedStageDigest === undefined ||
          nextBase.reviewDigest === undefined ||
          nextBase.broadDigest === undefined
        ) {
          fail();
        }
        return go("complete");
      }
      if (event === "registry_conflict") return go("stopped");
      if (event === "registry_recovery_required") return go("recovery_required");
      return fail();
    case "complete":
    case "replan_required":
    case "escalated":
    case "stopped":
    case "recovery_required":
      return fail();
    default:
      return fail();
  }
}

/**
 * Authority-bound transition: validates stage-typed evidence before applying the
 * deterministic state machine. Callers supply event + typed authority, never an arbitrary next state.
 */
export function transitionExecutionConvergenceStateWithAuthorityV1(
  current: ExecutionConvergenceStateV1,
  input: ConvergenceAuthorityAppendInputV1,
): ExecutionConvergenceStateV1 {
  const state = normalizeState(current);
  const event = enumValue(input.event, EVENTS, "authority.event");

  // Reject arbitrary complete jump
  if (event === "registry_committed" && state.lifecycle !== "registry_commit_pending") {
    throw new Error("invalid-evidence: illegal-transition");
  }

  if (event === "dependencies_invalidated") {
    if (!input.invalidation) {
      throw new Error("invalid-evidence: opaque-evidence");
    }
    const inv = input.invalidation;
    if (inv.schema !== "convergence-invalidation-v1") {
      throw new Error("invalid-evidence: opaque-evidence");
    }
    if (inv.generation !== state.generation) {
      throw new Error("invalid-evidence: generation_mismatch");
    }
    if (inv.oldImplementationSubjectDigest !== state.implementationSubjectDigest) {
      throw new Error("invalid-evidence: subject_mismatch");
    }
    // Invalidation clears scoped/review/broad and returns to targeted_pending
    return normalizeState({
      lifecycle: "targeted_pending",
      generation: state.generation,
      implementationSubjectDigest: inv.newImplementationSubjectDigest,
      activeBlockingSetDigest: input.activeBlockingSetDigest,
    });
  }

  const acceptingEvents: ConvergenceTransitionEventV1[] = [
    "apply_result_accepted",
    "targeted_accepted_no_blockers",
    "affected_accepted_no_blockers",
    "review_stable",
    "broad_accepted",
    "registry_committed",
  ];
  const modifyingEvents: ConvergenceTransitionEventV1[] = [
    "apply_result_accepted",
    "repair_effect_succeeded",
  ];

  if (acceptingEvents.includes(event) || modifyingEvents.includes(event)) {
    if (!input.stageEvidence) {
      throw new Error("invalid-evidence: opaque-evidence");
    }
    const evidence = input.stageEvidence;
    if (evidence.schema !== "convergence-stage-evidence-v1") {
      throw new Error("invalid-evidence: opaque-evidence");
    }

    const expectedStage: Partial<Record<ConvergenceTransitionEventV1, ConvergenceStageKindV1>> = {
      apply_result_accepted: "apply",
      targeted_accepted_no_blockers: "targeted",
      affected_accepted_no_blockers: "affected_area",
      review_stable: "review",
      broad_accepted: "broad",
      registry_committed: "registry_commit",
      repair_effect_succeeded: "apply",
    };
    const wantStage = expectedStage[event];
    if (wantStage && evidence.stage !== wantStage) {
      throw new Error("invalid-evidence: wrong-stage");
    }

    if (modifyingEvents.includes(event)) {
      // Modifying events establish generation+1 subject
      if (evidence.generation !== state.generation + 1) {
        throw new Error("invalid-evidence: generation_mismatch");
      }
    } else {
      // Non-modifying accepting events must match current generation and subject
      if (evidence.generation !== state.generation) {
        throw new Error("invalid-evidence: generation_mismatch");
      }
      if (evidence.implementationSubjectDigest !== state.implementationSubjectDigest) {
        throw new Error("invalid-evidence: subject_mismatch");
      }
      if (input.implementationSubjectDigest !== state.implementationSubjectDigest) {
        throw new Error("invalid-evidence: subject_mismatch");
      }
    }

    // Dependency digest must be recomputed from stage authority; omission fails closed.
    if (input.expectedDependencySetDigest === undefined) {
      throw new Error("invalid-evidence: dependency_mismatch");
    }
    if (evidence.dependencySetDigest !== input.expectedDependencySetDigest) {
      throw new Error("invalid-evidence: dependency_mismatch");
    }

    if (evidence.activeBlockingSetDigest !== input.activeBlockingSetDigest) {
      throw new Error("invalid-evidence: dependency_mismatch");
    }
  }

  // Invalidation predecessor/dependency/digest-list bindings must be consumable when present.
  if (input.invalidation) {
    const inv = input.invalidation;
    if (
      inv.oldImplementationSubjectDigest === inv.newImplementationSubjectDigest &&
      inv.oldDependencySetDigest === inv.newDependencySetDigest
    ) {
      throw new Error("invalid-evidence: dependency_mismatch");
    }
  }

  // Never coalesce invalidation with accepting event in same call
  // (dependencies_invalidated returns earlier, so any remaining event with invalidation is illegal)
  if (input.invalidation) {
    throw new Error("invalid-evidence: illegal-transition");
  }

  return transitionExecutionConvergenceStateV1(state, {
    event,
    activeBlockingSetDigest: input.activeBlockingSetDigest,
    implementationSubjectDigest: input.implementationSubjectDigest,
    scopedStageDigest: input.scopedStageDigest,
    reviewDigest: input.reviewDigest,
    broadDigest: input.broadDigest,
  });
}

export function buildConvergenceStageEvidenceV1(
  input: Omit<ConvergenceStageEvidenceV1, "schema" | "digest">,
): ConvergenceStageEvidenceV1 {
  assertDigest(input.evidenceDigest, "stageEvidence.evidenceDigest");
  assertDigest(input.implementationSubjectDigest, "stageEvidence.implementationSubjectDigest");
  assertDigest(input.dependencySetDigest, "stageEvidence.dependencySetDigest");
  assertDigest(input.activeBlockingSetDigest, "stageEvidence.activeBlockingSetDigest");
  assertDigest(input.referencedResultDigest, "stageEvidence.referencedResultDigest");
  const payload = cloneCanonical({
    schema: "convergence-stage-evidence-v1" as const,
    stage: enumValue(
      input.stage,
      ["apply", "targeted", "affected_area", "review", "broad", "registry_commit"],
      "stageEvidence.stage",
    ),
    evidenceDigest: input.evidenceDigest,
    generation: integerValue(input.generation, "stageEvidence.generation", 0),
    implementationSubjectDigest: input.implementationSubjectDigest,
    dependencySetDigest: input.dependencySetDigest,
    activeBlockingSetDigest: input.activeBlockingSetDigest,
    referencedResultDigest: input.referencedResultDigest,
  });
  const digest = sha256Digest(payload);
  return deepFreeze({ ...payload, digest }) as ConvergenceStageEvidenceV1;
}

export function buildConvergenceResultRecordV1(
  input: Omit<ConvergenceResultRecordV1, "schema" | "digest">,
): ConvergenceResultRecordV1 {
  assertDigest(input.evidenceDigest, "result.evidenceDigest");
  assertDigest(input.implementationSubjectDigest, "result.implementationSubjectDigest");
  assertDigest(input.dependencySetDigest, "result.dependencySetDigest");
  assertDigest(input.activeBlockingSetDigest, "result.activeBlockingSetDigest");
  const payload = cloneCanonical({
    schema: "convergence-result-record-v1" as const,
    stage: enumValue(
      input.stage,
      ["apply", "targeted", "affected_area", "review", "broad", "registry_commit"],
      "result.stage",
    ),
    evidenceDigest: input.evidenceDigest,
    generation: integerValue(input.generation, "result.generation", 0),
    implementationSubjectDigest: input.implementationSubjectDigest,
    dependencySetDigest: input.dependencySetDigest,
    activeBlockingSetDigest: input.activeBlockingSetDigest,
  });
  return deepFreeze({ ...payload, digest: sha256Digest(payload) }) as ConvergenceResultRecordV1;
}

export function buildConvergenceInvalidationV1(
  input: Omit<ConvergenceInvalidationV1, "schema" | "digest">,
): ConvergenceInvalidationV1 {
  assertDigest(input.predecessorDigest, "invalidation.predecessorDigest");
  assertDigest(input.oldImplementationSubjectDigest, "invalidation.oldImplementationSubjectDigest");
  assertDigest(input.newImplementationSubjectDigest, "invalidation.newImplementationSubjectDigest");
  assertDigest(input.oldDependencySetDigest, "invalidation.oldDependencySetDigest");
  assertDigest(input.newDependencySetDigest, "invalidation.newDependencySetDigest");
  const payload = cloneCanonical({
    schema: "convergence-invalidation-v1" as const,
    predecessorRevision: integerValue(input.predecessorRevision, "invalidation.predecessorRevision", 1),
    predecessorDigest: input.predecessorDigest,
    oldImplementationSubjectDigest: input.oldImplementationSubjectDigest,
    newImplementationSubjectDigest: input.newImplementationSubjectDigest,
    oldDependencySetDigest: input.oldDependencySetDigest,
    newDependencySetDigest: input.newDependencySetDigest,
    reason: codeValue(input.reason, "invalidation.reason"),
    invalidatedStageDigests: [...input.invalidatedStageDigests],
    generation: integerValue(input.generation, "invalidation.generation", 0),
  });
  const digest = sha256Digest(payload);
  return deepFreeze({ ...payload, digest }) as ConvergenceInvalidationV1;
}

export function buildConvergenceTransitionReceiptV1(
  input: Omit<ConvergenceTransitionReceiptV1, "schema" | "digest">,
): ConvergenceTransitionReceiptV1 {
  assertDigest(input.predecessorDigest, "receipt.predecessorDigest");
  assertDigest(input.nextStateDigest, "receipt.nextStateDigest");
  if (input.stageEvidenceDigest !== undefined) assertDigest(input.stageEvidenceDigest, "receipt.stageEvidenceDigest");
  if (input.invalidationDigest !== undefined) assertDigest(input.invalidationDigest, "receipt.invalidationDigest");
  const payload = cloneCanonical({
    schema: "convergence-transition-receipt-v1" as const,
    predecessorRevision: integerValue(input.predecessorRevision, "receipt.predecessorRevision", 0),
    predecessorDigest: input.predecessorDigest,
    event: enumValue(input.event, EVENTS, "receipt.event"),
    ...(input.stageEvidenceDigest === undefined ? {} : { stageEvidenceDigest: input.stageEvidenceDigest }),
    ...(input.invalidationDigest === undefined ? {} : { invalidationDigest: input.invalidationDigest }),
    nextStateDigest: input.nextStateDigest,
  });
  const digest = sha256Digest(payload);
  return deepFreeze({ ...payload, digest }) as ConvergenceTransitionReceiptV1;
}

/** Authority-bound append: event + typed evidence → computed next state only. */
export function appendExecutionConvergenceRevisionWithAuthorityV1(
  previous: ExecutionConvergenceDossierV1,
  authority: ConvergenceAuthorityAppendInputV1,
  history: readonly ExecutionConvergenceDossierV1[] = [],
): {
  dossier: ExecutionConvergenceDossierV1;
  receipt: ConvergenceTransitionReceiptV1;
} {
  const expectedPredecessors = previous.revision - 1;
  if (history.length !== expectedPredecessors) {
    throw new Error("invalid-evidence: convergence revision history");
  }
  const validatedPrevious = parseExecutionConvergenceDossierV1(previous, history);
  const nextState = transitionExecutionConvergenceStateWithAuthorityV1(validatedPrevious.state, authority);

  const nextRole = [...validatedPrevious.roleResultDigests];
  const nextInvalidation = [...validatedPrevious.invalidationRecordDigests];

  let stageEvidenceDigest: Sha256Digest | undefined;
  let invalidationDigest: Sha256Digest | undefined;

  if (authority.stageEvidence) {
    stageEvidenceDigest = authority.stageEvidence.digest;
    // roleResultDigests: result, stage-evidence, then receipt (receipt appended after issue)
    nextRole.push(authority.stageEvidence.referencedResultDigest);
    nextRole.push(authority.stageEvidence.digest);
  }
  if (authority.invalidation) {
    invalidationDigest = authority.invalidation.digest;
    nextInvalidation.push(authority.invalidation.digest);
  }

  const receipt = buildConvergenceTransitionReceiptV1({
    predecessorRevision: validatedPrevious.revision,
    predecessorDigest: validatedPrevious.digest,
    event: authority.event,
    stageEvidenceDigest,
    invalidationDigest,
    nextStateDigest: sha256Digest(normalizeState(nextState)),
  });

  if (authority.event === "dependencies_invalidated") {
    nextInvalidation.push(receipt.digest);
  } else {
    nextRole.push(receipt.digest);
  }

  const nextRepairProjection =
    authority.repairProjectionDigest ?? validatedPrevious.repairProjectionDigest;
  // Retry ledger growth is event-derived from resolved attempt records only.
  // Per-identity counters require complete predecessor attempt-record resolution.
  const nextRetry = deriveRetryLedgerDigestsForTransition(
    validatedPrevious,
    authority.event,
    authority.retryAttemptRecords ?? [],
    nextRepairProjection,
    authority.predecessorRetryAttemptRecords ?? [],
  );
  if (authority.retryLedgerDigests !== undefined) {
    assertExactDigestList(nextRetry, authority.retryLedgerDigests, "retry ledger");
  }
  const nextRegistry = authority.registryIntentDigests ?? validatedPrevious.registryIntentDigests;
  assertAppendOnlyPrefix(validatedPrevious.retryLedgerDigests, nextRetry, "retry ledger");
  assertAppendOnlyPrefix(validatedPrevious.invalidationRecordDigests, nextInvalidation, "invalidation records");
  assertAppendOnlyPrefix(validatedPrevious.roleResultDigests, nextRole, "role results");
  assertAppendOnlyPrefix(validatedPrevious.registryIntentDigests, nextRegistry, "registry intents");

  const dossier = issue(
    {
      baseDossierDigest: validatedPrevious.baseDossierDigest,
      baseBatchId: validatedPrevious.baseBatchId,
      baseBatchDigest: validatedPrevious.baseBatchDigest,
      state: nextState,
      dispositionDigest: authority.dispositionDigest ?? validatedPrevious.dispositionDigest,
      routingDecisionDigest: authority.routingDecisionDigest ?? validatedPrevious.routingDecisionDigest,
      repairProjectionDigest: nextRepairProjection,
      retryLedgerDigests: [...nextRetry],
      invalidationRecordDigests: nextInvalidation,
      roleResultDigests: nextRole,
      registryIntentDigests: [...nextRegistry],
    },
    validatedPrevious.revision + 1,
    validatedPrevious,
  );

  return { dossier, receipt };
}

/** Typed records required to replay convergence transitions authoritatively. */
export interface ConvergenceAuthorityRecordSetV1 {
  stageEvidence: readonly ConvergenceStageEvidenceV1[];
  invalidations: readonly ConvergenceInvalidationV1[];
  resultRecords: readonly ConvergenceResultRecordV1[];
  /** Complete retry-attempt records referenced by dossier retryLedgerDigests. */
  retryAttemptRecords?: readonly ConvergenceRetryAttemptRecordV1[];
}

function indexAuthorityRecords(records: ConvergenceAuthorityRecordSetV1): {
  stageByDigest: Map<string, ConvergenceStageEvidenceV1>;
  invByDigest: Map<string, ConvergenceInvalidationV1>;
  resultByDigest: Map<string, ConvergenceResultRecordV1>;
  attemptByDigest: Map<string, ConvergenceRetryAttemptRecordV1>;
} {
  const stageByDigest = new Map<string, ConvergenceStageEvidenceV1>();
  for (const ev of records.stageEvidence) {
    // Recompute content hash; reject forged carriers.
    const recomputed = buildConvergenceStageEvidenceV1({
      stage: ev.stage,
      evidenceDigest: ev.evidenceDigest,
      generation: ev.generation,
      implementationSubjectDigest: ev.implementationSubjectDigest,
      dependencySetDigest: ev.dependencySetDigest,
      activeBlockingSetDigest: ev.activeBlockingSetDigest,
      referencedResultDigest: ev.referencedResultDigest,
    });
    if (recomputed.digest !== ev.digest) {
      throw new Error("invalid-evidence: illegal-transition");
    }
    if (stageByDigest.has(ev.digest)) {
      throw new Error("invalid-evidence: illegal-transition");
    }
    stageByDigest.set(ev.digest, recomputed);
  }
  const invByDigest = new Map<string, ConvergenceInvalidationV1>();
  for (const inv of records.invalidations) {
    const recomputed = buildConvergenceInvalidationV1({
      predecessorRevision: inv.predecessorRevision,
      predecessorDigest: inv.predecessorDigest,
      oldImplementationSubjectDigest: inv.oldImplementationSubjectDigest,
      newImplementationSubjectDigest: inv.newImplementationSubjectDigest,
      oldDependencySetDigest: inv.oldDependencySetDigest,
      newDependencySetDigest: inv.newDependencySetDigest,
      reason: inv.reason,
      invalidatedStageDigests: inv.invalidatedStageDigests,
      generation: inv.generation,
    });
    if (recomputed.digest !== inv.digest) {
      throw new Error("invalid-evidence: illegal-transition");
    }
    if (invByDigest.has(inv.digest)) {
      throw new Error("invalid-evidence: illegal-transition");
    }
    invByDigest.set(inv.digest, recomputed);
  }
  const resultByDigest = new Map<string, ConvergenceResultRecordV1>();
  for (const result of records.resultRecords) {
    const recomputed = buildConvergenceResultRecordV1({
      stage: result.stage,
      evidenceDigest: result.evidenceDigest,
      generation: result.generation,
      implementationSubjectDigest: result.implementationSubjectDigest,
      dependencySetDigest: result.dependencySetDigest,
      activeBlockingSetDigest: result.activeBlockingSetDigest,
    });
    if (recomputed.digest !== result.digest || resultByDigest.has(result.digest)) {
      throw new Error("invalid-evidence: illegal-transition");
    }
    resultByDigest.set(result.digest, recomputed);
  }
  const attemptByDigest = new Map<string, ConvergenceRetryAttemptRecordV1>();
  for (const attempt of records.retryAttemptRecords ?? []) {
    const recomputed = recomputeRetryAttemptRecordDigest(attempt);
    if (recomputed !== attempt.digest || attemptByDigest.has(attempt.digest)) {
      throw new Error("invalid-evidence: illegal-transition");
    }
    attemptByDigest.set(attempt.digest, attempt);
  }
  return { stageByDigest, invByDigest, resultByDigest, attemptByDigest };
}

/** Must match blocking-repair-projection computeRetryAttemptRecordDigestV1 payload. */
function recomputeRetryAttemptRecordDigest(
  record: Omit<ConvergenceRetryAttemptRecordV1, "digest"> & { digest?: Sha256Digest },
): Sha256Digest {
  return sha256Digest(
    cloneCanonical({
      schema: "retry-attempt-record-v1",
      retryIdentity: record.retryIdentity,
      attemptNumber: record.attemptNumber,
      projectionDigest: record.projectionDigest,
      ...(record.priorAttemptDigest === undefined ? {} : { priorAttemptDigest: record.priorAttemptDigest }),
      convergenceRevision: record.convergenceRevision,
      convergenceDigest: record.convergenceDigest,
      terminalEffectResult: record.terminalEffectResult,
    }),
  );
}

/**
 * Permitted terminal-effect events that may append exactly one retry-attempt digest.
 * Other events must preserve the predecessor retry ledger exactly.
 */
function retryLedgerOutcomeForEvent(
  event: ConvergenceTransitionEventV1,
): "succeeded" | "failed" | undefined {
  if (event === "repair_effect_succeeded") return "succeeded";
  if (event === "repair_effect_failed") return "failed";
  return undefined;
}

/**
 * Resolve predecessor.retryLedgerDigests to complete attempt records (exact order).
 * Rejects missing, duplicate, or digest-mismatched carriers.
 */
function resolvePredecessorRetryAttemptRecords(
  predecessor: ExecutionConvergenceDossierV1,
  supplied: readonly ConvergenceRetryAttemptRecordV1[],
): ConvergenceRetryAttemptRecordV1[] {
  const byDigest = new Map<string, ConvergenceRetryAttemptRecordV1>();
  for (const record of supplied) {
    assertDigest(record.digest, "predecessorRetryAttempt.digest");
    if (recomputeRetryAttemptRecordDigest(record) !== record.digest) {
      throw new Error("invalid-evidence: retry ledger");
    }
    if (byDigest.has(record.digest)) {
      throw new Error("invalid-evidence: retry ledger");
    }
    byDigest.set(record.digest, record);
  }
  const resolved: ConvergenceRetryAttemptRecordV1[] = [];
  for (const digest of predecessor.retryLedgerDigests) {
    const record = byDigest.get(digest);
    if (!record) {
      throw new Error("invalid-evidence: retry ledger");
    }
    resolved.push(record);
  }
  // Supplied set may only contain predecessor ledger members (no extras that skip resolution).
  if (byDigest.size !== predecessor.retryLedgerDigests.length) {
    throw new Error("invalid-evidence: retry ledger");
  }
  return resolved;
}

function validateRetryAttemptRecordForLedgerAppend(
  record: ConvergenceRetryAttemptRecordV1,
  predecessor: ExecutionConvergenceDossierV1,
  outcome: "succeeded" | "failed",
  repairProjectionDigest: Sha256Digest | undefined,
  predecessorAttempts: readonly ConvergenceRetryAttemptRecordV1[],
): void {
  assertDigest(record.digest, "retryAttempt.digest");
  assertDigest(record.retryIdentity, "retryAttempt.retryIdentity");
  assertDigest(record.projectionDigest, "retryAttempt.projectionDigest");
  assertDigest(record.convergenceDigest, "retryAttempt.convergenceDigest");
  if (record.priorAttemptDigest !== undefined) {
    assertDigest(record.priorAttemptDigest, "retryAttempt.priorAttemptDigest");
  }
  if (recomputeRetryAttemptRecordDigest(record) !== record.digest) {
    throw new Error("invalid-evidence: retry ledger");
  }
  if (record.terminalEffectResult !== outcome) {
    throw new Error("invalid-evidence: retry ledger");
  }
  if (
    record.convergenceRevision !== predecessor.revision ||
    record.convergenceDigest !== predecessor.digest
  ) {
    throw new Error("invalid-evidence: retry ledger");
  }
  if (repairProjectionDigest === undefined || record.projectionDigest !== repairProjectionDigest) {
    throw new Error("invalid-evidence: retry ledger");
  }

  // Per-identity counter/prior — matches validateRetryAttemptAgainstLedgerV1.
  const forIdentity = predecessorAttempts.filter((r) => r.retryIdentity === record.retryIdentity);
  const expectedAttemptNumber = forIdentity.length + 1;
  if (!Number.isInteger(record.attemptNumber) || record.attemptNumber !== expectedAttemptNumber) {
    throw new Error("invalid-evidence: retry ledger");
  }
  if (expectedAttemptNumber === 1) {
    // Schema omits priorAttemptDigest for a new identity's first attempt.
    if (record.priorAttemptDigest !== undefined) {
      throw new Error("invalid-evidence: retry ledger");
    }
  } else {
    const expectedPrior = forIdentity[expectedAttemptNumber - 2]!;
    if (record.priorAttemptDigest !== expectedPrior.digest) {
      throw new Error("invalid-evidence: retry ledger");
    }
  }
}

/**
 * Derive the successor retry ledger from permitted event outcome + resolved attempt records.
 * Caller-selected digest lists are never a growth source.
 * Terminal repair_effect_succeeded/failed MUST append exactly one validated attempt record.
 * Non-terminal events MUST append zero records (exact predecessor list).
 * Counter/prior are per record.retryIdentity against complete predecessor attempt records.
 */
function deriveRetryLedgerDigestsForTransition(
  predecessor: ExecutionConvergenceDossierV1,
  event: ConvergenceTransitionEventV1,
  attemptRecords: readonly ConvergenceRetryAttemptRecordV1[],
  repairProjectionDigest: Sha256Digest | undefined,
  predecessorRetryAttemptRecords: readonly ConvergenceRetryAttemptRecordV1[] = [],
): Sha256Digest[] {
  const outcome = retryLedgerOutcomeForEvent(event);

  if (outcome === undefined) {
    // Non-terminal: zero attempt-record appends; exact predecessor list.
    if (attemptRecords.length !== 0) {
      throw new Error("invalid-evidence: illegal-transition");
    }
    return [...predecessor.retryLedgerDigests];
  }

  // Terminal repair effect: exactly one resolved attempt record with matching outcome.
  if (attemptRecords.length !== 1) {
    throw new Error("invalid-evidence: retry ledger");
  }
  const predecessorAttempts = resolvePredecessorRetryAttemptRecords(
    predecessor,
    predecessorRetryAttemptRecords,
  );
  const record = attemptRecords[0]!;
  validateRetryAttemptRecordForLedgerAppend(
    record,
    predecessor,
    outcome,
    repairProjectionDigest,
    predecessorAttempts,
  );
  if (predecessor.retryLedgerDigests.includes(record.digest)) {
    throw new Error("invalid-evidence: retry ledger");
  }
  return [...predecessor.retryLedgerDigests, record.digest];
}

function assertExactDigestList(
  expected: readonly Sha256Digest[],
  actual: readonly Sha256Digest[],
  label: string,
): void {
  if (
    actual.length !== expected.length ||
    expected.some((digest, index) => actual[index] !== digest)
  ) {
    throw new Error(`invalid-evidence: ${label}`);
  }
}

function recomputeReceiptDigest(receipt: ConvergenceTransitionReceiptV1): Sha256Digest {
  return buildConvergenceTransitionReceiptV1({
    predecessorRevision: receipt.predecessorRevision,
    predecessorDigest: receipt.predecessorDigest,
    event: receipt.event,
    stageEvidenceDigest: receipt.stageEvidenceDigest,
    invalidationDigest: receipt.invalidationDigest,
    nextStateDigest: receipt.nextStateDigest,
  }).digest;
}

function reconstructAuthorityInputFromReceipt(
  receipt: ConvergenceTransitionReceiptV1,
  predecessor: ExecutionConvergenceDossierV1,
  successor: ExecutionConvergenceDossierV1,
  stageByDigest: Map<string, ConvergenceStageEvidenceV1>,
  invByDigest: Map<string, ConvergenceInvalidationV1>,
  resultByDigest: Map<string, ConvergenceResultRecordV1>,
): ConvergenceAuthorityAppendInputV1 {
  if (receipt.digest !== recomputeReceiptDigest(receipt)) {
    throw new Error("invalid-evidence: illegal-transition");
  }
  if (
    receipt.predecessorDigest !== predecessor.digest ||
    receipt.predecessorRevision !== predecessor.revision
  ) {
    throw new Error("invalid-evidence: illegal-transition");
  }

  if (receipt.event === "dependencies_invalidated") {
    if (!receipt.invalidationDigest) {
      throw new Error("invalid-evidence: opaque-evidence");
    }
    const inv = invByDigest.get(receipt.invalidationDigest);
    if (!inv) {
      throw new Error("invalid-evidence: opaque-evidence");
    }
    // Invalidation predecessor bindings must match the actual predecessor dossier.
    if (
      inv.predecessorDigest !== predecessor.digest ||
      inv.predecessorRevision !== predecessor.revision
    ) {
      throw new Error("invalid-evidence: illegal-transition");
    }
    return {
      event: receipt.event,
      activeBlockingSetDigest: successor.state.activeBlockingSetDigest,
      implementationSubjectDigest: inv.newImplementationSubjectDigest,
      invalidation: inv,
    };
  }

  if (!receipt.stageEvidenceDigest) {
    throw new Error("invalid-evidence: opaque-evidence");
  }
  const evidence = stageByDigest.get(receipt.stageEvidenceDigest);
  if (!evidence) {
    throw new Error("invalid-evidence: opaque-evidence");
  }
  const result = resultByDigest.get(evidence.referencedResultDigest);
  if (!result) {
    throw new Error("invalid-evidence: opaque-evidence");
  }
  if (
    result.stage !== evidence.stage ||
    result.evidenceDigest !== evidence.evidenceDigest ||
    result.generation !== evidence.generation ||
    result.implementationSubjectDigest !== evidence.implementationSubjectDigest ||
    result.dependencySetDigest !== evidence.dependencySetDigest ||
    result.activeBlockingSetDigest !== evidence.activeBlockingSetDigest
  ) {
    throw new Error("invalid-evidence: illegal-transition");
  }

  let scopedStageDigest = predecessor.state.scopedStageDigest;
  let reviewDigest = predecessor.state.reviewDigest;
  let broadDigest = predecessor.state.broadDigest;
  if (evidence.stage === "targeted" || evidence.stage === "affected_area") {
    scopedStageDigest = evidence.evidenceDigest;
  } else if (evidence.stage === "review") {
    reviewDigest = evidence.evidenceDigest;
  } else if (evidence.stage === "broad") {
    broadDigest = evidence.evidenceDigest;
  }

  return {
    event: receipt.event,
    activeBlockingSetDigest: evidence.activeBlockingSetDigest,
    implementationSubjectDigest: evidence.implementationSubjectDigest,
    scopedStageDigest,
    reviewDigest,
    broadDigest,
    stageEvidence: evidence,
    // Recomputed from resolved stage evidence (stage authority), not caller-only assertion.
    expectedDependencySetDigest: evidence.dependencySetDigest,
  };
}

/**
 * Authority-bound parse: structural V1 readability plus full-history transition replay.
 * Resolves every referenced typed record, enforces canonical append order, recomputes
 * receipt/record hashes, and invokes the state transition function for every predecessor
 * before accepting complete/commit-ready states. Only the authority-bound result may authorize.
 */
export function parseExecutionConvergenceDossierWithAuthorityV1(
  value: unknown,
  history: readonly ExecutionConvergenceDossierV1[],
  transitionReceipts: readonly ConvergenceTransitionReceiptV1[],
  authorityRecords: ConvergenceAuthorityRecordSetV1,
): ExecutionConvergenceDossierV1 {
  if (!authorityRecords) {
    throw new Error("invalid-evidence: opaque-evidence");
  }
  const structural = parseExecutionConvergenceDossierV1(value, history);
  const { stageByDigest, invByDigest, resultByDigest, attemptByDigest } =
    indexAuthorityRecords(authorityRecords);

  if (structural.revision === 1) {
    if (
      transitionReceipts.length !== 0 ||
      structural.state.lifecycle !== "awaiting_apply_result" ||
      structural.state.generation !== 0 ||
      structural.state.scopedStageDigest !== undefined ||
      structural.state.reviewDigest !== undefined ||
      structural.state.broadDigest !== undefined ||
      structural.retryLedgerDigests.length !== 0 ||
      structural.invalidationRecordDigests.length !== 0 ||
      structural.roleResultDigests.length !== 0 ||
      structural.registryIntentDigests.length !== 0
    ) {
      throw new Error("invalid-evidence: illegal-transition");
    }
    return structural;
  }
  // One receipt per transition (revision 2..N) — history length equals revision-1.
  if (transitionReceipts.length !== history.length) {
    throw new Error("invalid-evidence: illegal-transition");
  }

  // Replay every predecessor through the transition function.
  const chain: ExecutionConvergenceDossierV1[] = [...history, structural];
  for (let i = 1; i < chain.length; i++) {
    const predecessor = chain[i - 1]!;
    const successor = chain[i]!;
    const receipt = transitionReceipts[i - 1]!;

    const authorityInput = reconstructAuthorityInputFromReceipt(
      receipt,
      predecessor,
      successor,
      stageByDigest,
      invByDigest,
      resultByDigest,
    );

    // Invoke state transition function; compare replayed successor with persisted state.
    let replayed: ExecutionConvergenceStateV1;
    try {
      replayed = transitionExecutionConvergenceStateWithAuthorityV1(predecessor.state, authorityInput);
    } catch {
      throw new Error("invalid-evidence: illegal-transition");
    }
    const replayedDigest = sha256Digest(normalizeState(replayed));
    const persistedDigest = sha256Digest(normalizeState(successor.state));
    if (replayedDigest !== persistedDigest || receipt.nextStateDigest !== persistedDigest) {
      throw new Error("invalid-evidence: illegal-transition");
    }

    // Canonical append order is exact, not membership-based.
    if (receipt.event === "dependencies_invalidated") {
      const expected = [
        ...predecessor.invalidationRecordDigests,
        receipt.invalidationDigest!,
        receipt.digest,
      ];
      if (
        successor.invalidationRecordDigests.length !== expected.length ||
        expected.some((digest, index) => successor.invalidationRecordDigests[index] !== digest)
      ) {
        throw new Error("invalid-evidence: illegal-transition");
      }
    } else {
      const evidence = stageByDigest.get(receipt.stageEvidenceDigest!);
      if (!evidence) throw new Error("invalid-evidence: opaque-evidence");
      const expected = [
        ...predecessor.roleResultDigests,
        evidence.referencedResultDigest,
        evidence.digest,
        receipt.digest,
      ];
      if (
        successor.roleResultDigests.length !== expected.length ||
        expected.some((digest, index) => successor.roleResultDigests[index] !== digest)
      ) {
        throw new Error("invalid-evidence: illegal-transition");
      }
    }

    // Retry ledger: event-derived from resolved attempt records; exact successor compare.
    const addedRetryDigests = successor.retryLedgerDigests.slice(
      predecessor.retryLedgerDigests.length,
    );
    if (
      successor.retryLedgerDigests.length < predecessor.retryLedgerDigests.length ||
      predecessor.retryLedgerDigests.some(
        (digest, index) => successor.retryLedgerDigests[index] !== digest,
      )
    ) {
      throw new Error("invalid-evidence: illegal-transition");
    }
    const resolvedAttempts: ConvergenceRetryAttemptRecordV1[] = [];
    for (const digest of addedRetryDigests) {
      const record = attemptByDigest.get(digest);
      if (!record) {
        throw new Error("invalid-evidence: opaque-evidence");
      }
      resolvedAttempts.push(record);
    }
    // Complete predecessor ledger records — required for per-identity counter/prior.
    const predecessorAttempts: ConvergenceRetryAttemptRecordV1[] = [];
    for (const digest of predecessor.retryLedgerDigests) {
      const record = attemptByDigest.get(digest);
      if (!record) {
        throw new Error("invalid-evidence: opaque-evidence");
      }
      predecessorAttempts.push(record);
    }
    let expectedRetry: Sha256Digest[];
    try {
      expectedRetry = deriveRetryLedgerDigestsForTransition(
        predecessor,
        receipt.event,
        resolvedAttempts,
        successor.repairProjectionDigest ?? predecessor.repairProjectionDigest,
        predecessorAttempts,
      );
    } catch {
      throw new Error("invalid-evidence: illegal-transition");
    }
    assertExactDigestList(expectedRetry, successor.retryLedgerDigests, "illegal-transition");
  }

  return structural;
}

function digestList(value: unknown, field: string): Sha256Digest[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`invalid-evidence: ${field}`);
  return value.map((item, i) => {
    assertDigest(item, `${field}[${i}]`);
    return item as Sha256Digest;
  });
}

function issue(
  input: {
    baseDossierDigest: Sha256Digest;
    baseBatchId: string;
    baseBatchDigest: Sha256Digest;
    state: ExecutionConvergenceStateV1;
    dispositionDigest?: Sha256Digest;
    routingDecisionDigest?: Sha256Digest;
    repairProjectionDigest?: Sha256Digest;
    retryLedgerDigests: readonly Sha256Digest[];
    invalidationRecordDigests: readonly Sha256Digest[];
    roleResultDigests: readonly Sha256Digest[];
    registryIntentDigests: readonly Sha256Digest[];
  },
  revision: number,
  previous?: ExecutionConvergenceDossierV1,
): ExecutionConvergenceDossierV1 {
  const state = normalizeState(input.state);
  if (input.dispositionDigest !== undefined) assertDigest(input.dispositionDigest, "dispositionDigest");
  if (input.routingDecisionDigest !== undefined) assertDigest(input.routingDecisionDigest, "routingDecisionDigest");
  if (input.repairProjectionDigest !== undefined) assertDigest(input.repairProjectionDigest, "repairProjectionDigest");

  const payload = cloneCanonical({
    schema: "execution-convergence-dossier-v1" as const,
    revision,
    ...(previous ? { previousDigest: previous.digest } : {}),
    baseDossierDigest: input.baseDossierDigest,
    baseBatchId: stringValue(input.baseBatchId, "baseBatchId"),
    baseBatchDigest: input.baseBatchDigest,
    state,
    ...(input.dispositionDigest === undefined ? {} : { dispositionDigest: input.dispositionDigest }),
    ...(input.routingDecisionDigest === undefined ? {} : { routingDecisionDigest: input.routingDecisionDigest }),
    ...(input.repairProjectionDigest === undefined ? {} : { repairProjectionDigest: input.repairProjectionDigest }),
    retryLedgerDigests: [...input.retryLedgerDigests],
    invalidationRecordDigests: [...input.invalidationRecordDigests],
    roleResultDigests: [...input.roleResultDigests],
    registryIntentDigests: [...input.registryIntentDigests],
  });
  const digest = sha256Digest(payload);
  return deepFreeze({
    ...payload,
    convergenceId: previous?.convergenceId ?? (`convergence:v1:${digest.slice(7, 39)}` as const),
    digest,
  }) as ExecutionConvergenceDossierV1;
}

export function createExecutionConvergenceDossierV1(
  input: ExecutionConvergenceDossierCreateInputV1,
): ExecutionConvergenceDossierV1 {
  assertExactKeys(
    input,
    [
      "baseDossier",
      "state",
      "dispositionDigest",
      "routingDecisionDigest",
      "repairProjectionDigest",
      "retryLedgerDigests",
      "invalidationRecordDigests",
      "roleResultDigests",
      "registryIntentDigests",
    ],
    "convergence dossier create",
  );
  // Validate base dossier is a well-formed V1 dossier (revision 1 may have no history)
  const base = parseExecutionDossierV1(
    input.baseDossier,
    input.baseDossier.revision === 1 ? undefined : undefined,
  );
  // Note: parseExecutionDossierV1 for revision > 1 needs history; for create we accept already-validated dossiers
  // by re-checking schema/digest lightly when revision > 1
  if (base.schema !== "execution-dossier-v1") throw new Error("unsupported-contract-version");

  return issue(
    {
      baseDossierDigest: base.digest,
      baseBatchId: base.batch.batchId,
      baseBatchDigest: base.batch.digest,
      state: input.state,
      dispositionDigest: input.dispositionDigest,
      routingDecisionDigest: input.routingDecisionDigest,
      repairProjectionDigest: input.repairProjectionDigest,
      retryLedgerDigests: digestList(input.retryLedgerDigests, "retryLedgerDigests"),
      invalidationRecordDigests: digestList(input.invalidationRecordDigests, "invalidationRecordDigests"),
      roleResultDigests: digestList(input.roleResultDigests, "roleResultDigests"),
      registryIntentDigests: digestList(input.registryIntentDigests, "registryIntentDigests"),
    },
    1,
  );
}

export function appendExecutionConvergenceRevisionV1(
  previous: ExecutionConvergenceDossierV1,
  changes: Partial<
    Pick<
      ExecutionConvergenceDossierCreateInputV1,
      | "state"
      | "dispositionDigest"
      | "routingDecisionDigest"
      | "repairProjectionDigest"
      | "retryLedgerDigests"
      | "invalidationRecordDigests"
      | "roleResultDigests"
      | "registryIntentDigests"
    >
  >,
  history: readonly ExecutionConvergenceDossierV1[] = [],
): ExecutionConvergenceDossierV1 {
  const expectedPredecessors = previous.revision - 1;
  if (history.length !== expectedPredecessors) {
    throw new Error("invalid-evidence: convergence revision history");
  }
  const validatedPrevious = parseExecutionConvergenceDossierV1(previous, history);

  // Append-only: ledger/intent/result digests may only grow with prefix equality
  const nextRetry = changes.retryLedgerDigests ?? validatedPrevious.retryLedgerDigests;
  const nextInvalidation = changes.invalidationRecordDigests ?? validatedPrevious.invalidationRecordDigests;
  const nextRole = changes.roleResultDigests ?? validatedPrevious.roleResultDigests;
  const nextRegistry = changes.registryIntentDigests ?? validatedPrevious.registryIntentDigests;

  assertAppendOnlyPrefix(validatedPrevious.retryLedgerDigests, nextRetry, "retry ledger");
  assertAppendOnlyPrefix(validatedPrevious.invalidationRecordDigests, nextInvalidation, "invalidation records");
  assertAppendOnlyPrefix(validatedPrevious.roleResultDigests, nextRole, "role results");
  assertAppendOnlyPrefix(validatedPrevious.registryIntentDigests, nextRegistry, "registry intents");

  return issue(
    {
      baseDossierDigest: validatedPrevious.baseDossierDigest,
      baseBatchId: validatedPrevious.baseBatchId,
      baseBatchDigest: validatedPrevious.baseBatchDigest,
      state: changes.state ?? validatedPrevious.state,
      dispositionDigest: changes.dispositionDigest ?? validatedPrevious.dispositionDigest,
      routingDecisionDigest: changes.routingDecisionDigest ?? validatedPrevious.routingDecisionDigest,
      repairProjectionDigest: changes.repairProjectionDigest ?? validatedPrevious.repairProjectionDigest,
      retryLedgerDigests: [...nextRetry],
      invalidationRecordDigests: [...nextInvalidation],
      roleResultDigests: [...nextRole],
      registryIntentDigests: [...nextRegistry],
    },
    validatedPrevious.revision + 1,
    validatedPrevious,
  );
}

function assertAppendOnlyPrefix(prev: readonly Sha256Digest[], next: readonly Sha256Digest[], label: string): void {
  if (next.length < prev.length) throw new Error(`invalid-evidence: ${label} prefix`);
  if (prev.some((d, i) => d !== next[i])) throw new Error(`invalid-evidence: ${label} prefix`);
}

function parseRevision(
  value: unknown,
  previous?: ExecutionConvergenceDossierV1,
): ExecutionConvergenceDossierV1 {
  assertExactKeys(value, DOSSIER_KEYS, "convergence dossier");
  if (value.schema !== "execution-convergence-dossier-v1") throw new Error("unsupported-contract-version");
  assertId(value.convergenceId, "convergence:v1:", "convergence.convergenceId");
  assertDigest(value.digest, "convergence.digest");
  assertDigest(value.baseDossierDigest, "convergence.baseDossierDigest");
  assertDigest(value.baseBatchDigest, "convergence.baseBatchDigest");
  if (value.previousDigest !== undefined) assertDigest(value.previousDigest, "convergence.previousDigest");
  const revision = integerValue(value.revision, "convergence.revision", 1);

  const state = normalizeState(value.state as ExecutionConvergenceStateV1);
  const retryLedgerDigests = digestList(value.retryLedgerDigests, "retryLedgerDigests");
  const invalidationRecordDigests = digestList(value.invalidationRecordDigests, "invalidationRecordDigests");
  const roleResultDigests = digestList(value.roleResultDigests, "roleResultDigests");
  const registryIntentDigests = digestList(value.registryIntentDigests, "registryIntentDigests");

  if (value.dispositionDigest !== undefined) assertDigest(value.dispositionDigest, "dispositionDigest");
  if (value.routingDecisionDigest !== undefined) assertDigest(value.routingDecisionDigest, "routingDecisionDigest");
  if (value.repairProjectionDigest !== undefined) assertDigest(value.repairProjectionDigest, "repairProjectionDigest");

  if (revision === 1 && (value.previousDigest !== undefined || previous)) {
    throw new Error("invalid-evidence: convergence revision");
  }
  if (
    revision > 1 &&
    (!previous ||
      revision !== previous.revision + 1 ||
      value.previousDigest !== previous.digest ||
      value.convergenceId !== previous.convergenceId)
  ) {
    throw new Error("invalid-evidence: convergence revision");
  }
  if (previous) {
    if (value.baseDossierDigest !== previous.baseDossierDigest || value.baseBatchDigest !== previous.baseBatchDigest) {
      throw new Error("invalid-evidence: base dossier reference");
    }
    assertAppendOnlyPrefix(previous.retryLedgerDigests, retryLedgerDigests, "retry ledger");
    assertAppendOnlyPrefix(previous.invalidationRecordDigests, invalidationRecordDigests, "invalidation records");
    assertAppendOnlyPrefix(previous.roleResultDigests, roleResultDigests, "role results");
    assertAppendOnlyPrefix(previous.registryIntentDigests, registryIntentDigests, "registry intents");
  }

  const payload = cloneCanonical({
    schema: "execution-convergence-dossier-v1" as const,
    revision,
    ...(value.previousDigest === undefined ? {} : { previousDigest: value.previousDigest as Sha256Digest }),
    baseDossierDigest: value.baseDossierDigest as Sha256Digest,
    baseBatchId: stringValue(value.baseBatchId, "baseBatchId"),
    baseBatchDigest: value.baseBatchDigest as Sha256Digest,
    state,
    ...(value.dispositionDigest === undefined ? {} : { dispositionDigest: value.dispositionDigest as Sha256Digest }),
    ...(value.routingDecisionDigest === undefined
      ? {}
      : { routingDecisionDigest: value.routingDecisionDigest as Sha256Digest }),
    ...(value.repairProjectionDigest === undefined
      ? {}
      : { repairProjectionDigest: value.repairProjectionDigest as Sha256Digest }),
    retryLedgerDigests,
    invalidationRecordDigests,
    roleResultDigests,
    registryIntentDigests,
  });
  const expected = sha256Digest(payload);
  if (
    value.digest !== expected ||
    (revision === 1 && value.convergenceId !== `convergence:v1:${expected.slice(7, 39)}`)
  ) {
    throw new Error("invalid-evidence: convergence digest");
  }
  return deepFreeze({
    ...payload,
    convergenceId: value.convergenceId as `convergence:v1:${string}`,
    digest: value.digest as Sha256Digest,
  }) as ExecutionConvergenceDossierV1;
}

export function parseExecutionConvergenceDossierV1(
  value: unknown,
  history: readonly ExecutionConvergenceDossierV1[] = [],
): ExecutionConvergenceDossierV1 {
  assertExactKeys(value, DOSSIER_KEYS, "convergence dossier");
  const revision =
    typeof value === "object" && value !== null ? (value as { revision?: unknown }).revision : undefined;
  if (revision !== 1 && (!Number.isSafeInteger(revision) || history.length !== Number(revision) - 1)) {
    throw new Error("invalid-evidence: convergence revision history");
  }
  if (revision === 1 && history.length > 0) throw new Error("invalid-evidence: convergence revision");

  let previous: ExecutionConvergenceDossierV1 | undefined;
  for (let i = 0; i < history.length; i++) {
    const candidate = history[i]!;
    if (candidate.revision !== i + 1) throw new Error("invalid-evidence: convergence revision history");
    previous = parseRevision(candidate, previous);
  }
  return parseRevision(value, previous);
}

/** Helper: bind a validated repair projection digest into convergence state bookkeeping. */
export function assertRepairProjectionBoundToBatchV1(
  projection: BlockingRepairProjectionV1,
  batch: ApplyBatchContractV1,
): void {
  if (projection.originalBatchId !== batch.batchId || projection.originalBatchDigest !== batch.digest) {
    throw new Error("batch-reference-mismatch");
  }
}
