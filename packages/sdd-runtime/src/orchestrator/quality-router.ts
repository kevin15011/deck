/**
 * Quality router — invokes quality agents only above threshold.
 * Logs skip decisions for auditability.
 */

import type { RiskResult } from "../contracts/risk";

// ── Config ──

export interface QualityRouterConfig {
  /** Standard tier threshold — below this, skip quality agents */
  standardThreshold: number;
  /** Boundary tier threshold */
  boundaryThreshold: number;
  /** Critical tier threshold — requires replan or override */
  criticalThreshold: number;
}

export const DEFAULT_ROUTER_CONFIG: QualityRouterConfig = {
  standardThreshold: 30,
  boundaryThreshold: 60,
  criticalThreshold: 80,
};

// ── Decision ──

export interface QualityRouteDecision {
  /** Whether to invoke quality agents */
  invokeQuality: boolean;
  /** Specific checks to run */
  checksToRun: string[];
  /** Why quality was skipped (for audit log) */
  skipReason?: string;
  /** Whether replan or explicit override is required (critical tier) */
  requiresReplanOrOverride: boolean;
  /** State validation is always enforced, even with overrides */
  stateValidationRequired: boolean;
}

// ── Routing ──

export function routeQuality(
  riskResult: RiskResult,
  config: QualityRouterConfig,
): QualityRouteDecision {
  const { score, overrides, recommendedChecks } = riskResult;

  // Use CONFIGURED thresholds consistently, not precomputed tier
  const isCritical = score >= config.criticalThreshold;
  const isHigh = score >= config.boundaryThreshold && !isCritical;
  const isBoundary = score >= config.standardThreshold && !isHigh && !isCritical;

  // Check for active overrides that scope to quality-only
  const qualityOverride = overrides.find(
    (o) => o.scope === "quality-only" && new Date(o.expiresAt) > new Date(),
  );

  // State validation is ALWAYS enforced regardless of overrides
  const stateValidationRequired = true;

  if (!isBoundary && !isHigh && !isCritical) {
    return {
      invokeQuality: false,
      checksToRun: [],
      skipReason: `Risk score ${score} below standard threshold ${config.standardThreshold}; no quality agents needed`,
      requiresReplanOrOverride: false,
      stateValidationRequired,
    };
  }

  if (isCritical) {
    if (qualityOverride) {
      return {
        invokeQuality: false,
        checksToRun: [],
        skipReason: `Critical tier overridden by "${qualityOverride.name}" expiring ${qualityOverride.expiresAt}`,
        requiresReplanOrOverride: false,
        stateValidationRequired,
      };
    }

    return {
      invokeQuality: true,
      checksToRun: recommendedChecks,
      requiresReplanOrOverride: true,
      stateValidationRequired,
    };
  }

  if (isHigh) {
    return {
      invokeQuality: true,
      checksToRun: recommendedChecks,
      requiresReplanOrOverride: false,
      stateValidationRequired,
    };
  }

  // boundary tier
  return {
    invokeQuality: true,
    checksToRun: recommendedChecks,
    requiresReplanOrOverride: false,
    stateValidationRequired,
  };
}
