/**
 * Budget watchdog — configurable time/token/turn thresholds;
 * soft→checkpoint prompt, hard→stop with budget-exceeded outcome.
 */

// ── Config ──

export interface BudgetLimits {
  tokens: number;
  turns: number;
  timeMs: number;
  toolCalls: number;
}

export interface BudgetConfig {
  softLimit: BudgetLimits;
  hardLimit: BudgetLimits;
}

export const DEFAULT_BUDGET_CONFIG: BudgetConfig = {
  softLimit: { tokens: 40000, turns: 10, timeMs: 120000, toolCalls: 20 },
  hardLimit: { tokens: 60000, turns: 15, timeMs: 180000, toolCalls: 30 },
};

// ── Usage ──

export interface BudgetUsage {
  tokensUsed: number;
  turnsUsed: number;
  timeElapsedMs: number;
  toolCallsUsed: number;
}

// ── Result ──

export type BudgetStatus = "within_budget" | "soft_budget" | "hard_budget";

export interface BudgetReport {
  used: BudgetUsage;
  limit: BudgetLimits;
}

export interface BudgetCheckResult {
  status: BudgetStatus;
  checkpointRequested: boolean;
  mustStop: boolean;
  budgetReport?: BudgetReport;
  /** Machine-readable outcome for hard budget breach */
  outcome?: "budget_exceeded";
  /** Which dimension triggered the hard breach */
  breachedDimension?: "tokens" | "turns" | "time" | "toolCalls";
}

// ── Check ──

function checkHardBreach(
  usage: BudgetUsage,
  hard: BudgetLimits,
): { breached: boolean; dimension?: "tokens" | "turns" | "time" | "toolCalls" } {
  if (usage.tokensUsed >= hard.tokens) return { breached: true, dimension: "tokens" };
  if (usage.turnsUsed >= hard.turns) return { breached: true, dimension: "turns" };
  if (usage.timeElapsedMs >= hard.timeMs) return { breached: true, dimension: "time" };
  if (usage.toolCallsUsed >= hard.toolCalls) return { breached: true, dimension: "toolCalls" };
  return { breached: false };
}

export function checkBudget(
  usage: BudgetUsage,
  config: BudgetConfig,
): BudgetCheckResult {
  const hard = checkHardBreach(usage, config.hardLimit);

  if (hard.breached) {
    return {
      status: "hard_budget",
      checkpointRequested: false,
      mustStop: true,
      budgetReport: { used: usage, limit: config.hardLimit },
      outcome: "budget_exceeded",
      breachedDimension: hard.dimension,
    };
  }

  const softBreached =
    usage.tokensUsed >= config.softLimit.tokens ||
    usage.turnsUsed >= config.softLimit.turns ||
    usage.timeElapsedMs >= config.softLimit.timeMs ||
    usage.toolCallsUsed >= config.softLimit.toolCalls;

  if (softBreached) {
    return {
      status: "soft_budget",
      checkpointRequested: true,
      mustStop: false,
    };
  }

  return {
    status: "within_budget",
    checkpointRequested: false,
    mustStop: false,
  };
}
