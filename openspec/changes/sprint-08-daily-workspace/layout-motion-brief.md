# Daily workspace: theme transition and panel controls

> Product-scope correction: genuine user prompt951c9845-8a91-4ad5-bd7e-4a08f2377c08 rejects invented functionality and interface. Prior runtime acceptance does not approve the ordinary-v1 product flow. Implementation continuation is suspended for a bounded comparison with Deck1; do not implement further from this brief until Lead incorporates the corrected source-backed scope. Existing edits and installed executable are preserved.

Status: ready for same-owner implementation from accepted/installed ordinary-v1 candidate b734bfe2, binary93492307. Lead owns this brief and acceptance. This is a bounded correction of P07/P08/P09, not full daily-workspace parity.

## Outcome and visual agreement

Preserve the original Deck identity from docs/design-baseline.md and docs/design-reference/live-20261111/README.md. Make theme changes visibly use the original reveal, and make navigation/conversation/workspace panels reachable, collapsible, reopenable and adjustable where the original supports adjustment. Preserve the existing nineteen themes/fonts and all ordinary-session controls. No alternative aesthetic or generic layout framework.

Original theme-reveal.ts reads the selected control bounds, reveals from its center across the viewport and uses restrained one-second easing. Dark-to-green/green-to-dark include their original narrow colored wave. Rapid replacement, hidden documents, reduced motion and disposal have explicit immediate/cancellation paths. The original uses View Transition/WAAPI; the recreation must implement movement with GSAP, as required by project instructions. Preserve observable behavior with the smallest suitable technique; do not copy WAAPI motion and label it GSAP. No decorative bounce or delayed access.

Original main.tsx persists sidebar collapse and chat/both/workspace selection, handles a 1000px breakpoint, and provides a 25–75 percent main divider. Inspect the exact control/render paths before implementing; do not invent sidebar resizing merely because the main divider resizes. Current pane-divider.tsx already supports pointer capture, accessible keyboard adjustment and 25–75 bounds. Reuse and expose working controls; fix reachability and missing collapse/state restoration rather than rebuilding it.

## Acceptance

1. Theme selection produces the actual reference reveal across all existing themes, with correct final colors and selected state. Rapid reversals cancel superseded work, reduced motion changes immediately or minimally, and unmount/hidden-document handling removes owned resources. Verify theme transitions themselves, not only settings-panel entrance.
2. Sidebar and main chat/workspace collapse/reopen controls are visible and keyboard reachable in applicable layouts. Main resize retains bounds and persisted size; collapse/view selection persists in the Deck2 preference namespace. Reopening restores useful content/focus; mobile keeps reachable navigation and panel access without trapping hidden controls. Unsupported stored values/storage failures have safe defaults.
3. Drafts, image state, unresolved command identities, active session, approvals, streaming selection/copy and scroll behavior survive resize, collapse, view changes and reload. Preserve the accepted hidden-node animation guard. GSAP owns new movement without CSS double animation or repeated observer-driven reinsertions. Input/focus/navigation must remain immediate.
4. Verify with owned packaged-browser fixtures: desktop/mobile, all themes, pointer/keyboard, rapid reversals, reduced motion, reload/storage failure, connected typing and ongoing synthetic streaming. Compare equivalent viewport/content/theme to original live captures and exact source; label projected references and remaining limits. No real provider call is needed solely for this frontend change. Do not pin markup/prose/styles/constants in tests.
5. Freeze exact source/assets/binary and report meaningful affected checks, durations and limitations. Reuse unchanged Rust/protected/provider evidence only with exact input mapping; run required affected frontend/type/build/package gates once on the final candidate. At most two low-priority build jobs; no compilation during browser performance measurement.

## Ownership and boundaries

Continue ApplyDeep production task task-181d5e85-7817-4dbd-bc81-849132576baf. It owns frontend implementation, necessary fixtures and packaging, is not alone in the workspace, and must preserve accepted changes. Lead owns all OpenSpec/docs, acceptance, findings and installation. Do not change backend authority, session permissions, private user state, personal tools, the running user host, auth or provider/model configuration. No commit/publication. Select frontend-ui-engineering, gsap-core/gsap-timeline, fixing-motion-performance and fixing-accessibility as relevant; original identity remains authoritative.

Other parity obligations remain explicit: double Escape, context percentages, full subagents, dictation, usage, session branch and broad runner/model/YOLO support are not completed by this slice. S1-Q07 remains open. The accepted ordinary profile remains Codex-only, fresh-execution, bounded edit/Investigator behavior.

## Parent discovery and coverage handoff

Tier Verify. Nearest graph home-kevin15011-deck, root /home/kevin15011/deck, generation2026-11-11T01:38:54Z (recorded01:50:21Z). Search apps/web/src/* with .*(Theme|theme|Resize|resize|Collapse|collapse).* returned all31 results over two pages (15+16), no remaining page. Earlier regex-like file pattern returned zero and is not absence evidence.

Material symbols: home-kevin15011-deck.apps.web.src.theme-reveal.createThemeReveal (52–126); theme-select.useThemeReveal (7–29); theme-select.ThemeDialog (45–111); theme.THEMES (2–22); motion.collapse (57–65); project-navigation.Collapse (12–21). Full theme-reveal module read. Both-direction depth1 createThemeReveal trace completed: caller useThemeReveal, callees browserEnvironment/resolveTheme. This is a bounded static trace, not exhaustive runtime topology.

Coverage: original theme-reveal.ts, theme-select.tsx, main.tsx, workspace.tsx, preferences.ts and motion.ts metadata-matched/no recorded issue. New frontend/src/pane-divider.tsx and app.tsx are outside_project/unavailable: exact source fallback applies. Parent read complete current pane-divider and original main state declarations115–165, plus theme-reveal. Original main render search was truncated; complete only the necessary exact render/control paths before relying on them. No graph/registry repair authority. Do not infer exhaustive support from clean coverage.

## Baseline evidence

Accepted ordinary-v1: target/review-ordinary-b734bfe2/candidate.json and handoff.json; Lead target/lead-ordinary-b734bfe2/review.json; installed receipt target/deck2-ordinary-install-evidence.json. Production37 integration262035 and Quality33 integration262036 resolve ORDINARY-Q01/Q02. Lead real journey90.125s/typing p95 26.74ms, current independent corruption/delivery/migration checks passed. These checks establish the starting baseline, not proof of the next UI candidate.
