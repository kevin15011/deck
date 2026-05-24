/**
 * Personality-aware output formatter for orchestrator pipeline output.
 *
 * Shapes human-facing explanation strings based on the active personality.
 * Machine-readable fields remain unchanged regardless of personality.
 *
 * Facts types are structured (not prebuilt paragraphs) so the formatter
 * can recompose them at the appropriate verbosity level per personality.
 *
 * Unknown/undefined personality normalizes to "pragmatica" before use.
 */

import type { AuditType } from "../contracts/self-audit";

// ── Personality types ────────────────────────────────────────────────────────

export const ORCHESTRATOR_PERSONALITIES = ["guia", "pragmatica", "ahorro-extremo"] as const;
export type OrchestratorPersonality = (typeof ORCHESTRATOR_PERSONALITIES)[number];
export const DEFAULT_ORCHESTRATOR_PERSONALITY: OrchestratorPersonality = "pragmatica";

function normalizePersonality(p: unknown): OrchestratorPersonality {
  if (typeof p === "string" && ORCHESTRATOR_PERSONALITIES.includes(p as OrchestratorPersonality)) {
    return p as OrchestratorPersonality;
  }
  return DEFAULT_ORCHESTRATOR_PERSONALITY;
}

// ── Fact types ───────────────────────────────────────────────────────────────

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

export interface LoopBreakerFacts {
  action: "continue" | "repair" | "replan" | "escalate";
  similarCount: number;
  phase?: string;
  taskGroup?: string;
  failingContract?: string;
}

// ── Formatters ──────────────────────────────────────────────────────────────

/**
 * Formats a block reason string based on the active personality.
 *
 * - guia:       Full rationale + "why this matters" context
 * - pragmatica: Standard explanation (matches current behavior)
 * - ahorro-extremo: One-line mandatory summary with critical facts only
 */
export function formatBlockReason(facts: BlockReasonFacts, personality: unknown): string {
  const p = normalizePersonality(personality);

  const { missingFields, invalidFields, enforcementMode, auditType, isCritical = false } = facts;

  if (p === "ahorro-extremo") {
    // One-line mandatory summary with critical facts only
    const parts: string[] = [];
    if (missingFields.length > 0) {
      parts.push(`missing=[${missingFields.join(",")}]`);
    }
    if (invalidFields.length > 0) {
      parts.push(`invalid=[${invalidFields.join(",")}]`);
    }
    const base = `Self-audit invalid in ${enforcementMode} mode: ${parts.join(", ")}`;
    if (isCritical) {
      return `${base} [CRITICAL]`;
    }
    return base;
  }

  if (p === "guia") {
    const parts: string[] = [];
    if (missingFields.length > 0) {
      parts.push(`Missing fields (${missingFields.length}): ${missingFields.join(", ")}`);
    }
    if (invalidFields.length > 0) {
      parts.push(`Invalid fields (${invalidFields.length}): ${invalidFields.join(", ")}`);
    }
    const explanation = parts.length > 0 ? ` — ${parts.join("; ")}` : "";

    const whyItMatters = isCritical
      ? " This is a CRITICAL-tier issue. A valid self-audit is required before the orchestrator can proceed safely. Without it, the pipeline cannot assess risk or route quality checks correctly."
      : " A valid self-audit ensures the orchestrator has accurate project context before making routing and risk decisions.";

    return `Self-audit invalid in ${enforcementMode} mode for ${auditType} audit${explanation}.${whyItMatters}`;
  }

  // pragmatica — standard explanation (matches current behavior)
  const parts: string[] = [];
  if (missingFields.length > 0) {
    parts.push(`missing=[${missingFields.join(",")}]`);
  }
  if (invalidFields.length > 0) {
    parts.push(`invalid=[${invalidFields.join(",")}]`);
  }
  return `Self-audit invalid in ${enforcementMode} mode: ${parts.join(", ")}`;
}

