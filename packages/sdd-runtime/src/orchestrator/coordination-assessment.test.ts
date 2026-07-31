import { describe, expect, test } from "bun:test";

import { assessCoordinationV1 } from "./coordination-assessment";

describe("CoordinationAssessmentV1", () => {
  test("treats path mentions and read overlap as advisory rather than exclusive ownership", () => {
    const assessment = assessCoordinationV1({
      work: [
        { id: "explore", reads: ["src/a.ts"], writes: [], mentions: ["src/shared.ts"] },
        { id: "apply", reads: ["src/a.ts", "src/shared.ts"], writes: ["src/b.ts"] },
      ],
    });

    expect(assessment.classification).toBe("advisory");
    expect(assessment.grantsModificationAuthority).toBe(false);
  });

  test("blocks incompatible concurrent writes, stale bases, dirty unattributed bytes, generated conflicts, and registry recovery", () => {
    for (const input of [
      { work: [{ id: "a", writes: ["src/a.ts"] }, { id: "b", writes: ["src/a.ts"] }] },
      { work: [{ id: "a", writes: ["src/a.ts"], base: "one" }, { id: "b", writes: ["src/b.ts"], base: "two" }] },
      { work: [{ id: "a", writes: ["src/a.ts"], unattributedDirtyTargets: ["src/a.ts"] }] },
      { work: [{ id: "a", writes: ["src/a.generated.ts"], generatedTargets: ["src/a.generated.ts"] }, { id: "b", writes: ["src/a.generated.ts"] }] },
      { work: [{ id: "a", writes: ["src/a.ts"] }], registryRecoveryRequired: true },
    ]) {
      expect(assessCoordinationV1(input).classification).toBe("blocking");
    }
  });

  test("identifies unrelated work as independent and explicit ordering as serialized", () => {
    expect(assessCoordinationV1({ work: [{ id: "a", writes: ["a.ts"] }, { id: "b", writes: ["b.ts"] }] }).classification).toBe("independent");
    expect(assessCoordinationV1({ work: [{ id: "a", writes: ["a.ts"] }, { id: "b", writes: ["b.ts"], dependsOn: ["a"] }] }).classification).toBe("serialize");
  });

  test("allows compatible modifying effects in the same file and blocks overlapping incompatible effects", () => {
    const disjoint = assessCoordinationV1({
      work: [
        {
          id: "hero-copy",
          writes: ["landing.tsx"],
          modifyingEffects: [{ target: "landing.tsx", start: 10, end: 20, effectDigest: `sha256:${"a".repeat(64)}` }],
          base: "candidate-1",
        },
        {
          id: "footer-spacing",
          writes: ["landing.tsx"],
          modifyingEffects: [{ target: "landing.tsx", start: 90, end: 100, effectDigest: `sha256:${"b".repeat(64)}` }],
          base: "candidate-1",
        },
      ],
    });
    expect(disjoint.classification).toBe("advisory");
    expect(disjoint.reasonCodes).toContain("COMPATIBLE_SHARED_TARGET:landing.tsx");

    const overlapping = assessCoordinationV1({
      work: [
        {
          id: "a",
          writes: ["landing.tsx"],
          modifyingEffects: [{ target: "landing.tsx", start: 10, end: 30, effectDigest: `sha256:${"a".repeat(64)}` }],
        },
        {
          id: "b",
          writes: ["landing.tsx"],
          modifyingEffects: [{ target: "landing.tsx", start: 20, end: 40, effectDigest: `sha256:${"b".repeat(64)}` }],
        },
      ],
    });
    expect(overlapping.classification).toBe("blocking");
    expect(overlapping.reasonCodes).toContain("INCOMPATIBLE_CONCURRENT_WRITE:landing.tsx");
  });
});
