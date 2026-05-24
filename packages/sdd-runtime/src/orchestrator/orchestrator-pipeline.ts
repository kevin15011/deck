/**
 * Orchestrator pipeline — wires audit → risk scorer → quality router → loop breaker.
 *
 * Invalid/missing self-audits produce blocked/partial outcome before scoring/routing
 * in enforced modes.
 */

import { validateSelfAudit, type AuditType } from "../contracts/self-audit";
import { computeRiskScore, DEFAULT_SCORER_CONFIG, type RiskScorerConfig } from "./risk-scorer";
import { routeQuality, DEFAULT_ROUTER_CONFIG, type QualityRouterConfig, type QualityRouteDecision } from "./quality-router";
import { checkLoopCondition, DEFAULT_LOOP_BREAKER_CONFIG, type LoopBreakerConfig, type FailureFingerprint, type LoopAction } from "./loop-breaker";
import type { RiskResult } from "../contracts/risk";
import { formatBlockReason, formatSkipReason, DEFAULT_ORCHESTRATOR_PERSONALITY, type OrchestratorPersonality } from "./personality-output";

// ── Input ──

export interface OrchestratorPipelineInput {
  audit: {
    invariants: string;
    boundaries: string;
    ambiguity: string[];
    riskSignals: { name: string; evidence: string }[];
    confidence: number;
    /** Phase-specific fields (e.g. externalContracts, sensitiveData for spec) */
    [key: string]: unknown;
  };
  auditType: AuditType;
  failureHistory?: FailureFingerprint[];
  /** Enforcement mode — when set, invalid audit blocks routing */
  enforcementMode?: "report-only" | "conditional-routing" | "full-enforcement";
}

// ── Result ──

export type PipelineOutcome = "completed" | "blocked" | "partial";

export interface OrchestratorPipelineResult {
  auditValid: boolean;
  riskResult: RiskResult;
  qualityRouted: boolean;
  qualityDecision: QualityRouteDecision;
  loopAction: LoopAction;
  /** Outcome reflects whether invalid audit blocked the pipeline */
  outcome: PipelineOutcome;
  /** When blocked/partial, describes why */
  blockReason?: string;
}

// ── Config ──

export interface PipelineConfig {
  scorerConfig: RiskScorerConfig;
  routerConfig: QualityRouterConfig;
  loopBreakerConfig: LoopBreakerConfig;
  /** Personality for human-facing output verbosity. Defaults to pragmatica. */
  personality?: OrchestratorPersonality;
}

export const DEFAULT_PIPELINE_CONFIG: PipelineConfig = {
  scorerConfig: DEFAULT_SCORER_CONFIG,
  routerConfig: DEFAULT_ROUTER_CONFIG,
  loopBreakerConfig: DEFAULT_LOOP_BREAKER_CONFIG,
};

// ── Pipeline ──

