# Native runner package retirement — design for review

## Current delivery scope — user-approved supersession

The user explicitly narrowed this delivery to clean, functional NEW installations on Codex, Claude, OpenCode and Pi, across supported native developer-team and cross-runner paths. Existing users will receive personal/operator-assisted cleanup. This decision supersedes A13 as a publication prerequisite and supersedes automatic execution of the previously reviewed local33/ambiguous5 work in this delivery. Historical evidence is retained as incomplete history, never relabeled as passing.

Active closure criteria: generated roles/prompts/skills and fresh install/preparation/launch outputs contain no retired context-mode/Serena integrations; Codebase Memory is absent and unprepared by default and activates only through explicit opt-in; RTK remains functional; native/fallback web search follows effective runner configuration; supported installed contributions have real granular ownership hashes. Verify the exact candidate in isolated fresh roots for all four runners, including a repeat sync/update that does not reintroduce retired resources. Preserve A12 real tool/search/RTK evidence requirements, reusing earlier evidence only where current identity and behavior justify it.

No further historical-version matrix expansion, old upstream installer repair, or historical CI gate is required for this delivery. Align required CI and release documentation with this approved scope, retaining historical checks as optional diagnostics where useful. Existing migration/recovery protections (ownership, individual confirmation, idle admission, drift preservation) must not be weakened or discarded; they remain safety requirements wherever those paths are reachable. Do not claim universal legacy migration support. No real-user cleanup, canary installation, restart or publication is authorized by this scope change.


Status: approved design with the user's subsequent adjustments, acceptance A1–A12. One implementation candidate is authorized. Migration of the user's actual installation requires presentation/review of its concrete planning-only output first.

## 1. Outcome and boundaries

Deck composes native runner tools without installing context-mode or Serena. Codebase Memory requires a new explicit activation. Search prefers the runner's effective native capability; absent or unknown capability uses the configured Deck provider, with an explicit possible-duplicate warning for unknown. All continuing Deck installation contributions receive durable per-runner ownership records.

Use the existing adapter plan/apply/verify and backup patterns, not a second installer. Keep session scheduling/continuity, Lead workflow, checks, output limits, RTK execution and Supermemory behavior unchanged. Runtime launch composition may resolve capability facts; it must not change session lifecycle. No model calls are added to detect search.

## 2. Architecture and production trace

| Boundary | Responsibility |
| --- | --- |
| `@deck/core` | Canonical package selection, legacy-input normalization, optional-capability intent, shared ownership record types, pure migration classification and native/fallback search selection. |
| Runner adapters | Resolve actual runner roots and native search facts; identify semantic config entries; render desired assets; apply precise edits through their existing installation facilities. |
| CLI composition | Connect the same normalized decisions to native developer-team launch, cross-runner driver inputs, dashboard/install, upgrade and repair. Present migration previews and collect explicit confirmations. |
| Shared installation accounting | Persist verified artifact receipts per runner, coordinate shared targets and recover interrupted installation writes. Reuse the Pi hashing/ownership approach rather than introducing an unrelated ownership model. |
| SDD runtime/content generators | Remove retired preparation and generated instruction references at their sources; retain unrelated preparation. |

Source anchors reviewed: `packages/core/src/runner-capability.ts` exposes installation plans, mutation previews and ownership releases; `apps/cli/src/upgrade-command/runner-sync.ts` already performs plan/backup/apply/verify but writes zero hashes; `manifest-store.ts` has file-only global records; `packages/adapter-pi/src/pi-global-install.ts` already carries expected preimages, keyed MCP ownership and atomic writes. `apps/cli/src/session-shared-services.ts` currently selects the configured search provider without first resolving intrinsic native search.

The graph generation was 2026-08-20; exact-path coverage was checked for these anchors and config/store paths. Changed/untracked coverage was followed with direct reads. Graph results are navigation evidence, not exhaustive current behavior claims. The existing inventory supplies the adapter-specific content and preparation paths.

