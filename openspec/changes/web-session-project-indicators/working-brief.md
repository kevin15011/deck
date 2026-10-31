# Session and project status indicators

Status: implemented and accepted after independent re-review; uncommitted, canary compiled and installed on user request.

## Mobile feedback follow-up

### Discreet project grouping refinement

Completed/installed 2026-10-29, Apply Deep attempt 5. Expanded projects have subtle theme-derived group/header surfaces and a fine session guide; project badges now occupy the same header row as the name. No further sidebar width increase or state/API change. Browser checks at320/390/1024/1440 in light/dark passed, including geometry, names, controls and existing state regressions. Lead inspected mobile-dark and desktop-light captures and matched exact CSS/harness hashes in `/tmp/deck-project-grouping-handoff.md`. Types passed. Affected gate had three timing failures (53 tests passed on isolated file reruns); full7668pass/11skip/2timeouts, both passed isolated. Not a clean broad-gate or baseline-exemption claim. Canary successfully installed; Lead verified0.14.0 c5cbea8 linux-x64 dev. No daemon restart/commit. Physical mobile untested; existing narrow Both-mode subagent card wrapping unchanged.

Latest user correction: the project active-session/activity indicator is currently beneath the project name; it MUST align alongside the project name on the same row, mobile and desktop. This supersedes prior project summary second-row placement. Keep project activity/attention badges on that row with readable names, no wrapping below. Integrate with the discreet expanded/collapsed grouping refinement and preserve session inline layout.

User confirms improved layout and requests subtle visual differentiation between projects, their session sections, and expanded/collapsed state, suggesting background changes. Preserve accepted inline session icons and all behavior. Use theme-derived low-contrast surfaces, modest group spacing and an expanded-state cue with existing chevron; avoid heavy cards, saturation, extra sidebar width or extra controls. Distinguish expansion from selection. Verify mobile/desktop and light/dark themes with mixed open/closed projects, including keyboard focus and existing drag/menu controls. Same navigation owner implements; no new design intake.

Completed and installed 2026-10-29: inline-session CSS plus font-radio correction passed combined production browser acceptance, affected7426/0fail and types. Required full run completed with7667pass/11skip/3 Codex-install timeouts; all three isolated reruns passed under unchanged limits. Lead accepted this documented timing limitation for the local CSS update. Apply Fast attempt5 compiled/installed canary; Lead verified0.14.0 c5cbea8 linux-x64 dev. No daemon restart or commit. Prior second-line layout guidance remains superseded by inline-session user feedback.

User reports session state circle/square below session name alongside attention icon after canary restart. This feedback supersedes the earlier second-status-row placement: place session status indicators alongside the name, keeping independent dimensions and readable labels. Check mobile and desktop actual layout; do not reintroduce severe truncation. Use compact spacing or rebalance nonessential action area instead of stacking indicators below names. Same Apply Deep owner handles navigation/indicator CSS; font owner separately fixes its radio row. Preserve all status semantics and unrelated source edits.

Apply Deep attempt 3: CSS-only inline readiness/name/indicator grid, nonwrapping badges and desktop sidebar +24px (248px) to preserve name space; mobile drawer dimensions retained. Real browser acceptance passed 12 name/width geometry cases at 320/390/1024/1440 plus existing semantic checks. Lead reviewed mobile screenshot and CSS. Physical mobile not exercised. Separate narrow Both-mode Subagents card wrapping remains outside this local correction. Combined final gates and canary rebuild next; no extra semantic review required for this CSS follow-up.

Canary update (2026-10-29): user requested compilation. `bun run canary:install` completed successfully for linux-x64 and installed `/home/kevin15011/.local/bin/deck-canary`. Existing daemon was not restarted.

## Final acceptance

Lead reviewed Quality task `task-151b836f-e239-4e05-9b97-6ba2ddf4f9bd` attempt 2 (result 19517, ended 19518). Independent 162 in-memory assertions, source review, production asset equivalence and all four responsive screenshots support acceptance. Review candidate 3efeab0b7d20749cee9cca10b0708ef1c3909180 differs from implementation candidate b19cf4748307c905b65f4ede6f531cd8105abb49 only in this brief; production/test evidence remains applicable.

