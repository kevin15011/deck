import { expect, test } from "bun:test";

import { buildAuthoritativeOutcomeV1 } from "../contracts/authoritative-outcome";
import { reconcileAuthoritativeOutcomesV1 } from "./outcome-reconciliation";

test("outcome reconciliation exposes idempotent direct adoption without reimplementation", () => {
  const direct = buildAuthoritativeOutcomeV1({
    schema: "authoritative-outcome-v1",
    subjectDigest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    resultDigest: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    protectedRequirementsDigest: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    mode: "direct",
    status: "delivered",
  });

  const reconciliation = reconcileAuthoritativeOutcomesV1({ current: direct, incoming: direct });
  expect(reconciliation).toMatchObject({ classification: "matching", idempotent: true, adoptWithoutReimplementation: true });
});
