import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";

import {
  DECK_PREPARATION_AUTHORITY_BOUNDARY_V1,
  FINDING_DISPOSITION_AUTHORITY_BOUNDARY_V1,
} from "./readiness-authority";

const EXPECTED_DECK_PREPARATION_AUTHORITY_BOUNDARY_V1 = `## Deck Preparation Authority Boundary

Deck preparation runs once per runner session before work routing and is not an SDD phase. Lead may perform only bounded read-only preparation checks and MUST NOT write project preparation state. When repair is required, Lead MUST issue one exact delegation to \`deck-setup\` for the degraded component. The delegation itself grants no modifying authority. A modifying effect is permitted only when the exact delegation and a trusted process-local Deck preparation authority both validate for the same session, invocation, canonical project-root digest, active runner, component, action, and target set. Caller or prompt data cannot mint, widen, replay, or substitute for that authority. Missing, expired, replayed, mismatched, malformed, revoked, or restarted authority MUST fail closed before the effect, preserve prior valid bytes, and MUST NOT trigger a write fallback. Valid normal preparation requires no routine user approval or pause. \`deck-setup\` MUST NOT install, download, upgrade, invoke package managers, write user-global configuration, call TUI installation actions, mutate Git state, or write centralized SDD \`state.yaml\` or \`events.yaml\`.`;

const EXPECTED_FINDING_DISPOSITION_AUTHORITY_BOUNDARY_V1 = `## Finding Disposition and Baseline Authority Boundary

The sole active cross-role authority orders TARGETED -> AFFECTED_AREA -> independent Review -> mandatory BROAD. Staged verification owns Verify-stage state only; stage-local classification never issues final disposition, readiness, or Archive authority. Every required check MUST execute against the same immutable candidate with independent identity and fresh evidence. A raw finding is non-blocking only when the authoritative baseline-evidence evaluator proves an immutable pre-candidate baseline, the same normalized fingerprint on baseline and candidate under equivalent sanitized environments, causal unrelatedness, no worsening, no protected risk, and a separately authorized durable ledger entry. New, worsened, related, unproven, stale, conflicting, security, authorization, credential or secret, Git-safety, destructive, data-loss, protected migration, public-interface, architecture, generated-output, registry-recovery, freshness, and required-artifact findings remain blocking regardless of age. The same failing run MUST NOT create or authorize the ledger entry that would excuse it. \`passed_with_warnings\` changes disposition only: it never skips, shortens, filters, defers, or relabels mandatory execution, never requires active-session repair or a routine user pause for a fully proven unrelated warning, and never permits progression or Archive with a blocking finding.`;

const FRAGMENTS = [
  {
    actual: DECK_PREPARATION_AUTHORITY_BOUNDARY_V1,
    expected: EXPECTED_DECK_PREPARATION_AUTHORITY_BOUNDARY_V1,
    heading: "## Deck Preparation Authority Boundary",
    sha256: "8dd8cba2908a360587f0884eb8bdde72c6df99f912c2a57a39728dc9503800f8",
  },
  {
    actual: FINDING_DISPOSITION_AUTHORITY_BOUNDARY_V1,
    expected: EXPECTED_FINDING_DISPOSITION_AUTHORITY_BOUNDARY_V1,
    heading: "## Finding Disposition and Baseline Authority Boundary",
    sha256: "4a79b1f56318abefaf8183a8311f6ad19ab82061cc088aa95278445b47bdc3d7",
  },
] as const;

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function composeExactlyOnce(surface: string, fragment: string): string {
  const composed = `${surface}\n\n${fragment}`;
  if (composed.split(fragment).length - 1 !== 1) {
    throw new Error("Authority fragment must be composed exactly once");
  }
  return composed;
}

describe("canonical readiness authority fragments", () => {
  test("exports both fragments with exact text and UTF-8 bytes", () => {
    for (const { actual, expected, heading, sha256: expectedSha256 } of FRAGMENTS) {
      expect(actual).toBe(expected);
      expect(new TextEncoder().encode(actual)).toEqual(new TextEncoder().encode(expected));
      expect(actual.startsWith(`${heading}\n\n`)).toBe(true);
      expect(actual.split("\n\n")).toHaveLength(2);
      expect(actual).not.toContain("${");
      expect(sha256(actual)).toBe(expectedSha256);
    }
  });

  test("rejects one-byte mutation and duplicate composition", () => {
    for (const { actual, sha256: expectedSha256 } of FRAGMENTS) {
      const oneByteMutation = `${actual.slice(0, -1)}!`;
      expect(sha256(oneByteMutation)).not.toBe(expectedSha256);

      expect(composeExactlyOnce("## Surface", actual)).toEndWith(actual);
      expect(() => composeExactlyOnce(actual, actual)).toThrow(
        "Authority fragment must be composed exactly once",
      );
    }
  });
});
