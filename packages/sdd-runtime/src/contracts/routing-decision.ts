import type { ApplyBatchContractV1, BatchId } from "./apply-batch";
import { assertBatchReferenceV1 } from "./apply-batch";
import {
  assertDigest,
  assertExactKeys,
  assertId,
  cloneCanonical,
  codeValue,
  deepFreeze,
  denseArray,
  enumValue,
  sha256Digest,
  stringArray,
  stringValue,
  type Sha256Digest,
} from "./canonical";
import type { FailureManifestV1, FailureRootCause, FindingId } from "./failure-manifest";
import {
  activeBlockingSetDigestV1,
  bindProtectedRiskAuthority,
  deriveProtectedRiskV1,
  type FindingDispositionEnvelopeV1,
  type ProtectedRiskAuthorityContextV1,
  type ProtectedRiskClassV1,
} from "./finding-disposition";

export type RoutingDestinationV1 =
  | "targeted_repair"
  | "replan_spec"
  | "replan_design"
  | "replan_tasks"
  | "verify_runtime_diagnosis"
  | "correct_oracle"
  | "escalate"
  | "stop";

export type RoutingOwnerV1 =
  | "apply"
  | "spec"
  | "design"
  | "tasks"
  | "verify-runtime"
  | "coordinator"
  | "human";

export type RoutingOutcomeV1 =
  | "homogeneous"
  | "split_required"
  | "checkpoint"
  | "complete"
  | "stop"
  | "escalate";

export type AuthorityStateV1 = "authorized" | "missing" | "invalid";
export type GitSafetyStateV1 = "not-required" | "confirmed" | "confirmation-required" | "invalid";
export type ProgressSignalV1 = "positive" | "none" | "negative";

export interface RoutingFindingPolicyInputV1 {
  fullyAnchored?: boolean;
  scopeValid?: boolean;
  protectedRisk?: boolean;
  dataLossRisk?: boolean;
  diagnosableRuntime?: boolean;
}

export interface RoutingPolicyInputV1 {
  routingPolicyVersion: string;
  authorityState: AuthorityStateV1;
  gitSafetyState: GitSafetyStateV1;
  /** Global protected-risk override applied to every active finding. */
  protectedRisk: boolean;
  /** Global data-loss override applied to every active finding. */
  dataLossRisk: boolean;
  excludedTargetIntersection: boolean;
  progress: ProgressSignalV1;
  /** Named bounded probe available for environment/transport/capability/unknown. */
  diagnosableRuntime: boolean;
  fullyAnchored: boolean;
  scopeValid: boolean;
  policyPermitted: boolean;
  /**
   * Optional per-finding overrides for anchor/scope/risk/diagnostic inputs.
   * True global safety overrides (policy.protectedRisk / dataLossRisk / authority / git / excluded)
   * still dominate when set.
   */
  findingInputs?: Readonly<Record<string, RoutingFindingPolicyInputV1>>;
}

export interface RouteEntryV1 {
  findingId: FindingId;
  destination: RoutingDestinationV1;
  owner: RoutingOwnerV1;
  rootCause: FailureRootCause;
  rationaleCodes: readonly string[];
}

export interface RoutingDecisionV1 {
  schema: "routing-decision-v1";
  decisionId: `routing:v1:${string}`;
  digest: Sha256Digest;
  batchId: BatchId;
  batchDigest: Sha256Digest;
  dispositionSemanticDigest: Sha256Digest;
  activeBlockingSetDigest: Sha256Digest;
  policyInputDigest: Sha256Digest;
  routes: readonly RouteEntryV1[];
  outcome: RoutingOutcomeV1;
  rationaleCodes: readonly string[];
  semanticDecisionDigest: Sha256Digest;
}

export interface RoutingDecisionInputV1 {
  batch: ApplyBatchContractV1;
  manifest: FailureManifestV1;
  disposition: FindingDispositionEnvelopeV1;
  policy: RoutingPolicyInputV1;
  /** Mandatory for authoritative protected-risk routing; omit only for legacy structural reads. */
  protectedRiskAuthority?: ProtectedRiskAuthorityContextV1;
}

const DESTINATIONS: readonly RoutingDestinationV1[] = [
  "targeted_repair",
  "replan_spec",
  "replan_design",
  "replan_tasks",
  "verify_runtime_diagnosis",
  "correct_oracle",
  "escalate",
  "stop",
];

