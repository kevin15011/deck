export type SessionSelectableLifecycleV1 = "active" | "parked" | "terminal" | "malformed";
export interface SessionChangeCandidateV1 { readonly changeId: string; readonly lifecycle: SessionSelectableLifecycleV1; }
export type SessionChangeSelectionV1 =
  | { readonly source: "explicit" | "session-binding" | "unique-active"; readonly changeId: string }
  | { readonly source: "none"; readonly reason: "not-found" | "ineligible" | "ambiguous-active" | "no-eligible-active" };

export function selectSessionChangeV1(records: readonly SessionChangeCandidateV1[], input: { readonly explicitChangeId?: string; readonly sessionChangeId?: string }): SessionChangeSelectionV1 {
  const choose = (changeId: string, source: "explicit" | "session-binding"): SessionChangeSelectionV1 => {
    const candidate = records.find((record) => record.changeId === changeId);
    return !candidate ? { source: "none", reason: "not-found" } : candidate.lifecycle !== "active" ? { source: "none", reason: "ineligible" } : { source, changeId };
  };
  if (input.explicitChangeId) return choose(input.explicitChangeId, "explicit");
  if (input.sessionChangeId) return choose(input.sessionChangeId, "session-binding");
  const active = records.filter((record) => record.lifecycle === "active");
  return active.length === 1 ? { source: "unique-active", changeId: active[0]!.changeId } : { source: "none", reason: active.length ? "ambiguous-active" : "no-eligible-active" };
}
