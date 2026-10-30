# Web UI control and surface refinement

## Intent and authority
The user requests an Apple-inspired Deck Web UI redesign of buttons, inputs,
dialogs and floating surfaces, preserving the current layout and compatibility
with all existing themes and selected fonts. Another session owns setup work.
This brief authorizes a bounded visual implementation; no setup repair,
installation, release or changes to session behavior are included.

## Visual agreement
- Calm, precise desktop application controls; retain existing density and geometry.
- Consistent control/surface radii, restrained depth, immediate press feedback,
  legible focus states, and subtle floating materials.
- Existing palette variables remain authoritative. Derive materials from them;
  do not replace theme palettes or introduce an Apple-blue brand override.
- Existing font selection remains authoritative, including serif and mono faces.
- Use apple-design for control feedback, materials and accessibility. Its default
  system font, structural changes and gesture additions do not override scope.
- Preserve reduced motion; provide solid materials for reduced transparency and
  stronger boundaries for increased contrast. Avoid animation of blur.

## Scope and coordination
Implementation owner: Apply Fast. Primary writable path: apps/web/src/style.css.
Lead alone writes this OpenSpec brief. No TSX, theme registry, preference logic,
font assets, setup files or generated tracked files need modification.
apps/web/src/session-controls.tsx and all pre-existing dirty files belong to
the other session and must remain untouched. Recheck status before writing.
Do not install or restart the shared canary; use isolated browser fixtures.

## Evidence and limitations
Investigation task task-5121d5ff-7260-4f0d-a0ba-6c25f5779e19 attempt 1 mapped
shared CSS buttons, dialog inputs and the shared floating-surface selector.
Lead checked those rules and the selected-font rules against current source.
Graph generation 2026-08-20T17:25:00Z did not return Web UI symbols; coverage
reported session-controls.tsx not_tracked. Current source is required evidence.
Investigation's absence-of-spec claims are not established: filename searching
missed existing cross-runner Web UI work. Review applicable existing artifacts
before implementation; preserve their behavior and geometry.

## Acceptance and verification
- Refine buttons, text fields/selects, dialogs, menus/popovers, tooltips and
  composer surfaces without changing panel layout, hit areas or control sizes.
- Preserve native checkboxes/radios, semantic status colors, scrolling, theme
  reveal, disabled states and keyboard focus.
- Verify light/dark and a colored theme; proportional, serif and mono selections;
  desktop/mobile; reduced-motion/transparency and increased contrast.
- Use focused theme/preference/component checks and generated bundle validation.
  Exercise existing browser harnesses and inspect screenshots; do not pin CSS
  prose or exact appearance in unit tests. Record exact commands and limitations.
- Run repository gates before any commit; no commit requested. Do not repair
  unrelated failures caused by concurrent work.

## Progress
Investigation reviewed with limitations. First CSS pass adopted: 104 lines,
SHA-256 efced5ad4b87bf26a535b2eceb284202a7b69eb1f8cb9e554b204243e5e965a4.
Apply reports 27 focused tests, bundle build and Chromium fixture checks passing.
Lead reviewed the CSS and mobile dialog capture. Existing outside-dismissal
assertion reportedly fails with baseline CSS too; not yet independently verified.
GSAP integration and final real-component browser review remain outstanding.

### GSAP implementation review
Apply attempt 2 adds scoped GSAP fades to Deck menu and theme/font/install
dialogs, secondary-panel entrances, and button feedback. It reuses the existing
GSAP dependency and excludes owned surfaces from the existing motion observer.
Lead read the helper/component diffs and matched all nine file hashes against
/tmp/deck-control-motion-candidate-final.json. Apply reports 30 focused tests,
bundle build, TypeScript and real-component Chromium lifecycle checks passing.
Other existing surface motion remains unchanged. Independent Quality review is
pending for lifecycle effects and visual evidence; full repository suite not run.
The earlier desktop dismissal assertion is reported to contradict intentional
desktop click-through behavior (mobile consumes outside clicks).

