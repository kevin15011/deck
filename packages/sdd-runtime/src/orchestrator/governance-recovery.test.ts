import { describe, expect, test } from "bun:test";

import { evaluateGovernanceRecoveryV1 } from "./governance-recovery";

const repair = (overrides = {}) => ({
  governanceOracleBroken: true,
  separatelyAuthorizedRepair: true,
  repairTargetsOnlyGovernanceOracle: true,
  containsProductWork: false,
  suppressesProtectedFindings: false,
  canonicalValidationWillRerun: true,
  ...overrides,
});

describe("GovernanceRecoveryDecisionV1", () => {
  test("permits only an exact, separately authorized repair of a broken governance oracle", () => {
    const decision = evaluateGovernanceRecoveryV1(repair());
    expect(decision.decision).toBe("permit");
    expect(decision.grantsProductModificationAuthority).toBe(false);
    expect(decision.requiredActions).toContain("RERUN_CANONICAL_VALIDATION");
  });

  test("blocks product work, protected-finding suppression, missing authority, and skipped canonical validation", () => {
    for (const overrides of [
      { containsProductWork: true },
      { suppressesProtectedFindings: true },
      { separatelyAuthorizedRepair: false },
      { canonicalValidationWillRerun: false },
    ]) {
      expect(evaluateGovernanceRecoveryV1(repair(overrides)).decision).toBe("block");
    }
  });
});
