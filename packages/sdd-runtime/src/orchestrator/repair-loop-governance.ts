/**
 * Repair Loop Governance — maps repair incidents to existing loop/budget decisions.
 *
 * Reuses `checkLoopCondition` (loop-breaker) and `checkBudget` (budget-watchdog)
 * without changing their semantics.
 *
 * Per Design: soft checkpoint at incident soft limits or soft budget;
 * hard stop at incident hard limits, hard budget, or escalation threshold.
 * In automatic mode, hard stop requires explicit override.
 */

import {
  checkLoopCondition,
  DEFAULT_LOOP_BREAKER_CONFIG,
  type FailureFingerprint,
  type LoopCheckResult,
} from "./loop-breaker";
import {
  checkBudget,
  DEFAULT_BUDGET_CONFIG,
  type BudgetCheckResult,
  type BudgetUsage,
} from "./budget-watchdog";
import type {
  RepairIncident,
  RepairFailureEntry,
  RepairBudgets,
  RuntimeBudget,
} from "../contracts/repair-incident";

// ── Operating mode ─────────────────────────────────────────────────────────────

/**
 * Controls whether hard stops require explicit override or allow interactive continuation.
 * - `automatic`: hard stop blocks further retries unless `hardStopOverride` is set.
 * - `interactive`: hard stop returns `block` but allows continuation with rationale.
 */
export type OperatingMode = "automatic" | "interactive";

// ── Config ────────────────────────────────────────────────────────────────────

export interface RepairGovernanceConfig {
  /**
   * Override the incident-level budgets with custom limits.
   * When absent, uses the `budgets` field from the incident itself.
   */
  incidentBudgets?: RepairBudgets;
  /**
   * Override the fingerprint loop thresholds.
   * When absent, uses the fingerprint thresholds from `incidentBudgets`.
   */
  loopBreakerConfig?: typeof DEFAULT_LOOP_BREAKER_CONFIG;
  /**
   * Override the runtime token/turn/time/tool-call budgets.
   * When absent, uses `DEFAULT_BUDGET_CONFIG`.
   */
  budgetConfig?: typeof DEFAULT_BUDGET_CONFIG;
  /**
   * Operating mode — controls hard-stop behavior.
   * Defaults to `automatic`.
   */
  operatingMode?: OperatingMode;
  /**
   * Explicit higher-level or human override that lifts hard-stop constraints.
   * Required in `automatic` mode when a hard stop is reached.
   */
  hardStopOverride?: {
    reason: string;
    at: string;
  };
}

// ── Result ───────────────────────────────────────────────────────────────────

/**
 * Decision returned by `evaluateRepairIncident`.
 */
export type RepairGovernanceDecision =
  | "continue"   // Normal retry; no budget or loop threshold hit
  | "repair"     // Loop condition hit — retry with scoped fix
  | "checkpoint" // Soft budget or incident soft limit hit — prompt for rationale
  | "replan"    // Fingerprint replan threshold hit — route to Spec/Design
  | "escalate"  // Fingerprint escalation threshold hit — route to human
  | "block";    // Hard budget, incident hard limit, or mandatory override absent

export interface RepairGovernanceResult {
  /** Overall governance decision for the incident */
  decision: RepairGovernanceDecision;
  /** Decision made for each individual failure entry */
  perFailure: FailureGovernanceResult[];
  /** Budget check result (null when no runtime budget is provided) */
  runtimeBudgetCheck: BudgetCheckResult | null;
  /** True when hard stop was reached but lifted by an override */
  hardStopOverridden: boolean;
  /** Human-readable summary */
  summary: string;
}

