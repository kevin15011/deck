# Tasks: native/session parity (final slices)

## Archive disposition — 2026-10-28

This accepted closure supersedes earlier pending-work instructions. Checked original items denote evidenced implementation, not all live acceptance bullets beneath them. Legacy/no-driver/fence language remains historical; current promoted spec and archive-report.md describe approved scope.

- [x] Verified installed role selection and Codex bootstrap separation (e40b0a2).
- [x] Shared bounded readiness, catalog/exposure evidence and native delivery (ccfed70, 8ac27d0; Quality 16).
- [x] Authenticated cross-runner Setup, including Pi; native Pi/OpenCode policy/OpenSpec/registry repairs and refresh (8ac27d0; Quality 19).
- [x] Revoke the blanket PQ2 Codex review-role fence under user decision; retain cross-runner enforcement and document native inherited authority (004f42d, READONLY-ROLES.md).
- [x] Supersede S7's no-driver assumption with implemented Pi session support (8ac27d0).
- [x] Final default four-worker full gate: 7,657 pass / 0 fail / 11 skip; typecheck passes (archive-final-gate.md).
- [x] Preserve and document the CODEX_HOME incident and test-isolation fix (26d0f3f).
- [ ] Final live model-backed runner consumption — not verified; user accepted archive without it.
- [ ] Native standalone Claude/Codex authenticated Setup — documented limitation.
- [ ] Native Codex subagent MCP/sandbox enforcement parity — unsupported by role overrides; inherits parent authority.
- [ ] Production auto-index initializer and adaptive-memory redesign — deferred.

Unchecked original tasks below are historical composite tasks, superseded details or acceptance not independently established; archive closure does not mark them done. See archive-report.md for evidence and limits.


Prerequisites (in order):

1. Option A (Claude full team plugin, `task-b475cdb9…` attempt 2): integrated.
2. Live checks P1a–P3 (`task-1295d93c…`): integrated; branches locked in `design.md` §7.
3. **Legacy profile and role removal** (inventory `task-83ac36fe…`) has landed (`2204c47`). Every slice below starts after it.
4. **test-strategy U2+B0** is accepted and committed as `8cc9e9a`; blocking B2 repairs are committed as `02636de`, and user-approved composite closure as `cdb5519`. The R implementation may proceed. This change absorbs U2.9; the Lead records that in test-strategy.

Implementation dependencies: S1 contracts and S2 native policy precede repair exposure. Keep one vertical implementation owner; build R1 evaluator, R3 authority/service and one R2 native delivery path together before repeating adapter integration. R4 cleanup follows functioning replacement; R5 verifies all final paths. The former parallel slice chart is not an agent assignment requirement.

Each slice ships its own guard test. Focused `bun test <file>` runs during the slice; `bun run test:changed` and `bunx tsc --noEmit` run at each slice handoff.

## S1. Core contracts and guard harness
- [ ] Add `@deck/core/session/overlay.ts`:
  - The closed section set from design §3, with no project-instructions section.
  - Lead-only kinds and the forbidden-marker check.
  - Move the delegation, roster, continuity and decision text out of `session-service.ts` and `session-manager.ts`.
- [x] Generalize `NativeSkillsDescriptor` into `NativeRoleDescriptor`, and add `DriverTaskInput.nativeRole`.
- [ ] Add `ParityLaunchShape` (with `roleTools`, `memory` and `webSearch`) and `ParityAllowEntry` (with `temporary-tracked` plus `temporary: {owner, expiresWhen, reviewBy}`).
- [ ] Add `SESSION_PARITY_ALLOWLIST` with the 12 rows of design §5.1, and `SESSION_CAPABILITY_OVERRIDES = ["codebase-memory"]`.
- [ ] Add `diffParity()` implementing the §5 failure rules.
- [ ] Add `resolveWebSearchLaunch()` over `selectSearchRoute`.
- [x] Split `CODEX_ROOT_LEAD_BOOTSTRAP` into `roleSelection` and `delegation(native|session)`.
- Acceptance: `diffParity` unit tests fail on each of these:
  - an unlisted field;
  - an unused entry;
  - an unexplained `mcpNative` difference, or any `webSearch`, `roleTools` or project-scope `memory` difference;
  - an override without an existing `necessityTest`;
  - a `temporary-tracked` entry without `temporary`, or past its `reviewBy`;
  - a global-memory difference with the row-8 entry removed;
  - a `quality` shape with write/exec built-ins or `mcpDefault: "allow"`.

  Overlay tests: an unknown kind, a Lead-only kind on a member, or a forbidden marker each throw.

