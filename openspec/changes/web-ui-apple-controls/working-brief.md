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
