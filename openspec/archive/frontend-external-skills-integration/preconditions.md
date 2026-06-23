# Preconditions: Frontend External Skills Integration

## Closure State

None.

## Explanation

Spec and Design are consistent. All open questions raised in the proposal phase have been resolved inside the Design artifact:

- OQ-1 (supported runner inventory) — resolved by Design §Adapter Installation Model: OpenCode and Pi are the supported runners with native skill installation.
- OQ-2 (roadmap documentation status) — resolved by Design §Open Decisions: leave `docs/skills-integration-roadmap.md` unchanged; treat as historical/reconstructed.
- OQ-3 (script executable-bit preservation) — resolved by Design §Migration / Backward Compatibility: preserve content/path only; file-mode metadata is out of scope.
- OQ-4 (adapter default install behavior) — resolved by Design §Silent Installation Design: install all registered standalone skills silently with no per-skill opt-in.
- OQ-5 (`ui-skills-root` prompt wording) — resolved by Design §Injection / Routing Rules: position as router for UI work, do not auto-load every downstream UI skill.

No conflicts between Spec and Design. No missing decisions. Tasks artifact covers all required surfaces (registry, generator, manifest, runner-neutral contracts, OpenCode + Pi adapters, role guidance, tests, verification).

## Closure Decision

- Ready for Apply: Yes
- Notes: None