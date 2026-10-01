# Exploration: OpenCode Supermemory Plugin Profiles

## Evidence and boundaries

- The prior Deck-owned OpenCode memory hooks and the official plugin would both own memory effects if simply co-loaded. The selected design retires only Deck-owned OpenCode memory effects, retaining other runners and the authorization plugin.
- The shipped Supermemory 2.0.15 artifact and OpenCode 1.18.31 loader have different entry-point expectations; the loader-only adapter is tested against the published artifact.
- The user's canary confirmed one OpenCode installation, canonical repository tag, and project-memory write. It is not evidence for every process-composition or multi-profile lifecycle scenario.

## Outcome

The proposal and working brief contain the detailed source trace and accepted trust boundary. Actual full process composition remains an open verification follow-up; the user explicitly accepted this risk for v0.6.0 publication on 2026-09-29. No unobserved test is represented as passing.
