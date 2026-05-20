/**
 * Risk scoring contracts — score, tier, signals, thresholds, overrides.
 */

export type RiskTier = "standard" | "boundary" | "high" | "critical";

export interface RiskSignal {
  name: string;
  weight: number;
  evidence: string;
}

export interface RiskThresholds {
  standard: number;
  boundary: number;
  critical: number;
}

export interface RiskOverride {
  name: string;
  scope: string;
  expiresAt: string;
}

export interface RiskResult {
  score: number;
  tier: RiskTier;
  signals: RiskSignal[];
  thresholds: RiskThresholds;
  overrides: RiskOverride[];
  recommendedChecks: string[];
  confidence: number;
}

export const DEFAULT_RISK_THRESHOLDS: RiskThresholds = {
  standard: 30,
  boundary: 60,
  critical: 80,
};

export interface RiskValidationResult {
  valid: boolean;
  errors: string[];
}

const VALID_TIERS: RiskTier[] = ["standard", "boundary", "high", "critical"];

export function validateRiskResult(result: unknown): RiskValidationResult {
  const record = result as Record<string, unknown>;
  const errors: string[] = [];

  // Score validation
  if (typeof record.score !== "number" || record.score < 0 || record.score > 100) {
    errors.push("score must be between 0 and 100");
  }

  // Tier validation
  if (!VALID_TIERS.includes(record.tier as RiskTier)) {
    errors.push("invalid tier");
  }

  // Signals required
  if (!Array.isArray(record.signals)) {
    errors.push("missing signals array");
  }

  // Thresholds required
  if (!record.thresholds || typeof record.thresholds !== "object") {
    errors.push("missing thresholds");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