### Independent review
Quality attempt 1 found no blocking defects; verified scoped lifecycle/feedback
with real GSAP and fake DOM adapters, reran TypeScript, inspected five component
captures, and confirmed desktop click-through behavior. Nine hashes still match.
Its focused suite could not start because its read-only environment prevented
temporary files. Remaining validation: full-workspace captures, visual checks
of transparency/contrast preferences, broader browser cleanup assertions, and
the final repository suite. Same implementation owner is closing these gaps.

## Final result
Completed and reviewed. Attempt 3 changed only the acceptance harness; all six
production file hashes remain identical to the independently approved candidate.
Lead matched all nine final hashes, inspected the expanded cleanup assertions,
read the suite log and reviewed desktop light/mobile real-workspace captures.

- `bun run test`: 459 files, 4,509 tests passed, zero failures/skips, 51.72s.
  Two initial per-file overruns passed the existing wrapper's isolated retries.
- `bunx tsc --noEmit`: passed, no diagnostics.
- `DECK_TEST_CHROME=/snap/bin/chromium bun apps/web/control-motion-acceptance.ts`:
  passed at 390px and 1280px, five owned surfaces and 166 root/descendant nodes
  per viewport disconnected with zero remaining tweens. Includes active button
  feedback disposal, Escape, focus, interruption and live reduced-motion checks.
- Workspace fixture built current assets and captured desktop dark/light and
  mobile views. Apply inspected reduced-transparency/increased-contrast captures;
  solid backgrounds and no backdrop blur were confirmed for these preferences.
- Scoped diff checks passed. Earlier 30 focused tests and independent Quality
  review remain applicable because production hashes did not change.

Final scoped manifest: `/tmp/deck-control-motion-candidate-attempt3.json`.
Exact evidence: `/tmp/deck-controls-verification-attempt3.md`.
Captures: `/tmp/deck-controls-workspace/`, `/tmp/deck-control-motion-browser/`.
Whole-tree identity `3bf075a1ef079bcde1219f1bd900343d9f9ea5dd:dfe768b4883b64f40575c6231fc7198bbeb4cfc9`
was captured after checks, so concurrent whole-tree changes qualify that evidence;
the scoped file hashes remained stable. Validation used Chromium and scripted
workspace data, not physical devices or real inference. No commits, canary
installation, shared-service restart or edits to reserved setup files were made.

## User motion direction update
The user explicitly selected GSAP as the animation engine, with apple-design
timing and motion character. This supersedes the CSS-only/no-dependency limit
only where necessary for the motion integration. Keep the same implementation
owner. Additional UI motion modules, minimal component lifecycle wiring and the
GSAP manifest/lockfile entry are permitted after checking concurrent ownership;
session-controls.tsx and setup files remain reserved.
Use gsap-core for implementation and apple-design for behavior: immediate press
feedback (about 100ms), restrained surface settling around 300–400ms, no default
bounce, retarget from current presentation state, and reduced-motion support.
These tween timings approximate the visual character; they are not equivalent to
physical spring response or velocity continuity. Do not add gesture mechanics.
Scope and clean up animations on unmount, preserve focus/dismissal semantics,
and avoid competing CSS and GSAP transforms on the same elements.

## Approved refinement: header, user bubbles and surface hierarchy
The user reviewed the running UI and approved these next changes:
- Consolidate the session header into one coherent header. Keep session identity,
  readiness, connection/work indicators and permission mode readily visible;
  place secondary session actions in an accessible session menu/popover.
- Refine user-message bubbles with Apple-inspired shape, restrained surface tone
  and content-appropriate width. Preserve attachments, long text/code, selection
  and timestamps. Do not change agent messages, their model metadata or times.
- Differentiate navigation, conversation and auxiliary surfaces using existing
  theme variables. Never hide, obscure or diminish status/work icons.