const OWNERS: readonly RoutingOwnerV1[] = [
  "apply",
  "spec",
  "design",
  "tasks",
  "verify-runtime",
  "coordinator",
  "human",
];

const ROOT_CAUSES: readonly FailureRootCause[] = [
  "implementation",
  "environment",
  "transport",
  "capability",
  "oracle",
  "requirement",
  "architecture",
  "batch_shape",
  "authorization",
  "security",
  "git_safety",
  "unknown",
];

const OUTCOMES: readonly RoutingOutcomeV1[] = [
  "homogeneous",
  "split_required",
  "checkpoint",
  "complete",
  "stop",
  "escalate",
];

const ROUTE_KEYS = ["findingId", "destination", "owner", "rootCause", "rationaleCodes"] as const;
const DECISION_KEYS = [
  "schema",
  "decisionId",
  "digest",
  "batchId",
  "batchDigest",
  "dispositionSemanticDigest",
  "activeBlockingSetDigest",
  "policyInputDigest",
  "routes",
  "outcome",
  "rationaleCodes",
  "semanticDecisionDigest",
] as const;

const POLICY_KEYS = [
  "routingPolicyVersion",
  "authorityState",
  "gitSafetyState",
  "protectedRisk",
  "dataLossRisk",
  "excludedTargetIntersection",
  "progress",
  "diagnosableRuntime",
  "fullyAnchored",
  "scopeValid",
  "policyPermitted",
  "findingInputs",
] as const;

const FINDING_POLICY_KEYS = [
  "fullyAnchored",
  "scopeValid",
  "protectedRisk",
  "dataLossRisk",
  "diagnosableRuntime",
] as const;

function normalizeFindingPolicy(
  value: RoutingFindingPolicyInputV1,
  field: string,
): RoutingFindingPolicyInputV1 {
  assertExactKeys(value, FINDING_POLICY_KEYS, field);
  const out: RoutingFindingPolicyInputV1 = {};
  if (value.fullyAnchored !== undefined) {
    if (typeof value.fullyAnchored !== "boolean") throw new Error(`invalid-evidence: ${field}.fullyAnchored`);
    out.fullyAnchored = value.fullyAnchored;
  }
  if (value.scopeValid !== undefined) {
    if (typeof value.scopeValid !== "boolean") throw new Error(`invalid-evidence: ${field}.scopeValid`);
    out.scopeValid = value.scopeValid;
  }
  if (value.protectedRisk !== undefined) {
    if (typeof value.protectedRisk !== "boolean") throw new Error(`invalid-evidence: ${field}.protectedRisk`);
    out.protectedRisk = value.protectedRisk;
  }
  if (value.dataLossRisk !== undefined) {
    if (typeof value.dataLossRisk !== "boolean") throw new Error(`invalid-evidence: ${field}.dataLossRisk`);
    out.dataLossRisk = value.dataLossRisk;
  }
  if (value.diagnosableRuntime !== undefined) {
    if (typeof value.diagnosableRuntime !== "boolean") throw new Error(`invalid-evidence: ${field}.diagnosableRuntime`);
    out.diagnosableRuntime = value.diagnosableRuntime;
  }
  return cloneCanonical(out);
}

