# Apply Progress: Canonical Supermemory Conversation Memory

## Status

- Phase: Apply
- State: In progress
- Started: 2026-08-11
- Implementation owner: one continuous Apply Deep candidate through the first functional vertical

## Approved defaults

1. Selecting Supermemory enables agent-mediated automatic high-signal save and materially relevant recall; no additional option is shown.
2. Every project-scoped MCP operation explicitly receives the canonical repository `containerTag`; `x-sm-project` alone is not considered sufficient.
3. The seven-memory semantic quota is deprecated rather than replaced.
4. Project scope is mandatory and never falls back to `sm_project_default`.
5. Migration is non-destructive and deletion is excluded.

## Progress

| Phase | Status | Evidence |
|---|---|---|
| 0. Provider and baseline evidence | Completed | Official provider-native scope, `customId`, dynamic dreaming, profile, and hybrid-search capabilities were confirmed. No safe runner-authenticated automatic execution boundary was found. |
| 1. Canonical identity vertical | Completed with blocked capture | Canonical Git-remote scope resolution is fail-closed and rejects local/path fallbacks. Native OpenCode scope is configured; automatic conversation execution remains unsupported. |
| 2. Runner parity | Completed for scoped native MCP | OpenCode, Pi, and Codex use the canonical endpoint and project scope contract. Automatic capture/profile/search is classified `unsupported/static-compatible` for all three runners. |
| 3. Conversation/retrieval policy | Completed with blocked execution | Manual topic keys, mandatory summaries, and the seven-memory behavioral quota were removed. Redaction, stable request construction, migration hashing, and retrieval bounds exist, but no automatic provider execution is claimed. |
| 4. Unified installation/diagnostics | Completed | No additional capture option was added. Doctor fails closed without a verified root and reports provider-specific scope/config state without ambient-CWD fallback or false parity claims. |
| 5. Non-destructive migration | Completed for dry-run | Local inventory classification validates destination scope, normalizes hashes, redacts record IDs, and exposes neither copy nor deletion effects. Remote copy remains blocked until authenticated provider enumeration is proven. |
| 6. Verification/review | Passed for partial candidate | Full suite passed 4,507/4,507; TypeScript and diff checks passed. Independent Quality returned GO for the honest partial candidate. |

## Runtime correction approved on 2026-08-12

Fresh OpenCode testing after reinstall proved:

- Deck correctly writes and OpenCode resolves `x-sm-project: sm_project_v1_kevin15011_deck`.
- `supermemory_add_memory` without `containerTag` still writes to `sm_project_default`.
- The same operation with explicit `containerTag: sm_project_v1_kevin15011_deck` writes to the canonical project space.

The user selected the MCP-only correction: preserve automatic agent save/recall behavior and make Deck materialize the current project's canonical tag into every applicable Supermemory request. No plugin, proxy, per-operation prompt, active-space mutation, or new UI choice is authorized.

## Verification evidence

- Focused final Doctor/Codex/Supermemory checks: 55 passed, 0 failed.
- Final repository suite: 4,507 passed, 0 failed across 294 files; 18,416 assertions.
- `bunx tsc --noEmit`: passed.
- `deck openspec validate --change canonical-supermemory-conversation-memory --json`: 0 errors, 0 warnings.
- `git diff --check`: passed.
- Independent Quality result: GO for the scoped, non-destructive, truthfully classified partial candidate.

## Remaining blocked requirements

- Whole-conversation ingestion, stable session documents, and dynamic dreaming remain outside the MCP-only agent-mediated design.
- Hard transport enforcement remains unavailable because the exposed tool schemas still allow omitted `containerTag`; this candidate enforces scope through project-bound materialized instructions.
- REQ-SM-051: remote copy is unavailable until authenticated enumeration/copy capabilities are proven.

## Live runner observation

The session-close adaptive-memory save performed after verification was routed by the currently installed Supermemory MCP environment to `sm_project_default`. This does not invalidate the repository candidate; it confirms that current installed runner configuration has not yet adopted the new canonical scope and that direct provider tools remain outside an automatic Deck execution boundary. The record was not deleted or moved because remote destructive effects were not authorized.

## Current result

The current candidate is safe and mergeable as a partial implementation: it fixes project isolation, endpoint drift, quota/prompt behavior, diagnostics, and migration safety without claiming unavailable automatic behavior. The OpenSpec change remains `Apply / in_progress` and MUST NOT be marked complete or archived until the blocked production execution requirements are resolved or formally superseded.

## Explicit per-operation scope delta — 2026-08-13