Explicitly rejected scope: changing the resizable split or its defaults,
simplifying/grouping technical Activity data, changing agent message presentation,
or adding sidebar action hiding. Existing adjustable divider is sufficient.
This supersedes the original layout-preservation constraint only for header
consolidation and user bubbles; all other layout behavior remains authoritative.
Use the same Apply Fast owner and existing Apple/GSAP agreement. Main UI wiring
and focused acceptance coverage may change as needed. session-controls.tsx still
contains another session's setup-message edits and remains reserved: first reuse
its current compact rendering from the parent and CSS without editing its source.
If this cannot preserve visible status/permissions, report the exact constraint.
Verify full workspace, desktop/mobile and narrow split, light/dark/colored themes,
serif/mono choices, indicators, menus, keyboard focus and preparation/close flows.
Lead alone owns this brief. No setup repair or unrelated changes.

Prior canary update: on the user's explicit request, Lead ran
`bun run canary:install` successfully and checked `deck-canary --version`
(0.14.0, dev, 3bf075a). No shared-session restart occurred.
This refinement is now in progress; earlier verification covers only the prior
candidate until invalidated checks are rerun.

### Refinement review
Attempt 4 implements the approved header/bubble/surface changes in main.tsx and
style.css. Lead inspected the desktop capture and source diff and matched all
candidate hashes in /tmp/deck-refinement-candidate-final.json. Apply reports
4,509 full-suite tests, 31 focused tests, types and the real-workspace matrix pass.
One interaction requires follow-up: the compact session disclosure consumes
Escape while Assignments is above it. Although this existed on mobile, using the
disclosure on desktop expands its impact; correct the parent integration so the
foreground dialog receives Escape. Preserve the reserved component's setup edits.
Canary update follows acceptance of this bounded correction.

### Refinement completion
Attempt 5 fixes foreground Escape in main.tsx: Assignments remounts the session
disclosure and returns focus to its replacement trigger; native modal Escape
events from nested confirmation dialogs do not reach the background disclosure.
Reserved session-controls.tsx remains untouched by this work. Lead reviewed the
source and verification report and matched all six final candidate hashes.
Desktop/mobile checks cover first Escape, direct close, repeated reopen, YOLO
confirmation cancellation, focus restoration, and close/reprepare. An in-memory
fault replay fails as expected. 15 focused tests, TypeScript and 4,509 full-suite
tests passed (65.65s); no failures or skips. Prior visual matrix remains applicable.
Evidence: /tmp/deck-session-modal-verification.md and
/tmp/deck-session-modal-candidate.json; main.tsx SHA-256:
9c5bda05c0283e3f0ccc3ad2f679d296533001b2a54288e7626de100e3fcb351.
Lead ran bun run canary:install successfully after acceptance. No active-session
restart or commit. Chromium/fake-runner and narrow mono-card wrapping limitations
remain; no permission mutation or exhaustive error-state validation claimed.

## Approved header clarity follow-up
User requests four targeted refinements to the same implementation:
- Label the session disclosure `Session`, making its menu purpose explicit;
  preserve readiness/work/error indicators and accessible status information.
- Rename the sidebar `Menu` to `Settings` and replace its ellipsis with an
  inline SVG gear. Preserve notifications attention indication and menu behavior.
- Remove `Conversation / You and the Lead` and the dedicated conversation-title
  row. Retain the Lead avatar in the single primary header beside session identity.
  Workspace tabs remain accessible within their own panel, without an empty
  matching row above the conversation. Preserve mobile navigation and divider.
- Replace Chat/Both/Workspace visible labels with distinct SVG panel-layout icons,
  preserving accessible names, tooltips, pressed state, focus and touch targets.

This is a targeted continuation, not a new design direction. Prior themes/fonts,
Apple/GSAP agreement, agent-message metadata, technical Activity and indicators
remain authoritative. The SessionControls trigger label/accessible description
may now be edited narrowly because the user explicitly requested its change;
the other session's setup-message edits in that file must be preserved verbatim.
No setup policy/behavior or unrelated changes. Lead updates canary after validation.

