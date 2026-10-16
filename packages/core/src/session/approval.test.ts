import { expect, test } from "bun:test";
import { matchesGrant, validateApprovalResponse } from "./approval";
const request = { toolKey: "claude:Bash", exactKey: "ls", risk: "high" as const, allowedScopes: ["once", "session", "always"] as const };
test("scope validation keeps legacy once/alias/deny, enforces availability and confirmation", () => {
  for (const decision of ["allow", "allow-once", "deny"] as const) expect(validateApprovalResponse(request, { decision }).ok).toBe(true);
  expect(validateApprovalResponse(request, { decision: "allow", scope: "session", grant: "exact" }).ok).toBe(true);
  expect(validateApprovalResponse(request, { decision: "allow", scope: "session", grant: "tool" })).toEqual({ ok: false, code: "approval-confirmation-required" });
  expect(validateApprovalResponse(request, { decision: "allow", scope: "always" })).toEqual({ ok: false, code: "approval-confirmation-required" });
  for (const scope of ["session", "always"] as const) expect(validateApprovalResponse(request, { decision: "allow", scope, grant: "tool", confirmed: true }).ok).toBe(true);
  expect(validateApprovalResponse({ ...request, allowedScopes: ["once"] }, { decision: "allow", scope: "session", grant: "exact" })).toEqual({ ok: false, code: "approval-scope-unsupported" });
  expect(validateApprovalResponse({ ...request, exactKey: undefined }, { decision: "allow", scope: "session", grant: "exact" })).toEqual({ ok: false, code: "approval-scope-unsupported" });
  expect(validateApprovalResponse(request, { decision: "allow", scope: "session" })).toEqual({ ok: false, code: "approval-scope-unsupported" });
  expect(validateApprovalResponse({ ...request, allowedScopes: ["once"] }, { decision: "deny", scope: "always" })).toEqual({ ok: true, scope: "once" });
  expect(validateApprovalResponse({ ...request, risk: "normal" }, { decision: "allow", scope: "session", grant: "tool" }).ok).toBe(true);
});
test("grant matching requires runner-qualified tool equality and exact keys for exact grants", () => {
  const grant = { kind: "exact" as const, toolKey: "claude:Bash", exactKey: "ls" };
  expect(matchesGrant(grant, request)).toBe(true);
  expect(matchesGrant(grant, { ...request, exactKey: "pwd" })).toBe(false);
  expect(matchesGrant(grant, { ...request, toolKey: "opencode:Bash" })).toBe(false);
  expect(matchesGrant({ ...grant, kind: "tool" }, { ...request, exactKey: "pwd" })).toBe(true);
  expect(matchesGrant({ ...grant, toolKey: "Bash" }, { toolKey: "Bash", exactKey: "ls" })).toBe(false);
});
