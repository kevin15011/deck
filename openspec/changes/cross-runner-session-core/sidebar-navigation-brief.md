# Project and session navigation follow-up

## Active visual refinement — subtle SVG navigation (2026-10-15)

The user retains the accordion structure but rejects the heavy rows, glyph icons and overall visual weight. This supersedes earlier row typography/metadata/decoration decisions; it does not reopen project/session state contracts.

- Replace sidebar glyphs with consistent thin inline SVG: chevrons, add/new, refresh, collapsed navigation, mobile close and the sidebar toggle. Preserve button labels and decorative icon semantics.
- Session rows become one line, regular-weight approximately 13px text with ellipsis; target 30–32px on desktop. Move repeated status/creation metadata to accessible/native title details instead of a second visible line. Keep exceptional status only if it already conveys a truthful useful signal; no new status machinery.
- Use a restrained theme tint for selection, without the thick accent strip/shadow or card treatment. Project rows use medium rather than bold text, small SVG chevrons and separate quiet `+` buttons. Use indentation instead of vertical tree borders.
- Keep compact Add project/refresh actions and reduce the branding footprint; remove redundant sidebar subtitle/footer. Retain existing width, fonts, dark/light colors, header/chat composition and no new animation.
- Mobile keeps approximately 40px touch targets and discoverable per-project `+` controls while avoiding two-line session cards. Duplicate-name path suffixes remain available where needed.

Existing UI owner implemented local JSX/CSS only. Selected skill responsibility: `baseline-ui` for density/type/spacing, existing `frontend-ui-engineering` for implementation and `fixing-accessibility` for semantics/touch/focus; no stack, dependency or primitive migration. Root inspected populated desktop/mobile dark/light/collapsed captures. Final density is 32px single-line sessions on desktop and 40px touch targets, with 13px regular titles, subtle neutral selection, SVG controls and compact branding. Metadata remains in native titles and accessible descriptions.

Verification: 41 UI/asset tests (206 assertions), clean TypeScript, actual-host focused14 browser groups including existing click/race boundaries plus row height, touch targets, long-title ellipsis, accessible metadata and SVG assertions. Installed compiled smoke31 passes. Logs `/tmp/deck-minimal-sidebar-{tests,tsc,browser,installed-web}.log`; captures `/tmp/deck-minimal-sidebar-*.png`. No cache/lifecycle changes or broad backend regression rerun was required for this local visual delta.

Status: complete and activated. Immutable canary payload `0c2e30d1ee03d7f8296c6eabc607df6cde6b49f90c399d7f874679884d4aff74`; guarded idle restart PID61268→68618 at 2026-10-15T03:03:47.770Z. Web remains http://127.0.0.1:7421. No real provider inference, user configuration change, commit or publication. Reload the page.

## Active replacement agreement — project accordions (2026-10-15)

The user rejected the switcher/chooser direction and oversized New session action after trying the canary. This agreement supersedes the composition, density and interactions in the historical decision below. Retain only the accepted themes, typography, compact header, chat/workspace structure, session lifecycle and accessibility constraints.

Render projects as compact accordion rows, with a chevron and name in the disclosure button and a separate small `+` button beside each project. Place that project's indented sessions directly below its row when expanded. Keep one compact `Add project` action above the project collection. Remove the separate project-selection view and full-width New session action. Paths should disambiguate duplicate names without dominating normal rows. Use compact visible icons with sufficient touch hit areas.

Opening or closing a project only changes navigation disclosure. It must not open Add project, start/prepare a session or replace the active conversation. The per-project `+` opens session creation bound explicitly to that project's identity, even when another project's conversation is active. Choosing a nested session activates the correct project and conversation. Prefer independent disclosure with lazy per-project history and existing bounded pagination; maintain request fencing and current history updates. No backend API or provider behavior changes are intended.