Fresh OpenCode runtime testing established that the active Supermemory tools route an omitted `containerTag` to `sm_project_default` even when the MCP connection has the correct `x-sm-project` header. Passing `containerTag: sm_project_v1_kevin15011_deck` explicitly routes correctly.

The implemented delta now:

- derives one canonical scope from the verified repository root;
- requires an observed configured canonical scope and exact agreement with the derived scope before operational memory guidance or bindings are materialized;
- rebinds caller-supplied adaptive-memory fragments while preserving unrelated package instructions;
- propagates the exact tag to Lead/session, specialists, delegation, agent-bound skills, standalone skills, and bootstrap skills for OpenCode, Pi, and Codex;
- emits exact scoped examples for add, search, memory/document listing, graph, and save operations;
- prohibits active/default-space fallback and constrains document-ID reads to IDs returned by a scoped predecessor;
- fails closed for memory and fail-open for coding when scope is absent, default, invalid, or mismatched;
- makes Doctor compare derived and observed runner scopes using the verified project root;
- regenerates tracked Codex/agent guidance through the canonical runner-sync path.

Final evidence for this delta:

- Full repository suite: 4,541 passed, 0 failed across 295 files; 18,746 assertions.
- `bunx tsc --noEmit`: passed.
- `deck openspec validate --change canonical-supermemory-conversation-memory --json`: 0 errors, 0 warnings.
- `git diff --check`: passed.
- Independent Quality: GO after verifying Codex first-install post-merge scope, generated-content integrity, launch/sync negative paths, Doctor root plumbing, and corrected Pi setup wording.

Residual limitation: enforcement is instruction/tool-binding based. The upstream tool schemas still permit omitted `containerTag`, so Deck cannot technically prevent an external or non-compliant caller from issuing an unscoped operation without a trusted authenticated interceptor. This limitation remains explicit and no plugin/proxy was added.

## First-class runtime supersession — 2026-08-15

The user explicitly superseded the MCP-primary limitation and authorized a Deck-owned automatic runtime above runners. The historical partial candidate remains valid evidence and rollback material, but it is no longer the target architecture.

New approved target:

- Adaptive Memory is Enabled/Disabled; Supermemory is the only durable backend and Engram is removed.
- Automatic profile/search/capture executes through Deck Runtime and does not depend on voluntary MCP calls.
- MCP remains separately diagnosed for ad-hoc recall and must not double-ingest automatic capture.
- Deck owns lifecycle, canonical project/session identity, capture/recall policy, sanitization, budgets, permissions, fail-open, and content-free observability.
- Supermemory owns extraction, semantic learning, graph, updates, supersession, forgetting, temporal reasoning, profiles, ranking, reranking, rewriting, and aggregation.
- The standalone Deck installer contains the client and requires no manual SDK, Node/npm, or runner configuration.

Provider evidence retrieved 2026-08-15 from official Supermemory documentation:

- canonical write/search/profile endpoints are `/v3/documents`, `/v4/search`, and `/v4/profile`;
- API authentication uses `Authorization: Bearer` and project isolation uses explicit body `containerTag`;
- stable conversation `customId` preserves session continuity;
- profiles expose provider-owned static and dynamic context;
- official harness guidance is read context, generate, then write the turn/conversation under the stable ID.

SDK spike evidence:

- `supermemory@4.25.4` compiled with Bun for Linux x64/arm64 and macOS x64/arm64;
- the compiled Linux x64 binary loaded `add`, `search`, and `profile` without Node/npm;
- mocked real operations, TLS, timeout, extracted-archive, and error-redaction tests remain required before final transport selection.

## First-class runtime completion — 2026-08-15

The superseding implementation is complete and independently approved.

Delivered behavior:

- removed Engram and provider selection; Adaptive Memory is Enabled/Disabled with conservative legacy migration;
- added a Deck-hosted authenticated loopback lifecycle protocol shared by OpenCode, Pi, and Codex thin runner assets;
- kept provider credentials and server-bound project scope inside Deck Runtime while exposing only ephemeral bridge credentials to runner processes;
- implemented native model-visible advisory context injection, role/session propagation, stable conversation `customId`, replay protection, explicit recall/remember semantics, and bounded shutdown flush;
- implemented central capture eligibility, high-confidence secret rejection, inherited-environment sanitization, advisory-data escaping, and a physical five-item/1,500-token/6,000-byte context ceiling;
- selected a minimal abortable HTTP client over the three official endpoints after the SDK wrapper failed the per-operation cancellation requirement;
- retained project-scoped MCP as a credential-free ad-hoc complement and reports its activity as external to runtime observability;
- added owner-only secret storage, Enabled setup/API validation, read-only Doctor diagnostics, content-free metrics, DeckMemoryBench, extracted standalone-binary smoke, and ordered release gates.