## 3. Canonical configuration

Remove context-mode and Serena from canonical selectable IDs, defaults, instruction-bundle dispatch and installation catalogs. Retain a small legacy-input reader that recognizes their former keys before strict normalization, drops them from effective configuration and returns a diagnostic with the key path. Normal reads do not rewrite user files. Canonical saves omit the obsolete keys.

Use one new explicit optional-capability setting, proposed shape:

```json
{
  "capabilities": {
    "codebase-memory": {
      "enabled": false,
      "runners": { "codex": true, "claude": false }
    }
  }
}
```

The runner keys use the existing runner registry. Resolve `runners[runnerId] ?? enabled ?? false`; false overrides true and absent overrides inherit the global setting. The example is illustrative, not the shipped default: shipped overrides are empty and global enabled is false. This small global-plus-exceptions shape avoids repeating opt-in across runners while preserving per-runner control, so the alternative runner-only design is not retained. Existing `packageInstructions.<runner>.codebase-memory` values become legacy input: a legacy true produces a migration notice but cannot activate the capability. The old instruction-selection view derives from the new setting, rather than maintaining a second editable boolean. UI activation and configuration writes use the new field. Installation, prompt composition, readiness and preparation consume the same resolved selection.

This structural distinction avoids treating a migration-generated version stamp or timestamp as proof of consent. Migration must not create a true value from legacy defaults. Extend the config-store projection/merge paths so the new setting survives saves and does not get lost when another preference changes.

Codebase Memory opt-out removes only owned integration/install artifacts under the ownership rules below. It does not delete independent user installations, knowledge data or conversation history. A user-owned native integration can remain exposed by its runner even while Deck's participation is disabled.

## 4. Ownership classification and retirement

Classify each in-scope contribution before planning a mutation:

| Class | Rule | Action |
| --- | --- | --- |
| Dedicated Deck directory | Path lies within a resolved, explicitly declared Deck-owned root. | Clean retired installation resources automatically, even without old hashes. Preserve unrelated Deck resources. |
| Verified manifest contribution | Current file or selected shared entry matches a valid ownership record. | Remove or update precisely that contribution and its record. |
| Ambiguous shared contribution | Missing/zero hash, changed entry, duplicate match, or incomplete provenance. | Preserve, report and offer individual confirmed deletion. |
| Known independent user resource | Evidence identifies an external/user installation. | Preserve; do not adopt it into Deck ownership. |

Adapters declare concrete dedicated roots, including the configured equivalents of `~/.local/share/deck/` and `<CODEX_HOME>/deck/`. The entire `.codex` directory, runner config root, shared `~/.agents/skills`, or a path merely containing the word `deck` is not a dedicated root. Resolve configuration overrides and path boundaries; never follow a symlink from an owned root to delete its external target. An owned link can be removed as a link. Reject traversal and recheck target identity before mutation.

Location ownership is broad evidence, but cleanup remains scoped: no blanket deletion of the Deck root, sessions, unrelated plugins, RTK or Supermemory. For old Claude plugin generations, switch references to the verified replacement before collecting retired unreferenced generations; retain any generation still used by an active launch. Shared launchers/artifacts are collected only when no surviving runner contribution requires them.

Retired packages' own external data directories and unproven backups are preserved. Migration reports distinguish removed, preserved-user-owned, awaiting-confirmation and failed; unresolved residues must not be called clean.

### Planning-only mode

Expose the same planner without its effectful apply path (for example `deck runner cleanup --runner <id> --plan`, with all-runner and machine-readable output). Enumerate exact target paths/entry selectors, proposed changes, ownership evidence and preimage hashes, grouped by runner and dedicated-location/manifest/ambiguous class. Show ambiguous removal as conditional, and enumerate retained items and reasons. Do not reduce the plan to aggregate counts.

