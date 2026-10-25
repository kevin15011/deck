# Approved acceptance criteria

## Current delivery scope — user-approved supersession

The user explicitly narrowed this delivery to clean, functional NEW installations on Codex, Claude, OpenCode and Pi, across supported native developer-team and cross-runner paths. Existing users will receive personal/operator-assisted cleanup. This decision supersedes A13 as a publication prerequisite and supersedes automatic execution of the previously reviewed local33/ambiguous5 work in this delivery. Historical evidence is retained as incomplete history, never relabeled as passing.

Active closure criteria: generated roles/prompts/skills and fresh install/preparation/launch outputs contain no retired context-mode/Serena integrations; Codebase Memory is absent and unprepared by default and activates only through explicit opt-in; RTK remains functional; native/fallback web search follows effective runner configuration; supported installed contributions have real granular ownership hashes. Verify the exact candidate in isolated fresh roots for all four runners, including a repeat sync/update that does not reintroduce retired resources. Preserve A12 real tool/search/RTK evidence requirements, reusing earlier evidence only where current identity and behavior justify it.

No further historical-version matrix expansion, old upstream installer repair, or historical CI gate is required for this delivery. Align required CI and release documentation with this approved scope, retaining historical checks as optional diagnostics where useful. Existing migration/recovery protections (ownership, individual confirmation, idle admission, drift preservation) must not be weakened or discarded; they remain safety requirements wherever those paths are reachable. Do not claim universal legacy migration support. No real-user cleanup, canary installation, restart or publication is authorized by this scope change.


Status: acceptance and design approved on 2026-10-22, including the subsequent four implementation adjustments. Implement one coherent candidate. Applying migration to the user's real installation is not authorized until its concrete read-only plan has been presented and reviewed. Scope covers Codex, Claude, OpenCode and Pi, native developer-team and cross-runner composition, Lead and members. Unsupported runner/path combinations must be explicitly identified rather than counted as tested.

## A1 — Retired generated content

Newly generated Deck roles, prompts and skills, in compact and full profiles, contain no context-mode or Serena names, tool guidance or instruction blocks. This includes transitively embedded content and generated assets. Historical OpenSpec/changelogs and migration identifiers/tests may retain names outside executing prompt/skill content. Verification renders actual outputs; generated sources are rebuilt through their generators.

## A2 — Clean installation and preparation

In isolated clean runner roots, install, update and launch introduce no context-mode/Serena downloads, entries, plugins, hooks, skills, tool grants, launchers or package-specific readiness/preparation operations. Serena onboarding is absent. Startup does not fail because these retired capabilities are missing. General preparation for unrelated capabilities remains intact.

## A3 — Ownership-safe migration

Automatic removal of in-scope retired resources is authorized by either a manifest establishing ownership at the affected file/entry/key granularity, or location within a dedicated Deck-owned directory (for example `~/.local/share/deck/` or `.codex/deck/`). Location ownership does not authorize deleting unrelated Deck state or traversing symlinks into external user resources. Missing hashes do not prevent cleanup of retired resources inside those owned directories.

In shared user configuration files, missing provenance, placeholder checksums, changed owned entries and ambiguous ownership produce a preserved-resource diagnostic. Deck MUST also offer entry-by-entry removal with explicit confirmation, displaying the specific entry and its surrounding context. Without confirmation nothing ambiguous is removed. Confirmation applies only to the reviewed entry/version; a changed preimage requires a new review. Same-name/template heuristics do not authorize automatic deletion.

Remove verified owned retired resources; preserve independently installed resources and unrelated sections of shared files. Apply the same rule to tool roots, plugin generations, skills and backups. Do not claim a fully clean migration when unresolved legacy resources remain. Preserve user data that is not a recorded disposable installation artifact.

## A4 — Repeatability and recovery

Migration is idempotent: a second successful run changes nothing. Writes preserve valid configuration; partial failures identify the affected resources and allow retry without losing user content. Diagnostics identify location and reason without disclosing secrets. Test valid manifest ownership, missing/legacy manifests, zero hashes, edited owned content, user-owned same-named resources and shared files.

## A5 — Codebase Memory explicit activation

Absent configuration means disabled across install, prompts, readiness and preparation. Use a global explicit activation, default false, with optional boolean runner overrides: override wins, otherwise inherit global. Explicit false overrides global true. No automatic installation or preparation occurs without resolved explicit activation. A new explicit opt-in enables the appropriate supported surfaces; opt-out disables Deck's participation and removes only proven Deck-owned installation resources. User-owned native integrations are untouched and may remain available through the runner.

An old persisted `true` with no reliable activation provenance is not sufficient consent. Keep Deck's capability off and explain how to explicitly enable it. Do not silently erase externally installed Codebase Memory or treat the old value as a new opt-in. The implementation must make future explicit intent distinguishable.