function normalizePolicy(policy: RoutingPolicyInputV1): RoutingPolicyInputV1 {
  assertExactKeys(policy, POLICY_KEYS, "routing policy");
  const findingInputs: Record<string, RoutingFindingPolicyInputV1> = {};
  if (policy.findingInputs !== undefined) {
    if (typeof policy.findingInputs !== "object" || policy.findingInputs === null || Array.isArray(policy.findingInputs)) {
      throw new Error("invalid-evidence: policy.findingInputs");
    }
    for (const [findingId, raw] of Object.entries(policy.findingInputs)) {
      assertId(findingId, "finding:v1:", `policy.findingInputs.${findingId}`);
      findingInputs[findingId] = normalizeFindingPolicy(raw as RoutingFindingPolicyInputV1, `policy.findingInputs.${findingId}`);
    }
  }
  return cloneCanonical({
    routingPolicyVersion: codeValue(policy.routingPolicyVersion, "policy.routingPolicyVersion"),
    authorityState: enumValue(policy.authorityState, ["authorized", "missing", "invalid"], "policy.authorityState"),
    gitSafetyState: enumValue(
      policy.gitSafetyState,
      ["not-required", "confirmed", "confirmation-required", "invalid"],
      "policy.gitSafetyState",
    ),
    protectedRisk: typeof policy.protectedRisk === "boolean" ? policy.protectedRisk : (() => { throw new Error("invalid-evidence: policy.protectedRisk"); })(),
    dataLossRisk: typeof policy.dataLossRisk === "boolean" ? policy.dataLossRisk : (() => { throw new Error("invalid-evidence: policy.dataLossRisk"); })(),
    excludedTargetIntersection:
      typeof policy.excludedTargetIntersection === "boolean"
        ? policy.excludedTargetIntersection
        : (() => { throw new Error("invalid-evidence: policy.excludedTargetIntersection"); })(),
    progress: enumValue(policy.progress, ["positive", "none", "negative"], "policy.progress"),
    diagnosableRuntime:
      typeof policy.diagnosableRuntime === "boolean"
        ? policy.diagnosableRuntime
        : (() => { throw new Error("invalid-evidence: policy.diagnosableRuntime"); })(),
    fullyAnchored:
      typeof policy.fullyAnchored === "boolean"
        ? policy.fullyAnchored
        : (() => { throw new Error("invalid-evidence: policy.fullyAnchored"); })(),
    scopeValid:
      typeof policy.scopeValid === "boolean"
        ? policy.scopeValid
        : (() => { throw new Error("invalid-evidence: policy.scopeValid"); })(),
    policyPermitted:
      typeof policy.policyPermitted === "boolean"
        ? policy.policyPermitted
        : (() => { throw new Error("invalid-evidence: policy.policyPermitted"); })(),
    ...(Object.keys(findingInputs).length ? { findingInputs } : {}),
  });
}

export function policyInputDigestV1(policy: RoutingPolicyInputV1): Sha256Digest {
  return sha256Digest(normalizePolicy(policy));
}

/**
 * Total root-cause routing with override rows first (design table).
 * Unrecognized combinations fail closed to stop/coordinator.
 * Finding-specific inputs override defaults for anchor/scope/diagnostic/risk rows;
 * true global safety overrides (policy.protectedRisk/dataLossRisk, authority, git, excluded) still dominate.
 */
