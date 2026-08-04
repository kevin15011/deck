# Proposal — Adaptive Developer Team Redesign

## Status

- Change ID: `adaptive-developer-team-redesign`
- Classification: Full SDD selected because the change migrates installed runner state and protected execution bindings.
- Status: approved by the user for implementation on 2026-08-04.

## Problem

The installed Developer Team applies a fourteen-role, phase-heavy workflow even when the requested outcome is a small reversible change. Repeated planning, context reloads, fragmented ownership, and universal-looking QA make normal work materially slower than clean Codex while still missing production-composition defects.

## Intent

Replace the installed team with seven adaptively activated agents: `deck-lead`, `deck-investigate`, `deck-architect`, `deck-apply-fast`, `deck-apply-deep`, `deck-quality`, and `deck-setup`. Preserve OpenSpec, TDD, Git safety, model selection, skill discovery, Serena, Codebase Memory, Context Mode, RTK, adaptive memory, and installed domain skills while removing ceremony that is not justified by uncertainty or protected risk.

## Outcomes

- Small reversible work can be completed directly by Lead with a minimal check and lightweight OpenSpec persistence.
- Exploration, planning, Apply, Quality, and Setup activate only on their documented signals.
- TDD remains owned by Apply and is selected by behavior type rather than imposed artificially.
- Fresh and upgraded OpenCode/Pi installations converge on the same seven-agent inventory.
- Legacy Deck-managed agents are absent from active runner locations after successful migration and are preserved safely when retired.
- Existing model choices migrate only when the mapping is unambiguous and remain reviewable in the TUI.

## Scope

Canonical catalog and content, capability routing, model migration, runner execution bindings, OpenCode/Pi materialization and reconciliation, bootstrap skills, TUI-driven model inventory, generated runner assets through their generator, focused documentation, and tests for fresh install and legacy upgrade.

## Non-goals

- Replacing runner-neutral package boundaries.
- Removing installed capability packages or domain skills.
- Rewriting historical OpenSpec artifacts containing legacy IDs.
- Making every request use Full SDD or independent QA.
- Inferring model power or silently choosing among conflicting legacy assignments.

## Rollback

The catalog change can be reverted as a forward change. Runner updates use existing backups plus legacy-file quarantine; a failed candidate is restored before reporting failure. Historical compatibility mappings remain read-only and do not materialize legacy aliases.