## A6 — Effective native search detection

Select search using effective runner/model/provider/configuration and tool exposure, not a fixed runner-name allowlist. For Deck-managed cross-runner members, evaluate during preparation of EVERY turn using that member's actual runner, model, provider, flags and exposed tools, including continuations. Re-read relevant effective configuration at that boundary; installation-time or logical-session-start-only decisions are insufficient. Never reuse another member's effective configuration. Evidence must distinguish available, unavailable and unknown; configuration alone is sufficient only where the runner contract makes exposure reliable.

Approved exception (2026-10-23): directly opened interactive Codex, Claude and OpenCode CLI sessions select search at launch/reopen. This exception does not apply to Deck-managed cross-runner members or to Pi. In the OpenCode cross runner, Deck starts an `opencode serve` process per turn; evaluating effective search at that process launch satisfies per-turn selection. This change does not require dynamic MCP APIs or shared-instance session-isolation mechanisms for that path.

If effective configuration changes while an interactive CLI remains open, Deck warns at the next review opportunity (doctor or opening the next session) that the existing CLI must be reopened. The next session uses current configuration. No continuous watcher, automatic restart or mid-session tool mutation is required. Verify unchanged configuration produces no stale warning, changed relevant configuration produces the warning at either review entry point, and cross-runner selection remains fresh on successive turns.

Required cases: Codex disabled versus enabled native modes and overrides; OpenCode provider and EXA/PARALLEL environment combinations; Claude provider/model/tool permissions; Pi with and without an extension exposing search. Do not bypass existing authority/deny rules. A transient failed search is not proof that the tool is absent.

## A7 — One selected search route

When Deck search is enabled and native search is confirmed available, inject no Deck search provider. When native search is confirmed unavailable, expose the configured Deck provider if usable. Missing credentials/configuration produce an actionable status, not a false ready claim. When Deck search is disabled, inject no Deck fallback; do not rewrite independent user/native settings.

Guarantee one selected search route in configurations controlled by Deck when availability is established, with no Deck-added duplicate. Preserve independent user search tools and report pre-existing duplication rather than disabling them. Preserve/report ambiguous legacy Deck-looking entries under A3 and offer confirmed removal; do not claim uniqueness in those unresolved cases.

If native availability is unknown and Deck search is enabled, inject the configured Deck provider and report a possible duplicate. Missing fallback configuration/credentials is an explicit actionable failure, never silently no search. Unknown availability is exceptional on supported configurations and is a detection defect to diagnose and test. It is not treated as an ordinary supported result. Existing permission boundaries remain in force.

## A8 — Preserved behavior and scope

RTK remains installed/configured and functions as before, including shared hook/plugin files. Supermemory, Lead flow, check execution, output limits and session-continuity policy are unchanged. Compatibility readers may recognize retired legacy keys without reactivating packages. Documentation and selection surfaces describe the new supported choices.

## A9 — Durable per-runner installation manifests

Everything Deck continues installing in any runner MUST be recorded in that runner's manifest: packages and their Deck-managed installation artifacts, MCP/search entries, agents, skills and support files, plugins, hooks, and individual configuration contributions. Hashes MUST represent actual installed content; placeholder/all-zero hashes are forbidden. Entries in shared files MUST be individually addressable and hashed. User-owned artifacts merely discovered by Deck MUST NOT be adopted automatically. Install, update, repair and removal paths use the same ownership accounting; the synchronizer cannot bypass it.

## A10 — Canonical configuration and compatibility

Canonical configuration and selectable package catalogs exclude context-mode and Serena. Codebase Memory defaults to false. Legacy retired keys are accepted by compatibility readers, ignored and reported; they never activate installation, preparation or prompt composition. Canonical writes do not reintroduce them. Legacy Codebase Memory activation follows A5.

## A11 — Read-only migration plan

Deck MUST expose a planning-only mode that shows the exact proposed removals by runner, target file/entry and ownership class: dedicated location, manifest proof or ambiguous. Ambiguous entries are explicitly conditional on individual confirmation, not planned automatic removals. Include preserved resources, reasons, preimage identity and precise proposed changes. Planning must not modify installation/configuration/manifests, generate backups, download packages, prepare capabilities, change trust or trigger migration through read helpers. Capture the plan as an artifact only when explicitly requested. Applying changes revalidates its preconditions. Before migration on the user's actual installation, present this concrete plan; no canary installation/update or launch may bypass that boundary by applying migration incidentally.

## A12 — Real runner closure evidence