export function routeActiveBlockerV1(input: {
  rootCause: FailureRootCause;
  policy: RoutingPolicyInputV1;
  findingPolicy?: RoutingFindingPolicyInputV1;
  /** Recomputed protected-risk class; when provided, dominates caller flags. */
  derivedProtectedRisk?: ProtectedRiskClassV1;
}): { destination: RoutingDestinationV1; owner: RoutingOwnerV1; rationaleCodes: readonly string[] } {
  const policy = normalizePolicy(input.policy);
  if (!ROOT_CAUSES.includes(input.rootCause)) throw new Error("invalid-evidence: unrecognized-root-cause");
  const findingPolicy = input.findingPolicy ?? {};

  const fullyAnchored = findingPolicy.fullyAnchored ?? policy.fullyAnchored;
  const scopeValid = findingPolicy.scopeValid ?? policy.scopeValid;
  const diagnosableRuntime = findingPolicy.diagnosableRuntime ?? policy.diagnosableRuntime;

  // Derived protected-risk class is the sole risk authority when supplied.
  // Caller true without derived positive class is ambiguous → stop (not Apply).
  // Caller false/omission never clears a derived positive class.
  const derived = input.derivedProtectedRisk;
  if (derived !== undefined) {
    if (derived === "security" || derived === "data_loss" || derived === "security_and_data_loss") {
      return {
        destination: "escalate",
        owner: "human",
        rationaleCodes:
          derived === "data_loss" || derived === "security_and_data_loss"
            ? ["PROTECTED_RISK_DATA_LOSS"]
            : ["PROTECTED_RISK_SECURITY"],
      };
    }
    if (derived === "ambiguous") {
      return {
        destination: "stop",
        owner: "coordinator",
        rationaleCodes: ["PROTECTED_RISK_AUTHORITY_AMBIGUOUS"],
      };
    }
    // derived === "none": unsupported positive caller assertion → ambiguous stop
    const callerPositive =
      policy.protectedRisk === true ||
      policy.dataLossRisk === true ||
      findingPolicy.protectedRisk === true ||
      findingPolicy.dataLossRisk === true;
    if (callerPositive) {
      return {
        destination: "stop",
        owner: "coordinator",
        rationaleCodes: ["PROTECTED_RISK_AUTHORITY_AMBIGUOUS"],
      };
    }
  } else {
    // Legacy structural path (no authority): intrinsic security root + caller flags.
    const protectedRisk = policy.protectedRisk || findingPolicy.protectedRisk === true;
    const dataLossRisk = policy.dataLossRisk || findingPolicy.dataLossRisk === true;
    if (protectedRisk || dataLossRisk || input.rootCause === "security") {
      return {
        destination: "escalate",
        owner: "human",
        rationaleCodes: dataLossRisk ? ["PROTECTED_RISK_DATA_LOSS"] : ["SECURITY_OR_PROTECTED_RISK"],
      };
    }
  }
  if (policy.authorityState === "missing" || policy.authorityState === "invalid") {
    return {
      destination: "stop",
      owner: "coordinator",
      rationaleCodes: [policy.authorityState === "missing" ? "AUTHZ_MISSING" : "AUTHZ_INVALID"],
    };
  }
  if (
    input.rootCause === "git_safety" ||
    policy.gitSafetyState === "confirmation-required" ||
    policy.gitSafetyState === "invalid"
  ) {
    return {
      destination: "stop",
      owner: "coordinator",
      rationaleCodes:
        input.rootCause === "git_safety"
          ? ["GIT_SAFETY_ROOT"]
          : policy.gitSafetyState === "invalid"
            ? ["GIT_SAFETY_CONFIRMATION_INVALID"]
            : ["GIT_SAFETY_CONFIRMATION_REQUIRED"],
    };
  }
  if (policy.excludedTargetIntersection) {
    return {
      destination: "stop",
      owner: "coordinator",
      rationaleCodes: ["EXCLUDED_TARGET_INTERSECTION"],
    };
  }

  // Root-cause rows
  switch (input.rootCause) {
    case "implementation":
      if (fullyAnchored && scopeValid && policy.policyPermitted) {
        return { destination: "targeted_repair", owner: "apply", rationaleCodes: ["IMPLEMENTATION_SCOPED_REPAIR"] };
      }
      return { destination: "replan_tasks", owner: "tasks", rationaleCodes: ["IMPLEMENTATION_MISSING_ANCHORS_OR_SCOPE"] };
    case "requirement":
      return { destination: "replan_spec", owner: "spec", rationaleCodes: ["ROOT_REQUIREMENT"] };
    case "architecture":
      return { destination: "replan_design", owner: "design", rationaleCodes: ["ROOT_ARCHITECTURE"] };
    case "batch_shape":
      return { destination: "replan_tasks", owner: "tasks", rationaleCodes: ["ROOT_BATCH_SHAPE"] };
    case "oracle":
      return { destination: "correct_oracle", owner: "verify-runtime", rationaleCodes: ["ORACLE_CORRECTION"] };
    case "environment":
    case "transport":
    case "capability":
      if (diagnosableRuntime) {
        return { destination: "verify_runtime_diagnosis", owner: "verify-runtime", rationaleCodes: ["RUNTIME_DIAGNOSIS"] };
      }
      return { destination: "escalate", owner: "human", rationaleCodes: ["RUNTIME_DIAGNOSIS_EXHAUSTED"] };
    case "authorization":
      return { destination: "stop", owner: "coordinator", rationaleCodes: ["AUTHZ_ROOT"] };
    case "unknown":
      if (diagnosableRuntime) {
        return { destination: "verify_runtime_diagnosis", owner: "verify-runtime", rationaleCodes: ["UNKNOWN_DIAGNOSABLE"] };
      }
      return { destination: "escalate", owner: "human", rationaleCodes: ["UNKNOWN_FAIL_CLOSED"] };
    default:
      // security/git_safety already handled by override rows above; unrecognized fails closed
      return { destination: "stop", owner: "coordinator", rationaleCodes: ["UNRECOGNIZED_COMBINATION"] };
  }
}

