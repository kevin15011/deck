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

// ── Pipeline stage types ───────────────────────────────────────────────────────

export type PipelineStage = "audit" | "risk" | "quality" | "loop";

export interface StageError {
  stage: PipelineStage;
  error: string;
  recoverable: boolean;
}

/**
 * Isolated configuration slice for a single pipeline stage.
 * Each stage receives its own config derived from PipelineConfig.
 */
export interface StageConfig {
  scorerConfig?: RiskScorerConfig;
  routerConfig?: QualityRouterConfig;
  loopBreakerConfig?: LoopBreakerConfig;
  personality?: OrchestratorPersonality;
}

/**
 * Profile context for pipeline routing.
 * When provided, phase-level overrides from the profile are applied to stage configs.
 */
export interface ProfileContext {
  name: string;
  phaseOverrides?: Record<string, Record<string, unknown>>;
}

// ── Personality types (moved from personality-output.ts) ────────────────────────

// These remain here for pipeline runtime use only.
// Prompt generation uses packages/core instead.
export const ORCHESTRATOR_PERSONALITIES = ["guia", "pragmatica"] as const;
export type OrchestratorPersonality = (typeof ORCHESTRATOR_PERSONALITIES)[number];
export const DEFAULT_ORCHESTRATOR_PERSONALITY: OrchestratorPersonality = "pragmatica";

// ── Formatters (moved from personality-output.ts) ───────────────────────────────

export interface BlockReasonFacts {
  missingFields: string[];
  invalidFields: string[];
  enforcementMode: string;
  auditType: AuditType;
  isCritical?: boolean;
}

export interface SkipReasonFacts {
  riskScore: number;
  threshold: number;
  tier?: string;
  overrideName?: string;
  overrideExpiresAt?: string;
}

function normalizePersonality(p: unknown): OrchestratorPersonality {
  if (typeof p === "string" && ORCHESTRATOR_PERSONALITIES.includes(p as OrchestratorPersonality)) {
    return p as OrchestratorPersonality;
  }
  return DEFAULT_ORCHESTRATOR_PERSONALITY;
}

function formatBlockReason(facts: BlockReasonFacts, personality: unknown): string {
  const p = normalizePersonality(personality);
  const { missingFields, invalidFields, enforcementMode, auditType, isCritical = false } = facts;

  if (p === "guia") {
    const parts: string[] = [];
    if (missingFields.length > 0) parts.push(`Missing fields (${missingFields.length}): ${missingFields.join(", ")}`);
    if (invalidFields.length > 0) parts.push(`Invalid fields (${invalidFields.length}): ${invalidFields.join(", ")}`);
    const explanation = parts.length > 0 ? ` — ${parts.join("; ")}` : "";
    const whyItMatters = isCritical
      ? " This is a CRITICAL-tier issue. A valid self-audit is required before the orchestrator can proceed safely. Without it, the pipeline cannot assess risk or route quality checks correctly."
      : " A valid self-audit ensures the orchestrator has accurate project context before making routing and risk decisions.";
    return `Self-audit invalid in ${enforcementMode} mode for ${auditType} audit${explanation}.${whyItMatters}`;
  }

  // pragmatica
  const parts: string[] = [];
  if (missingFields.length > 0) parts.push(`missing=[${missingFields.join(",")}]`);
  if (invalidFields.length > 0) parts.push(`invalid=[${invalidFields.join(",")}]`);
  return `Self-audit invalid in ${enforcementMode} mode: ${parts.join(", ")}`;
}

function formatSkipReason(facts: SkipReasonFacts, personality: unknown): string {
  const p = normalizePersonality(personality);
  const { riskScore, threshold, tier, overrideName, overrideExpiresAt } = facts;

// pragmatica
  if (overrideName && overrideExpiresAt) return `${tier ?? "Critical"} tier overridden by "${overrideName}" expiring ${overrideExpiresAt}`;
  return `Risk score ${riskScore} below standard threshold ${threshold}; no quality agents needed`;
}

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
  /** Optional profile context for phase-level overrides */
  profile?: ProfileContext;
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
  /** Collected errors from each stage — pipeline continues despite errors */
  stageErrors: StageError[];
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

// ── Pipeline ──────────────────────────────────────────────────────────────────

