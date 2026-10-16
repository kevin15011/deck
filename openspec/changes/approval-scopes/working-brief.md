# Approval scopes (allow once / for this session / always)

## Intent and acceptance

Permission requests offer more than "allow once": **Allow once**, **Allow for this session** (Deck-owned, two breadths: this exact action, or any use of this tool) and **Always allow** (only where the runner can persist it natively, behind an explicit confirmation naming where it is stored), plus **Deny**. Session grants are visible and revocable. Labels promise only what really happens.

## Decisions (user-approved)

1. "For this session" is implemented by Deck, not by each runner. A session grant lives in the session (rebuilt from the ledger), is matched by Deck, and auto-answers equivalent requests with a plain once-allow to the runner, so it behaves identically on Claude, Codex and OpenCode, survives the per-turn native process, and writes nothing to disk.
2. Breadth: `exact` (this exact action: same toolKey and same exactKey) or `tool` (any use of that toolKey). A `tool` grant for a `risk: "high"` tool needs an explicit server-validated confirmation.
3. "Always" only where the runner supports it natively: OpenCode (`reply: "always"`) and Codex (`acceptWithExecpolicyAmendment` when the request proposes an amendment). Never for Claude (it would mean writing settings files). Always requires an explicit confirmation naming where it is stored.

## Contract

Types (new core module packages/core/src/session/approval.ts):
- `ApprovalScope = "once" | "session" | "always"`; `SessionGrantKind = "exact" | "tool"`; `ApprovalRisk = "normal" | "high"`.
- `approval.requested` data adds: `allowedScopes: ApprovalScope[]` (always includes "once"; includes "session" when `toolKey` is present; "always" only when the runner supports native persistence for this request), `toolKey: string` (runner-qualified normalized tool id: `claude:Bash`, `codex:commandExecution`, `codex:fileChange`, `codex:permissions`, `opencode:bash`, ...), `exactKey?: string` (normalized key of this exact action: command line / file path / patterns; bounded <= 512 chars; redacted), `risk: ApprovalRisk` (high for shell/command execution, file writes/edits/patches, network fetch), `alwaysNote?: string` (truthful runner-specific text for the confirmation; only when "always" allowed).
- `approval.respond` command: `{ approvalId, decision: "allow" | "allow-once" | "deny", scope?: ApprovalScope, grant?: SessionGrantKind, confirmed?: boolean }`. Rules: scope absent => once; scope "session" requires an allow decision and `grant` ("exact" requires the request to have `exactKey`); scope "always" requires "always" in the request's `allowedScopes`; `confirmed === true` is REQUIRED for scope "always" and for scope "session" with grant "tool" when `risk === "high"`, else the command is rejected with `approval-confirmation-required` (the approval stays pending); an unsupported scope is rejected `approval-scope-unsupported`; deny ignores scope.
- `approval.resolved` data adds `scope` and, for auto-approvals, `auto: true` and `by: "session-grant:<grantId>"`.
- New event `session.grant` data `{ action: "added" | "revoked", grantId, kind, toolKey, exactKey?, risk, by, approvalId? }` (ledger-replayed; grants are rebuilt from these events on reattach/restart; cleared when the session ends or is removed). New command `session.revokeGrant { grantId }`.
- Session summaries and sessions.status rows add `grants: { grantId, kind, toolKey, exactKey?, risk, createdAt }[]` (bounded, <= 100).
- Matching: a grant matches a request when the runnerId-qualified `toolKey` is equal, and for `exact` grants also `exactKey` equal. Never across runners. Applies to every member's turns (Lead and subagents) in that session. On a match the broker emits `approval.requested` followed immediately by `approval.resolved` (auto) so the audit trail and UI show it, and replies to the driver with a once-allow.
- Driver contract (core driver.ts): `DriverApprovalRequest` gains `toolKey`, `exactKey?`, `risk`, `nativeScopes?: ("always")[]` and `alwaysNote?`; `DriverDecision` gains `scope?: "once" | "always"` (the host maps "session" to once; session grants are Deck-side). Drivers ignore unknown scopes and fall back to once.

## Runner mappings (verified from installed Claude 2.1.301, Codex 0.162.1, OpenCode 1.19.1)

- Claude (via deck_approve, bridge-service.ts approve()): native scopes none; only once and deny (`{behavior:"allow",updatedInput}` / `{behavior:"deny",message}`). toolKey `claude:<tool_name>`; exactKey from input (Bash command, file_path, url, MCP tool name+args digest). Never send `updatedPermissions` or any settings destination.
- Codex: `item/commandExecution/requestApproval` decisions `accept` | `acceptForSession` | `{acceptWithExecpolicyAmendment:{execpolicy_amendment:[...]}}` | `decline` | `cancel`; the request carries `command`, `cwd`, `proposedExecpolicyAmendment`. Map once => `accept`; always => the amendment decision when `proposedExecpolicyAmendment` is present (else not offered); deny => `decline`. NEVER send `acceptForSession` (session is Deck-side; its survival across per-turn processes is unverified). `item/fileChange/requestApproval`: once `accept`, deny `decline`. Fix the current gap: `item/permissions/requestApproval` (params `{cwd, permissions, reason}`) is unhandled and answered with -32601; handle it: allow once => `{permissions:<requested subset>, scope:"turn"}`, deny => `{permissions:{}}`; toolKey `codex:permissions`, risk high. alwaysNote for Codex: the command prefix is added to Codex's exec-policy rules on this machine and applies to future sessions.
- OpenCode: `POST /permission/{id}/reply {reply:"once"|"always"|"reject"}`; request has `permission`, `patterns[]`, `always[]`, `metadata`. once => "once", always => "always", deny => "reject". alwaysNote: OpenCode stores the permission for this project on this machine, outside Deck; it applies to future sessions and Deck cannot revoke it. toolKey `opencode:<permission>`; exactKey = patterns joined.

## UI (apps/web)

Approval card buttons: **Allow once**, **Allow for this session** (menu: "This exact action" when exactKey exists / "Any use of <tool>" with a warning when risk is high and a required confirmation), **Always allow…** (only when allowed; confirmation dialog quoting `alwaysNote`, naming the exact tool/pattern verbatim), **Deny**. Show the tool + pattern verbatim, never just "Allow Bash". Auto-approved requests show "Auto-approved (session permission)". The session controls list active session permissions with a Revoke button.

## Risks

Session grants live only in Deck; broad `tool` grants on high-risk tools are dangerous (confirmation required); Codex/OpenCode "always" write outside Deck and cannot be revoked from Deck; OpenCode persistence location is unverified (wording says "stored by OpenCode on this machine").