export function runOrchestratorPipeline(
  input: OrchestratorPipelineInput,
  config: PipelineConfig = DEFAULT_PIPELINE_CONFIG,
): OrchestratorPipelineResult {
  const personality = config.personality ?? DEFAULT_ORCHESTRATOR_PERSONALITY;

  // 1. Validate audit
  const auditValidation = validateSelfAudit(input.audit, input.auditType);

  // 2. Invalid audit blocks in enforced modes
  if (!auditValidation.valid && input.enforcementMode && input.enforcementMode !== "report-only") {
    const blockReasonFacts = {
      missingFields: auditValidation.missingFields,
      invalidFields: auditValidation.invalidFields,
      enforcementMode: input.enforcementMode,
      auditType: input.auditType,
      isCritical: true,
    };
    const reason = formatBlockReason(blockReasonFacts, personality);

    // Produce conservative risk result and blocked outcome
    return {
      auditValid: false,
      riskResult: {
        score: 100,
        tier: "critical",
        signals: [],
        thresholds: { standard: 30, boundary: 60, critical: 80 },
        overrides: [],
        recommendedChecks: ["full-review"],
        confidence: 0,
      },
      qualityRouted: false,
      qualityDecision: {
        invokeQuality: false,
        checksToRun: [],
        requiresReplanOrOverride: true,
        stateValidationRequired: true,
        skipReason: undefined,
      },
      loopAction: "continue",
      outcome: "blocked",
      blockReason: reason,
    };
  }

  // 3. Normalize invalid audit before scoring (report-only / default path)
  //    Prevents crash when audit is null/primitive/missing arrays
  const normalizedAudit = normalizeAuditForScoring(input.audit, auditValidation.valid);

  // 4. Compute risk
  const riskResult = computeRiskScore(normalizedAudit, config.scorerConfig);

  // 5. Route quality
  const qualityDecision = routeQuality(riskResult, config.routerConfig);

  // 6. Check loop condition from failure history
  let loopAction: LoopAction = "continue";
  if (input.failureHistory && input.failureHistory.length > 0) {
    const latestFailure = input.failureHistory[input.failureHistory.length - 1];
    const result = checkLoopCondition(latestFailure, input.failureHistory.slice(0, -1), config.loopBreakerConfig);
    loopAction = result.action;
  }

  // 6. Determine outcome — blockReason is formatted for human display
  let outcome: PipelineOutcome = "completed";
  let blockReason: string | undefined;
  if (!auditValidation.valid) {
    outcome = "partial";
    // Partial path uses "incomplete" wording which the formatter handles as pragmatic default
    const blockReasonFacts = {
      missingFields: auditValidation.missingFields,
      invalidFields: auditValidation.invalidFields,
      enforcementMode: input.enforcementMode ?? "report-only",
      auditType: input.auditType,
      isCritical: false,
    };
    blockReason = formatBlockReason(blockReasonFacts, personality);
  }

  // 7. Format skipReason with personality if set
  let finalQualityDecision = qualityDecision;
  if (qualityDecision.skipReason && typeof qualityDecision.skipReason === "string") {
    // Extract active quality override fields so the formatter's override branch is reachable
    const qualityOverride = riskResult.overrides.find(
      (o) => o.scope === "quality-only" && new Date(o.expiresAt) > new Date(),
    );
    const skipReasonFacts = {
      riskScore: riskResult.score,
      threshold: config.routerConfig.standardThreshold,
      tier: riskResult.tier,
      overrideName: qualityOverride?.name,
      overrideExpiresAt: qualityOverride?.expiresAt,
    };
    finalQualityDecision = {
      ...qualityDecision,
      skipReason: formatSkipReason(skipReasonFacts, personality),
    };
  }

  return {
    auditValid: auditValidation.valid,
    riskResult,
    qualityRouted: finalQualityDecision.invokeQuality,
    qualityDecision: finalQualityDecision,
    loopAction,
    outcome,
    blockReason,
  };
}

/**
 * Normalizes potentially invalid audit into a safe shape for computeRiskScore.
 * Returns conservative defaults for missing/malformed fields so scoring never throws.
 */
function normalizeAuditForScoring(
  audit: unknown,
  isValid: boolean,
): { ambiguity: string[]; riskSignals: { name: string; evidence: string }[]; confidence: number } {
  if (isValid) {
    return audit as { ambiguity: string[]; riskSignals: { name: string; evidence: string }[]; confidence: number };
  }

  // Invalid audit: normalize to conservative safe shape
  const safeAmbiguity: string[] = [];
  const safeRiskSignals: { name: string; evidence: string }[] = [];
  let safeConfidence = 0;

  if (audit !== null && audit !== undefined && typeof audit === "object" && !Array.isArray(audit)) {
    const record = audit as Record<string, unknown>;

    if (Array.isArray(record.ambiguity)) {
      safeAmbiguity.push(...record.ambiguity.filter((a): a is string => typeof a === "string"));
    }

    if (Array.isArray(record.riskSignals)) {
      for (const sig of record.riskSignals) {
        if (sig !== null && sig !== undefined && typeof sig === "object") {
          const s = sig as Record<string, unknown>;
          if (typeof s.name === "string" && typeof s.evidence === "string") {
            safeRiskSignals.push({ name: s.name, evidence: s.evidence });
          }
        }
      }
    }

    if (typeof record.confidence === "number" && !isNaN(record.confidence)) {
      safeConfidence = Math.max(0, Math.min(1, record.confidence));
    }
  }

  return {
    ambiguity: safeAmbiguity,
    riskSignals: safeRiskSignals,
    confidence: safeConfidence,
  };
}
