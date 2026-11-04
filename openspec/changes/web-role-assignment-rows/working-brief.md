# Working Brief: Configure all role assignments together

## Intent and authorization

The user authorized a separate UI change on current `main`: replace one-role-at-a-time
web assignment with all roles visible as aligned rows, each showing Role, Runner
and Model. Source changes only; no release or user daemon restart is implied.

## Visual agreement

Keep the current web application's typography, palette, control styling and spacing
tokens. Use a compact, readable row layout with aligned role/runner/model columns.
Preserve a usable narrow-screen arrangement without hiding roles behind selection.
No new brand direction, images or dependencies are required.

Implementation responsibility: frontend-ui-engineering; control accessibility:
fixing-accessibility; relevant motion: gsap-core. Existing project/user conventions
take precedence over broad redesign suggestions. All UI strings remain English.
Movement and appearance transitions use GSAP, with reduced motion, interruption
and cleanup handled according to AGENTS.md.

## Acceptance

- All configured team roles are visible and editable together.
- Each role has its own correctly labeled Runner and Model controls.
- Models reflect the selected runner; changing one row does not alter other rows.
- Runner changes cannot silently retain a model invalid for that runner.
- Existing catalog loading, validation, assignment persistence and prepare flow work.
- Desktop, narrow-screen, keyboard and applicable reduced-motion behavior are checked.

## Ownership and verification

Apply Fast task `task-f725bfd1-7d54-49f9-9594-9c0e07af784d` owns the web assignment
implementation and narrow related styles/checks. Lead centralizes this brief.
Resilience implementation owns backend lifecycle; preserve its concurrent edits.
Focused behavior checks and browser evidence precede final integration. Avoid
tests that pin markup, classes, styles or prose. Implementation is in progress;
no checks have yet been accepted for the final candidate.

## Review progress

Attempt 1 implemented rows in workspace-dialogs.tsx/style.css and extended the
browser acceptance harness. The owner reports focused browser, six controls tests
and typecheck passing. Lead reviewed the diff and desktop screenshot: rows match
the requested composition, but a mobile new-session acceptance selector was
incorrectly changed to a role-scoped name. Attempt 1 is not accepted as final.
Same owner attempt 2 fixes it and strengthens full-team reachability, draft
preservation and close/reopen checks. The broader reconnect scenario is unverified.

Quality attempt 1 identified unresolved finding UI-CONCURRENT-ROW-01 (P2): a dirty
row keeps its draft but adopts an external revision/baseline, allowing a same-row
remote change to be overwritten without conflict. Lead reviewed the effect and
accepted the finding. Apply Fast attempt 3 owns correction and red/green same-row
concurrency coverage. Quality's browser run was denied temporary-directory writes;
it supplies no passing browser evidence. Lead must rerun the corrected targeted
acceptance in the writable root before final acceptance.

Apply Fast attempt 3 adds explicit Use latest / Keep my draft conflict resolution
and reports a red-first same-row regression. Lead matched the three UI SHA256
inputs from that report before and after an independent writable run:
`DECK_TEST_ASSIGNMENTS_ONLY=1 bun run apps/web/workspace-acceptance.ts` passed
in 4.872 seconds (exit 0), covering the full team, scrolling, keyboard, draft
preservation, persistence and external updates. Quality attempt 2 is reviewing
the corrected candidate; UI-CONCURRENT-ROW-01 stays open until Lead reviews its
recommendation. Full-suite/type gates await the final combined backend candidate;
the owner's type run observed an in-progress backend fixture error, not a pass.

Quality attempt 2 recommends resolving UI-CONCURRENT-ROW-01 with no remaining
blocking UI findings. Lead rechecked all three unchanged hashes and adopts that
scoped recommendation, backed by the prior browser rerun and six independent
reviewer state checks. The finding originated in prose, not the host's structured
finding ledger; a structured resolution was rejected as finding-unknown. No host
closure is claimed. Final backend/canonical gates and broader reconnect acceptance
remain outside this scoped approval.

Test purpose: the focused assignment acceptance protects independent role drafts,
correct runner/model persistence, and intentional resolution of concurrent same-row
edits. Its oracle is the user's role-row workflow plus preservation of external
changes until explicit resolution; it fails if saving silently loses a remote edit.