## S1 amendments

- [x] Add typed member capability rows to the existing Lead delegation/roster data: actual runner, new-task versus continuation binding, enablement and separately evidenced availability.
- [x] Keep readiness, repair instructions and project instructions forbidden in every overlay section, including handoff/notices.
- [x] Add typed readiness scope and independently derived parity projections. Compare complete bytes on equal scopes; allow only typed additional-participant coordination data on differing scopes.
- [ ] Add the narrow evidence allow-list entry from design §8.8; mutations that drop a native hook or grant disabled tools must still fail.

## S2 amendments

- [ ] Materialize Setup-only project repair visibility and explicit non-Setup denies for the selected transport.
- [x] Keep runtime role/invocation authentication separate from those visibility rules; do not treat an MCP tool filter as proof of identity.


## S2. Shared core role tool policy, native first (D9; fixes the shared core defect)
- [ ] Add `ROLE_TOOL_POLICY` to `@deck/core`:
  - Read-only roles get read built-ins plus explicit read-only MCP tool ids for context7, codebase-memory and web-search.
  - MCP is deny-by-default for read-only roles, including user and project servers.
- [ ] Claude: generate agent `tools:` from the policy, replacing `runner-adapter.ts:77-85` and dropping the context-mode and serena entries.
- [ ] OpenCode native: read-only agent entries get `bash/edit/write: false`, deny-by-default MCP and allowed read tool ids, in both `tools` and `permission`. Remove `resolveSerenaToolsForAgent` (`developer-team-install.ts:308-331`).
- [ ] Codex native: read-only role TOML gets `sandbox_mode = "read-only"`, plus native per-server MCP tool filtering if the installed Codex supports it. If it does not, record a residual native gap in `apply-progress.md`, with the Lead writing it. Recording a residual limitation does not satisfy the read-only policy or parity acceptance. If required MCP denies cannot be enforced, the affected read-only role launch remains unavailable and S2 is incomplete for that runner; the guard must not normalize an unsafe tool set into success.
- [ ] Pi native: verify that `deck-tool-policy.generated.js` consumes the same policy. Regenerate only through the generator, never by hand-editing generated files.
- Acceptance:
  - Unit tests per adapter: the `quality` and `investigate` native materializations contain no write/exec built-in, and deny unlisted MCP tools.
  - Live smoke on native OpenCode: `deck-quality` cannot call an MCP shell or write tool; this is the P2 gap, now closed.
  - Native Claude `tools:` contains no retired ids.

## S3. Claude vertical
- [x] `prepareSessionRole(roleId)` reuses generation verification with `roleRef = deck-developer-team:<roleId>`. A retired server in the generation fails `claude-session-generation-unverified`.
- [x] `buildClaudeTurnLaunch` adds `--agent <roleRef>` and keeps `--model`/`--effort` (P1a). The overlay is the only appended text.
- [x] Paired Codebase overrides plus the explicitly approved typed availability omission (D3a).
  - Rename `readSessionMcpServers` to `readSessionCapabilityOverrides`.
  - Remove the context-mode/serena deletion and the `{codebase-memory}` filter in `session-shared-services.ts:55-61`.
  - An unpaired override fails `claude-mcp-override-unpaired`.
