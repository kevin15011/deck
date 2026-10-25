# Git diff viewer — product framing

Status: Product scope and criteria approved; paused at the user's explicit request to investigate the live codex-rpc-frame-too-large incident. No runtime implementation has started. Preserve this scope for later resumption.

## Intent

Provide a conventional read-only Git diff viewer in the Web UI. Prioritize readable differences and a small maintenance surface. This is P-010. The user explicitly rejected session-specific baseline capture, attribution and historical comparison machinery.

## Scope and visual agreement

- Git diff tab between OpenSpec and Subagents.
- Ordinary repository working changes using conventional Git semantics. No captured session baselines or session ownership claims.
- Compact file list and toolbar following Deck's existing typography, palette and controls.
- Two rendering modes: side-by-side (old and new columns) and inline/unified (one column with additions and removals). Both render the same comparison.
- Reconsider existing left/right folding controls as a coherent layout system before implementation. The user rejected simply adding a shared right-panel expand button; that earlier placement is superseded.
- Approved desktop framing: one stable layout-control group in the application header, with a sessions-navigation toggle and a content-view selector (Chat / Both / Workspace). Distinguish sessions navigation, conversation and workspace explicitly; do not confuse the left navigation sidebar with the chat pane.
- Content modes share one state: Chat shows only the conversation, Both shows chat and workspace, and Workspace gives Activity/OpenSpec/Git diff/Subagents the combined content width. Never allow both content panes to be hidden. Existing redundant hide/expand controls should be replaced rather than accumulated.
- Layout controls remain reachable in every mode. Switching workspace tabs retains the selected layout; returning to Both restores the previous split with chat state and draft intact. Mobile keeps one-view navigation and its sessions drawer, using the same visual vocabulary without exposing an unusable split mode.
- Keep the selected file when switching modes or expanding/restoring; preserve reading position where practical. Expansion is an explicit user action, not an effect of opening details.
- On mobile, default to inline and keep file navigation accessible; avoid forcing unreadably narrow columns.

## Approved acceptance criteria

1. Users can open the tab in the requested order and select changed files with line numbers and surrounding context.
2. Side-by-side and inline show the same additions/removals without changing the underlying comparison or losing file selection.
3. A coherent layout system replaces redundant existing left/right controls. Users can reach Chat, Both and Workspace without a blank content state; sessions navigation remains independently reachable. Switching workspace tabs retains the selected layout. Returning to Both preserves the previous split, conversation state and draft. Lead/subagent execution continues while a view is hidden. Mobile transitions keep all views reachable.
4. Conventional staged/unstaged distinctions remain clear. New, deleted, renamed and binary files have appropriate representations. Unavailable or bounded content is not represented as an empty or complete diff. Document exact Git command mapping during technical design without adding a custom comparison system.
5. Refresh preserves selection and reading position where possible. Loading, no changes, errors and large-file limits have clear states.
6. Load content on demand with bounded output; no periodic Git scanning in hidden tabs and no model calls or context injection.
7. Viewing does not change repository files, index or history. Keep file access within the repository and render diff text inertly, without external diff/textconv execution.
8. Browser verification covers both diff modes; expansion/restoration and tab switching across all four workspace views; desktop/mobile transitions; keyboard access; long lines; large diffs; and preservation of the chat draft and active view state.

## Non-goals

Session baselines/snapshots, per-session or per-agent attribution, historical comparison selectors, staging/commit/discard actions, merge resolution, a full repository browser and AI explanations. Native continuation and member steering remain separate changes.

## Planning notes

The earlier two-comparison proposal and session-linked file filter are superseded by the user's request for a conventional viewer. The subsequent right-panel expand-button proposal is also superseded: the latest user direction requires rethinking existing left/right folding controls together to prevent inconsistent UI. The header grouping and three content modes above are approved product behavior; detailed implementation remains paused. Side-by-side/inline diff rendering remains in scope. deck-frontend-design preserves existing visual identity; fixing-accessibility is the complementary review responsibility when implementation starts. Prefer existing primitives and a maintained diff renderer if suitable; no dependency is selected yet.

Prior bounded source inspection confirmed tab/panel navigation in apps/web/src/workspace.tsx and apps/web/src/main.tsx. Graph generation was 2026-08-20 and discovery was insufficient; implementation paths beyond navigation remain unverified.

The latest user approval authorizes the corrected framing and implementation. The prior statement describing header grouping as unapproved is superseded. Keep a single vertical implementation owner across Git access, transport and UI; review the candidate against these criteria. Use real implementation/review work for continuity measurement without enlarging scope for benchmarking.
