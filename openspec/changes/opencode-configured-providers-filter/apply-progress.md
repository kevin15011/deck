# Apply Progress: OpenCode Configured Providers Filter + TUI List Rendering

## Completed Tasks

### Frontend Task: MenuList windowing visual/navigation bugfix (long model/provider lists)

**Status**: ✅ Complete
**Agent**: Frontend Apply

**Root Cause**

The previous windowing implementation in `MenuList` used a regular ASCII space (`" "`)
for placeholder rows that keep the rendered list height constant when only one of the
two scroll indicators (`…`) is active (cursor pinned to the top or bottom of the list).

Ink's `Output.get()` (`node_modules/ink/build/output.js`) applies `.trimEnd()` to every
line before joining them with `\n`. A line containing only a regular space is trimmed to
an empty string `""`. This has two compounding effects:

1. `renderToString` produces an empty line — the row "disappears" in string-based output
   and in tests that count non-empty rows.
2. In the live terminal, Ink's `log-update` (`node_modules/ink/build/log-update.js`)
   splits the output by `\n` and uses `lines.length` as `previousLineCount` to drive
   `ansiEscapes.eraseLines(previousLineCount)` on the next render. When the trailing
   placeholder is blank, the joined output ends with `\n`, which inflates
   `previousLineCount` by one. On the subsequent keypress, Ink erases one line too many,
   shifting the entire list upward and making the cursor (`❯`) and nearby items appear to
   vanish. Navigating one row at a time near the top or bottom of a long list therefore
   looked "not precise nor stable" and the "selector disappears" — exactly the symptom
   the user reported.

A secondary, latent defect: the `focused = index === cursor` check used the raw
`cursor` prop. `computeWindow` already clamps the cursor internally for window math, but
the render path did not, so a transiently out-of-range cursor (e.g. during async model
list shrinkage or provider swap) would leave the selector unrendered entirely.

**Fix**
- Replace `<Text> </Text>` placeholder rows with `<Text>{"\u200B"}</Text>` (zero-width
  space, U+200B). ZWSP is **not** matched by JavaScript's `\s` class, so it survives
  Ink's `.trimEnd()`. It is zero terminal width, so the row still looks visually blank
  while reliably occupying a rendered line. This keeps the joined output from ending with
  `\n` and stabilizes `previousLineCount` across renders.
- Add a defensive `safeCursor` clamp in `MenuList` and use it for both `computeWindow`
  and the `focused` comparison, so the selector is always rendered on a valid item even
  if the parent passes a stale cursor.
- Short lists (`totalItems <= maxVisible`) keep their original behavior: no windowing,
  no indicators, no reserved rows.

**Files Changed**
- `apps/cli/src/tui/components/menu-list.tsx` — modify: ZWSP placeholders + defensive
  cursor clamp.
- `apps/cli/src/tui/components/menu-list.test.tsx` — modify: fix `Item` → `Model` label
  mismatch in the "short lists keep their original layout" test; add regression tests
  for ZWSP placeholder survival and out-of-range cursor clamping.

**Verification**
- Frontend Tests: pass (32/32 in `menu-list.test.tsx`; 37/37 in `developer-team-screens-effort.test.tsx`)
- Build: skipped (no build step requested; targeted typecheck used instead)
- Typecheck: pass for touched files (zero diagnostics in `menu-list.tsx` and
  `menu-list.test.tsx`; Serena LSP diagnostics clean; 121 pre-existing errors in other
  uncommitted files are unrelated to this change)
- Serena diagnostics: clean (`{}`) for both touched files

**Behavior Verified**
- `total rendered row count is constant across navigation in a long list` — passes for
  all 50 cursor positions; count is stable at `maxVisible` (10).
- `cursor is always visible at every position in a long list` — passes.
- `cursor row position stays stable when entering the windowing range` — passes.
- `indicators do not break global cursor alignment` — exactly one `❯` per render.
- `placeholder rows use zero-width space (not trimmed to empty)` — new regression test:
  output does not start or end with `\n`; every line is non-empty.
- `cursor out of range still renders the selector (defensive clamp)` — new regression
  test: `cursor=999` clamps to last item; `cursor=-3` clamps to first item.
- `short lists keep their original layout (no indicator slots reserved)` — passes after
  fixing the `Item`/`Model` label mismatch.
- `empty list does not render a selector` — new regression test.
- No new failures introduced in the broader TUI suite (11 pre-existing failures
  confirmed identical with and without this change — all in unrelated files:
  `PersonalitySelectionScreen` third-personality mismatch, `action-runner` Supermemory
  safety, `internal package install action routing`).

**Notes**
- The fix is localized to `MenuList` and does not touch backend inventory/model logic,
  runner adapters, or provider filtering — those remain the backend/general apply
  scope described in `exploration.md` § "Minimal Fix Plan" steps 1–4.
- The `PersonalitySelectionScreen > shows cursor on Ahorro extremo when cursor=2`
  failure in `developer-team-flow.test.tsx` is pre-existing and unrelated: the test
  expects a third personality option ("Ahorro extremo") that does not exist in the
  current `PersonalitySelectionScreen` implementation (which only has `guia` and
  `pragmatica`). Confirmed failing identically with the original `menu-list.tsx`.
- `maxVisible` derivation from `stdout?.rows` is unchanged. It is stable within a
  session (only changes on terminal resize, which Ink handles). The blank-row collapse
  was the dominant root cause; no memoization of `stdout.rows` was needed.
- Used Serena symbolic editing (`replace_symbol_body` for `MenuList`) as first
  preference per skill guidance. Edit tools were available and worked correctly.

## Remaining Tasks

- Backend Task (steps 1–4 of exploration § "Minimal Fix Plan"): `auth.json` reader +
  configured-provider filtering + `env`/`env_vars` field-name fix in
  `packages/adapter-opencode/src/model-inventory.ts`. Owned by Backend Apply / General
  Apply — out of scope for this Frontend Apply pass.
- Optional: consider promoting `maxVisible` to an explicit prop on
  `ModelProviderSelectionScreen` / `ModelSelectionScreen` call sites for deterministic
  test coverage of the terminal-height path. Not required for the bugfix.