- [ ] Web search: remove `web-search` from the plugin `.mcp.json` (`capabilities.ts:56-60`). Native launch (`runner-adapter.ts:556-563`) and the session both add the fallback through `--mcp-config` from `resolveWebSearchLaunch`.
- [ ] Confirm the R2 Claude `SessionStart` channel (AGENTS.md plus the readiness block) loads in session children unchanged. Remove the session injection at `session-service.ts:88,95`.
- [ ] Emit `--dangerously-skip-permissions` only for `runner-default` derived from `yolo`.
- [ ] Add `claude.parity.test.ts`.
- Acceptance:
  - The parity test permits only applicable rows 1–8 and row 12. Row 12 applies only to typed additional-participant coordination; equal complete scopes/evidence require equal full context bytes.
  - Each of these mutations fails it: denying context7, dropping `--agent`/`tools:`/`SessionStart`, or adding skip-permissions in relay.
  - A stale generation throws before spawn.
  - Live smoke:
    - the `quality` child cannot Edit or Bash, or call a non-listed MCP tool;
    - a Deck skill loads by bare name;
    - context7 comes from the plugin;
    - AGENTS.md is present in both native and session.

## S4. Codex vertical
- [x] `prepareSessionRole` verifies the role TOML (`developer_instructions`, `model`, `model_reasoning_effort`, `sandbox_mode`), skills and hooks. The Lead uses the `roleSelection` bootstrap bytes.
- [x] The driver sends `developerInstructions` = verified bytes + overlay.
  - Model and effort are passed explicitly on `thread/start` and each turn: the assignment, or else the TOML values.
  - The read-only sandbox is never widened in relay.
- [ ] Admit hooks by exact `trusted_hash` for the Deck manifest hooks. The `hooks/list` startup check fails closed.
- [ ] Rename `readSessionMcpServers` to `readSessionCapabilityOverrides`. `codexThreadMcpConfig` keeps additions and suppressions only.
- [ ] The native Codex launch applies `resolveWebSearchLaunch`.
- [ ] Add `codex.parity.test.ts`.
- Acceptance:
  - The parity test passes.
  - An absent or untrusted RTK hook fails `codex-hook-isolation-violation`.
  - A stale TOML fails `codex-session-generation-unverified`.
  - A role TOML model is applied when there is no assignment.
  - Native and session web-search shapes are equal.

## S5. OpenCode vertical
- [x] `prepareSessionRole` verifies the agent entry (S2 tools and permission), the prompt files and the execution plugin hash.
- [ ] The driver seeds permissions from `deck-<role>`, sends `agent: deck-<role>`, and puts only the overlay in `system`.
  - A startup assertion checks that the agent exists and that `developer-team-execution` is loaded.
- [ ] Rename the MCP reader to `readSessionCapabilityOverrides`.
- [ ] Add `opencode.parity.test.ts`.
- Acceptance:
  - The parity test passes.
  - A member message carries `agent: deck-<role>`.
  - A missing agent or execution plugin fails closed.
  - Native and D9 denies survive relay and `yolo`.
  - Live smoke: a session `quality` member cannot reach an MCP write/exec tool.

## S6. Override necessity and temporary memory entry
- [ ] codebase-memory necessity tests:
  - two concurrent children on different runners share one readiness entry;
  - a digest mismatch reports `codebase-memory-unsupported` without spawning;
  - the server is released at task end.
- [ ] Record row 8 as `temporary-tracked` with owner `adaptive-memory-redesign`.
  - Add guard fixtures with no git identity.
  - Project-scope fixtures must match native exactly: same builders, same raw-key env names.
- Acceptance:
  - Row 7 names the necessity tests, and deleting one fails `diffParity`.
  - Removing row 8 while the global difference persists fails the guard.
  - A project-scope memory difference fails regardless of row 8.

## S7. Pi unsupported and dead code
- [ ] Add the `pi` `*` `unsupported` entry. Delegating to a Pi-assigned member fails closed with `session-runner-unsupported`.
- [ ] Remove `createSessionMemoryPort` (`session-shared-services.ts:15-35`), its wiring (`session-service.ts:17,128`) and its tests (`session-shared-services.test.ts:46,64,74,126`).
  - First confirm with `rg` that there is no other consumer.
  - Remove the session-host `memory` option only if nothing else supplies it.
- Acceptance:
  - A guard test asserts Pi has no driver and that delegation fails closed.
  - `rg createSessionMemoryPort` returns nothing.
  - Memory broker behavior for Claude, Codex and OpenCode leads is unchanged.

