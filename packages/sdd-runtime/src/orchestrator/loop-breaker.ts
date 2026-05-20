/**
 * Loop breaker — detects repeated/similar failures, forces repair/replan/escalation.
 * Uses normalized failure fingerprints for similarity.
 */

// ── Fingerprint ──

export interface FailureFingerprint {
  phase: string;
  taskGroup: string;
  failingContract: string;
  errorClass: string;
  changedFiles: string[];
  reviewFindingHash: string;
}

// ── Config ──

export interface LoopBreakerConfig {
  /** Failures to trigger repair */
  repairThreshold: number;
  /** Failures to trigger replan */
  replanThreshold: number;
  /** Failures to trigger escalation */
  escalationThreshold: number;
}

export const DEFAULT_LOOP_BREAKER_CONFIG: LoopBreakerConfig = {
  repairThreshold: 2,
  replanThreshold: 3,
  escalationThreshold: 4,
};

// ── Result ──

export type LoopAction = "continue" | "repair" | "replan" | "escalate";

export interface LoopCheckResult {
  action: LoopAction;
  similarCount: number;
  failureCluster: FailureFingerprint[];
}

// ── Normalization ──

function normalizeFingerprint(fp: FailureFingerprint): string {
  // Sort changed files for order-independent comparison
  const sortedFiles = [...fp.changedFiles].sort().join(",");
  return `${fp.phase}|${fp.taskGroup}|${fp.failingContract}|${fp.errorClass}|${sortedFiles}|${fp.reviewFindingHash}`;
}

// ── Classification ──

export function classifyFailure(fp: FailureFingerprint): string {
  return normalizeFingerprint(fp);
}

// ── Loop check ──

export function checkLoopCondition(
  current: FailureFingerprint,
  history: FailureFingerprint[],
  config: LoopBreakerConfig,
): LoopCheckResult {
  const currentKey = normalizeFingerprint(current);

  const similar = history.filter(
    (past) => normalizeFingerprint(past) === currentKey,
  );

  const similarCount = similar.length + 1; // +1 for current
  const cluster = [...similar, current];

  if (similarCount >= config.escalationThreshold) {
    return { action: "escalate", similarCount, failureCluster: cluster };
  }

  if (similarCount >= config.replanThreshold) {
    return { action: "replan", similarCount, failureCluster: cluster };
  }

  if (similarCount >= config.repairThreshold) {
    return { action: "repair", similarCount, failureCluster: cluster };
  }

  return { action: "continue", similarCount, failureCluster: cluster };
}
