# Conversational capability retirement design

## Baseline and accepted decisions

Preceding commits8148de1/4f1079e/bee195e preserve the reviewed UI/resilience work.
Architect taskef63aa51attempt1 and inventory0e792d3cattempts1-2 are advisory design
inputs. Complete lexical capture is `/tmp/deck-memory-removal-inventory.json`;
matches include false positives/historical records and are not deletion operands.

Retire the active product atomically across core/session contracts, four adapters,
CLI/TUI/web composition, instructions, generators, packages, tests and docs. No
memory provider/runtime stub or dormant configuration remains. Personal integrations
pass through generic policy once the retired capability-specific reservation is gone.

## Compatibility without a retained subsystem

Discard legacy top-level and package-instruction settings during normalization;
normal writes omit them. Keep strict secret/structural validation before projection.
Separate read-only legacy ledger events from the emittable event union and reject
new appends. Do not rewrite persisted user ledgers.

Existing native config can invoke internal commands before a reviewed upgrade
cleanup has occurred. If needed, route narrowly identified retired invocations to
a generic inert compatibility dispatcher; no transport/server/provider is retained.
Document its exact scope and bounded removal milestone. Unneeded flags and internal
commands fall through normal unknown-command behavior; accepted legacy no-op flags
must not reintroduce a selectable capability.

## Ownership and cleanup

Reuse contribution journals, root containment, hash verification, native leases,
generation references and idle-mutation admission. Extend the existing retirement
flow rather than inventing a name-based deleter. Explicitly remove retired owned
Codex runtime hooks/MCP contributions during content-only upgrade sync, otherwise
all users retain per-tool-call invocations. Preserve the rest of config bytes.

Remove no-longer-desired owned Pi extensions and pinned native plugin artifacts
through their existing receipt/manifest formats. Unknown, altered or independently
installed content is preserved/reported. A prior receipt mismatch overrides any
legacy shape recovery. Enumerate exact installed receipts before real cleanup.

Do not query remote memory or delete accounts. Do not print credential values.
Dedicated Deck secret artifacts require the same exact contained ownership and
explicit cleanup semantics as other retired local artifacts; provider-owned settings
or independent personal registrations cannot be deleted by matching names. No new
general secret deletion API is needed solely to satisfy a lexical zero count.

All actual user-installation cleanup is deferred until source verification and
independent review. Active current/native sessions protect their referenced files;
deferred artifacts must be reported honestly, not counted as removed.

## Sources, generated artifacts and history

Delete dedicated source origins before regenerating bundles/schema. Regenerate
Pi/runner execution assets through canonical generators under the pinned runtime;
never hand-edit generated content. Prune workspace dependencies and lockfile through
the package manager in a controlled project fixture, then verify frozen install.

Remove active product docs and current spec requirements. Lead alone reconciles
OpenSpec: memory-only pending changes become explicitly superseded historical
records, mixed historical evidence remains truthful. Git history is preserved.
Final residual reporting distinguishes active product, inert transition, current
spec, historical evidence and unrelated memory terminology.

## Work ownership

Backend removal owner: core/session-host contracts, four adapters, cleanup/security,
package exports, generator source ownership and corresponding protected tests.
CLI/UI removal owner: apps/cli and apps/web composition, TUI/settings/doctor,
dedicated CLI/UI tests, root scripts/dependency declarations and product docs.
Do not edit another owner's files without a concrete Lead handoff. Backend owner
owns final cross-workspace typecheck, lockfile/generated regeneration and integration
once CLI owner is finished. Lead centralizes all OpenSpec and commits.

Use focused checks during concurrent work; full gates run only on integrated source.
Preserve unrelated functions' behavioral tests; removing dedicated memory tests is
authorized, deleting generic approval/lifecycle regressions is not. Use residual
validation as an architecture/artifact audit, not snapshots pinning prose/markup.
