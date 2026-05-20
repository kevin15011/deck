/**
 * Runner pipeline — wires recovery classifier → budget check → state manager.
 */

import {
  classifyTransportFailure,
  attemptResume,
  DEFAULT_RECOVERY_CONFIG,
  type TransportFailureContext,
  type ArtifactValidationResult,
  type RecoveryConfig,
  type FailureClassification,
} from "./runner-recovery";
import { checkBudget, DEFAULT_BUDGET_CONFIG, type BudgetConfig, type BudgetUsage } from "../orchestrator/budget-watchdog";

// ── Input ──

export interface RunnerPipelineInput {
  transportContext: TransportFailureContext;
  artifactValidation: ArtifactValidationResult;
  budgetUsage?: BudgetUsage;
}

// ── Result ──

export interface RunnerPipelineResult {
  classification: FailureClassification;
  resumed: boolean;
  retryAllowed: boolean;
  budgetStatus?: string;
  budgetReport?: { used: BudgetUsage; limit: unknown };
  /** When hard budget overrides, this is set */
  budgetOutcome?: "budget_exceeded";
  /** Which dimension triggered the hard budget breach */
  breachedDimension?: "tokens" | "turns" | "time" | "toolCalls";
}

// ── Config ──

export interface RunnerPipelineConfig {
  recoveryConfig: RecoveryConfig;
  budgetConfig: BudgetConfig;
}

export const DEFAULT_RUNNER_PIPELINE_CONFIG: RunnerPipelineConfig = {
  recoveryConfig: DEFAULT_RECOVERY_CONFIG,
  budgetConfig: DEFAULT_BUDGET_CONFIG,
};

// ── Pipeline ──

export function runRunnerPipeline(
  input: RunnerPipelineInput,
  config: RunnerPipelineConfig = DEFAULT_RUNNER_PIPELINE_CONFIG,
): RunnerPipelineResult {
  // 1. Budget check FIRST — hard budget overrides all continuation
  if (input.budgetUsage) {
    const budgetCheck = checkBudget(input.budgetUsage, config.budgetConfig);
    if (budgetCheck.status === "hard_budget") {
      // Hard budget: stop immediately, do NOT resume or retry
      return {
        classification: "budget_exhausted",
        resumed: false,
        retryAllowed: false,
        budgetStatus: budgetCheck.status,
        budgetReport: budgetCheck.budgetReport,
        budgetOutcome: budgetCheck.outcome,
        breachedDimension: budgetCheck.breachedDimension,
      };
    }
  }

  // 2. Classify transport failure
  const failureResult = classifyTransportFailure(input.transportContext);

  // 3. Attempt resume (now validates artifact independently)
  const resumeResult = attemptResume(
    failureResult,
    input.artifactValidation,
    config.recoveryConfig,
  );

  // 4. Soft budget status (only if not hard)
  let budgetStatus: string | undefined;
  let budgetReport: { used: BudgetUsage; limit: unknown } | undefined;
  if (input.budgetUsage) {
    const budgetCheck = checkBudget(input.budgetUsage, config.budgetConfig);
    budgetStatus = budgetCheck.status;
    if (budgetCheck.budgetReport) {
      budgetReport = budgetCheck.budgetReport;
    }
  }

  return {
    classification: failureResult.classification,
    resumed: resumeResult.resumed,
    retryAllowed: resumeResult.retryAllowed,
    budgetStatus,
    budgetReport,
  };
}