## R1. Scoped preflight, honest evidence and snapshot coordination

- [x] Build trusted scope from the effective roster plus actual queued/running/selected-continuation assignments; do not enumerate all account runners.
- [x] Resolve capability intent through existing native/core policy for each binding before any optional probe. Preserve code-economy's current instruction-only semantics.
- [x] Separate project and runner keys, required-by labels, immutable observations, repair disposition and availability from enablement.
- [ ] Read shared project bytes once; derive runner-scoped registry validation from authorized source snapshots. Preserve direct discovery on unsupported/unknown views without a rewrite loop.
- [ ] Bound reads/stats, total bytes, parse depth/nodes and evaluation time. Include cache fingerprint work. Preserve independently proven findings when another component is indeterminate.
- [ ] Do not call SessionCodebaseReadiness, native launch builders or external capability tools from the evaluator. Supply runtime evidence instead. Unknown project index state remains indeterminate.
- [ ] Implement component evidence reuse and session snapshot coordination across child processes, invalidation on relevant configuration/roster/evidence changes and a bounded native delivery reference.
- [ ] Tie identity to canonical root, session epoch, effective roster digest, actual task runner, relevant generation and native route inputs. Do not rely solely on assignmentRevision.
- Acceptance: table-driven hermetic tests assert disabled capabilities produce zero reader calls; all-disabled still checks OpenSpec/registry; two enabled consumers share one project check; unknown index/registry evidence is not ready; independent degradation survives unrelated uncertainty; budget counts fingerprint/absence checks; no writes/network/spawn occurs.

## R3. One project repair service with authenticated callers

- [x] Inspect existing trusted execution/session-host lifetimes and choose the smallest transport that proves actual Setup identity. Prefer their existing interfaces; consider a thin deck-prepare stdio bridge only where needed. Do not install a universal server by assumption.
- [ ] Extend current preparation contracts/parsers coherently for retired-key cleanup, arbitrary approved project components, epoch/scope/evidence binding and distinct requester/executor identities. Remove obsolete shape requirements encountered in this touched contract; no legacy compatibility branch.
- [x] Bind the exact trusted delegation and current selected Setup invocation. Reject spoofed role, runner, roster, root, operation or target data even when the tool can be called directly.
- [ ] Implement project/target locking, source digest comparison, per-operation single-use authorization and handoff aggregation. Recompute affected eligibility under lock.
- [ ] For Setup-disabled/other-enabled cases, select a verified enabled initializer binding in the host without exposing optional tools to Setup or changing its assignment. If none can enforce the project target, return a limitation.
- [x] Keep runner installs/credentials report-only. Assert zero installer/package-manager/user-config/Git/SDD-state writes from repair paths.
- [x] Implement the supported retired-policy YAML transformation with command preservation, collision handling, opaque user-data preservation, unsupported-shape rejection and idempotence.
- [ ] Persist/reconcile Setup attempt identity through the host's existing ledger to prevent duplicate repair on resume. Native host supplies equivalent execution evidence.
- Acceptance: tests cover Lead/Apply/raw-client spoofing, requester/executor mismatch, last-consumer disablement, stale generation/evidence, concurrent target modification, replay/restart/expiry, multiple operations, failed/uncertain repair not cached ready, and disabled Setup never gaining optional tools.

The first repair increment uses the existing authenticated session bridge and a Claude native-selected Setup child for bounded retired-policy YAML cleanup, after S1/S2 and relevant S3 role/channel prerequisites. Bind exact validated delegation and credentials to task attempt, host epoch and validated native launch. This is not final native/session parity acceptance: native subagent repair identity and the remaining R5 paths stay outstanding. See [implementation-route.md](implementation-route.md).

## R2. Native delivery and consolidation