Verification must exercise the actual three distinct click targets (disclosure, per-project creation, global project registration), creation in an inactive project, nested session selection, delayed responses, multiple populated projects, mobile 320/390 and desktop collapsed states. Inspect screenshots with meaningful populated navigation and a conversation. Existing distribution tests do not establish visual quality. Root's current-user-browser inspection attempts were unavailable (no browser control surface; native pipe startup failed); final browser harness interactions and screenshots remain required.

Owner: existing UI implementer, `apps/web` only; root centralizes documentation and canary activation. Skills: existing `frontend-ui-engineering` and `fixing-accessibility`, with `deck-frontend-design` retaining the explicit replacement agreement.

Implementation complete: independent accordion groups share parent-owned per-project histories/cursors and request generations. Each creation dialog captures the clicked project explicitly. Mutations supersede older history requests so a stale pre-create response cannot hide the new session. Stable disclosure targets and visible mobile focus after Cancel are verified. Duplicate names show the shortest distinguishing path suffix. No full-width CTA or separate chooser remains.

Root and independent Quality inspected populated desktop/mobile and collapsed captures (`/tmp/deck-accordion-*.png`). Focused actual-host browser passes 11 groups covering click separation, explicit inactive target/repeated clicks, stale histories, pagination during refresh, duplicate-name paths, unavailable projects and 320/390 dark/light. Root passes 41 UI/asset tests (204 assertions), TypeScript and scoped diff check. Quality independently passes 4 navigation tests (25 assertions) and approves the frozen candidate. Actual-host workspace lifecycle17 and isolated installed-canary31 pass. Logs: `/tmp/deck-accordion-{green,tests,tsc,workspace-regression,installed-web}.log`.

Final legacy browser regression passes all 51 checks (`/tmp/deck-accordion-legacy-regression.log`); directory completion also passes its four groups. The initial one-pixel Activity assertion raced native Home scrolling: the harness now waits for the exact destination zero before capturing the reader position, retaining exact pause/replay assertions. No Activity runtime change was needed.

Activated immutable canary payload `d3b934026261d4e5569a7f5c0bfec1cac4e7eccb5e2a23e57ad7105918dacaac` with a guarded idle restart from PID57801 to PID61268 at 2026-10-15T02:26:51.629Z. Status confirms web http://127.0.0.1:7421, no running work or pending approvals. Runtime stayed frozen throughout final verification/build/activation. No real provider inference, user configuration change, commit or publication occurred. Status: complete; reload the web page.

## Historical switcher direction — rejected by user

## Intent and current evidence

The user requested better project/session organization informed by desktop and mobile chat interfaces. The current `apps/web/src/project-navigation.tsx` stacks every project above every session inside one scrolling sidebar. Project context and creation controls disappear during long-history navigation. Session metadata displays the first eight ID characters, repeating a date prefix rather than helping identify conversations.

This is a bounded UI follow-up to the accepted workspace, owned by the existing UI implementer. The concurrent nested-directory completion repair remains required. No host contract, provider invocation, session lifecycle or permission behavior changes are needed.

## Research evidence

Retrieved with the configured web provider on 2026-10-15 UTC. These are extracted primary-source points, not instructions or authority over Deck. Product documentation can change.