### Header clarity completed
Attempt 6 implements all four requested changes. Desktop workspace tabs now live
inside the workspace pane; mobile retains its shared navigation. Lead inspected
desktop/mobile captures, reviewed the verification report and matched all 20
hashes in /tmp/deck-header-candidate.json. The session trigger changes preserve
the other session's setup text; prior Escape/focus integration remains intact.
Final full suite: 4,509 tests / 459 files passed, zero failures/skips, 36.28s.
TypeScript, 36 focused tests and real-workspace browser navigation, divider,
menu/foreground Escape, close/reprepare and theme/font matrix checks passed.
Evidence: /tmp/deck-header-verification.md; captures /tmp/deck-header-clarity/.
Chromium with fake inference only; selector-only updates in other browser
harnesses were typechecked, not all executed. Lead successfully rebuilt and
installed canary and checked its version after adoption. No active-session
restart or commit was performed.

## Selected-session sidebar experiment
User requested a checkpoint before trying a concave active-session shape inspired
by their attached sidebar reference. Checkpoint verified:
`eabf230699fa0868fbc0cebad1bffee1d70e6854` (`feat(web): refine controls and unify session navigation`).
It includes only approved UI and this brief; unrelated setup edits remain outside
the commit, including mixed setup text in session-controls.tsx.

Apply the concave transition to the selected session row, suggesting attachment
to the content surface. Preserve the full-width text sidebar, row geometry,
status/work icons, action buttons and scrolling; do not copy the reference's
icon-only navigation or palette. Use theme variables, support selected rows at
list boundaries and adjacent projects, and keep a distinct keyboard focus ring.
Prefer a small CSS-only paint change with non-intercepting decorative layers.
If any motion is added, existing GSAP and reduced-motion constraints apply.
Keep this experiment uncommitted and separate from the checkpoint for review.
Validate light/dark/colored themes, first/middle/last rows, long names, desktop
and mobile drawer, selection changes and keyboard/action interaction. Lead owns
this brief and will update canary after visual review. No unrelated setup edits.

### Sidebar preview implemented
Attempt 8 adds 42 CSS lines only, uncommitted. Lead reviewed the diff, desktop
capture and report; CSS SHA-256 matches
2ac882b90c0c9274f3df662546ef77fedd13c4bfa231d1e8daec4e670be8c287.
18 Chromium desktop/drawer scenes pass across dark/light/eva01 and first/middle/
last selections. Before/after row boxes match exactly; focus, actions, scrolling
and indicators remain available. Five focused navigation tests pass. CSS bundle
and browser checks cover this experiment; earlier full suite is historical.
The 17px/27px gutter bridge has unverified scrollbar portability outside Chromium.
Evidence: /tmp/deck-concave-verification.md; captures /tmp/deck-concave-after/.
Canary rebuilt for preview; no active-service restart. User visual acceptance
pending; checkpoint eabf230 remains intact and this experiment remains uncommitted.

### Sidebar correction requested
User rejects the continuous vertical stripe/border between sidebar and chat:
the selected row must visually merge with the actual chat background. Supersede
the 17px/27px surface-colored gutter bridge; use the adjoining content's actual
paint and handle scrollbar/padding geometry without a mismatched vertical rail.
User also explicitly requests GSAP animation between selected sessions. Animate
the concave selection treatment with restrained Apple-inspired motion (~300–400ms,
no decorative bounce), retarget rapid selections from current presentation,
preserve independent keyboard focus, and settle immediately for reduced motion.
Support row size changes, scrolling, project expansion, collapse and unmount;
do not animate text/icons or block navigation. Keep experiment uncommitted.
Validate the user's one-dark-like screenshot theme in addition to light/dark,
actual boundary colors, rapid switching, scrolling and cleanup. Lead owns canary.

### Sidebar scrollbar placement
User explicitly requests moving the sidebar scrollbar to the LEFT to free the
chat-facing edge for the seamless concave join. Adopt this placement for the
sidebar scroll region (and drawer where applicable), preserving LTR text/icon
order, action positions, keyboard navigation and scroll behavior. Do not move
conversation/workspace scrollbars. If CSS direction is used on the scroll host,
restore content direction explicitly and verify mixed text and horizontal keys.
This supplements the pending GSAP/join correction, not a separate redesign.

