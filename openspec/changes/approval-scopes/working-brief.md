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

## Addendum: review fixes (match identity vs display key)

An independent review found that exact grants were matched on the DISPLAY key (redacted and truncated), so distinct actions collapsed into one grant (cwd ignored, secrets redacted into equality, commands cut at 512, OpenCode patterns merged by space), that Codex MCP grants ignored the tool name, and that credentialed URLs were stored. Rules from now on:

1. **Display key vs match identity.** `exactKey` is DISPLAY ONLY (redacted, shown in UI, bounded to 512). Matching uses a separate full-fidelity `identity`.
2. `DriverApprovalRequest` gains `identity?: string`: the full canonical, UNREDACTED identity of the action (in memory only; bounded 16 KiB; never emitted, logged or persisted raw). It must include everything that makes the action distinct: Bash/command => command string AND cwd; file ops => normalized absolute path (cwd-resolved); MCP tools => canonical JSON (sorted keys) of the FULL arguments; OpenCode => canonical JSON array of the patterns (no space-joining); URL => the full URL. Drivers also pass `exactKey` as the FULL redacted display string (up to 4096) and the broker bounds it.
3. The broker derives `matchKey = HMAC-SHA256(sessionKey, toolKey + "\0" + identity)` (hex). `sessionKey` is a random per-session secret kept in the session's private store (0600), created on first use and reloaded after restart, never emitted. Exact grants store and compare `matchKey` (plus `toolKey`); `session.grant` events carry `matchKey` (not the identity); summaries/UI never show it. A request without `identity` never offers an exact session grant.
4. **Truncation rule:** if the redacted display key had to be shortened to 512 characters the request carries `exactKeyTruncated: true`, and its `allowedScopes` EXCLUDES the exact session grant and 'always' (the user could not see the whole action); only once, "any use of tool" (with its confirmation for high risk) and deny remain. The UI shows a visible "Shortened — the full action is not displayed" badge and, where the full `input` is available in the event, an expandable full view.
5. **Tool grants** compare `toolKey` only; toolKeys must be as specific as the authorization shown to the user: Codex MCP approvals => `codex:mcp:<serverName>:<toolName>`; OpenCode => `opencode:<permission>`; Claude => `claude:<tool_name>` (MCP tool names already include server and tool).
6. **Redaction:** the core redaction used for summary, input, exactKey and diagnostics must also redact URL userinfo (`scheme://user:pass@host` => `scheme://[redacted]@host`) and credential-looking query parameters (token, access_token, api_key, key, secret, password, sig, signature, auth). Applies to approval.requested summary/input/exactKey and to session.grant events.
7. Web: grants are cleared from the UI state on `session.released` (and ended/removed); the permission card makes any shortened display obvious.


## Verification checkpoint (2026-10-16)

Status: implemented and independently approved for the bounded review-fix scope; repository-wide typecheck remains blocked by the recorded unrelated error. The addendum supersedes the original display-key matching descriptions above. Session grants and their HMAC match keys persist in Deck's private ledger; a private 0600 per-session key supports restart matching. No runner policy is written for session grants. Historical exact grants without match keys require a new grant.

Recovered implementation evidence: backend owner reported 539 session-host tests, 74 core session tests, 1903 full core tests under Bun 1.3.12, schema generation and 14 CLI session command tests passing. Web unit log reports 109 passing tests. All seven browser acceptance suites pass: approvals, questions, YOLO, ordering/motion, status, subagents, and workspace. Workspace was completed on resume against freshly compiled assets (17 checks, exit 0); the six successful prior runs were retained. Evidence: `/tmp/deck-scopes-review-*-final.log`.

Fresh lead integration check: `bun test packages/session-host/src/__tests__/bridge.test.ts packages/adapter-codex/src/session-driver/driver.test.ts packages/adapter-opencode/src/session-driver/driver.test.ts` passed 197 tests, resolving the bridge owner's three backend-dependent failures. `git diff --check` passed.

Fresh `bunx tsc --noEmit` still reports only TS2322 at `apps/cli/src/pi-client-proof.ts:187` (string or undefined passed to a scalar setting). The file is unchanged from base f4562ee; the same diagnostic exists in the prior implementation logs. The baseline ledger's green typecheck does not describe this branch's current state; no clean repository typecheck is claimed.

Continuation incident: original web and quality native contexts each failed twice before execution with codex-startup-failed and codex-rpc-invalid-frame. Replacement tasks retain the same member roles and receive the original scope/evidence: web task-b3080b3b-abdc-4f66-aed8-2645d00fc5f2; quality task-70aef816-3bff-4e6a-a0fe-c2a034ebe8b0. Graph MCP tools are unavailable in this runner; source/test evidence is used without graph coverage claims. Native inference and Codex/OpenCode persistent-policy behavior remain unverified.

### Independent review follow-up

The replacement reviewer closed findings 1–4 and 7, but retained URL redaction and visually clipped command tails, and identified missing trusted cwd in Claude's exact identity. Additional acceptance requirements:

- URL redaction covers full userinfo containing multiple `@` characters and percent-encoded sensitive query parameter names; regression evidence must include persisted events.
- Approval cards display the whole bounded action even below the 512-character transport limit, including narrow layouts; CSS clipping must not hide the action being authorized.
- Claude exact grants require trusted effective execution context for cwd-dependent actions. When unavailable, omit exact identity for shell commands and relative file paths rather than guessing the project directory. Once and confirmed tool-wide approvals remain available. Context-independent full MCP argument identities remain supported.

Quality evidence: `/tmp/scopes-replacement-manager.test.ts`, `/tmp/scopes-replacement-bridge.test.ts`, `/tmp/scopes-replacement-visual.ts`. These are targeted follow-ups on the current candidate; independent closure is pending.

Follow-up implementation evidence: redaction tests 30/30; persisted URL regression tests 3/3 (both new defects reproduced before the fix); bridge tests 48/48 with cwd-dependent exact grants suppressed; approval browser regression reproduced clipping before the CSS fix, then passed at 320, 390, and 1440px along with the affected approval acceptance suite. Unchanged acceptance suites retain their preceding successful evidence. Re-review is limited to these three follow-ups. Existing historical leaked events are not rewritten by the redaction change.


## Final result (2026-10-16)

Independent quality task `task-70aef816-3bff-4e6a-a0fe-c2a034ebe8b0`, attempt 2: **PASS**. All remaining findings closed, no additional blocking regression in affected deltas. Independent closure checks passed 19 adapted scratch tests, 30 redaction tests, and three Chromium layout checks at 320, 390, and 1440px without horizontal overflow. Source was unchanged throughout re-review. Screenshot: `/tmp/scopes-closure-card-mobile.png`.

The final typecheck still reports only the previously recorded `pi-client-proof.ts:187` TS2322; no clean typecheck or native-policy persistence verification is claimed. Seven browser acceptance suites have successful evidence, with approval acceptance rerun after the final UI change. This closes the review-fix implementation, not a release or merge authorization.