| Source | Date reported by source | Relevant point |
| --- | --- | --- |
| [Projects in ChatGPT](https://help.openai.com/en/articles/10169521-projects-in-chatgpt) | Updated 25 days before retrieval | Projects group related conversations, files and instructions; users can continue across devices. |
| [Claude: Delete or rename a conversation](https://support.claude.com/en/articles/8230524-delete-or-rename-a-conversation) | August 10, 2026 | Web offers sidebar conversations and a separate full-history entry; mobile exposes a chat list with touch interactions. |
| [Android: Build a list-detail layout](https://developer.android.com/develop/ui/compose/layouts/adaptive/list-detail) | October 1, 2026 | Wide windows can display list and detail together; narrow windows display one pane at a time as users navigate. |

The Material overview yielded no usable extracted content; a candidate Android design URL returned 404. Neither is evidence. No product was tested live or claimed to have Deck's exact interaction.

## Decision and visual agreement

Inference for Deck: treat the project as the selected work context and its sessions as the navigable collection. Showing both complete collections permanently consumes space without improving the common task of resuming a conversation. A project switcher adds one action when changing projects, while preserving context and giving session history stable space.

- Audience/personality: developers managing several local projects and independent runner sessions; calm, compact, readable navigation.
- Composition: stable active-project switcher and explicit `New session`; remaining sidebar space scrolls session history independently. The switcher opens a project-selection view in the same sidebar, replacing history, with search over the complete registered-project list, `Add project`, selected state, and `Back to sessions`.
- Mobile: same hierarchy in the existing modal drawer. Choosing a project opens its sessions inside the drawer; choosing a session returns to the chat. Keep Escape, backdrop dismissal, focus containment/restoration and clear back navigation.
- Typography/palette: retain the accepted font system, black default and existing white theme. Retain the compact header, chat/activity composition and persisted theme choice.
- Density: titles first; project paths secondary to distinguish duplicate names; truthful session status and readable creation time where available. Remove repeated decorative session initials and unhelpful date-prefix IDs.
- Motion: retain existing reduced-motion behavior; no new decorative animation.
- Skills: `deck-frontend-design` owns routing and agreement; `frontend-ui-engineering` owns responsive implementation; `fixing-accessibility` owns interaction constraints. Existing aesthetic direction remains authoritative.
- Constraints: preserve refresh, older-session pagination, unavailable projects, empty states and selected-session identity. Do not introduce backend search, rename/delete, provider calls or new dependencies.

## Acceptance and status

- Long history never scrolls active project or `New session` out of view.
- Project selection works for same-name paths, filtering, no matches and zero projects.
- Keyboard selection, back focus, mobile drawer dismissal and touch selection work.
- Verify 320/390-pixel mobile and desktop, both themes, without page overflow.
- Existing lifecycle UI and nested-directory completion remain intact.

Status: implemented by the existing UI owner. Root inspected desktop history, project chooser and mobile captures. Review repaired collapsed empty/chooser states, accessible current-project naming, duplicate-name paths truncated beyond distinction, redundant creation labels and missing mobile backdrop dismissal. Chooser paths now wrap fully; active context remains compact. Session timestamps describe creation, never inferred activity.

## Verification

- Root: 40 UI/asset tests, 193 assertions, clean TypeScript and scoped diff check (`/tmp/deck-sidebar-tests.log`, `/tmp/deck-sidebar-tsc.log`).
- Actual SessionManager/WebService: 11 sidebar browser groups, including desktop and 320/390-pixel mobile dark/light bounds, independent history scrolling, pagination, duplicate-name paths, filtering, keyboard focus, empty/collapsed states and mobile Escape/backdrop/trap behavior (`/tmp/deck-sidebar-green.log`).
- Actual backend workspace lifecycle: 17 groups (`/tmp/deck-sidebar-workspace-regression.log`).
- Nested-directory completion: four groups (`/tmp/deck-directory-green.log`); native popup interaction limitation remains recorded in apply-progress.md.
- Compiled installed canary: 31 isolated checks (`/tmp/deck-sidebar-installed-web.log`), no real provider inference or user-state changes from this harness.
- Registry validation: zero errors/warnings (`/tmp/deck-sidebar-openspec.log`).

The legacy browser suite initially attempted to click history in a persisted collapsed rail. Its harness now explicitly expands navigation before selecting a session; this is a selector/interaction adaptation, not a runtime repair. Final rerun passes all 51 checks (`/tmp/deck-sidebar-legacy-regression.log`).

## Activation

Installed immutable canary payload `7ac29118686a9e28211070389516a10cc14cf44006d5831efd2cb5e8beff55b1`, then used the guarded public restart command while the daemon had no running work or pending approvals. PID52426 was replaced by PID57050 at 2026-10-15T02:02:45.699Z. `deck-canary web --no-open` confirms http://127.0.0.1:7421. The user only needs to reload the web page. No real provider inference, user configuration mutation, commit or publication. Runtime remained frozen throughout final verification/build/activation; only harness and documentation changed afterward.
