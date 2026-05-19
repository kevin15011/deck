import { describe, expect, test } from "bun:test";

import type { AdaptiveMemoryCandidate } from "./adaptive-memory-contract";
import {
  createAdaptiveMemoryCommitAudit,
  validateAdaptiveMemoryCandidate,
  validateAdaptiveMemoryCommitRequest,
  validateAdaptiveMemoryMetadata,
  validateAdaptiveMemoryScope,
  validateAdaptiveMemorySearchFilters,
  validateContainerTag,
  validateForbiddenMemoryContent,
  validateTeamCandidatePromotion,
} from "./adaptive-memory-governance";

function candidate(overrides: Partial<AdaptiveMemoryCandidate> = {}): AdaptiveMemoryCandidate {
  return {
    content: "User explicitly prefers concise verification summaries.",
    containerTag: "u:user-1",
    highSignal: true,
    scope: { scope: "personal", userId: "user-1" },
    metadata: {
      source: "preference",
      scope: "personal",
      type: "preference",
      confidence: 0.9,
      createdBy: "user",
    },
    ...overrides,
  };
}

function issueCodes(result: { issues: readonly { code: string }[] }): string[] {
  return result.issues.map((issue) => issue.code);
}

describe("adaptive memory governance", () => {
  test("REQ-AMG-001 validates separated personal/project/team/org scopes", () => {
    expect(validateAdaptiveMemoryScope({ scope: "personal", userId: "u" }).valid).toBe(true);
    expect(validateAdaptiveMemoryScope({ scope: "project", projectId: "p" }).valid).toBe(true);
    expect(validateAdaptiveMemoryScope({ scope: "team", teamId: "t" }).valid).toBe(true);
    expect(validateAdaptiveMemoryScope({ scope: "org", orgId: "o" }).valid).toBe(true);

    expect(issueCodes(validateAdaptiveMemoryScope({ scope: "team" }))).toContain(
      "ADAPTIVE_MEMORY_INVALID_SCOPE",
    );
  });

  test("REQ-AMG-002 and REQ-AMG-003 reject invalid global or oversized container tags", () => {
    expect(validateContainerTag("u:user-1:p:project-1").valid).toBe(true);
    expect(issueCodes(validateContainerTag("global memory bucket"))).toContain(
      "ADAPTIVE_MEMORY_INVALID_CONTAINER_TAG",
    );
    expect(issueCodes(validateContainerTag("a".repeat(101)))).toContain(
      "ADAPTIVE_MEMORY_INVALID_CONTAINER_TAG",
    );
  });

  test("REQ-AMG-004 requires source, scope, type, confidence, and creator metadata", () => {
    expect(validateAdaptiveMemoryMetadata(candidate().metadata).valid).toBe(true);

    const result = validateAdaptiveMemoryMetadata({ scope: "personal", confidence: Number.NaN });
    expect(issueCodes(result)).toContain("ADAPTIVE_MEMORY_METADATA_REQUIRED");
    expect(issueCodes(result)).toContain("ADAPTIVE_MEMORY_CONFIDENCE_INVALID");
  });

  test("REQ-AMG-005 accepts high-signal candidates and rejects low-signal candidates", () => {
    expect(validateAdaptiveMemoryCandidate(candidate()).valid).toBe(true);

    const result = validateAdaptiveMemoryCandidate(candidate({ highSignal: false }));
    expect(issueCodes(result)).toContain("ADAPTIVE_MEMORY_LOW_SIGNAL");
  });

  test("REQ-AMG-006 limits session commits to no more than seven learnings", () => {
    const result = validateAdaptiveMemoryCommitRequest({
      candidates: Array.from({ length: 8 }, (_, index) =>
        candidate({ containerTag: `u:user-1:${index}` }),
      ),
    });

    expect(issueCodes(result)).toContain("ADAPTIVE_MEMORY_COMMIT_LIMIT_EXCEEDED");
  });

  test("REQ-AMG-007 rejects forbidden content categories", () => {
    const forbiddenSamples = [
      "active spec content should remain in OpenSpec",
      "raw chat transcript from the session",
      "secret API key token value",
      "sensitive code snippet",
      "unapproved requirement experimental delta",
      "Engram migration payload",
    ];

    for (const sample of forbiddenSamples) {
      expect(issueCodes(validateForbiddenMemoryContent(sample))).toContain(
        "ADAPTIVE_MEMORY_FORBIDDEN_CONTENT",
      );
    }
  });

  test("REQ-AMG-008 requires team-scoped memories to remain candidates unless explicitly approved", () => {
    const teamMetadata = {
      ...candidate().metadata,
      scope: "team" as const,
      promotionStatus: "approved" as const,
    };

    expect(issueCodes(validateTeamCandidatePromotion(teamMetadata))).toContain(
      "ADAPTIVE_MEMORY_TEAM_CANDIDATE_REQUIRED",
    );
    expect(validateTeamCandidatePromotion(teamMetadata, { explicitlyApproved: true }).valid).toBe(true);
    expect(
      validateTeamCandidatePromotion({ ...teamMetadata, promotionStatus: "candidate" }).valid,
    ).toBe(true);
  });

  test("REQ-AMG-009 validates scope/container/metadata filters before recall", () => {
    expect(
      validateAdaptiveMemorySearchFilters({
        scopes: [{ scope: "personal", userId: "user-1" }],
        containerTags: ["u:user-1"],
        metadata: { scope: "personal", type: "preference" },
      }).valid,
    ).toBe(true);

    const result = validateAdaptiveMemorySearchFilters({
      scopes: [{ scope: "org" }],
      containerTags: ["invalid tag with spaces"],
    });

    expect(issueCodes(result)).toContain("ADAPTIVE_MEMORY_SEARCH_FILTER_INVALID");
  });

  test("REQ-AMG-010 creates audit information without exposing memory content", () => {
    const candidates = [
      candidate({ content: "first sensitive implementation preference" }),
      candidate({ content: "second sensitive implementation preference", containerTag: "u:user-1:2" }),
    ];

    const audit = createAdaptiveMemoryCommitAudit(candidates, new Set([0]), new Map([[1, "low signal"]]));

    expect(audit.savedCount).toBe(1);
    expect(audit.discardedCount).toBe(1);
    expect(audit.decisions).toEqual([
      { accepted: true, scope: "personal", source: "preference", reason: "accepted" },
      { accepted: false, scope: "personal", source: "preference", reason: "low signal" },
    ]);
    expect(JSON.stringify(audit)).not.toContain("sensitive implementation preference");
  });
});
