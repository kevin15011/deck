/**
 * Enforcement mode — controls migration from report-only to full enforcement.
 *
 * Report-only: contracts optional, scoring logs warnings but does not gate phases.
 * Conditional-routing: thresholds gate quality invocation; state manager enforces version checks.
 * Full-enforcement: locks/events required; legacy writes readable with deprecation warnings.
 */

export type EnforcementMode = "report-only" | "conditional-routing" | "full-enforcement";

// ── Config ──

export interface EnforcementConfig {
  /** Score threshold for conditional quality gating */
  qualityGateThreshold: number;
  /** Whether to warn on legacy writes */
  warnOnLegacyWrites: boolean;
}

export const DEFAULT_ENFORCEMENT_CONFIG: EnforcementConfig = {
  qualityGateThreshold: 30,
  warnOnLegacyWrites: true,
};

// ── Input ──

export interface EnforcementInput {
  conditionalRoutingEnabled?: boolean;
  locksRequired?: boolean;
}

// ── Context for enforcement check ──

export interface EnforcementContext {
  auditValid: boolean;
  riskScore: number;
  hasValidLock?: boolean;
}

// ── Result ──

export interface EnforcementResult {
  blocked: boolean;
  qualityGated: boolean;
  warnings: string[];
  deprecationWarnings: string[];
}

// ── Resolve mode ──

export function resolveEnforcementMode(input: EnforcementInput): EnforcementMode {
  if (input.locksRequired && input.conditionalRoutingEnabled) {
    return "full-enforcement";
  }
  if (input.conditionalRoutingEnabled) {
    return "conditional-routing";
  }
  return "report-only";
}

// ── Apply enforcement ──

export function applyEnforcement(
  mode: EnforcementMode,
  context: EnforcementContext,
  config: EnforcementConfig,
): EnforcementResult {
  const warnings: string[] = [];
  const deprecationWarnings: string[] = [];

  switch (mode) {
    case "report-only": {
      if (!context.auditValid) {
        warnings.push("Self-audit incomplete; scoring operates with reduced signal");
      }
      if (context.riskScore >= config.qualityGateThreshold) {
        warnings.push(`Risk score ${context.riskScore} exceeds standard threshold but report-only mode does not gate`);
      }
      return { blocked: false, qualityGated: false, warnings, deprecationWarnings };
    }

    case "conditional-routing": {
      if (!context.auditValid) {
        return {
          blocked: true,
          qualityGated: false,
          warnings: ["Self-audit is required in conditional-routing mode"],
          deprecationWarnings,
        };
      }
      const qualityGated = context.riskScore >= config.qualityGateThreshold;
      if (config.warnOnLegacyWrites) {
        deprecationWarnings.push("Direct artifact writes are deprecated; use state manager");
      }
      return { blocked: false, qualityGated, warnings, deprecationWarnings };
    }

    case "full-enforcement": {
      if (!context.auditValid) {
        return {
          blocked: true,
          qualityGated: false,
          warnings: ["Self-audit is required in full-enforcement mode"],
          deprecationWarnings,
        };
      }
      if (!context.hasValidLock) {
        return {
          blocked: true,
          qualityGated: true,
          warnings: ["Lock or event-sourced write required in full-enforcement mode"],
          deprecationWarnings,
        };
      }
      return {
        blocked: false,
        qualityGated: context.riskScore >= config.qualityGateThreshold,
        warnings,
        deprecationWarnings,
      };
    }
  }
}