This mode uses strictly read-only readers, including raw legacy manifest parsing: it MUST NOT call a reader that migrates on read. No config/manifests writes, backup creation, capability bootstrap, downloads or trust updates. Optional report-file output is an explicit user-selected artifact, not an installation mutation. Apply consumes a freshly validated plan; changed preimages invalidate the corresponding approval. Lead must show the real-installation plan before any migration apply, including indirect apply from canary installation or update.

### Ambiguous-entry confirmation

Reuse CLI/TUI installation review surfaces. Provide a repeatable review entry point in the existing runner management flow; proposed CLI spelling is `deck runner cleanup --runner <id> --review` (to be registered with existing command conventions, not a separate service).

For each candidate show runner, real file path, entry key or hook identity, the entry, nearby structure, ownership uncertainty and the precise proposed deletion. Redact secret values without hiding the target's identity. Choices are **remove this entry** or **keep**; default/EOF/cancellation means keep. No bulk yes flag substitutes for the explicit per-entry confirmation. Unattended upgrades preserve candidates and print the review entry point.

Bind confirmation to the candidate ID, entry hash and full-file preimage hash. Re-read before mutation; if anything changed, replan and show the updated preview before asking again. Patch only the confirmed entry, preserving sibling keys, comments and unrelated array items. Invalid or unparseable configuration cannot produce a safe entry deletion and remains preserved with repair guidance. Confirmation does not turn unrelated content into Deck-owned content.

## 5. Per-runner manifests and real hashes

Extend the Pi manifest model into a common, versioned contribution contract. Pi's v1 records are imported without weakening their ownership checks; avoid running two independent ownership databases for Pi. Proposed authoritative locations:

| Runner | Manifest location |
| --- | --- |
| Codex | `<CODEX_HOME>/deck/manifest.json` |
| Claude | `<Deck data root>/claude/manifest.json`, outside individual plugin generations |
| OpenCode | `<OpenCode config root>/deck/manifest.json` |
| Pi | `<Pi agent root>/deck/manifest.json` (versioned evolution of the current file) |

A manifest identifies its schema version, runner, resolved installation root identity, Deck version and a map of contributions. Each contribution records:

- Stable ID, kind and capability/source item; actual target path and scope (global/project).
- Selector: whole file, semantic config key, uniquely identifiable hook/array entry, symlink or package-registration entry.
- Hash algorithm and encoding, actual content hash, installed revision and ownership basis (verified prior record, Deck root, or a newly authorized write).
- Shared artifact references when another runner uses the same physical artifact.

Hash whole files/binaries by actual post-write bytes. Hash shared configuration contributions by a documented deterministic serialization of the selected semantic value; preserve array order and distinguish absent from null. Record this encoding explicitly. Symlinks are hashed as link targets without traversing them. Installed managed package trees need a file list with real hashes or an equivalent deterministic tree record containing its individual leaves; an unchecked version string is not a content hash. Do not claim ownership of an externally reused executable just because Deck discovers it.

Record MCP entries, each installed agent/skill and its support files, hooks, plugin/package registrations and managed artifacts such as RTK assets and enabled Codebase Memory. The same accounting applies to remaining integrations without changing their runtime behavior. Temporary launch overlays are not permanent installations: record the selected source contributions in launch diagnostics, without writing a permanent install record on every model step.

For shared files, neither the manifest nor successful verification claims the whole file. Array indices alone are unstable selectors: match a stable semantic identity plus expected hash, and treat multiple matches as ambiguous. Never store raw credentials or full config copies in manifests. Backups needed for recovery remain local and access-restricted.

### One writer path and failure handling

All install/update/repair/remove entry points produce contribution changes and use the same accounting boundary. Replace `runner-sync`'s fabricated hashes with receipts from verified actual writes; manifest validation rejects all-zero/placeholder hashes. A failed write or unverifiable hash cannot be reported as a successful installed contribution.

