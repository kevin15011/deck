# Pi background subagents
## Intent and authority
Implement the user-approved Pi-only background delegation and observable progress experience in Deck repository source. Distribution MUST use the existing TUI Review & Install flow. Do not modify the user's installed Pi, home configuration or extensions; do not run installation. Tests use isolated temporary fixtures.
## Outcome
Lead remains conversational while specialists work. A right-hand floating, minimizable panel shows honest live progress and stays anchored to the visible terminal during conversation scrolling. Completion and important progress reach Lead without polling spam.
## Scope
Background single/parallel/chain jobs; session-bound job records and persistent child sessions; progress/details/cancel/explicit resume controls; lifecycle isolation; generated assets and installation tests; documentation.
## Boundaries
New Pi sessions never adopt old jobs. Native /resume alone selects the original parent session. Restoring records never starts a child. Session switch/shutdown cancels owned children. No daemon, cross-runner change, home installation, credentials storage, auto-replay of mutating tasks, or global project job registry.
## Compatibility
This change supersedes synchronous-only and --no-session child requirements in pi-runner-parity only for the new session-bound background lifecycle. Preserve role policies, model selection, child recursion prevention and bounded concurrency/output.
## Risks and rollback
Race conditions, stale callbacks, duplicate resumes, terminal scroll/focus regressions and misleading progress require deterministic and native-runtime evidence. Reverting distribution to the preceding generated extension disables the feature; preserve saved records for inspection, never delete user sessions as rollback.