function parseRoute(raw: unknown, index: number): RouteEntryV1 {
  assertExactKeys(raw, ROUTE_KEYS, `routes[${index}]`);
  assertId(raw.findingId, "finding:v1:", `routes[${index}].findingId`);
  return cloneCanonical({
    findingId: raw.findingId as FindingId,
    destination: enumValue(raw.destination, DESTINATIONS, `routes[${index}].destination`),
    owner: enumValue(raw.owner, OWNERS, `routes[${index}].owner`),
    rootCause: enumValue(raw.rootCause, ROOT_CAUSES, `routes[${index}].rootCause`),
    rationaleCodes: stringArray(raw.rationaleCodes, `routes[${index}].rationaleCodes`, true),
  });
}

function semanticDecisionPayload(input: {
  dispositionSemanticDigest: Sha256Digest;
  activeBlockingSetDigest: Sha256Digest;
  policyInputDigest: Sha256Digest;
  routes: readonly RouteEntryV1[];
  outcome: RoutingOutcomeV1;
  rationaleCodes: readonly string[];
}) {
  return cloneCanonical({
    dispositionSemanticDigest: input.dispositionSemanticDigest,
    activeBlockingSetDigest: input.activeBlockingSetDigest,
    policyInputDigest: input.policyInputDigest,
    routes: input.routes.map((r) => ({
      findingId: r.findingId,
      destination: r.destination,
      owner: r.owner,
      rootCause: r.rootCause,
      rationaleCodes: r.rationaleCodes,
    })),
    outcome: input.outcome,
    rationaleCodes: input.rationaleCodes,
  });
}

function computeOutcome(routes: readonly RouteEntryV1[]): {
  outcome: RoutingOutcomeV1;
  rationaleCodes: string[];
} {
  if (routes.length === 0) {
    return { outcome: "complete", rationaleCodes: ["NO_ACTIVE_BLOCKERS"] };
  }
  const destinations = new Set(routes.map((r) => r.destination));
  const owners = new Set(routes.map((r) => r.owner));
  if (destinations.has("stop") && destinations.size === 1) {
    return { outcome: "stop", rationaleCodes: ["HOMOGENEOUS_STOP"] };
  }
  if (destinations.has("escalate") && [...destinations].every((d) => d === "escalate" || d === "stop")) {
    // Escalation/stop overrides dominate
    return { outcome: "escalate", rationaleCodes: ["HOMOGENEOUS_ESCALATE"] };
  }
  if (destinations.has("stop") || destinations.has("escalate")) {
    // Mixed with stop/escalate still overall escalate/stop preference: escalate if any escalate else stop
    if (destinations.has("escalate")) return { outcome: "escalate", rationaleCodes: ["ESCALATE_DOMINATES"] };
    return { outcome: "stop", rationaleCodes: ["STOP_DOMINATES"] };
  }
  if (destinations.size > 1 || owners.size > 1) {
    return { outcome: "split_required", rationaleCodes: ["MIXED_OWNER_OR_DESTINATION"] };
  }
  const only = routes[0]!.destination;
  if (only === "targeted_repair") return { outcome: "homogeneous", rationaleCodes: ["HOMOGENEOUS_REPAIR"] };
  if (only === "verify_runtime_diagnosis") return { outcome: "homogeneous", rationaleCodes: ["HOMOGENEOUS_DIAGNOSIS"] };
  if (only === "correct_oracle") return { outcome: "homogeneous", rationaleCodes: ["HOMOGENEOUS_ORACLE"] };
  if (only.startsWith("replan_")) return { outcome: "homogeneous", rationaleCodes: ["HOMOGENEOUS_REPLAN"] };
  return { outcome: "homogeneous", rationaleCodes: ["HOMOGENEOUS"] };
}