Before declaring delivery verified, open a real session on each of Codex, Claude, OpenCode and Pi using the candidate integration; execute a real tool, perform a real web search and demonstrate RTK operating. Use isolated installation/configuration roots so these checks do not migrate the user's installation before plan review. Report runner/model/provider, candidate build, tool/search selection, outcome and RTK evidence. An installed RTK file alone is not proof of execution. Distinguish automatic interception from supported explicit RTK invocation. Separate real evidence from mocks/simulations and record unavailable credentials/provider failures as incomplete verification, never a pass.

## Verification evidence required for implementation delivery

- Generated-output checks across supported runner/path/role/profile combinations.
- Isolated fresh installation, upgrade and second-upgrade fixtures, with ownership conflicts and user installations.
- Explicit-off, absent, legacy-true and new-opt-in Codebase Memory cases, including install and preparation effects.
- Native/fallback/disabled/unknown search cases using effective configuration and observed tool exposure; distinguish simulated fixtures from real runner checks.
- Focused RTK/shared-file preservation checks and scoped regression verification.
- Owned-directory cleanup without hashes; symlink boundaries; ambiguous-entry skip/deny/confirm and changed-preimage cases.
- Per-runner manifest completeness across install/update/repair, actual post-write hashes, shared-entry ownership and failure/retry; zero-hash regression protection.
- Legacy-key compatibility and canonical configuration round trips.
- Global Codebase Memory inheritance and true/false runner exceptions; per-turn config changes and different members' effective search choices; direct interactive Codex/Claude/OpenCode launch/reopen selection and stale-configuration warnings through doctor and next-session opening.
- Planning-only no-write/no-bootstrap checks plus all four real runner sessions required by A12.

These are approved acceptance requirements, not results already obtained. Implementation is authorized. The user's subsequent authorization permits only the reviewed 33 ownership-proven removals, subject to exact preimage/reference revalidation and A15's idle boundary; ambiguous entries still require individual review. It does not authorize release publication or a broader real-installation upgrade.

## Additional publication gates — approved 2026-10-23

The user's machine is one sample, not sufficient release evidence. A13–A17 are mandatory before publishing this change; they are not certified by closing NRP-Q001–Q005.

### A13 — Published-version migration matrix in CI

Identify every relevant published Deck version per supported runner and record why it is included. At minimum cover each historical install/ownership/configuration format transition involving the affected packages and the latest published predecessor for that runner; do not silently substitute current templates for historical installation output. Generate installations using pinned published versions or their verified release source/artifacts in isolated roots, then run the candidate migration in CI. Record version, runner, artifact identity and applicability; justified equivalent-version grouping must remain explicit and reproducible.

Verify positive ownership-based cleanup and preservation of user installations, edited/ambiguous entries, legacy missing/zero manifests, shared artifacts and active generation references. After required explicit fixture confirmations and safe replacement/reference release, verify the managed result is clean and functional, including preserved RTK and search. Without confirmations, unresolved resources must be preserved and reported, not called clean. Test repeat migration, failure/retry and recovery. Missing historical artifacts or unsupported runner/version combinations are explicit gaps, not passes.

### A14 — Update behavior by execution mode

Interactive update presents the exact plan and requests separate explicit confirmation for each ambiguous entry, with secret-safe entry/context previews and current preimages. Non-interactive update and daemon paths apply only currently proven-owned removals when safe, preserve ambiguous entries, and make unresolved/deferred work visible in doctor with actionable review instructions. Default, cancellation and EOF preserve ambiguous resources. No unattended path may infer consent from names, templates or an interactive confirmation for another entry/version.

### A15 — No migration during active work

If the daemon has active sessions or turns, migration waits or is postponed. No runner configuration mutation, replacement publication or retirement may occur mid-turn. Guard the authoritative activity check and mutation boundary against new work starting between them; a one-time status poll is insufficient. Defer safely when activity cannot be established. Revalidate reviewed preimages, ownership and generation references after waiting. Read-only planning remains available during active work. Tests must cover active, idle, unknown, queued/new activity races and retry after deferral. Do not interrupt user work merely to migrate.

### A16 — Public plan-only command and existing recovery

Every user can obtain an exact read-only migration plan via the documented CLI, including runner filtering and machine-readable output. Reuse existing backup/recovery mechanisms for authorized apply; planning creates no installation/configuration/manifests/backups/trust effects. Verify the public command and update paths, not only pure helper functions. Pending/failed recovery and preserved entries are visible through doctor.

### A17 — Changelog and operator guidance

Before publication, add the release changelog entry explaining removal of context-mode/Serena in favor of native tools, unchanged RTK, explicit optional Codebase Memory, automatic proven-owned migration, individual ambiguity review, plan-only command, active-work deferral, backup/recovery and known retained resources. Explain that old Claude generations become collectible only after verified replacement selection and release of all active/recovery references. Do not equate a binary upgrade with successful plugin replacement or complete cleanup.
