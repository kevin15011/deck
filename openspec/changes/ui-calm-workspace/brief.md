# Working Brief: Calm workspace and settings modal

Status: in progress (not installed). Lead-owned; English only.

## Intent
Make Deck2's web UI modern, minimalist and usable by humans while keeping every existing function reachable.

## Decisions (user-approved, 2026-11-16)
1. Settings is a modal dialog (T3 Code style): search, SVG icon per section, breadcrumb, close button. The "Session" section is removed; its actions live in the session menu.
2. The global "Capabilities" section becomes "Agents & tools". It covers global items only: which agents/runners are available and whether they work. Plain-language summary first; technical content goes in a collapsed "Technical details" disclosure.
3. Project-scoped items (code map / Codebase Memory, team configuration changes) move to per-project "Project settings", opened from the project's "..." menu in the sidebar. The project name is always visible there.
4. Visual redesign follows the structure of /home/kevin15011/deck-redesign-mockup (README.md): conversation-first, slimmer sidebar, row actions on hover or focus, fewer boxes, spacing/type hierarchy, human-readable agent status, technical metadata behind disclosure.
   - KEEP the existing theme system (themes.css) and all its palettes. The mockup palette is rejected; use theme tokens only.
5. Right panel = option C (hybrid):
   - Subagent progress is shown inline in the conversation as compact expandable lines (e.g. "Investigate · investigating credentials · 2 min").
   - Each inline subagent line shows the provider logo of its runner as a small inline SVG mark (Claude → Claude/Anthropic mark; Codex → OpenAI/ChatGPT mark; OpenCode and Pi → their own marks; unknown → neutral generic agent icon). The logo has an accessible label naming the provider. It is monochrome or uses theme tokens so it fits every theme, and it is derived from the existing recorded runner field (no backend change).
   - Activity, Subagents and Git details move to an on-demand floating inspector that overlays the conversation without reserving layout width. It opens from header icons with counters, and opens on its own only when attention is required (e.g. an approval).
6. Motion: GSAP only, Apple-like, interruptible, reduced-motion respected (repo AGENTS.md).

## Candidate
- /home/kevin15011/deck-next-settings-candidate (settings modal + Agents & tools in progress)
- Baseline: installed combined133 / 6ce06c42, UI28 assets; running PID 322212 must not be touched until approved install.

## Non-goals
- No backend API changes unless strictly required and reported.
- No palette changes.
