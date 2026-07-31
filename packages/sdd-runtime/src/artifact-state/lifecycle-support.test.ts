import { describe, expect, test } from "bun:test";

import { applyGenesisAtomicallyV1, planLegacyGenesisV1 } from "../contracts/legacy-genesis";
import { selectSessionChangeV1 } from "../contracts/session-change-selection";

describe("legacy genesis and session selection", () => {
  test("plans legacy genesis from observed artifacts without fabricating events", async () => {
    const plan = planLegacyGenesisV1({
      changeId: "legacy", placement: "changes", artifacts: [{ path: "proposal.md", source: "proposal" }],
      stateSource: "currentPhase: proposal\nstatus: in_progress\n", eventsSource: undefined,
    });
    expect(plan.observedEvents).toEqual([]);
    expect(plan.artifacts[0]?.digest).toMatch(/^sha256:/);
    let calls = 0;
    await applyGenesisAtomicallyV1(plan, { acceptPlanDigest: plan.digest, commit: async () => { calls++; } });
    expect(calls).toBe(1);
  });

  test("selects explicit ID, then binding, then a unique eligible active record", () => {
    const records = [
      { changeId: "active", lifecycle: "active" as const },
      { changeId: "archived", lifecycle: "terminal" as const },
    ];
    const explicit = selectSessionChangeV1(records, { explicitChangeId: "active" });
    expect(explicit.source).toBe("explicit");
    if (explicit.source === "none") throw new Error("expected explicit selection");
    expect(explicit.changeId).toBe("active");
    expect(selectSessionChangeV1(records, { sessionChangeId: "active" }).source).toBe("session-binding");
    const fallback = selectSessionChangeV1(records, {});
    if (fallback.source === "none") throw new Error("expected active fallback");
    expect(fallback.changeId).toBe("active");
    const ambiguous = selectSessionChangeV1([...records, { changeId: "second", lifecycle: "active" as const }], {});
    if (ambiguous.source !== "none") throw new Error("expected ambiguity");
    expect(ambiguous.reason).toBe("ambiguous-active");
  });
});