- [ ] Wire one shared formatter to all native channels, retaining Claude AGENTS.md delivery and no overlay readiness.
- [ ] Hook adapters consume the coordinator snapshot; they do not run independent per-child project scans. Keep readiness independent of memory feature flags.
- [ ] Implement startup/resume/compaction and explicit invalidation delivery on supported native lifecycle points. If a persistent runner needs a native restart/resume to refresh, use it before the next affected execution; never inject an ordinary turn readiness overlay.
- [ ] Deduplicate by prompt assembly and snapshot identity; OpenCode/Pi transforms read cached text only, with no per-turn filesystem scan.
- [ ] Prove Codex app-server SessionStart additionalContext and native subagent handling, plus Pi prompt append/AGENTS.md behavior. Begin with scripted/fake runner fixtures; label unperformed live checks honestly and do not run paid probes without the separately applicable authorization.
- Acceptance: same-scope native/session bytes equal; mixed-scope output has only expected typed additional findings; an all-disabled Lead still sees another member's project finding; memory disabled does not suppress readiness; no overlay marker/findings or duplicate context segment.

## R4. Producer replacement and Setup naming

- [ ] After the new producer functions, remove the unused needs-init path and use one bounded OpenSpec parse/evidence source.
- [ ] Coordinate with the existing U2+B0 owner before renaming Setup content/removing deck-init remnants and updating doctrine references.
- [x] Include Setup in the default catalog-derived member list.
- [ ] Update the preparation authority boundary to name the trusted coordinator, per-component scope and requester/executor binding while retaining mutation restrictions.
- [ ] Reuse applicable OpenCode/Pi provider seams or remove them only after equivalent live responsibilities are covered.
- Acceptance: one production readiness producer, Setup reachable without an explicit member list, structural safety/authority guards retained, generated outputs rebuilt only by their generators.

## R5. End-to-end behavioral matrix

Use deterministic runner fakes for native Claude/Codex/OpenCode/Pi and cross-runner Claude/Codex/OpenCode. No new paid-probe requirement is implied by this handoff.

| Fixture | Required observation |
|---|---|
| Native single runner, optional capability off | No optional probe, finding, tool grant or repair; always-on checks remain |
| Lead off, Quality on | One shared project check, Quality runner check, consolidated native-channel output, truthful roster |
| Setup off, Apply on | Authenticated project repair via enabled initializer binding, no Setup capability grant |
| Two enabled runners, one shared missing project item | One evaluation and one delegated repair; runner gaps remain distinct |
| Only runner installation is missing | Runner-qualified remediation, zero installation by Setup |
| Server handshake succeeds, no index observation | Indeterminate index, zero auto-indexing |
| Registry file valid for only one exposure | No cross-runner ready claim or alternating rewrite loop |
| Roster reassignment plus old-task continuation | New-task and preserved task assignments both represented correctly |
| All enabled consumers removed before effect | Optional repair rejected before mutation |
| Resume/compaction, unchanged inputs | Same bytes, no duplicate Setup delegation |
| Setup changes one project file | Only dependent cache entries invalidated; next native boundary receives refreshed output |
| Two hooks/children race | Shared computation; one repair owner/target lock |
| New host epoch after uncertain effect | Old authorization rejected; prior attempt reconciled without blind retry |
| Non-Setup or forged role/roster calls repair | Rejected independently of role tool visibility |

## S8. Session path cleanup and final verification
- [ ] `sessionRolePrompt` becomes overlay-only, and `assignedRoleId` uses catalog membership.
- [ ] Add a guard asserting that the session path makes no `getAgentContent` role-body call.
- Acceptance: `bun run test:changed`, `bunx tsc --noEmit`, then `bun run test:full` once for the final candidate.

## S3–S5 and S8 amendments

- Assert the selected native delivery and repair transport in each runner vertical; remove unconditional assertions that every runner must have a server named deck-prepare.
- Update parity tables: compare local/base context and full context on equal scopes; mixed-roster coordination is the sole new evidence exception. Keep native MCP/role enablement identity and all other existing protections.
- Keep scoped verification: focused affected tests while implementing, `bun run test:changed` and `bunx tsc --noEmit` at handoff, and `bun run test:full` once for the final candidate under repository conventions. This Architect handoff runs none because it changes no repository behavior.
- Replace rollout text requiring a new universal deck-prepare generation with the actual selected hook/service materializations; retain verified-generation rollout behavior.

## Parity guard assertions per runner

