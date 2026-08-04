/**
 * Shared Apply behavior for conversational iterations on an already-authorized
 * user outcome. The authorization gate and independent QA boundaries remain
 * unchanged.
 */
export const APPLY_CONTINUOUS_DELTA_RULE_V1 = `## Continuous Delta Execution

- A relative follow-up such as "move this up", "make it smaller", "change this copy", "try the other layout", or "fix that failure" continues the same user outcome when it stays inside the authorized targets, product intent, risk, and reversibility.
- Treat Lead's continuation authorization as an ordinary modifying batch. Do not require a new proposal, task artifact, phase restart, or repeated user confirmation solely because the instruction is incremental.
- Keep one authoritative candidate and implement the smallest complete delta. Preserve still-valid evidence and declare exactly which checks became stale because of the delta.
- Exercise the changed behavior through its relevant interface after each delta. Return the observed result, changed targets, invalidated evidence, and focused Apply-local checks so Lead can present a useful result quickly.
- There is no arbitrary revision-cycle limit. Continue while each delta remains authorized; stop only for a real product decision, scope expansion, protected risk, irreversible action, incompatible modifying effect, stale base, or an infeasible requirement.
- Apply-local checks support iteration but never replace fresh independent Verify or Review when the risk posture requires them.`;