export function buildRoutingDecisionV1(input: RoutingDecisionInputV1): RoutingDecisionV1 {
  assertExactKeys(input, ["batch", "manifest", "disposition", "policy", "protectedRiskAuthority"], "routing decision input");
  const { batch, manifest, disposition } = input;
  assertBatchReferenceV1(manifest, batch);
  if (disposition.batchDigest !== batch.digest || disposition.manifestDigest !== manifest.digest) {
    throw new Error("invalid-evidence: disposition reference");
  }
  const policy = normalizePolicy(input.policy);
  const policyInputDigest = policyInputDigestV1(policy);
  const activeBlockingSetDigest = activeBlockingSetDigestV1(disposition, manifest);
  // Authorizing routing requires complete protected-risk authority (fail closed when omitted).
  const protectedRiskAuthority = bindProtectedRiskAuthority(
    input.protectedRiskAuthority,
    batch,
    manifest,
    input.protectedRiskAuthority?.classificationPolicyVersion ??
      disposition.classificationPolicyVersion,
    { required: true },
  );
  if (
    protectedRiskAuthority &&
    protectedRiskAuthority.routingPolicyVersion !== policy.routingPolicyVersion
  ) {
    throw new Error("invalid-evidence: PROTECTED_RISK_AUTHORITY_AMBIGUOUS");
  }

  const openById = new Map(manifest.findings.filter((f) => f.status === "open").map((f) => [f.findingId, f]));
  const activeEntries = disposition.entries.filter(
    (e) => e.disposition === "blocking" && openById.has(e.findingId),
  );

  const routes: RouteEntryV1[] = activeEntries
    .map((entry) => {
      const finding = openById.get(entry.findingId)!;
      const derivedAnchored =
        entry.requirementIds.length > 0 && entry.taskIds.length > 0 && entry.checkIds.length > 0;
      const findingOverride = policy.findingInputs?.[entry.findingId] ?? {};
      const derivedProtectedRisk = deriveProtectedRiskV1(finding, protectedRiskAuthority);
      const routed = routeActiveBlockerV1({
        rootCause: finding.rootCause,
        policy,
        derivedProtectedRisk,
        findingPolicy: {
          // Anchors are finding-specific: disposition anchors AND any explicit override/default.
          fullyAnchored: derivedAnchored && (findingOverride.fullyAnchored ?? policy.fullyAnchored),
          scopeValid: findingOverride.scopeValid ?? policy.scopeValid,
          protectedRisk: findingOverride.protectedRisk,
          dataLossRisk: findingOverride.dataLossRisk,
          diagnosableRuntime: findingOverride.diagnosableRuntime ?? policy.diagnosableRuntime,
        },
      });
      return cloneCanonical({
        findingId: entry.findingId,
        destination: routed.destination,
        owner: routed.owner,
        rootCause: finding.rootCause,
        rationaleCodes: routed.rationaleCodes,
      });
    })
    .sort((a, b) => a.findingId.localeCompare(b.findingId));

  const { outcome, rationaleCodes } = computeOutcome(routes);
  const semanticDecisionDigest = sha256Digest(
    semanticDecisionPayload({
      dispositionSemanticDigest: disposition.semanticDigest,
      activeBlockingSetDigest,
      policyInputDigest,
      routes,
      outcome,
      rationaleCodes,
    }),
  );

  const payload = cloneCanonical({
    schema: "routing-decision-v1" as const,
    batchId: batch.batchId,
    batchDigest: batch.digest,
    dispositionSemanticDigest: disposition.semanticDigest,
    activeBlockingSetDigest,
    policyInputDigest,
    routes,
    outcome,
    rationaleCodes,
    semanticDecisionDigest,
  });
  const digest = sha256Digest(payload);
  return deepFreeze({
    ...payload,
    decisionId: `routing:v1:${digest.slice(7, 39)}` as const,
    digest,
  }) as RoutingDecisionV1;
}

