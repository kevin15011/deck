/**
 * Risk scorer — computes risk from universal + discovered signals.
 * Adapts weights based on detected project capabilities.
 */

import type { RiskSignal } from "../contracts/risk";
import { DEFAULT_RISK_THRESHOLDS } from "../contracts/risk";
import type { RiskResult, RiskTier } from "../contracts/risk";

// ── Config ──

export interface ProjectCapabilities {
  hasTestRunner: boolean;
  hasTypeChecker: boolean;
  hasLinter: boolean;
  hasBuildTool: boolean;
  detectedCapabilities: string[];
}

export interface RiskScorerConfig {
  /** Extra weight added when project lacks test capabilities */
  noTestPenalty: number;
  /** Extra weight added when project lacks any quality tool */
  noQualityToolPenalty: number;
  /** Confidence penalty multiplier (low confidence = higher risk) */
  confidencePenaltyWeight: number;
  /** Base score contribution from ambiguity */
  ambiguityWeight: number;
  /** Project capabilities for adaptive scoring */
  projectCapabilities?: ProjectCapabilities;
}

export const DEFAULT_SCORER_CONFIG: RiskScorerConfig = {
  noTestPenalty: 15,
  noQualityToolPenalty: 10,
  confidencePenaltyWeight: 20,
  ambiguityWeight: 8,
};

interface AuditInput {
  ambiguity: string[];
  riskSignals: { name: string; evidence: string; weight?: number }[];
  confidence: number;
}

// ── Scoring ──

export function computeRiskScore(
  audit: AuditInput,
  config: RiskScorerConfig,
): RiskResult {
  let score = 0;
  const signals: RiskSignal[] = [];

  // 1. Risk signals contribution
  for (const signal of audit.riskSignals) {
    const weight = typeof signal.weight === "number" ? signal.weight : 0.5;
    const contribution = weight * 40;
    score += contribution;
    signals.push({
      name: signal.name,
      weight,
      evidence: signal.evidence,
    });
  }

  // 2. Ambiguity contribution
  score += audit.ambiguity.length * config.ambiguityWeight;
  for (const item of audit.ambiguity) {
    signals.push({
      name: "ambiguity",
      weight: 0.3,
      evidence: item,
    });
  }

  // 3. Low confidence penalty
  const confidenceGap = 1 - audit.confidence;
  score += confidenceGap * config.confidencePenaltyWeight;
  if (audit.confidence < 0.5) {
    signals.push({
      name: "low_confidence",
      weight: confidenceGap,
      evidence: `Producer confidence: ${audit.confidence.toFixed(2)}`,
    });
  }

  // 4. Project capability adaptation
  const caps = config.projectCapabilities;
  if (caps) {
    if (!caps.hasTestRunner) {
      score += config.noTestPenalty;
      signals.push({
        name: "no_test_runner",
        weight: 0.6,
        evidence: "Project has no detected test runner",
      });
    }

    const qualityTools = [caps.hasTypeChecker, caps.hasLinter].filter(Boolean).length;
    if (qualityTools === 0) {
      score += config.noQualityToolPenalty;
      signals.push({
        name: "no_quality_tools",
        weight: 0.4,
        evidence: "Project has no detected quality tools",
      });
    }
  }

  // 5. Clamp to 0..100
  score = Math.max(0, Math.min(100, Math.round(score)));

  // 6. Determine tier
  const tier = scoreToTier(score);

  return {
    score,
    tier,
    signals,
    thresholds: DEFAULT_RISK_THRESHOLDS,
    overrides: [],
    recommendedChecks: recommendChecks(tier),
    confidence: audit.confidence,
  };
}

function scoreToTier(score: number): RiskTier {
  if (score >= 80) return "critical";
  if (score >= 60) return "high";
  if (score >= 30) return "boundary";
  return "standard";
}

function recommendChecks(tier: RiskTier): string[] {
  switch (tier) {
    case "critical":
      return ["full-review", "security-review", "integration-test", "replan-assessment"];
    case "high":
      return ["security-review", "integration-test"];
    case "boundary":
      return ["contract-quality"];
    case "standard":
      return [];
  }
}