/** Governance result for a single failure entry */
export interface FailureGovernanceResult {
  failureId: string;
  /** Fingerprint-level loop action from `checkLoopCondition` */
  loopAction: LoopCheckResult;
  /** Whether this failure's individual repair-attempt soft limit is reached */
  atSoftLimit: boolean;
  /** Whether this failure's individual repair-attempt hard limit is reached */
  atHardLimit: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Normalize a RepairFailureEntry to a FailureFingerprint for loop condition checking.
 *
 * When `entry.fingerprint` is pre-populated it is used directly.
 * Otherwise a best-effort fingerprint is built from the entry's surface fields.
 * A `reviewFindingHash` of `""` (empty string) is used as the default to avoid
 * requiring review-finding context in the repair incident.
 */
function toFingerprint(entry: RepairFailureEntry): FailureFingerprint {
  if (entry.fingerprint) return entry.fingerprint;
  return {
    phase: entry.sourcePhase,
    taskGroup: entry.taskGroup,
    failingContract: entry.failingContract,
    errorClass: entry.errorClass,
    changedFiles: entry.changedFiles ?? [],
    reviewFindingHash: "",
  };
}

/** Stable string key for value-based fingerprint comparison. */
function fingerprintKey(fp: FailureFingerprint): string {
  return `${fp.phase}|${fp.taskGroup}|${fp.failingContract}|${fp.errorClass}|${
    [...fp.changedFiles].sort().join(",")
  }|${fp.reviewFindingHash}`;
}

// ── Main ──────────────────────────────────────────────────────────────────────

/**
 * Evaluate a repair incident against loop and budget constraints.
 *
 * Resolution order (highest priority first):
 *  1. Incident-level hard stop — hard limit on verify cycles or repair attempts → `block`
 *  2. Hard budget breach → `block` (unless overridden)
 *  3. Incident-level soft stop → `checkpoint`
 *  4. Soft budget breach → `checkpoint`
 *  5. Fingerprint escalation threshold → `escalate`
 *  6. Fingerprint replan threshold → `replan`
 *  7. Fingerprint repair threshold → `repair`
 *  8. Otherwise → `continue`
 */
export function evaluateRepairIncident(
  incident: RepairIncident,
  config: RepairGovernanceConfig = {},
): RepairGovernanceResult {
  const {
    incidentBudgets = incident.budgets,
    loopBreakerConfig,
    budgetConfig = DEFAULT_BUDGET_CONFIG,
    operatingMode = "automatic",
    hardStopOverride,
  } = config;
  const fingerprintLoopConfig = loopBreakerConfig ?? {
    repairThreshold: incidentBudgets.fingerprint.repairThreshold,
    replanThreshold: incidentBudgets.fingerprint.replanThreshold,
    escalationThreshold: incidentBudgets.fingerprint.escalationThreshold,
  };

  // --- Runtime budget check ---
  // RuntimeBudget fields are nullable (runner may not expose all metrics).
  // We only call checkBudget when at least one metric is present.
  const runtimeBudget: BudgetCheckResult | null =
    incident.runtimeBudget != null
      ? (() => {
          const rb = incident.runtimeBudget!;
          if (
            rb.tokensUsed == null &&
            rb.turnsUsed == null &&
            rb.timeElapsedMs == null &&
            rb.toolCallsUsed == null
          ) {
            return null;
          }
          const usage: BudgetUsage = {
            tokensUsed: rb.tokensUsed ?? 0,
            turnsUsed: rb.turnsUsed ?? 0,
            timeElapsedMs: rb.timeElapsedMs ?? 0,
            toolCallsUsed: rb.toolCallsUsed ?? 0,
          };
          return checkBudget(usage, budgetConfig);
        })()
      : null;

  // --- Incident-level budget check ---
  const verifyCycles = incident.lifecycle.filter(
    (e) => e.event === "repair.started" || e.event === "repair.retry_recorded",
  ).length;

  const atIncidentSoftVerifyLimit =
    verifyCycles >= incidentBudgets.incident.verifyCyclesSoft;
  const atIncidentHardVerifyLimit =
    verifyCycles >= incidentBudgets.incident.verifyCyclesHard;

  // --- Per-failure loop condition evaluation ---
  const perFailure: FailureGovernanceResult[] = incident.failures
    .filter((f) => f.status === "open" || f.status === "repairing")
    .map((entry) => {
      const fp = toFingerprint(entry);

      // Build a representative history: use the other failures in the incident that share the same fingerprint
      const fpKey = fingerprintKey(fp);
      const priorFailures: FailureFingerprint[] = incident.failures
        .filter(
          (f) => f.id !== entry.id && fingerprintKey(toFingerprint(f)) === fpKey,
        )
        .map((f) => toFingerprint(f));
      const attemptHistoryFingerprints = priorFailures.length === 0
        ? Array.from({ length: Math.max(0, entry.attempts.count) }, () => fp)
        : [];

      const loopResult = checkLoopCondition(
        fp,
        [...priorFailures, ...attemptHistoryFingerprints],
        fingerprintLoopConfig,
      );

      const atSoft =
        entry.attempts.count >= incidentBudgets.incident.repairAttemptsSoft;
      const atHard =
        entry.attempts.count >= incidentBudgets.incident.repairAttemptsHard;

      return {
        failureId: entry.id,
        loopAction: loopResult,
        atSoftLimit: atSoft,
        atHardLimit: atHard,
      };
    });

  // --- Incident-level resolution ---
  // Priority 1: incident hard verify limit
  if (atIncidentHardVerifyLimit) {
    const overridden = hardStopOverride != null && operatingMode === "automatic";
    return buildResult(
      overridden ? "checkpoint" : "block",
      perFailure,
      runtimeBudget,
      overridden,
      `Incident hard verify-cycle limit (${incidentBudgets.incident.verifyCyclesHard}) reached. ${
        overridden
          ? "Override present; continuing with checkpoint."
          : "No override — hard stop."
      }`,
    );
  }

  // Priority 2: hard budget
  if (runtimeBudget?.status === "hard_budget") {
    const overridden =
      hardStopOverride != null && operatingMode === "automatic";
    return buildResult(
      overridden ? "checkpoint" : "block",
      perFailure,
      runtimeBudget,
      overridden,
      `Hard budget breach (${runtimeBudget.breachedDimension}). ${
        overridden
          ? "Override present; continuing with checkpoint."
          : "No override — hard stop."
      }`,
    );
  }

  // Priority 3: per-fingerprint hard repair attempt limits. Hard stops must
  // dominate soft checkpoint conditions so an exhausted fingerprint cannot be
  // downgraded by incident/runtime soft limits.
  const hardFailure = perFailure.find((r) => r.atHardLimit);
  if (hardFailure) {
    const overridden = hardStopOverride != null && operatingMode === "automatic";
    return buildResult(
      overridden ? "checkpoint" : "block",
      perFailure,
      runtimeBudget,
      overridden,
      `Fingerprint hard repair-attempt limit (${incidentBudgets.incident.repairAttemptsHard}) reached for failure '${hardFailure.failureId}'. ${
        overridden
          ? "Override present; continuing with checkpoint."
          : "No override — hard stop."
      }`,
    );
  }

  // Priority 4: incident soft verify limit
  if (atIncidentSoftVerifyLimit) {
    return buildResult(
      "checkpoint",
      perFailure,
      runtimeBudget,
      false,
      `Incident soft verify-cycle limit (${incidentBudgets.incident.verifyCyclesSoft}) reached.`,
    );
  }

  // Priority 5: soft budget
  if (runtimeBudget?.status === "soft_budget") {
    return buildResult(
      "checkpoint",
      perFailure,
      runtimeBudget,
      false,
      "Soft budget limit reached.",
    );
  }

  // Priority 6: per-fingerprint soft repair attempt limits.
  const softFailure = perFailure.find((r) => r.atSoftLimit);
  if (softFailure) {
    return buildResult(
      "checkpoint",
      perFailure,
      runtimeBudget,
      false,
      `Fingerprint soft repair-attempt limit (${incidentBudgets.incident.repairAttemptsSoft}) reached for failure '${softFailure.failureId}'.`,
    );
  }

  // Priority 7-10: per-failure loop actions
  // Escalation (highest)
  const escalateResult = perFailure.find(
    (r) => r.loopAction.action === "escalate",
  );
  if (escalateResult) {
    return buildResult(
      "escalate",
      perFailure,
      runtimeBudget,
      false,
      `Fingerprint escalation threshold (${fingerprintLoopConfig.escalationThreshold}) reached for failure '${escalateResult.failureId}'.`,
    );
  }

  // Replan
  const replanResult = perFailure.find(
    (r) => r.loopAction.action === "replan",
  );
  if (replanResult) {
    return buildResult(
      "replan",
      perFailure,
      runtimeBudget,
      false,
      `Fingerprint replan threshold (${fingerprintLoopConfig.replanThreshold}) reached for failure '${replanResult.failureId}'.`,
    );
  }

  // Repair
  const repairResult = perFailure.find(
    (r) => r.loopAction.action === "repair",
  );
  if (repairResult) {
    return buildResult(
      "repair",
      perFailure,
      runtimeBudget,
      false,
      `Fingerprint repair threshold (${fingerprintLoopConfig.repairThreshold}) reached for failure '${repairResult.failureId}'.`,
    );
  }

  // Default: continue
  return buildResult(
    "continue",
    perFailure,
    runtimeBudget,
    false,
    perFailure.length === 0
      ? "No active failures to evaluate."
      : "No loop or budget thresholds reached; continue.",
  );
}

// ── Internal ───────────────────────────────────────────────────────────────────

function buildResult(
  decision: RepairGovernanceDecision,
  perFailure: FailureGovernanceResult[],
  runtimeBudgetCheck: BudgetCheckResult | null,
  hardStopOverridden: boolean,
  summary: string,
): RepairGovernanceResult {
  return {
    decision,
    perFailure,
    runtimeBudgetCheck,
    hardStopOverridden,
    summary,
  };
}