export function parseRoutingDecisionV1(
  value: unknown,
  manifest: FailureManifestV1,
  disposition: FindingDispositionEnvelopeV1,
  batch: ApplyBatchContractV1,
  policy: RoutingPolicyInputV1,
  protectedRiskAuthority?: ProtectedRiskAuthorityContextV1,
): RoutingDecisionV1 {
  assertExactKeys(value, DECISION_KEYS, "routing decision");
  if (value.schema !== "routing-decision-v1") throw new Error("unsupported-contract-version");
  assertId(value.decisionId, "routing:v1:", "decision.decisionId");
  assertDigest(value.digest, "decision.digest");
  assertDigest(value.batchDigest, "decision.batchDigest");
  assertDigest(value.dispositionSemanticDigest, "decision.dispositionSemanticDigest");
  assertDigest(value.activeBlockingSetDigest, "decision.activeBlockingSetDigest");
  assertDigest(value.policyInputDigest, "decision.policyInputDigest");
  assertDigest(value.semanticDecisionDigest, "decision.semanticDecisionDigest");
  assertBatchReferenceV1(
    { batchId: stringValue(value.batchId, "decision.batchId"), batchDigest: stringValue(value.batchDigest, "decision.batchDigest") },
    batch,
  );
  if (value.dispositionSemanticDigest !== disposition.semanticDigest) {
    throw new Error("invalid-evidence: dispositionSemanticDigest");
  }
  const expectedActive = activeBlockingSetDigestV1(disposition, manifest);
  if (value.activeBlockingSetDigest !== expectedActive) {
    throw new Error("invalid-evidence: activeBlockingSetDigest");
  }

  // Authoritative recompute: routes/outcome/rationales must match policy+manifest+disposition projection.
  // Missing mandatory authority is fail-closed (non-optional at authorizing parse).
  if (protectedRiskAuthority === undefined) {
    throw new Error("invalid-evidence: PROTECTED_RISK_AUTHORITY_AMBIGUOUS");
  }
  let expectedDecision: RoutingDecisionV1;
  try {
    expectedDecision = buildRoutingDecisionV1({ batch, manifest, disposition, policy, protectedRiskAuthority });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("PROTECTED_RISK_AUTHORITY_AMBIGUOUS")) throw err;
    throw err;
  }
  if (value.policyInputDigest !== expectedDecision.policyInputDigest) {
    throw new Error("invalid-evidence: policyInputDigest");
  }

  const routes = denseArray(value.routes, "routes").map((raw, i) => parseRoute(raw, i));
  const sorted = [...routes].sort((a, b) => a.findingId.localeCompare(b.findingId));
  if (JSON.stringify(routes.map((r) => r.findingId)) !== JSON.stringify(sorted.map((r) => r.findingId))) {
    throw new Error("invalid-evidence: routes-order");
  }
  if (JSON.stringify(routes) !== JSON.stringify(expectedDecision.routes)) {
    const riskMismatch = expectedDecision.routes.some(
      (r) =>
        r.rationaleCodes.includes("PROTECTED_RISK_SECURITY") ||
        r.rationaleCodes.includes("PROTECTED_RISK_DATA_LOSS") ||
        r.rationaleCodes.includes("PROTECTED_RISK_AUTHORITY_AMBIGUOUS") ||
        r.destination === "escalate",
    );
    throw new Error(
      riskMismatch
        ? "invalid-evidence: ROUTING_PROTECTED_RISK_MISMATCH"
        : "invalid-evidence: routes-recompute-mismatch",
    );
  }
  const outcome = enumValue(value.outcome, OUTCOMES, "decision.outcome");
  const rationaleCodes = stringArray(value.rationaleCodes, "decision.rationaleCodes", true);
  if (outcome !== expectedDecision.outcome || JSON.stringify(rationaleCodes) !== JSON.stringify(expectedDecision.rationaleCodes)) {
    throw new Error("invalid-evidence: outcome-recompute-mismatch");
  }
  const semanticDecisionDigest = sha256Digest(
    semanticDecisionPayload({
      dispositionSemanticDigest: disposition.semanticDigest,
      activeBlockingSetDigest: expectedActive,
      policyInputDigest: expectedDecision.policyInputDigest,
      routes: expectedDecision.routes,
      outcome: expectedDecision.outcome,
      rationaleCodes: expectedDecision.rationaleCodes,
    }),
  );
  if (value.semanticDecisionDigest !== semanticDecisionDigest) {
    throw new Error("invalid-evidence: semanticDecisionDigest");
  }

  const payload = cloneCanonical({
    schema: "routing-decision-v1" as const,
    batchId: batch.batchId,
    batchDigest: batch.digest,
    dispositionSemanticDigest: disposition.semanticDigest,
    activeBlockingSetDigest: expectedActive,
    policyInputDigest: expectedDecision.policyInputDigest,
    routes: expectedDecision.routes,
    outcome: expectedDecision.outcome,
    rationaleCodes: expectedDecision.rationaleCodes,
    semanticDecisionDigest,
  });
  const expected = sha256Digest(payload);
  if (value.digest !== expected || value.decisionId !== `routing:v1:${expected.slice(7, 39)}`) {
    throw new Error("invalid-evidence: routing decision");
  }
  return deepFreeze({ ...payload, decisionId: value.decisionId, digest: value.digest }) as RoutingDecisionV1;
}
