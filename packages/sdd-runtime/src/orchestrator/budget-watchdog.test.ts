import { describe, expect, test } from "bun:test";

import {
  checkBudget,
  type BudgetConfig,
  type BudgetUsage,
  type BudgetCheckResult,
  DEFAULT_BUDGET_CONFIG,
} from "./budget-watchdog";

describe("budget-watchdog", () => {
  describe("checkBudget", () => {
    test("returns within-budget when usage is below soft limit", () => {
      const usage: BudgetUsage = { tokensUsed: 10000, turnsUsed: 3, timeElapsedMs: 30000, toolCallsUsed: 5 };
      const result = checkBudget(usage, DEFAULT_BUDGET_CONFIG);

      expect(result.status).toBe("within_budget");
      expect(result.checkpointRequested).toBe(false);
    });

    test("requests checkpoint at soft budget", () => {
      const config: BudgetConfig = {
        softLimit: { tokens: 40000, turns: 10, timeMs: 120000, toolCalls: 20 },
        hardLimit: { tokens: 60000, turns: 15, timeMs: 180000, toolCalls: 30 },
      };

      const usage: BudgetUsage = { tokensUsed: 41000, turnsUsed: 5, timeElapsedMs: 60000, toolCallsUsed: 10 };
      const result = checkBudget(usage, config);

      expect(result.status).toBe("soft_budget");
      expect(result.checkpointRequested).toBe(true);
    });

    test("hard budget stops execution", () => {
      const config: BudgetConfig = {
        softLimit: { tokens: 40000, turns: 10, timeMs: 120000, toolCalls: 20 },
        hardLimit: { tokens: 60000, turns: 15, timeMs: 180000, toolCalls: 30 },
      };

      const usage: BudgetUsage = { tokensUsed: 65000, turnsUsed: 5, timeElapsedMs: 60000, toolCallsUsed: 10 };
      const result = checkBudget(usage, config);

      expect(result.status).toBe("hard_budget");
      expect(result.mustStop).toBe(true);
    });

    test("hard budget on turns stops execution", () => {
      const usage: BudgetUsage = { tokensUsed: 10000, turnsUsed: 16, timeElapsedMs: 60000, toolCallsUsed: 5 };
      const result = checkBudget(usage, DEFAULT_BUDGET_CONFIG);

      expect(result.status).toBe("hard_budget");
      expect(result.mustStop).toBe(true);
    });

    test("hard budget on time stops execution", () => {
      const usage: BudgetUsage = { tokensUsed: 10000, turnsUsed: 3, timeElapsedMs: 200000, toolCallsUsed: 5 };
      const result = checkBudget(usage, DEFAULT_BUDGET_CONFIG);

      expect(result.status).toBe("hard_budget");
      expect(result.mustStop).toBe(true);
    });

    test("hard budget on tool calls stops execution", () => {
      const usage: BudgetUsage = { tokensUsed: 10000, turnsUsed: 3, timeElapsedMs: 60000, toolCallsUsed: 35 };
      const result = checkBudget(usage, DEFAULT_BUDGET_CONFIG);

      expect(result.status).toBe("hard_budget");
      expect(result.mustStop).toBe(true);
    });

    test("soft budget on multiple dimensions still only requests checkpoint", () => {
      const usage: BudgetUsage = { tokensUsed: 45000, turnsUsed: 11, timeElapsedMs: 60000, toolCallsUsed: 22 };
      const result = checkBudget(usage, DEFAULT_BUDGET_CONFIG);

      expect(result.status).toBe("soft_budget");
      expect(result.mustStop).toBe(false);
      expect(result.checkpointRequested).toBe(true);
    });

    test("generates budget report with usage details", () => {
      const usage: BudgetUsage = { tokensUsed: 65000, turnsUsed: 16, timeElapsedMs: 200000, toolCallsUsed: 35 };
      const result = checkBudget(usage, DEFAULT_BUDGET_CONFIG);

      expect(result.budgetReport).toBeDefined();
      expect(result.budgetReport!.used).toEqual(usage);
      expect(result.budgetReport!.limit).toEqual(DEFAULT_BUDGET_CONFIG.hardLimit);
    });

    // ── New: outcome and breachedDimension tests ──

    test("hard budget emits budget_exceeded outcome", () => {
      const usage: BudgetUsage = { tokensUsed: 65000, turnsUsed: 5, timeElapsedMs: 60000, toolCallsUsed: 10 };
      const result = checkBudget(usage, DEFAULT_BUDGET_CONFIG);

      expect(result.outcome).toBe("budget_exceeded");
    });

    test("hard budget reports breached dimension for tokens", () => {
      const usage: BudgetUsage = { tokensUsed: 65000, turnsUsed: 5, timeElapsedMs: 60000, toolCallsUsed: 10 };
      const result = checkBudget(usage, DEFAULT_BUDGET_CONFIG);

      expect(result.breachedDimension).toBe("tokens");
    });

    test("hard budget reports breached dimension for turns", () => {
      const usage: BudgetUsage = { tokensUsed: 10000, turnsUsed: 16, timeElapsedMs: 60000, toolCallsUsed: 5 };
      const result = checkBudget(usage, DEFAULT_BUDGET_CONFIG);

      expect(result.breachedDimension).toBe("turns");
    });

    test("hard budget reports breached dimension for time", () => {
      const usage: BudgetUsage = { tokensUsed: 10000, turnsUsed: 3, timeElapsedMs: 200000, toolCallsUsed: 5 };
      const result = checkBudget(usage, DEFAULT_BUDGET_CONFIG);

      expect(result.breachedDimension).toBe("time");
    });

    test("hard budget reports breached dimension for tool calls", () => {
      const usage: BudgetUsage = { tokensUsed: 10000, turnsUsed: 3, timeElapsedMs: 60000, toolCallsUsed: 35 };
      const result = checkBudget(usage, DEFAULT_BUDGET_CONFIG);

      expect(result.breachedDimension).toBe("toolCalls");
    });

    test("soft budget does NOT emit budget_exceeded outcome", () => {
      const usage: BudgetUsage = { tokensUsed: 45000, turnsUsed: 5, timeElapsedMs: 60000, toolCallsUsed: 10 };
      const result = checkBudget(usage, DEFAULT_BUDGET_CONFIG);

      expect(result.outcome).toBeUndefined();
      expect(result.breachedDimension).toBeUndefined();
    });

    test("within budget has no outcome or dimension", () => {
      const usage: BudgetUsage = { tokensUsed: 1000, turnsUsed: 1, timeElapsedMs: 1000, toolCallsUsed: 1 };
      const result = checkBudget(usage, DEFAULT_BUDGET_CONFIG);

      expect(result.outcome).toBeUndefined();
      expect(result.breachedDimension).toBeUndefined();
    });
  });
});
