# Pi memory reinitialization fix

## Current status — verified by Lead, 2026-10-04
The user subsequently required Lead-only completion without subagents. Lead preserved the implementation, corrected native reload test isolation (Bun `type: file` import cache versus executable module identity), and completed combined validation. The move to safe settled-boundary continuation also exposed missing advisory context in native custom-message turns; the Pi extension now reuses only the exact parent's existing advisory ephemerally when absent, without duplicate injection, provider recall, raw child capture or session persistence.

Final combined evidence: 1,141 passing tests, 0 failures, 5,055 assertions across 88 files on pinned Bun 1.3.12; root TypeScript and diff hygiene pass. Tests include actual native reload, negative credential/handoff cases, child role policy, continuation privacy and normal TUI distribution. Details: ../pi-background-subagents/verification.md. No personal installation or live provider was used. The prior scoped independent memory review remains historical; current integration/boundary review belongs to Lead.

The following records preserve the original implementation request and delegation history.
## Intent
Fix the false missing-memory-endpoint/token-file warning and missing memory tools after a Deck Pi memory extension reinitializes in the same process. User explicitly requests implementation with subagents to exercise the new background delegation UI. Repository changes only; normal TUI installation remains the delivery route. No personal Pi installation/config changes, real credentials in tests, live providers or real install runs.
## Confirmed evidence
- The reported live canary Pi process was initially supplied both bridge fields; the token file existed. Only presence was inspected, never token contents.
- Deck config enables Supermemory; the installed subagents bundle matches the current repository candidate.
- Minimal factory reproduction with a fake endpoint, fake token reader and shared environment: first initialization registers memory_search/memory_save; second initialization registers neither and emits the exact reported missing-endpoint/token-file warning.
- memory/extension.ts reads only environment and scrubs all DECK_RUNNER_MEMORY_TOKEN* keys. shared/memory-handoff.ts already holds a process-local endpoint/token-file handoff for children, but memory initialization does not consume it.
- The concrete trigger of the user's second initialization (reload/replacement/bootstrap) has not been established. Do not overclaim a live root trigger or suppress real invalid handoff failures.
## Acceptance
- Reinitializing the extension through actual Pi resource reload preserves healthy bridge/tool availability without exposing tokens in the environment or emitting a false warning.
- Fresh initialization still works; missing/invalid/non-loopback/unreadable/empty credentials still fail open with a bounded warning and no usable memory tools.
- Explicit disabled memory remains silent and cannot reuse stale published credentials. Fresh explicit launch handoff takes precedence over cached data; partial/invalid explicit input must not silently cross-bind to a previous bridge.
- Preserve lead/child role policies, runtime-managed immutable scope, private token-file contract, no stored bearer token/global environment token restoration, and existing subagent forwarding.
- Tests include two initialization/reload cycles, real native Pi composition with fake effects, disabled/failure/stale state boundaries and generated bundle freshness/TUI delivery.
## Route and ownership
Apply Fast owns the complete code/test delta; Lead owns this brief and evidence. Independent Quality reviews memory transport and cache/lifecycle boundaries. Existing background-subagent work and unrelated .serena/project.yml/.bun-cache changes must be preserved.
## Targets
packages/adapter-pi/src/pi-extensions/memory/extension.ts; shared/memory-handoff.ts if needed; corresponding unit/native tests; generated assets via scripts/generate-pi-extension-assets.ts only.
## Progress
Apply task 1043ccb8-10fe-4509-86f7-893a984c8096 completed the memory candidate with 100 focused tests and 13 delivery checks on Bun 1.4.0. Owner reported prior inconsistent combined Bun 1.3.12 failures; native reload passed standalone. Lead reran memory + child runner/extension + generator checks with the existing Bun 1.3.12 binary: 93 passed and only 3 source-digest freshness checks failed while the separately authorized panel owner was actively changing panel source. All runtime/reload/abort checks passed in this Lead rerun. Do not conclude all-version freshness until the panel owner settles and final combined assets are regenerated.
Independent Quality task c26b7d81-cb30-4661-b199-9378d698258b is reviewing the memory/transport boundary. Panel task 49f1cbff-a4b8-41b5-ab96-0dc956551e27 owns only panel source/tests and intentionally leaves generated assets to Lead. No personal installation changes authorized or performed.