Final evidence:

- independent Quality: GO;
- full repository suite: 4,604 passed, 0 failed; 19,307 assertions across 301 files;
- adversarial bridge/security bundle: 151 passed, 0 failed;
- acceptance-area bundle: 424 passed, 0 failed;
- `bunx tsc --noEmit`: passed;
- DeckMemoryBench: 13/13, precision 1.0, recall 1.0, local p95 approximately 0.26 ms against the 20 ms gate;
- compiled verification: Linux x64 execution plus Linux arm64/macOS x64/macOS arm64 compilation, extracted Deck binary with empty PATH, authenticated loopback capture, read-only Doctor, and standalone Codex hook execution;
- change-scoped OpenSpec validation: 0 errors, 0 warnings;
- `git diff --check`: passed.

Documented limitations:

- live Supermemory ranking and live TLS were not exercised with real credentials in CI;
- non-host release targets are compile-only in the current Linux CI environment;
- installed Codex hook configuration invokes the standalone `deck` command and requires Deck itself on PATH;
- Pi final-assistant capture depends on the native final-message event exposed by the installed Pi version;
- external MCP ad-hoc calls are outside Deck Runtime observability;
- remote provider-record copy/deletion is not implemented or authorized.

## Post-reinstall Doctor correction — 2026-08-15

Validation against the rebuilt installed OpenCode configuration found and corrected two stale diagnostics:

- Doctor no longer treats a `supermemory` CLI binary as a prerequisite or asks users to install one; the provider client remains internal to standalone Deck.
- Doctor now reports the Deck-supervised native loopback route matrix and runner-specific final-assistant limits instead of the superseded exec-only message.

Evidence: 60 focused Doctor/binary tests passed, TypeScript passed, compiled-runtime verification passed, the rebuilt Doctor report contained no Supermemory CLI installation guidance, and `git diff --check` passed.

## Native-OAuth runtime credential correction — 2026-08-15

Two real OpenCode reinstall attempts reproduced a missing runtime secret despite successful MCP materialization. Root cause: TUI validation treated runner-native MCP OAuth as if it also satisfied Deck Runtime API authentication, so read-only API validation and secret-store persistence were skipped for OpenCode.

The correction fully separates the two authentication planes:

- optional runner MCP OAuth remains credential-free and runner-owned;
- Adaptive Memory Enabled always requires an ephemeral Supermemory API key for Deck Runtime;
- Deck performs read-only API validation and writes the key to the owner-only secret store regardless of MCP OAuth support;
- missing runtime credentials fail setup even when MCP OAuth is ready;
- the API key never enters runner MCP configuration.

Regression coverage proves native-OAuth OpenCode executes MCP validation, read-only runtime API validation, and secret-store write in order. Focused action-runner tests, TypeScript, rebuilt binary, and `git diff --check` passed.

## Start Installation runtime credential correction — 2026-08-15

A third real reinstall confirmed that the prior correction covered the runner-dashboard Review & Install path but not the primary Start Installation flow. The `developer-team-installing` effect applied runner files directly and bypassed the shared Supermemory validation action.

The primary flow now uses the same centralized validate-and-store operation before any runner mutation:

1. resolve verified project root and canonical scope;
2. require the ephemeral runtime API key;
3. perform read-only Supermemory API validation;
4. write the key to the owner-only Deck secret store;
5. clear the ephemeral TUI value;
6. apply and verify Developer Team files.

Missing/invalid credentials or secret-store failure stop installation, clear the token, and prevent config from claiming runtime readiness. A new OpenCode native-OAuth Start Installation regression failed RED with order `apply` instead of `api -> apply`, then passed GREEN after the fix. Focused Start Installation/dashboard/E2E tests, TypeScript, rebuilt binary, and diff checks passed.

## Token-submit persistence boundary — 2026-08-15

A fourth real validation showed config updates without plugin reapplication, proving another TUI entry path could enable Adaptive Memory without entering either later validation gate. Deferring first credential persistence to Review/install phases was therefore the wrong lifecycle boundary.

The shared `supermemory-token` submit boundary now owns first-time readiness for every TUI entry path:

1. resolve verified project root/canonical scope;
2. perform centralized read-only API validation;
3. write the runtime key to the owner-only secret store;
4. only then persist Adaptive Memory Enabled and navigate;
5. clear the ephemeral token immediately.

