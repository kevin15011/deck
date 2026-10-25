# Git diff and workspace layout — working design

Approved product contract: proposal.md. Status: implementation brief; concrete source decisions and verification evidence will be reconciled after candidate review.

## Boundaries

The session host owns bounded read-only Git access resolved from the authorized session project/worktree, behind existing authenticated web API patterns. The browser receives a file catalog and requested file diff, never an unrestricted shell or arbitrary filesystem API. Preserve ordinary unstaged (index to worktree) and staged (HEAD to index) semantics; non-ignored untracked files are explicitly new. Do not add session baselines, history comparisons or attribution logic.

Use argument arrays, literal path handling, time/output limits and no external diff/textconv helpers. Validate paths from the current repository catalog and handle symlinks without reading external targets. Handle absent repositories/HEAD, binary content, conflicts and bounded output explicitly. Reuse existing process/security helpers where suitable.

The UI loads the catalog when the diff tab is visible and file content when selected; explicit refresh is sufficient for the first delivery. Preserve selections across refresh when still valid. Ignore stale responses after file/session changes. No background Git polling in hidden tabs. Inline and side-by-side share the same parsed data and bounded context. Choose the smallest maintainable rendering approach after inspecting existing dependencies.

## Layout

Keep navigation visibility independent. Replace workspace-collapsed semantics with a single desktop content mode: chat, both or workspace. Migrate the existing preference conservatively (collapsed workspace means chat; otherwise both). Controls live in a stable application header, use consistent icons/labels and remain reachable in every mode. Avoid duplicate hide/expand controls. Hiding panes must not discard chat drafts, conversation or component selection state, nor stop execution. Desktop preference must not make views inaccessible when crossing mobile breakpoints.

## Verification and handoff

Focused Git fixtures cover staged/unstaged/new/deleted/renamed/binary/conflicted content, missing HEAD, path boundaries and unchanged worktree/index/history. UI checks cover both render modes, all layout modes, all workspace tabs, mobile transitions, preserved drafts and stale async results. Hydrated browser verification is required for layout claims; save reusable checks and screenshots rather than repeatedly rebuilding scripts. Bound large-diff behavior and report actual tested limits.

The implementation owner returns changed paths, concrete API/renderer choices, focused test evidence and browser artifacts. Lead owns OpenSpec updates. Independent review will cover the new filesystem boundary and layout regressions. No canary restart or release is part of candidate implementation.
