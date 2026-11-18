# Accepted connected OpenCode design

Architect22 report, accepted as design by Lead231. Runtime qualification remains pending. See runner-assignment-expansion.md for binding implementation scope and acceptance.

**Recommend one connected OpenCode slice for the same ApplyDeep owner:** ordinary Lead and member execution through the existing assignment controls, including mixed Codex/OpenCode sessions, durable continuation, approvals, cancellation and restart recovery.

OpenCode is the next practical candidate because both the original adapter and Rust HTTP/process seams exist. The scoped investigator implementation is not a suitable ordinary-session contract.

No files or runtime state were changed. All **301 recorded implementation inputs** matched accepted candidate `84d7c8e3` before and after analysis.

1. **Preserve the original composed behavior.**

   Deck1’s path is:

   `createCrossSessionService → project-scoped catalog → SessionManager admission/scheduling → runner-specific role/MCP preparation → OpenCode driver → correlated native result → process drain`.

   The original catalog uses `opencode models --verbose`, ready inventory and model-specific variants. Launch inherits admitted native configuration, verifies selected role/plugin content, starts an authenticated loopback server, attests effective tools and permissions, creates or resumes a native session, then sends the selected agent/model/variant. Approvals, questions and process cleanup remain host-controlled. [Composition](/home/kevin15011/deck/apps/cli/src/session-service.ts:60), [discovery](/home/kevin15011/deck/packages/adapter-opencode/src/runner-adapter.ts:270), [launch](/home/kevin15011/deck/packages/session-host/src/session-manager.ts:1977), [native driver](/home/kevin15011/deck/packages/adapter-opencode/src/session-driver/driver.ts:114).

   The current Rust gaps are broader than assignment validation:

   | Boundary | Current constraint | Required delta |
   |---|---|---|
   | Catalog/create/save | Codex-only validation and discovery | Discover and validate each supported runner independently |
   | Submission/queue | Codex availability, executable and authentication scope | Select these from the admitted Lead assignment |
   | Member execution | Codex provenance, role loader and `Native::start_member` | Resolve the immutable task assignment’s runner |
   | Tools/permissions | Connected MCP is reusable; native approval encoding is Codex-specific | OpenCode launch configuration and HTTP decision delivery |
   | Continuity/history | Untagged native context; Codex-specific adoption and continuity inputs | Explicit runner/storage identity and runner-specific validation |

   Sources: [assignment contract](/home/kevin15011/deck-next/crates/host/src/session_contract.rs:286), [submission](/home/kevin15011/deck-next/crates/host/src/server.rs:903), [member execution](/home/kevin15011/deck-next/crates/host/src/session_tasks.rs:560).

2. **Implement normal execution separately from the investigator policy.**

   Reuse bounded HTTP, authenticated loopback access, process ownership and cleanup primitives from `opencode.rs`. Its existing route hardcodes MiniMax, an investigator agent, restricted tools, disabled project configuration/external skills and an isolated native database. None should become ordinary-session defaults. [Current preparation](/home/kevin15011/deck-next/crates/host/src/opencode.rs:540).

   Add a small OpenCode-specific connected transport and explicit Codex/OpenCode dispatch branches. Keep scheduling, receipts, task identity, decisions, project ownership and the existing MCP bridge shared. A generic runner framework is unnecessary.

   - **Catalog:** preserve public `provider/model` IDs; recognize legacy `opencode/provider/model` only through unambiguous inventory resolution. Keep the remainder after the first provider separator intact. Pass native `{providerID, modelID}` and validated `variant`; preserve the original `off` omission behavior. Never substitute Codex reasoning levels or a fixed model.
   - **Availability:** report failures per runner. Missing Codex must not block an available OpenCode Lead. Stale inventory cannot authorize a changed assignment. Do not use a historical quota failure or presence in `auth.json` as the universal eligibility rule; native configuration can supply credentials through other mechanisms.
   - **Configuration:** use the owning project and its current trust decision for both discovery and launch. Preserve global configuration, admitted project configuration, personal MCP and native skills. Authenticate Deck-owned executable plugins separately from customized prompt text. The original distinguishes those boundaries. [Launch configuration](/home/kevin15011/deck/packages/adapter-opencode/src/session-driver/launch.ts:14), [role validation](/home/kevin15011/deck/packages/adapter-opencode/src/native-role-source.ts:17).
   - **Ownership:** credentials and native conversation storage remain OpenCode-owned. Persist storage identity, never credential values. Attempt-local server passwords and MCP tokens remain ephemeral. Do not copy credentials or reuse the investigator’s disposable database for durable conversations.

   Target **1.19.1 as the initial qualification candidate**, not as already qualified connected execution. Deck1’s driver records 1.18.31 as tested and treats newer versions as degraded. The existing 1.19.1 probe establishes guarded startup/authenticated health/SSE only; it did not establish tools, provider execution, cancellation correlation or descendant cleanup.

3. **Make the durable distinctions explicit in schema 18.**

   Extend the existing schema-17 transaction rather than introducing another store:

   - Give native contexts an explicit runner discriminator. Retain opaque native session IDs and validate them by runner; OpenCode IDs must not pass through the original Codex UUID requirement.
   - Record the selected runner binding in each admission: executable identity/version/protocol, native storage identity and role/configuration evidence. Existing project, owner, attempt and generation fields remain authoritative and must agree with that binding.
   - Resolve a member’s executable and role from its **recorded assignment**, not from the requesting Lead’s runner. A Codex Lead must be able to continue an OpenCode task, and conversely.
   - Keep `Session.original` and `original_generation` immutable as provenance boundaries. Lead reassignment increments generation and clears active context; member-default changes affect new tasks only.
   - Add runner-specific native approval transport identification. OpenCode HTTP request IDs must not be interpreted as Codex JSON-RPC IDs.

   Migrate legacy fields to Codex only where schema-17 invariants establish that meaning. Missing historical identity remains unknown; migration must not mint executable authority or rewrite historical reports/grants. Publish schema 18 only after validation succeeds. Injected migration failure must leave schema 17 intact; rollback after successful publication uses the consistent pre-upgrade backup, not an improvised downgrade.

   Relevant seams: [shared native context](/home/kevin15011/deck-next/crates/shared/src/lib.rs:201), [admission snapshot](/home/kevin15011/deck-next/crates/shared/src/lib.rs:410), [migration transaction](/home/kevin15011/deck-next/crates/host/src/lib.rs:413).