Start Installation, Configure Packages/package-selection, and runner-dashboard token-submit tests prove the secret exists before later install actions. Invalid credentials leave Adaptive Memory disabled, write no secret or ready runner state, remain on setup, and expose only redacted errors. Later install gates remain defense-in-depth and can reuse the stored secret after ephemeral state is cleared. Focused TUI/install/action-runner tests, TypeScript, rebuilt binary, and diff checks passed.

## Runtime credential and optional MCP OAuth UX separation — 2026-08-15

Real Review & Install output exposed the last overloaded state: a successfully stored runtime key was followed by clearing ephemeral input, but the preflight interpreted the cleared input as missing readiness and requested token re-entry. OpenCode plan text also incorrectly implied native MCP OAuth removed the runtime API-key requirement.

The TUI now models three distinct states:

- `runtimeCredentialStored`: required Deck Runtime API key was validated and stored;
- `ephemeralTokenAvailable`: transient input exists only during setup and is cleared after storage;
- `mcpOAuthReady`: optional runner-native OAuth for ad-hoc MCP, never a substitute for runtime readiness and never a blocker for automatic memory.

Review/install blockers and validation consume persisted runtime readiness and can revalidate through the secret store after ephemeral input is cleared. OpenCode guidance now states that the Deck-owned runtime key is required, MCP OAuth is optional, and no API key enters MCP configuration. The setup label is `Supermemory API key (Deck Runtime)`. Compatibility normalization accepts legacy `hasToken` state without preserving its overloaded semantics.

Regression tests reproduce the exact OpenCode Review & Install screen: stored runtime credential plus cleared ephemeral input is ready and non-blocking; a missing stored credential blocks with actionable runtime wording. Focused TUI/dashboard/render/action-runner/capability-plan tests, TypeScript, rebuilt binary, and diff checks passed.

## Restart readiness hydration — 2026-08-15

With the runtime key now proven present and Doctor-ready, restart analysis found that fresh dashboard composition did not hydrate Adaptive Memory or secret readiness from canonical config. A new process could therefore forget stored readiness even though the owner-only secret remained valid.

`composeRegisteredRunnerDashboard` now hydrates runner-neutral memory state through an injected shared secret-store dependency:

- disabled config remains provider none regardless of stale secrets;
- enabled config plus a readable non-empty runtime secret becomes configured and `runtimeCredentialStored` without retaining the value;
- enabled config plus absent/read-error secret remains fail-closed for memory with redacted actionable diagnostics while the general dashboard remains usable;
- optional MCP OAuth is never inferred from the API key.

Fresh OpenCode/Pi/Codex dashboard plans consume this hydrated state. Restart regression coverage proves the real scenario—enabled config, cleared ephemeral input, existing secret—opens a ready OpenCode review plan without setup or token re-entry. Focused app/dashboard/reducer/render/action-runner/OpenCode tests, TypeScript, rebuilt binary, and diff checks passed.

## Authoritative secret-backed plan readiness — 2026-08-15

A fresh TUI still produced a stale not-ready plan while the real secret and Doctor readiness were valid, proving React/dashboard snapshots could remain older than persisted readiness. Runtime credential readiness is now re-resolved from the injected owner-only secret store at both plan-build and execution-preflight boundaries.

The resolver returns only a boolean, redacted diagnostics, and a content-free reason code (`state-ready`, `secret-ready`, `missing`, or `read-error`). Plan construction overlays authoritative readiness immediately before adapter review-plan generation; Review blockers and execution preflight use the same evidence. Missing/read-error secrets remain fail-closed for memory, and revision/CAS protections remain unchanged.

A real temporary owner-only secret plus intentionally stale OpenCode state regression proves the plan is ready, execution is non-blocked, and output contains stored-ready wording without secret disclosure. Removing the secret restores the runtime-credential block. Focused app/plan/input/render/action-runner/OpenCode tests, TypeScript, rebuilt binary, and diff checks passed.

## Generic-to-native readiness mapper correction — 2026-08-15

The exact real OpenCode plan was reproduced outside the TUI with canonical config, real owner-only secret, and current capability inventory. Hydrated dashboard state was correct, but `OpenCodeRunnerAdapter.buildReviewPlan` dropped `runtimeCredentialStored`, `ephemeralTokenAvailable`, and `mcpOAuthReady` while mapping generic state to the native plan, leaving only deprecated `hasToken=false`. This made exactly the Supermemory deck-config and validation actions pending.