### Motion correction reviewed; scrollbar choice pending
Attempt 9 replaces the rail with a measured canvas-colored SVG selection plane
and 360ms GSAP retargeting. Lead reviewed source/report/One Dark Pro capture and
matched seven candidate hashes. Reported 24 scenes, 12 pixel-matched desktop
joins, lifecycle checks, types and 4,509 tests pass. The left scrollbar request
has not yet been implemented. User subsequently proposed hiding the sidebar
scrollbar with conditional top/bottom overflow fades and asked for an opinion;
Lead recommended fades but has not treated that discussion as a selected option.
Clarify this preference before completing scrollbar work and canary delivery.
Evidence: /tmp/deck-selection-verification.md and /tmp/deck-selection-candidate.json.

## Approved motion coverage and overflow affordances
User explicitly chooses hidden sidebar scrollbar with conditional top/bottom
overflow fades, superseding the earlier left-scrollbar direction. Scope is the
projects/sessions list (and its mobile drawer), not chat/workspace scrollbars.
Fades appear only where more content exists, remain subtle/non-interactive and
must not conceal names, status/work indicators or focus. Preserve wheel, trackpad,
touch and keyboard scroll and the seamless selection/chat join.

User also requires a persistent AGENTS.md rule: all Web UI movement, entrance,
exit, expansion/collapse and view/tab transitions use GSAP with the established
Apple-inspired motion and accessibility/lifecycle safeguards. Lead added it.
Correct the specifically identified gaps now: Chat/Both/Workspace view changes,
Usage expansion/collapse, workspace tab content transitions and sliding active
indicators for workspace tabs and panel-view buttons. Preserve current data,
scroll positions, editable state, focus/ARIA, resizing and navigation semantics.
Fast switching retargets current presentation and never blocks actions. Reduced
motion is immediate or minimal fade. Review relevant existing motion ownership
to avoid two systems animating the same property. This scope does not require
rewriting unrelated interactions merely to audit the entire app in one pass.
Same implementation owner; Lead owns AGENTS.md and OpenSpec. Keep new work
uncommitted relative to checkpoint eabf230; no setup or unrelated edits.
Verify actual animations, rapid reversal, cleanup, overflow edges and expansion
after resize/content changes in desktop/mobile and multiple themes. Independent
targeted review follows effects changes; Lead updates canary after verification.

## Approved composer focus treatment
User confirmed replacing the composer's rectangular textarea focus outline with
two soft luminous segments travelling around the rounded composer perimeter in
the same direction, exactly half a path apart, with a short fading trail.
Use GSAP and the active theme accent/focus palette, not a fixed blue. Activate
while the message input has focus and stop/clean up on blur or unmount. Track
composer resize/autogrow without changing its geometry or intercepting pointer
events. Preserve send/attachment/stop controls and their own keyboard outlines.
Reduced motion uses a static visible focus treatment; forced colors/high contrast
must retain an unmistakable accessible focus fallback. Remove only the redundant
textarea rectangle once its replacement is present, not global focus indicators.
Keep input semantics, IME, keyboard submission and selection behavior unchanged.
This supplements pending panel/Usage/tab motion and sidebar fades, without
cancelling them. Same Apply owner; no new commit before user review.

## Approved ambient theme depth
User requests subtle ambient background illumination inspired by their supplied
mobile UI reference, for BOTH desktop and mobile. Add broad, soft, low-opacity
light pools derived from each active theme's accent and canvas/surface palette.
Do not impose the reference's orange color or change theme identities/fonts.
Lighting should give depth to the app background/content surfaces while keeping
text, status/work/attention icons and controls legible. Preserve the selected
sidebar-to-chat seam by sharing background composition or deriving its paint
consistently; do not reintroduce a visible rail or mismatched selection patch.
Use bounded static gradients rather than continuously moving decorative lights
or expensive animated blur. Any introduced entrance/intensity transition uses
GSAP per AGENTS.md. Respect high contrast/forced colors and reduced transparency;
provide a restrained/solid fallback. Preserve foreground hierarchy, scrolling,
focus glow and current motion work; no layout changes. Validate actual full UI
desktop/mobile in light/dark and colored themes. Reference attachment:
/home/kevin15011/.local/state/deck/sessions/20261030T151526-fd2deb/attachments/2b6f91b8-4686-4498-b1b4-c87b5c17b309.image.
Same implementation owner; keep these refinements uncommitted for user review.