4. **Carry authority through the complete native lifecycle.**

   Preserve existing pre/post-discovery revision, busy, device, source, project, configuration and executable checks. Extend their snapshots to the selected OpenCode sources. Preserve the accepted history-before-identity lock order; no store lock should span native waits.

   At launch:

   - Claim existing capacity and freeze current approval mode at admission.
   - Start a fresh per-attempt MCP bridge; translate its configuration to OpenCode’s remote-MCP shape and attest effective `/config`, `/mcp` and selected `/agent`.
   - Revalidate role generation and current authority before input claim. Disable native delegation; Deck remains the task owner.
   - Persist native session and caller message identity before sending. Use the original `/session/{id}/message` contract, including existing image inputs.
   - Correlate assistant output to both session and parent message. Bound pending SSE events; late output, unrelated permissions and old questions cannot acquire current-turn authority.
   - Translate permission replies to `once`, `always` or `reject`. Preserve native denies. Native `always` requires its explicit persistent-scope warning; Deck session grants must not silently become native permanent grants.
   - On cancellation, abort the native session, escalate if necessary and drain the owned process group before releasing capacity, MCP authority or native-store reservations.

   A lost acknowledgment is not permission to resend. Restart retains uncertain dispatched work and invalidates old responses without replay. Existing recovery behavior supplies that contract. [Original correlation/approvals](/home/kevin15011/deck/packages/adapter-opencode/src/session-driver/driver.ts:332), [Rust recovery](/home/kevin15011/deck-next/crates/host/src/lib.rs:570).

   For delegated continuation, retain review-fresh policy and truthful reseeding. OpenCode’s original driver explicitly reports request-input normalization as unverified; context-window capacity cannot supply the missing compaction proof. Generalize the current hardcoded runner/version inputs without fabricating a production bound. Only a confirmed missing native-session lookup may trigger the corresponding absence fallback; authentication, transport and ownership failures must not. [Continuity policy](/home/kevin15011/deck-next/crates/host/src/session_continuity.rs:154).

5. **Bound the first delivery and the immediately following compatibility delta.**

   First candidate:

   - New OpenCode sessions and OpenCode/Codex member mixtures.
   - Both directions of idle Lead reassignment, preserving conversation history.
   - Existing adopted Codex sessions switching to OpenCode in a later generation while retaining all original-source guards.
   - Durable OpenCode task/result lineage, current-authority continuation, cancellation and restart.
   - Existing assignment UI, with accurate availability and runner display.

   **Original OpenCode native adoption is the next protected delta**, not an implied capability of this candidate. It must establish the original native storage namespace, session/project identity and settled ownership before relaxing the Codex-specific adoption guard. Extend original-task eligibility only after that proof. Unsupported histories remain readable; never silently translate their runner or execute historical prompts.

   Persisted original assignments may include unavailable runners. Do not require every historical member’s runner to be installed merely to use a supported Lead; validate the member actually selected for execution.

   Then complete Claude and Pi through their own native contracts, followed by remaining runner install/update/login management and broader provider/device/parallel qualification. Full P18/P19 remains open until those obligations are delivered.

6. **Give the owner behavioral acceptance, not metadata-only checks.**

   Extend existing fixtures at external process/HTTP boundaries:

   | Check | Oracle and failure condition |
   |---|---|
   | Catalog and wire selection | Two providers with matching model names, distinct variants, legacy IDs and unavailable entries; fail on wrong provider/model/variant or silent fallback |
   | Mixed-runner admission | OpenCode works with Codex absent; both delegation directions use the task’s recorded runner; fail if Lead/default changes reroute an existing task |
   | Held-discovery races | Revoke device/source/trust or replace configuration/executable during discovery; fail on partial save or any subsequent dispatch |
   | Approvals and events | Native deny, explicit permanent scope, stale reply, foreign session, wrong parent and late completion; fail if any gains current authority |
   | Cancellation/restart | Lost acknowledgment, hanging abort and descendant process; fail on duplicate input, premature ownership release or automatic replay |
   | Migration/generation | Schema-17 round-trip/fault rollback and adopted-Codex reassignment/restart; fail if provenance changes or the original context is restored |
   | Packaged browser | Existing controls create, assign, delegate, display results, continue and survive restart; verify keyboard and reduced/normal motion |

   Establish REDs on the current composed boundaries for unsupported OpenCode selection and routing. Keep exact wire assertions separate from browser metadata. Native reuse with injected continuity evidence must be labeled fixture-only.

   Use focused Rust checks while editing, then the documented workspace gate, frontend typecheck/tests/build and packaged journey once for the final affected inputs. Retain the 240-second gate budget, two low-priority build jobs and no overlapping expensive measurements. Independent review should re-execute a targeted authority/recovery case. Preserve inherited static failures, S1-Q07 and existing closures.

Graph evidence used Verify tier, generation `2026-11-11T01:38:54Z`, bounded traces and completed relevant pages. Coverage checked 26 paths; all reported original-source partial ranges were read directly. Rust/product paths are outside that graph and were inspected directly. No tests or native/provider probes were run for this read-only design.
