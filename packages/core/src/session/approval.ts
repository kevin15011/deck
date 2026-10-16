/** Runner-neutral approval scopes. Session grants are owned by Deck, never the runner. */
export type ApprovalScope = "once" | "session" | "always";
export type SessionGrantKind = "exact" | "tool";
export type ApprovalRisk = "normal" | "high";
export type SessionGrant = { grantId: string; kind: SessionGrantKind; toolKey: string; exactKey?: string; risk: ApprovalRisk; createdAt: string };
export type ApprovalResponse = { decision: "allow" | "allow-once" | "deny"; scope?: ApprovalScope; grant?: SessionGrantKind; confirmed?: boolean };
export type ApprovalScopeRequest = { allowedScopes: readonly ApprovalScope[]; toolKey?: string; exactKey?: string; risk: ApprovalRisk };
export type ApprovalScopeValidation = { ok: true; scope: ApprovalScope } | { ok: false; code: "approval-scope-unsupported" | "approval-confirmation-required" };
export const isApprovalScope = (value: unknown): value is ApprovalScope => value === "once" || value === "session" || value === "always";
export const isSessionGrantKind = (value: unknown): value is SessionGrantKind => value === "exact" || value === "tool";
export const isApprovalRisk = (value: unknown): value is ApprovalRisk => value === "normal" || value === "high";
export const isApprovalToolKey = (value: unknown): value is string => typeof value === "string" && value.length <= 256 && /^[^:\s\x00-\x1f\x7f-\x9f]+:[^\s\x00-\x1f\x7f-\x9f]+$/.test(value);
export function validateApprovalResponse(request: ApprovalScopeRequest, response: ApprovalResponse): ApprovalScopeValidation {
  if (response.decision === "deny") return { ok: true, scope: "once" };
  const scope = response.scope ?? "once";
  if (!isApprovalScope(scope) || !request.allowedScopes.includes(scope) || scope === "session" && (!isApprovalToolKey(request.toolKey) || !isSessionGrantKind(response.grant) || response.grant === "exact" && !request.exactKey)) return { ok: false, code: "approval-scope-unsupported" };
  if ((scope === "always" || scope === "session" && response.grant === "tool" && request.risk === "high") && response.confirmed !== true) return { ok: false, code: "approval-confirmation-required" };
  return { ok: true, scope };
}
export function matchesGrant(grant: Pick<SessionGrant, "kind" | "toolKey" | "exactKey">, request: { toolKey?: string; exactKey?: string }): boolean {
  return isApprovalToolKey(grant.toolKey) && grant.toolKey === request.toolKey && (grant.kind === "tool" || grant.kind === "exact" && !!grant.exactKey && grant.exactKey === request.exactKey);
}