## Final ambient and motion delivery — 2026-10-30
Accepted apply-fast attempts 10–13: GSAP panel/tab/indicator and Usage motion,
hidden sidebar scrollbar with conditional edge fades, two opposite theme-colored
composer focus lights, and static theme-derived ambient desktop/mobile lighting.
The AGENTS.md motion rule remains in force. Checkpoint eabf230 is preserved;
these refinements remain uncommitted and foreign setup changes are preserved.

Independent Quality attempt 2 identified two P2 defects: Usage opening skipped
its collapsed starting height after React committed hidden=false, and forced
colors removed the workspace selection gradient. Lead reviewed attempt 13 fixes:
explicit settled disclosure state preserves live reversals; system Highlight
selection fallbacks cover workspace tabs and desktop panel modes. All 20 current
manifest hashes match /tmp/deck-p2-candidate.json. Lead independently reran
`bun apps/web/view-motion-acceptance.ts`: PASS opening intermediate height,
reversals, reduced motion, retained state, semantics and unmount. Both findings
are resolved on this evidence plus source review and reported four forced-color
application scenes. Current TypeScript and 3 quota tests passed in implementation.
The earlier full 4509-test result remains historical supporting evidence.

Ambient evidence: /tmp/deck-ambient-verification.md; four themes at desktop/mobile
with solid accessibility fallbacks and pixel-matched sidebar join. Latest repair
evidence: /tmp/deck-p2-verification.md. Browser coverage is Linux Chromium with
fake inference, not all engines or physical devices.

Lead ran `bun run canary:install` successfully and checked `deck-canary --version`.
No active shared session service was restarted. Canary installation includes the
current working tree; this does not claim unrelated concurrent changes were audited.

## Composer focus visual refinement — 2026-10-30
User accepts the overall UI but rejects the focus effect as clearly shaped lines
that distract. Replace the segmented luminous strokes/trails with two small,
soft diffuse low-intensity light pools, opposite each other, traveling in the
same direction more slowly using GSAP. Retain active theme color, accessibility
fallbacks, responsive geometry, focus/visibility lifecycle and cleanup. Avoid a
hard bright core, visible tail lengths or a conspicuous full perimeter outline.
Keep a discernible accessible focus state; reduced-motion/forced-color fallbacks
remain static. Scope is composer effect only; no ambient/sidebar/layout changes.
Use current apple-design direction and GSAP conventions. Same apply-fast owner;
keep uncommitted and update canary after proportionate visual/browser validation.
Reference: attachments/ed5c6c41-020a-440c-9ea7-97c1eb81ae66.image.

## User message entrance — 2026-10-30
User additionally requests GSAP animation when their message appears in chat.
Animate newly inserted user message bubbles with a restrained short fade and
small translation per Apple motion conventions. Do not replay history on mount,
session switching or rerenders; avoid duplicate animation on optimistic/server
reconciliation. Preserve immediate sending, scroll anchoring, keyboard focus and
reduced-motion behavior. Agent messages remain unchanged. This extends current
apply-fast refinement scope; it does not replace the pending softer composer glow.

## Session switch responsiveness investigation — 2026-10-30
User reports longstanding session/chat-switch stalls, predating current motion.
Investigate attempt 2 provides source-only hypotheses, not measured causes:
serial summary/history requests, synchronous transcript mount and event reduction.
No optimization is accepted from this report alone. Investigator lacks shell/browser
execution, so apply-deep owns isolated measurement with no production edits while
apply-fast finishes the overlapping user-message entrance work. Measure network
wait versus main-thread render/layout and realistic short/long-history switching;
record candidate changes and preserve setup files. Use evidence to select a bounded
fix, not speculative caching, content-visibility or a rewrite.