Retain existing adapter backups and precise mutation previews. Add a bounded pending-transaction record before changes, with expected preimages, desired hashes and affected contributions. Serialize overlapping writes by target; manifests for shared assets also register each runner's reference. Publish the new manifest atomically after verifying postimages. On restart/retry, compare actual state with pre/post hashes to finish accounting or restore only unchanged transaction-owned postimages. Never overwrite an intervening user edit during rollback. Keep failed recovery visible.

The global upgrade manifest can retain binary ownership and references to per-runner manifests; it is not a competing authority for individual runner entries. Legacy zero-hash records are read as unknown, not upgraded into ownership proof by hashing arbitrary current user content. A retained shared artifact outside dedicated roots is adopted only with prior valid provenance or explicit user authorization, not by matching an expected template. New desired contributions that conflict with user content are reported instead of overwritten.

## 6. Native-first search with fallback

Each adapter exposes a read-only `inspectNativeSearch` facet for its effective launch configuration. Proposed result:

```ts
type NativeSearchEvidence = {
  availability: "available" | "unavailable" | "unknown";
  reason: string;
  mode?: string;
  configFingerprint: string;
  evidenceSource: "tool-inventory" | "effective-config" | "provider-contract";
};
```

The fingerprint covers runner/version, selected model/provider, relevant config overrides, tool policy and relevant environment flags. It must not contain secrets. For Deck-managed cross-runner members, at preparation of every turn, including continuations, resolve that member's effective configuration anew and obtain current tool-exposure evidence. Cached results are permitted only within the same validated preparation; install/logical-session-start caches cannot replace a subsequent turn's evaluation. Do not reuse the Lead's search result for a member with a different runner/model/configuration. Immutable provider metadata can be shared, but is not the current availability decision.

### Approved interactive exception and review boundary (2026-10-23)

| Execution path | Required selection boundary |
| --- | --- |
| Deck-managed Codex/Claude/OpenCode members | Every turn, including continuations, with current member-specific effective configuration. |
| Cross-runner OpenCode | Launch of its per-turn `opencode serve` process; this already is the per-turn boundary. No dynamic MCP API or shared-instance session-isolation feature is needed for this change. |
| Directly opened interactive Codex/Claude/OpenCode CLI | Launch/reopen, under the explicitly approved exception. |
| Pi | Existing approved per-turn requirement; no new exception. |

The direct-interactive exception preserves native CLI lifecycle. It does not authorize a proxy, remote app-server reroute, continuous watcher, automatic restart, or manipulation of another session's search tools. The earlier investigation of OpenCode instance-global MCP APIs is not a prerequisite for the cross-runner path.

Retain a non-secret search-configuration fingerprint associated with the interactive launch using existing launch metadata where possible. At doctor or the next session opening, compare the relevant effective configuration with that launch evidence. A detected change warns that the already-open interactive CLI must be reopened to refresh search selection; opening a new session selects from current facts. Do not imply that the old process was updated. Missing historical evidence must not be treated as verified unchanged configuration. Keep this bookkeeping outside the read-only migration planner and do not introduce session scheduling/continuity changes.

Prefer a supported effective tool inventory where available; otherwise combine effective config with verified runner/provider capability contracts. Model/provider facts belong in the adapter's capability evidence, not a global `runnerId => hasSearch` table. No model prompt, test search or private history/database read is needed. Unavailable discovery or unrecognized relevant configuration produces unknown, not a fabricated yes/no.

| Deck search | Native evidence | Selection |
| --- | --- | --- |
| Disabled | Any | No Deck search injection; preserve independent native/user settings. |
| Enabled | Available | Native; omit/retire proven Deck fallback contributions. |
| Enabled | Unavailable | Configured Deck provider. |
| Enabled | Unknown | Configured Deck provider plus visible possible-duplicate diagnostic. |