OpenCode and Pi generic-to-native mappers now preserve all normalized readiness booleans without forwarding credential values; Core dashboard contracts expose the same runner-neutral fields. Pi planning also uses `runtimeCredentialStored` as its readiness authority with `hasToken` only as compatibility fallback. Adapter-level tests prove stored runtime readiness produces ready Supermemory actions while MCP OAuth alone remains pending.

The real-plan reproduction now returns `ready=true`; Supermemory deck-config, MCP config, and validation actions are all ready, with info diagnostics stating that the runtime key is validated/stored and MCP OAuth is optional. Focused runner-adapter/capability-plan/TUI tests, TypeScript, rebuilt binary, and diff checks passed.

## Live bridge retrieval-priority correction — 2026-08-15

Live authenticated validation passed health, profile, capture, and direct canary search, then exposed a bridge quality defect: broad profile context consumed the full 6,000-byte final budget and displaced the task-specific canary search result.

Combined advisory rendering now prioritizes ranked query/search results before broad profile context, appends profile items only within the remaining item/token/byte budget, and deduplicates equivalent ID/content pairs before final selection. Queryless starts remain profile-only. The global five-item, 1,500-token, and 6,000-byte limits and advisory escaping remain unchanged.

An adversarial authenticated loopback test covers an oversized profile plus unique search canary. The live bridge rerun returned `ok=true`, included the canary, and remained exactly within the 6,000-byte physical ceiling. Focused runtime-host/provider/runner-asset tests, TypeScript, rebuilt binary, and diff checks passed.

## Post-install live acceptance — 2026-08-15

Final validation used the real canonical config, owner-only secret, OpenCode capability inventory, Supermemory API, and authenticated loopback bridge.

Results:

- runtime secret exists with owner `dev` and mode `0600`; Doctor recognizes it without exposing content;
- installed OpenCode bridge asset hash exactly matches the generated source asset;
- real OpenCode review-plan reproduction returns `ready=true`, with Supermemory deck-config, MCP config, and validation actions all ready;
- direct live runtime health, profile, explicit capture, and search all succeeded;
- the unique canary was retrieved through Supermemory search;
- authenticated OpenCode loopback `session_start` returned `ok=true` and injected the canary inside the 6,000-byte advisory ceiling;
- OpenCode MCP is remote, credential-free, and bound to the canonical project scope fingerprint;
- the corrected install-only plan had no pending file mutations because installed assets already matched.

The final repository suite passed 4,623 tests with 19,404 expectations across 301 files; TypeScript and diff checks passed. Four stale assertions were updated to distinguish prohibition text from operational default-scope routing, current scope-mismatch diagnostics, and the approved Deck Runtime API-key label.

## DECK_DEBUG readiness-blocker correction — 2026-08-15

Real TUI validation exposed a direct regression introduced during debugging: both Review and execution preflight appended `Supermemory runtime readiness: ready (state-ready)` to blocker arrays whenever `DECK_DEBUG=1`. Because `bun run deck:run` always enables debug mode, a successful readiness diagnostic itself disabled Run Install.

Ready/not-ready reason codes now go only to the debug logger/observability channel. Blocker arrays contain only actionable not-ready failures, without duplicate debug text. Exact regression coverage uses `DECK_DEBUG=1`, real-ready OpenCode state, no ephemeral token, rendered Review, and production Review-to-Run transition; blocker lists are empty and apply executes exactly once. Missing-secret coverage remains blocked with runtime-credential wording.

The real config/real secret check under `DECK_DEBUG=1` now returns `{ "ready": true, "blockerCount": 0 }`. The final full suite passed 4,627 tests with 19,413 expectations across 301 files; TypeScript, rebuilt binary, and diff checks passed.

## Post-install installed-state validation — 2026-08-15

After the user completed the real OpenCode reinstall, installed-state verification passed. The materialized OpenCode plugin is byte-identical to the generated repository asset; OpenCode MCP configuration is remote, contains only the canonical `x-sm-project` scope header, and contains no credential header. The runtime secret remains owner-only (`0600`). Doctor reports Adaptive Memory enabled, canonical runtime scope resolved, runtime credential present, and OpenCode Supermemory configuration valid.

The real installed review plan reports `ready: true`, zero blockers, and all six actions ready under `DECK_DEBUG=1`. A non-destructive live recall through a freshly started authenticated OpenCode loopback bridge returned the existing canary `deck-sm-canary-20260815-02`, with a successful bounded advisory response. The content-free observability sink is present and owner-only; its schema contains counts and token estimates but no content, query, credential, or API-key fields.
