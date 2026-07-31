import { describe, expect, test } from "bun:test";

import { buildAuthoritativeOutcomeV1, reconcileAuthoritativeOutcomesV1 } from "./authoritative-outcome";

const outcome = (overrides = {}) => buildAuthoritativeOutcomeV1({
  schema: "authoritative-outcome-v1",
  subjectDigest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  resultDigest: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  protectedRequirementsDigest: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
  mode: "direct",
  status: "delivered",
  ...overrides,
});

describe("AuthoritativeOutcomeV1 reconciliation", () => {
  test("treats exact repeats as idempotent matches and adopts matching direct delivery without reimplementation", () => {
    const direct = outcome();
    const adopted = reconcileAuthoritativeOutcomesV1({ current: direct, incoming: direct });

    expect(adopted.classification).toBe("matching");
    expect(adopted.idempotent).toBe(true);
    expect(adopted.adoptWithoutReimplementation).toBe(true);
  });

  test("classifies superseding, partial, conflicting, and untracked mode handoffs", () => {
    const current = outcome();
    expect(reconcileAuthoritativeOutcomesV1({ current, incoming: outcome({ resultDigest: "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd", supersedes: current.outcomeId }) }).classification).toBe("superseding");
    expect(reconcileAuthoritativeOutcomesV1({ current, incoming: outcome({ status: "partial" }) }).classification).toBe("partial");
    expect(reconcileAuthoritativeOutcomesV1({ current, incoming: outcome({ resultDigest: "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd" }) }).classification).toBe("conflicting");
    expect(reconcileAuthoritativeOutcomesV1({ current, incoming: outcome({ mode: "full_sdd" }) }).classification).toBe("untracked_mode_handoff");
  });

  test("blocks protected requirements drift even when the delivery result otherwise matches", () => {
    const result = reconcileAuthoritativeOutcomesV1({
      current: outcome(),
      incoming: outcome({ protectedRequirementsDigest: "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd" }),
    });

    expect(result.classification).toBe("conflicting");
    expect(result.blocked).toBe(true);
    expect(result.reasonCodes).toContain("PROTECTED_REQUIREMENTS_DRIFT");
  });
});