/**
 * Formats a quality skip reason string based on the active personality.
 *
 * - guia:       Full rationale + "why this matters" context
 * - pragmatica: Standard explanation (matches current behavior)
 * - ahorro-extremo: One-line summary with risk score and threshold
 */
export function formatSkipReason(facts: SkipReasonFacts, personality: unknown): string {
  const p = normalizePersonality(personality);

  const { riskScore, threshold, tier, overrideName, overrideExpiresAt } = facts;

  if (p === "ahorro-extremo") {
    if (overrideName && overrideExpiresAt) {
      return `${tier ?? "Critical"} tier overridden by "${overrideName}" (expires ${overrideExpiresAt})`;
    }
    return `Risk score ${riskScore} below threshold ${threshold}; quality agents skipped`;
  }

  if (p === "guia") {
    if (overrideName && overrideExpiresAt) {
      return `Quality agents were skipped because the ${tier ?? "critical"} risk tier was explicitly overridden by "${overrideName}", which expires ${overrideExpiresAt}. Overrides allow experienced users to proceed when they have external context the orchestrator cannot see. Without a valid override, the orchestrator would require a full review before continuing.`;
    }

    const tierLabel = tier ? ` (${tier} tier)` : "";
    const whyItMatters =
      riskScore < threshold
        ? ` A valid risk assessment is needed before the orchestrator can decide whether to invoke quality agents. Scores below ${threshold} indicate standard-tier projects where the cost of quality agent invocation outweigh the expected benefit.`
        : "";

    return `Risk score ${riskScore}${tierLabel} is below the quality routing threshold of ${threshold}; no quality agents will be invoked.${whyItMatters}`;
  }

  // pragmatica — standard explanation (matches current behavior)
  if (overrideName && overrideExpiresAt) {
    return `${tier ?? "Critical"} tier overridden by "${overrideName}" expiring ${overrideExpiresAt}`;
  }
  return `Risk score ${riskScore} below standard threshold ${threshold}; no quality agents needed`;
}

/**
 * Formats a loop-breaker message string based on the active personality.
 *
 * - guia:       Full explanation + recommended next step
 * - pragmatica: Concise explanation of loop action taken
 * - ahorro-extremo: Single-line summary of action taken
 */
export function formatLoopBreakerMessage(facts: LoopBreakerFacts, personality: unknown): string {
  const p = normalizePersonality(personality);

  const { action, similarCount, phase, taskGroup, failingContract } = facts;

  if (p === "ahorro-extremo") {
    const label = action.charAt(0).toUpperCase() + action.slice(1);
    return `[LoopBreaker] ${label} after ${similarCount} similar failures`;
  }

  if (p === "guia") {
    const stepHints: Record<string, string> = {
      repair: "Review the failing contract and related task group. The orchestrator detected a pattern that can be resolved by targeted fixes rather than a full replan.",
      replan: "The failure pattern suggests the current approach is not working. A full task replan is recommended to address the root cause rather than iterating on the same approach.",
      escalate: "This failure has persisted through multiple repair and replan cycles. Escalation is required — consider engaging a human reviewer or revising the task structure.",
      continue: "No loop pattern detected; the pipeline can proceed normally.",
    };

    const context =
      phase && taskGroup && failingContract
        ? ` Detected in phase="${phase}", taskGroup="${taskGroup}", contract="${failingContract}".`
        : "";

    return `Loop breaker triggered: ${action} (${similarCount} similar failures). ${stepHints[action] ?? ""}${context}`;
  }

  // pragmatica — concise explanation
  const label = action.charAt(0).toUpperCase() + action.slice(1);
  const context =
    phase && taskGroup
      ? ` (phase=${phase}, taskGroup=${taskGroup}${failingContract ? `, contract=${failingContract}` : ""})`
      : "";

  return `Loop breaker: ${label} after ${similarCount} similar failures${context}`;
}