Lead closes report findings IND-1 (validated malformed summaries), IND-2 (exact-attempt discarded failure handling), IND-3 (human-blocked Lead waiting), IND-4 (disconnected tab freshness), and IND-5 (readable SVG status rows). These IDs were tracked in reports/this brief, not registered host findings; attempted structured resolution returned finding-unknown, so no host finding closure is claimed.

Final full suite: 7670 passed, 11 skipped, zero failures; affected suite: 7426 passed, 3 skipped, zero failures. Types, real browser indicator/font/pane acceptance and production assets passed. Independent reviewer could not rerun filesystem fixtures/browser due to read-only EROFS; accepted matching implementation integration/browser evidence plus independent in-memory/source review. No claim of physical Safari/iOS/Android testing. No commit, deployment or canary restart performed. Existing unrelated terminal brief preserved.

## Quality review 1: changes required

Apply Deep attempt 2 reports IND-1..5 corrected. Lead reviewed detailed `/tmp/deck-indicators-revision-handoff.md`, actual broad log results and desktop screenshot: SVGs now sit below readable names. Full candidate b19cf4748307c905b65f4ede6f531cd8105abb49: affected 7426 pass / 3 skip / 0 fail, full 7670 pass / 11 skip / 0 fail; types, asset build, font compatibility and indicator browser regressions at four widths passed. No timeout waivers or test retirement. Findings remain pending independent re-review; no acceptance inferred from implementation report alone.

Quality task `task-151b836f-e239-4e05-9b97-6ba2ddf4f9bd` attempt 1, reviewed by Lead with source and screenshot evidence. Open findings:

- IND-1 (P1): validate every project-summary entry, nested counts and requested identity before state updates; malformed/null entries must preserve previous summary as stale and never crash rendering.
- IND-2 (P2): latest failed attempts explicitly discarded/handled must not remain unresolved errors forever. Use exact attempt lifecycle/disposition evidence; do not assume arbitrary completion or integration means recovery.
- IND-3 (P2): a Lead waiting for a human question/approval must show waiting, not execution, in session and project counts; worker activity remains independent.
- IND-4 (P2): Subagents tab must expose stale/unavailable projection on disconnect and stop live execution animation, recovering only with authoritative fresh data.
- IND-5 (visual acceptance): screenshot shows severe name truncation and cryptic tiny Unicode badges. Replace new ad-hoc symbols with consistent compact SVG icons/counts and give names sufficient space, including mobile/sidebar. Preserve independent dimensions, keyboard access, reduced motion and theme contrast. Use a second compact status line or rebalance action space if necessary; do not grow the entire sidebar without need.

Reviewer independently passed compiler/in-memory build and probes; fixture/browser reruns could not start due to EROFS in reviewer environment. Existing screenshot inspected; no independent fresh browser pass claimed. Same Apply Deep owner must fix and provide meaningful regressions, then same Quality task continues fresh for verification. Font/pane implementation remains unchanged.

## Implementation evidence, awaiting independent review

Apply Deep task `task-02c69604-a6cf-455c-ac06-71d1649edfa1` attempt 1 implemented shared worker counts, additive host summaries and authenticated bounded project status transport, connected-only aggregate polling independent of expanded history, freshness-aware session/project displays and matching Subagents tab count. Lead reviewed handoff `/tmp/deck-indicators-handoff.md`, shared/host/UI source and clean diff check. Candidate reported: c5cbea838930139ec1f1b09ef209a255f9ab5a82:bbfb4c686d07285940e43a4420399d6d3fa993b9.

Focused contract/UI checks (18), authenticated transport checks (2), types, production asset build, indicator browser checks, real-host tab checks and font/pane compatibility passed. Full suite: 7662 passed, 11 skipped, 3 timeout failures; all three passed in isolated reruns. This is not a clean full-suite run; no baseline-failure claim, timeout changes or quarantines. Broad affected run predated corrections, with focused invalidated checks subsequently rerun. Independent Quality review is next, including combined visual/function regression and full-gate limitations. No commit or canary restart.

## Accepted refinement and implementation acceptance