| Runner | Must be identical (native vs session) | Allowed differences (rows) | Always fails |
|---|---|---|---|
| Claude | Role source (`--agent` ref plus generation hash), `roleTools` (including the authenticated Setup-only project repair), skills and preload, plugins, hooks (RTK, `SessionStart`), `mcpNative` (context7 and selected native preparation transport), `webSearch`, `settingSources`, `projectInstructions = native-hook`, independently derived `sessionStartContext` projections (§8.8), project-scope `memory` | 1–8, 12 | Any plugin denial other than a paired Codebase override or validated Codebase availability omission; any unrelated source omission; skip-permissions in relay; AGENTS.md in the overlay; a retired id |
| Codex | Verified role bytes hash, TOML model/effort when there is no assignment, `sandbox_mode`, `roleTools`, skills, `mcpNative` (including the selected native preparation transport), `webSearch`, independently derived `sessionStartContext` projections (§8.8) (`SessionStart` hook), project-scope `memory`, native AGENTS.md | 1–9, 12 | A missing Deck hook, or admission through a global bypass; a TOML value dropped |
| OpenCode | Agent `deck-<role>`, agent tools and permission (S2), prompt files, execution plugin, `mcpNative` (including the selected native preparation transport), `webSearch`, independently derived `sessionStartContext` projections (§8.8) (system transform), project-scope `memory` | 1–8, 10, 12 | A default `build` agent; a native or D9 deny relaxed; MCP write/exec reachable by `quality` |
| Pi | n/a (no driver). The native channel is covered by R2 and R5. | 11 | Any Pi member delegation not failing `session-runner-unsupported` |

Cross-runner (all shapes):

- `quality` has no write/exec built-in and uses `mcpDefault: "deny"`, in native and in session.
- Only a runtime-authenticated `deck-setup` invocation may request the exact delegated project repair, independently of tool visibility.
- The overlay never contains `<deck-project-readiness` or project instructions.
- Full readiness bytes are identical for equal complete scopes/evidence; unequal scopes allow only canonical row-12 coordination data.

## Rollout
- The Claude generation hash changes (`SessionStart` hook, route-free `.mcp.json`, policy `tools:`). The OpenCode and Codex role materializations change too (S2). Existing installs fail closed in sessions until `deck upgrade` runs, and native installs get the read-only fix on that same upgrade.
- Selected R2/R3 hook and preparation-service materializations participate in verified generation rollout. A universal new MCP server is not assumed.

## Remaining implementation evidence
- Select the smallest trusted preparation transport that authenticates the actual Setup invocation; a thin deck-prepare bridge is optional, not a universal requirement.
- Prove Codex app-server native context delivery and Pi native lifecycle behavior with bounded adapter evidence.
- U2.9 is owned here; U2+B0 and the limited B2 repairs are closed through the user-approved composite acceptance recorded in test-strategy-and-suite-pruning; this exception does not waive verification of this new implementation.


## Approved PQ3 implementation checks

- [x] Preserve paired managed overrides; implement the explicitly accepted typed Codebase availability omission in native/session launch policy.
  - Reject unlisted IDs, raw/unproven suppression, integrity failures, disabled intent and stale generation/evidence.
  - Preserve plugin/selection bytes, exact selected role, unrelated native MCP, and existing live-intent fences.
  - Check expected-absent plugin/tool identities before validated startup authority.
  - Exercise unavailable → recovery through real composition/launch with hermetic processes; ordinary work must complete without swallowing launch errors.
  - Add independent native backend observation and tests; do not claim native failure parity from the session outcome or an inferred native role.
  - Feed enabled/unavailable into the roster/native channel; retain unverified index status and report-only runtime remediation.
- [x] Refine the parity guard to retain actual installed declarations and effective route/omission evidence; allow only independently justified Codebase backend differences.


## Lead continuity snapshot

See [lead-handoff.md](lead-handoff.md) for current approved decisions, active owner/attempt, scoped findings, remaining work and evidence. Model switch preserves running Apply Deep attempt 7; PQ3 contract is approved and implementation/review remain pending. Broad task checkboxes intentionally remain open.