## Sidebar reorder regression — 2026-10-30
User reports that reordering sessions makes the selected sidebar row contents
disappear. Screenshot shows selected background remains but title/controls vanish.
Reproduce with actual session drag/reorder and preserve the selected row title,
status indicators, controls and hit targets after drop and cancelled drag. Inspect
selection SVG layering, drag ghost/state cleanup, React identity and GSAP inline
styles; do not assume cause from screenshot. Prioritize a bounded regression fix
with browser reproduction and rapid reorder/selection coverage. Other pending
user-message entrance and session-switch performance work remain active.

## Sidebar parent-child hierarchy — 2026-10-30
User reports people cannot distinguish which sessions belong to a folder/project.
Authorized visual refinement: clearer indentation of child sessions relative to
project headers, with a subtle theme-derived vertical grouping guide for expanded
projects if useful. Keep session status/work/attention icons and action controls
visible, selected concave seamless join intact, long names usable, and desktop/
mobile consistency. Avoid relying on color alone; alignment provides hierarchy.
Apply after/in coordination with pending reorder regression under same apply-fast
owner. Revalidate drag targets, collapsed/expanded groups, selected first/last child
and multiple adjacent projects. Keep uncommitted; preserve all unrelated edits.
Pending delivery to apply-fast: task was running attempt16 when request arrived;
continue same task with this requirement on next completion before canary delivery.

## New One Dark blood-red variant — 2026-10-30
User requests an additional theme like One Dark Pro with blood-red rather than
blue accents. Working name: One Dark Blood; stable id one-dark-blood. Preserve
One Dark Pro unchanged and reuse its dark neutral surface/typography hierarchy.
Use deep blood-red chromatic accents with contrast-adjusted hover/focus/action
variants, readable button text and distinct semantic success/warning/error states.
Theme-derived ambient and composer lighting must pick up new tokens naturally.
Register in selector/persistence through existing theme conventions; verify desktop
and mobile, custom fonts and actual contrast. Known literal locations: theme.ts
registry, themes.css One Dark Pro block and additional placeholder/readiness
selectors; theme.test.tsx currently asserts exact theme catalog. Graph UI theme
search returned zero, scope coverage gives no completeness proof; source fallback
is necessary. Deliver to same apply-fast owner together with pending sidebar
hierarchy on completion of running attempt16. Keep uncommitted for user review.

## Measured switch stall and bounded correction
Apply-deep attempt1 measured116 isolated switches on fixed snapshots. Initial
history page is40 rows (120 is accumulated window). Dense Markdown40-row mount
produced ~1.16s longest main-thread task; local summary/history medians2.3/10.7ms,
reduction0.1ms. Historical committed UI also reproduces. Synthetic loopback
workload, not the user's session or cold-backend proof. Report:
/tmp/deck-session-switch-perf-1793388205/REPORT.md.
Proceed with bounded interruptible initial history rendering experiment under
same performance owner. Preserve fetched data/cursors, complete eventual content,
scroll anchors, bottom following, keyboard/focus, live updates and new-user motion.
Do not trade away access to older messages or stale-session isolation. Compare
fixed baseline/candidate timings and long tasks; no claimed improvement without
measurement. Own transcript/main/history helper scope; apply-fast owns sidebar/
theme files separately. No new framework, backend protocol or speculative cache.

## Accepted visual refinements through attempt17
Lead reviewed attempt17 report and desktop One Dark Blood screenshot; all8 scoped
file hashes match /tmp/deck-hierarchy-candidate.json. Accepted24px child indentation
and vertical grouping guide, independent crimson One Dark Blood theme with
unchanged original One Dark Pro. Reported15 focused tests/types and Chromium
18 application scenes, persisted picker/font previews, representative contrast,
20 reorder checkpoints and9 seamless-join checks pass. Preceding accepted changes
include softer18s composer light pools, live-only user-message entrance, and
reorder stacking fix with actual blank-label red/green paint evidence.
These changes remain uncommitted and await combined canary delivery after the
concurrently edited transcript performance work stabilizes; no current combined
full-suite or performance outcome is claimed.

