# Git diff viewer verification

## Result

Implementation accepted locally on Linux x64 with pinned Bun 1.3.12 after independent Quality attempt 4 (result 15307, ended 15308). No additional local implementation defect remains from the reviewed findings. Native Linux arm64, Darwin x64 and Darwin arm64 qualification remains open under GD-002. This is not release or all-platform approval.

The final Web UI tab order is Chat, Activity, Subagents, Review; desktop retains the separate Chat pane. OpenSpec is removed from navigation, with legacy route migration. Review offers a collapsible folder/file tree with orange modified, green new and red deleted status, inline and side-by-side diffs, staged/unstaged/untracked groups, unavailable/limited states and refresh. SVG buttons on `.md` entries open full bounded safe Markdown previews with version labels and return-to-diff. Stable header controls preserve mounted state/drafts; mobile uses single-view navigation. Lead context appears only inside the Lead chat. Git reads are authenticated, scoped to the durable session project, inertly rendered and isolated in a supervised process.

## Evidence

- Independent final review: 35 focused tests, TypeScript and whitespace checks pass on Bun 1.3.12. Source and compiled probes include the canonical CLI from a foreign cwd.
- Actual SIGABRT tests verify host survival, unrelated manager queries, temporary cleanup and next-request recovery. Independent descendant cleanup exercised the deadline fallback in approximately 32 seconds.
- Six malformed protocol cases rejected; startup failure releases admission and oversized requests are rejected before spawning.
- Nested 501-file repository remains one explicit unavailable entry; parent patch stays readable. Small staged patch remains readable beside oversized worktree content.
- Earlier hydrated browser acceptance remains valid: both modes and line numbers, desktop/mobile/header transitions, keyboard navigation, refresh/scroll/selection, drafts, stale responses and hidden execution. No UI changes occurred in the final repair.
- Prior independent regressions verify filters remain inert, repository races cannot redirect Linux reads, linked/shared layouts work, oversized/ignored special entries do not disable unrelated reads, and blank context/binary/config semantics remain correct.
- Local single-sample final owner measurements: catalog 2.38 s, selected read 1.08 s, timer gaps below 12 ms. These are not live-daemon or statistical performance guarantees.

Detailed evidence: `/home/kevin15011/.cache/deck-git-acceptance/` and its `repair-attempt-2/` and `repair-attempt-3/` directories. Reusable checks are in `apps/web/git-diff-acceptance.ts` and `scripts/verify-git-diff-runtime.ts`. Review provenance is retained in apply-progress.md and Deck task records.

## Remaining qualification

Run `bun run scripts/verify-git-diff-runtime.ts` with Bun 1.3.12 and Git on native Linux arm64, Darwin x64 and Darwin arm64. This environment cannot supply those hosts. Cross-compilation alone is not execution evidence. Bun FFI remains experimental; process isolation verifies failure containment, not the unknown historical native crash cause or other-platform ABI correctness.

Installed Bun 1.4.0 passed Git/process tests but timed out twice on the manager abort test; its compatibility is not established. Use the pinned runtime.

The full repository suite was not rerun. Thirteen broader Web readiness failures and the ordering-animation assertion were reproduced on original HEAD and remain documented; no full-suite pass is claimed. No installation, daemon restart, commit or release was performed.

GD-001 and GD-003 through GD-013 are resolved. GD-002's original Linux escape and host-impact concerns are verified repaired; only native platform qualification remains open. The change remains active pending that qualification.

## Review and Markdown revision verification

Latest accepted UI follow-up: selected Markdown diff headers now expose the same SVG preview action as the tree. Reopening the navigator expands selected ancestors and scrolls only the tree to that file, without forcing subsequent browsing or moving document scroll/focus. Lead reran 27 focused tests on Bun 1.3.12; owner hydrated browser evidence (Bun 1.4.0) covers desktop/mobile round trips and long-tree reopen behavior. See `reveal-reopen/` under the evidence directory. This follow-up was subsequently compiled and installed into the Linux x64 canary at the user's request, with installed version smoke passing. The daemon was not restarted.

Quality attempt 5 independently passed 56 focused content/security/UI/navigation/HTTP/scope tests and found only GD-013, a file/folder tree collision. Deep attempt 6 repaired that local rendering branch without backend changes. Lead inspected the source and collision screenshot, reviewed the hydrated browser log, and independently reran 26 UI/navigation tests (165 assertions) on Bun 1.3.12, all passing; whitespace checks also pass.

Both replacement directions preserve terminal and descendant selection, disclosure, Markdown preview and keyboard access. Owner browser evidence also covers tree colors, dark/light/mobile behavior, preview version/safety/cancellation, tab order, draft and scroll preservation. Evidence: `/home/kevin15011/.cache/deck-git-acceptance/review-revision/` and `collision-repair/`. No additional independent full-browser run is claimed. Latest visual/content revisions are accepted locally and subsequently compiled and installed through the canonical canary installer at the user's request. Installed version smoke passed; the daemon was not restarted.

## Current Files expansion acceptance

Files/Changes, safe text/Markdown/raster previews, lazy paginated navigation and accurate large-file status are locally accepted on Linux x64/Bun 1.3.12. Quality attempt 7 independently verified GD-014 through GD-018 with 60 focused tests, 24 adversarial assertions and browser probes; those findings are resolved.

Deep attempt 12 repaired the remaining GD-019 refresh/reveal regression (result 32581, ended 32582). Lead inspected the implementation and report, independently passed 11 UI tests with 89 assertions, and reran the hydrated production-component Chromium harness on pinned Bun 1.3.12. Desktop/mobile refresh, local reload, later-page ancestors, cancellation, bounded requests, absent/repeated cursors, manual pagination, focus and document-scroll preservation pass. Browser transport uses deterministic fixtures; prior independent backend pagination evidence remains applicable. The 15-second timeout is implemented but was not separately advanced in the fixture.

Evidence: `/home/kevin15011/.cache/deck-git-acceptance/gd019/`, independent rerun screenshots in `gd019-lead/`, and prior `files-repairs/`. GD-019 is resolved. GD-002 remains only external native qualification for Linux arm64 and Darwin x64/arm64. No full-suite or additional-platform pass is claimed. This Files expansion has not been committed or installed into canary; no daemon restart occurred.