The user's latest reply accepts the proposed indicators and restricts project aggregates to connected sessions only. This supersedes earlier all-session aggregate recommendations. Connected uses the existing UI contract: preparationStatus ready, not releasing/removing, and not ended; verify host readiness is equivalent. Do not equate connected with actively executing. Disconnected/closed historical sessions contribute no project counts or alerts. Include connected sessions even when their project is collapsed, never opened or history-paginated out. A failed transport fetch is stale/unknown, not proof that all sessions disconnected.

Add an active-worker count beside the Subagents tab label, consistent with the session worker indicator. Exclude Lead and completed/cancelled/failed attempts; distinguish queued/starting or human-blocked workers from actually executing workers in detail and avoid pretending they are running. Use one documented definition across tab, sidebar and project aggregation. Preserve other independent indicators and accessibility from the accepted proposal.

Implement additive bounded host summaries, freshness-aware project polling, session/project indicators, and the tab count. Preserve authorization and project scope. Tests must cover connected-only inclusion, collapsed/never-opened projects, release/removal, latest attempts, human attention ownership/resolution, freshness/races and independent Lead/worker activity. Run focused checks, browser acceptance, affected/type/full gates per repository policy; independent targeted Quality review is required for the host/web summary contract.

## Reviewed investigation and recommended contract

Investigation task `task-5f6f96b7-e34a-49ae-9b90-c0a4b035ffa6`, attempt 1, reviewed against direct source reads of session-manager summarize, push-attention and main polling. Sidebar summaries expose only current Lead questions/approvals; activeTasks includes Lead. Expanded-only polling and paginated histories cannot satisfy collapsed-project attention. This does not mean worker attention is absent from every client view.

Recommend independent Lead activity, worker count, human attention, unresolved failure and browser unread dimensions. Available means ready to receive work, never objective completion. Keep starting/queued distinct from actual running; lifecycle closing/closed and stale/unknown status must prevent false availability. Pending worker review is internal work, not automatically human attention. Clear attention on resolution, not on viewing a row. A historical failed attempt must not permanently mark a recovered session as broken.

Project attention badge counts affected sessions, with request counts/owners in details; activity remains separately visible. Source all-session project aggregates from host, including never-expanded and paginated-out sessions. Never assert complete/healthy when a summary fails. Do not replay all archived logs every three seconds: design bounded caching/invalidation and transport scope. Cold summarize can open logs, unlike cached status reads. Unread stays per-browser and must not be claimed exhaustive from loaded sessions alone.

The investigation recommendations below are historical context; the accepted refinement above governs implementation. Font/pane work continues independently with its existing owner.

## User intent

Replace the disliked checkmark beside session names and define clear state indicators for Lead activity, Lead availability, human attention from Lead or subagents, and independent subagent activity. Project rows must reflect child-session attention even while collapsed. Identify additional useful cases.

## Proposed direction

Separate independent dimensions: Lead activity/availability, worker activity count, human-required attention, unread replies, and connection/lifecycle freshness. A finished turn is availability, not completion of the user's entire objective. Worker activity must never imply that Lead is running. Unread is not equivalent to a blocking request. Project aggregates preserve attention plus activity rather than selecting one mutually exclusive status. Do not infer idle/healthy from missing, paginated or stale data.

Preserve current sidebar density, palette and typography. Replace persistent success check with quiet availability glyph; use small labeled/count indicators with shape as well as color, accessible descriptions, reduced motion support and details explaining source/reason. Proposal only until source trace establishes reliable inputs.

## Initial evidence

Source reads: apps/web/src/status-indicator.tsx renders completed as an inline SVG path; indicatorState currently prioritizes questions, approvals, running, error, waiting, completed, stopped, idle. apps/web/src/project-navigation.tsx renders session leadActivity plus readiness; project rows currently have no aggregate indicator. These are bounded observations, not a complete lifecycle trace.

Graph project deck generation 2026-08-20T17:25:00Z; symbol query returned zero results. Coverage for both files: not_tracked; apps/web/src no recorded entries, not proof of completeness. Source fallback required. Prior font/pane implementation remains owned by Apply Fast task task-f8243ce9-8c2e-4be9-bd42-6c2e0f7c9dfb; avoid mutations in that work.