## Transcript independent review follow-up
Quality attempt3 independently verified fixed-candidate hashes, queue invariants
and reported matched medians. One P2: formatting remains active in hidden chat,
where zero geometry invalidates reading-anchor correction. Modeled callback
reproduction supports it; apply-deep continues for browser red/green and bounded
visibility/resume correction. Final combined full suite pending: review environment
preload was read-only (EROFS), not a demonstrated test failure. No canary until
correction and writable verification. Progressive formatting itself introduces
no deliberate animation and review found no GSAP-rule conflict.

## Combined canary delivery after hidden-pane correction
Accepted apply-deep attempt3 visibility/hydration/route-ready activation guard.
Lead reviewed narrow source patch and all3 task hashes; independently reran
`bun apps/web/transcript-rendering-acceptance.ts` PASS, including desktop/mobile
hidden anchors, hydration/reversal, selection/copy, paging, rapid session switches,
streaming, live-user entrance, reduced motion and zero browser errors. Quality P2
hidden-pane issue resolved on actual browser red/green plus independent rerun.
Implementation stable candidate full gate passed4509 tests (47.83s suite wall),
11 focused tests and TypeScript; detailed report /tmp/deck-hidden-chat-anchor/REPORT.md.
Lead rerun log /tmp/deck-lead-final-transcript.log.

Lead installed via `bun run canary:install` successfully and checked version.
Combined delivery includes One Dark Blood, sidebar hierarchy/reorder fix, soft
composer lights, user-message entrance and interruptible transcript formatting.
No active services restarted, no new commit; checkpoint eabf230 preserved.
Performance tradeoff remains: dense initial paint702->278ms, longest task554->130ms
in matched synthetic tests; full formatting754->1346ms, source available meanwhile.
Single exceptionally large Markdown message may still block. Chromium coverage
is desktop/mobile emulation, not every engine/device or real cold backend.

## User correction: seamless selected row and border-only sheen
The latest screenshot shows hierarchy indentation/group styling compromises the
selected session's visual integration with chat. Restore a continuous concave
selected surface through the sidebar edge while keeping project-child alignment
clear; prefer indenting row contents instead of clipping/insetting the active
selection surface. Preserve reorder stacking fix, status/actions and mobile.
Reference attachments/a6db57fb-269e-4a12-98cd-ee3f3266ddd4.image.

Composer direction supersedes diffuse light pools: user wants a subtle moving
border sheen, strictly confined to the thin rounded border. No outward glow,
interior spots, particles or sharp segmented streaks. Preserve two opposite
highlights/same direction unless geometry warrants equivalent smooth restrained
continuity; theme-derived color, low intensity, GSAP and accessibility lifecycle
remain. Validate close-up desktop/mobile captures: no paint beyond border band.
Keep uncommitted; update canary after focused visual/browser verification.

## Border sheen and seamless selection delivery — attempt18
Accepted full-width group surface with indentation moved to row contents;
transparent expanded group preserves concave selected canvas join. Composer radial
modulation is masked to thin rounded border, without outer/interior light pools.
Lead reviewed sidebar/composer screenshots and8 matching source hashes in
/tmp/deck-correction-candidate.json. Independently reran composer acceptance PASS;
467 changed pixels, zero outside allowed border rasterization band. Reported
desktop/mobile themes, reorder checks,7 focused tests and TypeScript pass.
Prior full-suite evidence remains historical; no new full-suite claim for paint delta.
Lead successfully ran canary:install and checked installed version. No active
service restart or commit. Report /tmp/deck-correction-verification.md; Lead check
/tmp/deck-lead-border-check.log. Chromium-only browser evidence.