Missing fallback credentials/configuration is reported explicitly; do not label search ready. Unknown on a supported configuration emits a detection-defect diagnostic with non-secret facts and must become a regression case, rather than a routine success status. A transient provider failure does not cause another search tool to be injected.

Codex detection considers effective `web_search`, overrides and provider support; disabled selects fallback. OpenCode considers provider, EXA/PARALLEL flags and tool permissions. Claude considers effective provider/model/tool exposure. Pi considers extensions and discovered tools, not a hard-coded negative. These branches are verified against supported runner contracts during implementation; the inventory's official references are evidence, not a permanent version allowlist.

Selection applies before install materialization and at the execution-path boundary above, before final native launch/continuation inputs are fixed. If model-specific availability is unknown at install time, install/configure the Deck fallback with the warning as approved; this never replaces per-turn evaluation with effective member facts in the cross runner. For shared global configs, do not toggle entries behind concurrent sessions: prefer supported per-launch selection/overrides, preserving the artifact manifest. If a runner cannot suppress an existing ambiguous or user-owned search entry, report the resulting duplication rather than deleting it or claiming uniqueness. This also applies to the approved unknown fallback case. Adapt composition seams as needed without changing session scheduling or continuity policy.

A native-specific disabled setting triggers the requested fallback. An explicit broader authority rule forbidding web access is still binding; fallback is not a permission bypass. Independent user search tools remain untouched. Avoid matching arbitrary tool names as proof of functional web search without a supported inventory/schema contract.

## 7. Sequence and rollout

```mermaid
sequenceDiagram
    participant U as User / upgrade
    participant C as CLI composition
    participant A as Runner adapter
    participant M as Runner manifest
    U->>C: Install/update/review
    C->>C: Normalize config and legacy diagnostics
    C->>A: Inspect roots, contributions, native search
    A-->>C: Desired changes and ownership evidence
    C->>C: Select native or fallback (warn if unknown)
    opt Ambiguous shared entries and interactive review
        C-->>U: Entry + context + exact removal
        U->>C: Confirm one entry or keep
    end
    C->>A: Revalidate preimages; apply authorized plan
    A->>A: Backup, write and verify actual content
    A->>M: Commit real contribution hashes
    A-->>C: Removed / kept / unresolved / failed
    C-->>U: Result and any follow-up review
```

Approved implementation order:

1. Establish the common contribution contract and wire real manifest receipts into existing install/update/repair paths. Preserve Pi ownership history. Remove zero-hash writes before enabling cleanup.
2. Normalize legacy config and explicit Codebase Memory opt-in; remove retired catalog/content/preparation sources and regenerate assets.
3. Add ownership classification, dedicated-root retirement, strictly read-only planning and per-entry review to existing migration flows. Connect recovery and shared-artifact accounting.
4. Connect effective native-search evidence and shared selection policy to the approved execution-path boundaries: per-turn managed members and Pi, launch/reopen for direct interactive Codex/Claude/OpenCode, including unknown fallback diagnostics and stale-configuration review warnings.
5. Verify the complete candidate in isolated installations, including real sessions/tool calls/web searches/RTK execution in all four runners. Separately generate and present the read-only real-installation migration plan. Do not apply it before review.

One functional candidate owns these boundaries; do not release a half-migrated combination where old writers recreate retired resources or overwrite manifests. Implementation is authorized; migration of the user's real installation is a later reviewed action.

## 8. Verification and rollback

Map tests directly to A1–A10: rendered prompt/skill output; clean install effects; legacy reads/canonical writes; CBM old-true versus new-opt-in; owned-root cleanup without hashes; shared-entry positive/negative/stale confirmation; symlink escape; actual manifests and zero-hash rejection; interrupted writes/retry; shared RTK preservation; search true/false/unknown and user-owned duplicates across supported runners/routes.