export function runOrchestratorPipeline(
  input: OrchestratorPipelineInput,
  config: PipelineConfig = DEFAULT_PIPELINE_CONFIG,
): OrchestratorPipelineResult {
  const personality = config.personality ?? DEFAULT_ORCHESTRATOR_PERSONALITY;
  const stageErrors: StageError[] = [];

  // ── Profile-aware config resolution ─────────────────────────────────────────

  // Map auditType to SDD phase for profile override lookup
  const phaseMap: Record<AuditType, string> = {
    spec: "spec",
    design: "design",
    tasks: "tasks",
  };
  const currentPhase = phaseMap[input.auditType] ?? input.auditType;
  const profileOverrides = input.profile?.phaseOverrides?.[currentPhase] ?? {};

  // Apply profile overrides to stage configs (deep merge)
  function applyProfileOverrides<T extends object>(base: T, overrides: Record<string, unknown> | undefined): T {
    if (!overrides || Object.keys(overrides).length === 0) return base;
    // Shallow merge with override precedence — stage config fields are top-level
    return { ...base, ...overrides } as T;
  }

  const effectiveScorerConfig = applyProfileOverrides(config.scorerConfig, profileOverrides);
  const effectiveRouterConfig = applyProfileOverrides(config.routerConfig, profileOverrides);
  const effectiveLoopBreakerConfig = applyProfileOverrides(config.loopBreakerConfig, profileOverrides);

  // ── Stage wrappers with isolated error collection ──

  function runAuditStage(): {
    validation: ReturnType<typeof validateSelfAudit>;
    blocked: boolean;
    blockReason?: string;
  } {
    try {
      const validation = validateSelfAudit(input.audit, input.auditType);

      // Record validation failures as stage errors (non-recoverable)
      if (!validation.valid) {
        const missingFields = validation.missingFields.length > 0
          ? `Missing fields: ${validation.missingFields.join(", ")}`
          : "";
        const invalidFields = validation.invalidFields.length > 0
          ? `Invalid fields: ${validation.invalidFields.join(", ")}`
          : "";
        const errorMsg = [missingFields, invalidFields].filter(Boolean).join("; ") || "Invalid audit";

        stageErrors.push({
          stage: "audit",
          error: errorMsg,
          recoverable: false,
        });
      }

      // 2. Invalid audit blocks in enforced modes
      if (!validation.valid && input.enforcementMode && input.enforcementMode !== "report-only") {
        const blockReasonFacts = {
          missingFields: validation.missingFields,
          invalidFields: validation.invalidFields,
          enforcementMode: input.enforcementMode,
          auditType: input.auditType,
          isCritical: true,
        };
        const reason = formatBlockReason(blockReasonFacts, personality);
        return { validation, blocked: true, blockReason: reason };
      }

      return { validation, blocked: false };
    } catch (err) {
      stageErrors.push({
        stage: "audit",
        error: err instanceof Error ? err.message : String(err),
        recoverable: false,
      });
      return {
        validation: { valid: false, missingFields: [], invalidFields: [] },
        blocked: false,
      };
    }
  }

  function runRiskStage(normalizedAudit: { ambiguity: string[]; riskSignals: { name: string; evidence: string }[]; confidence: number }): RiskResult {
    try {
      return computeRiskScore(normalizedAudit, effectiveScorerConfig);
    } catch (err) {
      stageErrors.push({
        stage: "risk",
        error: err instanceof Error ? err.message : String(err),
        recoverable: true,
      });
      return {
        score: 100,
        tier: "critical",
        signals: [],
        thresholds: { standard: 30, boundary: 60, critical: 80 },
        overrides: [],
        recommendedChecks: ["full-review"],
        confidence: 0,
      };
    }
  }

  function runQualityStage(riskResult: RiskResult): QualityRouteDecision {
    try {
      return routeQuality(riskResult, effectiveRouterConfig);
    } catch (err) {
      stageErrors.push({
        stage: "quality",
        error: err instanceof Error ? err.message : String(err),
        recoverable: true,
      });
      return {
        invokeQuality: false,
        checksToRun: [],
        requiresReplanOrOverride: false,
        stateValidationRequired: false,
        skipReason: undefined,
      };
    }
  }

  function runLoopStage(failureHistory: FailureFingerprint[] | undefined): LoopAction {
    try {
      let loopAction: LoopAction = "continue";
      if (failureHistory && failureHistory.length > 0) {
        const latestFailure = failureHistory[failureHistory.length - 1];
        const result = checkLoopCondition(latestFailure, failureHistory.slice(0, -1), effectiveLoopBreakerConfig);
        loopAction = result.action;
      }
      return loopAction;
    } catch (err) {
      stageErrors.push({
        stage: "loop",
        error: err instanceof Error ? err.message : String(err),
        recoverable: true,
      });
      return "continue";
    }
  }

  // Execute stages
  const { validation, blocked, blockReason: auditBlockReason } = runAuditStage();

  // If blocked by audit in enforced mode, return early with conservative defaults
  if (blocked) {
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
      blockReason: auditBlockReason,
      stageErrors,
    };
  }

  // 3. Normalize invalid audit before scoring (report-only / default path)
  //    Prevents crash when audit is null/primitive/missing arrays
  const normalizedAudit = normalizeAuditForScoring(input.audit, validation.valid);

  // 4. Compute risk
  const riskResult = runRiskStage(normalizedAudit);

  // 5. Route quality
  const qualityDecision = runQualityStage(riskResult);

  // 6. Check loop condition from failure history
  const loopAction = runLoopStage(input.failureHistory);

  // 6. Determine outcome — blockReason is formatted for human display
  let outcome: PipelineOutcome = "completed";
  let blockReason: string | undefined;
  if (!validation.valid) {
    outcome = "partial";
    // Partial path uses "incomplete" wording which the formatter handles as pragmatic default
    const blockReasonFacts = {
      missingFields: validation.missingFields,
      invalidFields: validation.invalidFields,
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
      threshold: effectiveRouterConfig.standardThreshold,
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
    auditValid: validation.valid,
    riskResult,
    qualityRouted: finalQualityDecision.invokeQuality,
    qualityDecision: finalQualityDecision,
    loopAction,
    outcome,
    blockReason,
    stageErrors,
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
