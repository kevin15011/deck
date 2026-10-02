# Codex model assignment preservation

Issue: https://github.com/kevin15011/deck/issues/11

Status: implemented in source; user confirmed the corrected Codex session through canary. Stable `deck` remains unchanged.

## Outcome

Fresh `deck codex developer` sessions must retain the configured `deck-lead` model and reasoning effort as the main-session launch selection. Regenerating Deck-owned Codex roles must not silently erase an existing or newly selected assignment when model discovery is missing or the catalog no longer confirms it.

## Targets

- `packages/adapter-codex/src/runner-adapter.ts`: preserve unchanged role assignments without requiring a fresh catalog; validate requested changes with authenticated evidence; reject plans whose generated role loses any requested model or reasoning field.
- `packages/adapter-codex/src/runner-adapter.test.ts`: cover fresh-process preservation, unavailable/retired catalog, reasoning-only roles, and blocked unsafe changes.
- Leave `~/.codex/config.toml` and Codex resume semantics unchanged.

## Evidence

- Before: stable `deck codex developer --dry-run` exited 0 while warning `Model assignment for deck-lead is not confirmed by Codex evidence and was omitted.`
- After: `deck-canary codex developer --dry-run` exits 0 without that omission and reports preserving `deck-lead`; the stable binary still exhibits the old warning.
- Focused adapter tests: 5 passed; install/launch tests: 34 passed; CLI launch tests: 57 passed; `tsc --noEmit` passed. Independent read-only review found no remaining material defect in the candidate.
- The broader adapter/tools combined test command exceeded the local 180-second limit; the focused checks above completed. No release-wide test claim is made.
- `deck-canary` was installed separately; no stable binary replacement or global Codex model change was made. The user confirmed the main session now uses the Deck-configured model when launched through canary.