Use existing focused adapter, configuration, runner-install contract and TUI review tests with isolated roots and deterministic mocks. Hash assertions read actual materialized content and each selected shared entry. Test no effects in planning mode and configuration changes between managed turns, including successive OpenCode serve launches. Test direct interactive launch/reopen selection and both stale-review entry points (doctor and next-session opening), including unchanged and changed relevant configuration. These deterministic gates keep the existing no-network/no-user-installation policy.

In a separate, explicitly user-authorized live acceptance pass, open a candidate-backed real session for each of Codex, Claude, OpenCode and Pi in isolated roots, run a harmless tool, perform a web search and demonstrate RTK execution. Reuse available credentials without copying secrets into reports or modifying the user's installation. Record model/provider/build/tool route and actual RTK transformation or invocation. Separate automatic hook behavior from explicit RTK invocation; preserve each runner's existing integration behavior. A fixture pass, installed file or old binary session does not satisfy this live criterion. If credentials or provider availability prevent a check, report that row as incomplete and continue independent checks; do not declare full closure.

Rollback restores only transaction-owned content still matching the applied postimage, preserving newer user edits. Restoring a previous integration/configuration is an explicit recovery action, not automatic reactivation of retired packages after successful migration. Retain recovery evidence until the transaction is verified. Do not promise that running an older Deck binary cannot reinstall its old defaults; document the supported recovery path.

## 9. Tradeoffs and approval boundary

- Dedicated-directory ownership allows useful automatic cleanup even when historical manifests are incomplete; careful path and scope checks prevent treating the entire machine or Deck data tree as disposable.
- A new optional-capability setting is a small config migration, but avoids falsely treating stored defaults as explicit activation.
- Per-runner contribution records add durable ownership infrastructure requested by the user; reuse existing adapter operations and Pi semantics rather than building a new installation framework.
- Unknown search deliberately favors availability over uniqueness. The warning is visible and the detection gap remains a defect, as approved.
- Ambiguous shared entries require user review. Neither design approval nor an unattended upgrade confirms those future individual deletions.

Design approved. Proceed with the single candidate; present the concrete real-installation plan before applying its migration. Individual ambiguous-entry confirmations remain required at application time.

## 10. Publication gates and limited real-apply authorization (2026-10-23)

The user authorized only the 33 proven-owned removals in the reviewed opaque-display plan. Freeze that exact entry set and identities; revalidation may defer an entry but must not widen the authorized set. The five ambiguous entries are to be reviewed one by one after that stage. New authorization does not cover real plugin replacement, full update/canary installation or publishing a release.

The user also requires idle migration: active daemon sessions/turns defer mutation, including replacement publication. Planning is read-only and may run while busy. Implement a coordinated activity/migration admission boundary, with rechecks after waiting, rather than checking once and mutating later. Do not stop active work to create an idle window. Until this boundary is verified, no real migration is executed from an active Lead/member turn. The current user-approved 33-entry operation remains deferred, not cancelled or awaiting repeated consent.

Claude's selected generation is protected because new launches still refer to it. Existing publication writes a replacement generation and updates selection; only successful replacement/verification allows new sessions to use the new generation. Existing native processes/launch receipts may continue referring to the old generation. Cleanup must replan after references are released and pending recovery is resolved; do not promise collection immediately on binary installation. Validate this sequence against historical generated plugins and the actual update entry point, not just a replacement helper.

Acceptance A13–A17 govern publication: pinned historical-release installations per runner in CI; interactive/unattended/daemon behavior; race-safe active-work deferral; a public read-only planner backed by existing recovery; and changelog/operator guidance. The relevant release inventory must state exact versions, hashes and format epochs, with explicit unsupported/missing rows. Preserve actual historical installation behavior; current-template synthetic fixtures alone are insufficient.

Reuse existing update, doctor, daemon admission and backup facilities. The new activity guard protects migration only and must not redesign general task scheduling/continuity. Non-interactive paths preserve and report ambiguity rather than bypassing prompts. These are authorized implementation deltas on the same candidate, but release publication and real-installation scope remain separately bounded.
