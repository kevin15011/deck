# Role-owned skill context and responsive Pi delegation

## Intent and authorization
The user requests persistent Deck behavior rather than session-only promises. Shared skill-loading ownership belongs in Core because the excess Lead context occurs across runners. Pi-specific background orchestration and panel behavior remain in adapter-pi. No personal installation, provider calls, commits or release are authorized.

## Acceptance
- Canonical Lead agent, skill and session instructions route using concise role descriptions without preloading specialist execution skills just to delegate.
- The executing role loads applicable full skills in its own context; content already supplied need not be read again. Lead can load execution skills when performing that work directly. Required safety/authority guidance is preserved.
- Pi-generated launch profiles instruct timely delegation once scope and necessary safeguards are established, prompt conversational yield after background acceptance, no waiting/polling loops, and autonomous review/integration upon completion.
- This is instruction-level guidance, not a host-enforced token or latency guarantee. Other runners do not receive Pi orchestration rules.
- Production materialization and focused tests establish propagation. Existing panel delta remains tracked under pi-background-subagents.

## Implementation route
Lead implements the small canonical instruction and Pi profile changes directly, independently of the now-completed Apply Fast panel candidate. Tests exercise canonical content and generated runner surfaces, including Pi profile files. No new workflow, registry refresh or separate implementation agent is needed.

## Result and evidence
Completed in repository; no personal installation performed.

- `packages/core/src/teams/developer/adaptive-team-content.ts`: canonical Lead context-ownership rules and executing-role skill responsibility in the shared runtime contract. Specialist skill bodies retain the existing compact contract reference rather than duplicating it.
- `packages/adapter-pi/src/pi-team-profile.ts`: Pi-only early-delegation/conversational-yield guidance composed into the generated launch profile before optional capabilities and advisory memory.
- Regression tests verify the canonical Lead agent/skill/session surfaces, all seven role contracts, generated Pi/Codex/OpenCode Lead content, absence of Pi-specific orchestration in other runners, and an actual temporary Pi system-prompt file.
- Pinned Bun 1.3.12: `bun test packages/core/src/teams/developer packages/adapter-codex/src/developer-team-install.test.ts packages/adapter-opencode/src/developer-team-install.test.ts packages/adapter-pi/src/developer-team-install.test.ts packages/adapter-pi/src/pi-team-profile.test.ts`: 1,366 passed, 0 failed, 7,100 assertions across 38 files. Subsequent assertion-only strengthening of all-role coverage: 6 passed, 0 failed, 97 assertions. An initial additional test incorrectly expected the full runtime contract to be duplicated inside each skill; corrected it to verify the existing binding reference plus the agent-level rule.
- Combined native panel/PTY/extension/assets and instruction/profile check: 65 passed, 0 failed, 436 assertions. Root `tsc --noEmit` and `git diff --check` passed.

## Status and limits
Completed. Normal build and TUI Review & Install -> Run install are required to update the user's installed package/CLI; subsequent Deck launches materialize the new Pi profile. Existing sessions are not retroactively rewritten. These are durable generated instructions, not hard enforcement of model behavior or latency; no live-provider adherence benchmark is claimed. No production implementation changes were made to other runner adapters; their generated skill policy changes flow from Core. Prior Pi lifecycle verification remains baseline evidence, not a new full lifecycle run.
