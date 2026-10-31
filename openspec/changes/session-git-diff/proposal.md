# Git diff viewer — product framing

Status: Implemented and independently accepted locally on Linux x64 with Bun 1.3.12. Native Linux arm64 and Darwin x64/arm64 qualification remains outstanding. No release, installation or daemon restart performed. See verify-report.md for evidence and limits.

## Intent

Provide a read-only project file browser and conventional Git diff viewer in the Web UI. The latest user request expands Review to unchanged project files and image previews, superseding the original changes-only scope. Prioritize readable files/differences and a small maintenance surface. This is P-010. Session-specific baseline capture, attribution and historical comparison machinery remain excluded.

## Scope and visual agreement

- Latest expansion: Review defaults to a project file tree with unchanged files in neutral colors and Git status colors for changes, while keeping a Changes view/filter for staged/unstaged/deleted comparisons. Reading a clean file must not imply modification. Text, Markdown and common raster image previews are available on demand; preserve the existing Markdown controls and tree reveal behavior.
- Hide Git administrative metadata. Hide ignored files by default to keep dependency/build folders manageable, with an explicit ignored-files visibility option if compatible with bounded lazy traversal. Never traverse outside the authorized project or execute document content. Image bytes, dimensions and unsupported formats must have explicit bounded behavior; image limits are separate from text-diff limits.

- Latest approved tab order: Chat, Activity, Subagents, Review. Remove the OpenSpec tab and rename the Git diff presentation to Review. This supersedes both previous orders; desktop retains its existing separate Chat pane behavior.
- Markdown files in the Review file tree expose an accessible SVG-icon button to render the full selected Markdown document using the existing safe Markdown renderer. Preserve diff access. Preview the index version for staged entries and working version for unstaged/untracked entries; deleted entries may preview the comparison's prior version. Content remains bounded and read-only through the authorized Git reader.
- The opened `.md` file's own header also exposes the Markdown-preview SVG control while viewing its diff, so users can switch in both directions without returning to the file tree. Preserve the existing tree control and Return to diff action.
- Reopening the file navigator reveals the current selection: expand its containing section/folders when needed and scroll the tree to the selected file without moving the document viewport or changing selection.
- Ordinary repository working changes using conventional Git semantics. No captured session baselines or session ownership claims.
- Compact file list and toolbar following Deck's existing typography, palette and controls.
- Latest user visual revision: replace the flat changed-file dropdown with an editor-like collapsible folder/file tree. Use orange for modified, green for new and red for deleted paths; preserve explicit status labels/icons and staged/unstaged/untracked distinctions. Retain the existing diff rendering modes and overall Deck identity. The previous dropdown presentation is superseded.
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

Session baselines/snapshots, per-session or per-agent attribution, historical comparison selectors, staging/commit/discard actions, merge resolution and AI explanations. Native continuation and member steering remain separate changes. The former exclusion of a repository browser is superseded by the user's explicit request for project-wide files and image visualization.

## Planning notes

The earlier two-comparison proposal and session-linked file filter are superseded by the user's request for a conventional viewer. The subsequent right-panel expand-button proposal is also superseded: the latest user direction requires rethinking existing left/right folding controls together to prevent inconsistent UI. The header grouping and three content modes above are approved product behavior; implementation has resumed. Side-by-side/inline diff rendering remains in scope. deck-frontend-design preserves existing visual identity; fixing-accessibility is the complementary review responsibility. Prefer existing primitives and a maintained diff renderer if suitable; no dependency is selected yet.

Prior bounded source inspection confirmed tab/panel navigation in apps/web/src/workspace.tsx and apps/web/src/main.tsx. Graph generation was 2026-08-20 and discovery was insufficient; implementation paths beyond navigation remain unverified.

The latest user approval authorizes the corrected framing and implementation. The prior statement describing header grouping as unapproved is superseded. Keep a single vertical implementation owner across Git access, transport and UI; review the candidate against these criteria. Use real implementation/review work for continuity measurement without enlarging scope for benchmarking.
