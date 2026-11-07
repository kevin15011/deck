# Review branch diff and compact controls

## Outcome

Add a Diff mode alongside Files and Changes in Review. Replace tabs and duplicated Review header rows with one compact selector row, SVG mode icon and icon-only Refresh. Preserve the current application identity, palette, typography and dense developer-tool layout. Use baseline-ui for compact control craft and existing GSAP motion conventions; no visual redesign.

## Behavior

- Diff uses PR-style merge-base-to-local-HEAD comparison against the remote default branch, exposing exact compared branch labels and added/deleted counts. Existing Changes retains uncommitted work. Use locally available remote tracking references and clearly represent unavailable/default-branch/merge-base failures; do not silently perform network fetches or alter Git configuration.
- Reuse the file tree, one-file selection and inline/side-by-side diff experiences. Handle renamed/deleted/binary files and stale asynchronous selection safely.
- Remove redundant working-file and Markdown-preview header rows. A floating top-right accessible icon toggles Markdown/text, showing the destination mode. Preserve discoverability of file paths in the tree and avoid covering content.
- On desktop move sidebar collapse into the sidebar, retaining a reachable reopen control. Move panel toggles to the far right of the platform header: independent left and right icons with pressed states; both active replaces the old Both control. Preserve mobile behavior except the requested branch label.
- On desktop and mobile show current branch subtly to the right of the session title when available, with truncation and full accessible text.

## Constraints and verification

Read-only Git inspection with bounded output, safe path/ref handling and existing API authorization. No project repair, user configuration changes, daemon restart, commits or release as part of implementation. Lead owns OpenSpec. Match existing UI components and English copy. Use GSAP for affected transitions, reduced motion, cancellation and unmount cleanup. Verify keyboard controls, rapid reversals, desktop/mobile layout and browser behavior. Add proportional Git/API regression tests, run affected tests and types, then full gate on final candidate. Report actual evidence and remaining limitations.

## Status

Runtime-feedback repair accepted in source after independent review. Branch identity is now independent of the comparison catalog. The reproduced 664-file checkout comparison uses bounded 200-file pagination instead of rejecting at 500 files. Failed continuations preserve the catalog and request Refresh; revision-resolution limits retain command-specific diagnostics. The original user project and installed build remain unverified.

Final code candidate `c33abb06d0f982e2f72ce703f05f0dda002f54aa:6bdbe3aadd988be11d531aae8ab16fad517193c6`: 4,709 passed, zero failed, one skipped; TypeScript passed. Lead recomputed all 17 recorded hashes with no mismatch before this documentation update. Independent review ran 28 boundary cases and recommended closing both pagination/diagnostic P2 findings. Evidence: implementation attempt 4 (230228/230229), review attempt 4 (231086/231087), `/private/tmp/deck-review-p2-handoff.md`. This supersedes the earlier source candidate below; no installation or commit is claimed.

Lead reran the final browser acceptance harness with pinned Bun 1.4.0: exit 0, artifacts `/private/tmp/deck-review-acceptance-PoEDa8`. Real Git/API and Chromium confirmed 601-file pagination, failed-continuation preservation and Refresh recovery, independent branch identity during metadata failure, and desktop/mobile keyboard/reduced-motion controls.

### Earlier feature verification

Implemented and accepted in source. Comparison uses the stated PR semantics while keeping local Changes separate. No canary installation or commit performed for this change.

Candidate `c33abb06d0f982e2f72ce703f05f0dda002f54aa:e9218ea2bcde900ca24c7a9e602bb34093efcded`: 4,707 tests passed, zero failed, one skipped; TypeScript passed. Lead independently matched all 16 reported hashes, including generated assets. Independent review found no remaining blocking Git/API or UI defects after the selector-focus repair.

Lead independently ran `TMPDIR=/private/tmp PATH=/private/tmp/deck-review-tools:$PATH bun run apps/web/review-branch-acceptance.ts`: exit 0. Evidence `/private/tmp/deck-review-acceptance-kmY6zK`. Real Chromium, HTTP/WebSocket and disposable Git fixtures passed consecutive keyboard mode changes, focus preservation, counts/content, Markdown toggle, panels/sidebar, reduced motion and desktop/390/320px mobile checks. Inference was faked; no live session or user project was modified. The keyboard-focus P2 is resolved by layout-time focus transfer guarded against unrelated focus ownership.

Evidence: implementation task `task-a88b630a-0068-413f-ad6e-39aa29473528` attempt 2 (224291/224292); review task `task-c28aaa40-d07d-4bd2-af5c-e9b0d96d420f` attempt 2 (225055/225056). Locally available remote symbolic default refs/history remain required; no fetch occurs. At least one desktop content panel remains visible under the existing layout contract.

## Mobile branch header follow-up

Accepted source follow-up: remove the 35% branch cap and grow the identity container; intrinsic columns distribute available title/branch space, retaining ellipsis only under real constraints. Add a decorative Git branch SVG before the accessible branch name on desktop/mobile. Lead matched all four delta hashes and inspected CSS plus the 390px screenshot. Evidence: implementation attempt 5 (232176/232177), `/private/tmp/deck-review-header-handoff.md`; 16 real-browser layouts at 320/390/768/1440px, 19 affected tests and TypeScript passed. Prior frontend evidence is superseded; unchanged backend evidence reused. No new full-suite, installation or commit claim.
