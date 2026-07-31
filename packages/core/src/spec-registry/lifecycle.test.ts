import { describe, expect, test } from "bun:test";

import {
  classifySemanticLifecycleV1,
  discoverRegistryLifecycleV1,
  planRegistryReconciliationV1,
} from "./lifecycle";

describe("semantic registry lifecycle", () => {
  test("classifies terminal state semantically, independent of placement", () => {
    expect(classifySemanticLifecycleV1({ currentPhase: "archive", status: "archived" })).toBe("terminal");
    expect(classifySemanticLifecycleV1({ currentPhase: "closed", status: "superseded" })).toBe("terminal");
    expect(classifySemanticLifecycleV1({ currentPhase: "closed", status: "incomplete" })).toBe("terminal");
    expect(classifySemanticLifecycleV1({ currentPhase: "apply", status: "in_progress" })).toBe("active");
    expect(classifySemanticLifecycleV1({ currentPhase: "apply", status: "parked" })).toBe("parked");
    expect(classifySemanticLifecycleV1({ currentPhase: "closed", status: "completed" })).toBe("malformed");
  });

  test("groups discovery and reports duplicate IDs rather than preferring changes", () => {
    const discovery = discoverRegistryLifecycleV1([
      { changeId: "terminal-in-changes", placement: "changes", state: { currentPhase: "archive", status: "archived" } },
      { changeId: "active", placement: "changes", state: { currentPhase: "apply", status: "in_progress" } },
      { changeId: "dup", placement: "changes", state: { currentPhase: "apply", status: "in_progress" } },
      { changeId: "dup", placement: "archive", state: { currentPhase: "archive", status: "archived" } },
    ]);

    expect(discovery.groups.terminal.map((record) => record.changeId)).toContain("terminal-in-changes");
    expect(discovery.groups.active.map((record) => record.changeId)).toEqual(["active"]);
    expect(discovery.placementDiagnostics).toContainEqual(expect.objectContaining({ code: "terminal-in-changes" }));
    expect(discovery.placementDiagnostics).toContainEqual(expect.objectContaining({ code: "duplicate-change-id", changeId: "dup" }));
    expect(discovery.records.find((record) => record.changeId === "dup")?.lifecycle).toBe("malformed");
  });

  test("makes reconciliation a read-only discovery-digest-bound plan", () => {
    const discovery = discoverRegistryLifecycleV1([
      { changeId: "stale", placement: "archive", state: { currentPhase: "apply", status: "in_progress" } },
    ]);
    const plan = planRegistryReconciliationV1(discovery);
    expect(plan.schema).toBe("registry-reconciliation-plan-v1");
    expect(plan.discoveryDigest).toBe(discovery.digest);
    expect(plan.actions).toContainEqual(expect.objectContaining({ changeId: "stale", kind: "review-placement" }));
  });
});
