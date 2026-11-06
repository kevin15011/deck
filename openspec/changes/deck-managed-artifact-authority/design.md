# Managed artifact authority design

## Accepted decisions

1. Inventory-managed locations and selectors determine write authority independently of current byte equality. Dedicated roots must be explicitly enumerated generated roots, not all Deck state. Namespaced entries must use known generated identifiers, not arbitrary prefixes. Receipt/history recognition must validate runner/root/path/selector containment; untrusted metadata cannot expand write scope.
2. An authorized writer replaces managed targets with trusted current generator output. Expected postimages are known before effects and verified before issuing receipts. Existing executable bytes are never authenticated merely because a receipt is missing. Acquired tool trees require pinned artifact verification before receipts.
3. Shared JSON/TOML/Markdown files preserve all unrelated values and content outside managed selectors/marker spans. Deck input configuration, credentials, project source and conversation data are not generated outputs. Project-generated files and instruction blocks ARE in scope; their exact boundaries require the inventory supplement.
4. Preserve read-only launch trust, symlink refusal, root containment, active-generation protection, writer ordering, locks, TOCTOU checks and rollback. Missing ownership metadata is recoverable through regeneration. Corrupt/pending writer fences are not ordinary output and MUST NOT be discarded or reconstructed blindly: recovery must prove transaction and compatible-writer state.
5. Receipt mismatch or absence on an established managed target is drift. Equal-version refresh may repair drift while preserving same-version stable/canary convergence; matching valid installed receipts must not cause peers to rewrite each other from generator differences alone.
6. Back up replaced noncanonical output privately, with bounded retention and no secret contents in logs. Backups are never executed or automatically adopted as trusted installation output. Backup failure aborts the transaction safely.
7. No per-file customization approval for established managed output. Ambiguous generic shared entries require bounded identification from supported historical generators/history, never blanket ownership. Inventory must explicitly account for them and prefer managed namespaced alternatives where feasible. Do not report a required capability healthy when a collision prevents its installation.
8. No silent exclusions of project-generated artifacts, installer helpers, extensions, commands, skills, MCP, hooks, instructions, plugin selections, or retired managed content. Architectural audit must enumerate these and assign implementation coverage.

## Verification oracles

- For every runner and project generator: fresh install, edited managed content, absent/old receipt, canonical second-run idempotence.
- OpenCode incident: canonical read-only tools and verified plugin after install; rejection before repair remains intact.
- Foreign agents/MCP/config/comments/credentials/source/data unchanged; symlink and forged-metadata scope expansion refused.
- Interrupted apply restores preimage; active use defers; older writer cannot overwrite newer state; same-version peers converge.
- Managed retired artifacts can be removed despite byte edits while retaining active-reference and transaction protections.
- Targeted tests run red/green; independent Quality checks trust, containment, rollback and shared-file preservation. Full suite/types on final candidate, baseline failures explicitly recorded; Lead isolated live canary checks for installer paths.

## Architecture review corrections

The initial report excluded project-init/skill-registry output and proposed rebuilding corrupt fences. Those parts are NOT accepted: the user's scope includes generated project artifacts and recovery must preserve writer/transaction evidence. The report's broad claim that every writer uses receipt equality remains a hypothesis to qualify per inventory row.

### Registry lease design review

Architect attempt 5 (112520/112521) proposed link/rename-aside leases with age-based expiry. Lead rejected adoption: a holder can pause after verify and resume after expiry/replacement, so verify-before-rename does not fence the effect. Moving a foreign lock aside opens an acquisition gap; failed restoration followed by unlink loses foreign evidence. Do not implement this proposal. Revision must avoid stealing live holders by age and investigate supported kernel-backed serialization on a stable object with non-destructive release. The accepted cleanup diagnostics and stateRoot propagation remain independent.

### Accepted registry serialization revision

Architect attempt 6 (115493/115494) replaces the rejected protocol with a stable per-project SQLite file under a validated private per-user lock root, independent of stateRoot. Each writer holds its own BEGIN EXCLUSIVE transaction through preimage inspection, backup, file effects, rollback and cleanup; release rolls back/closes the connection and never deletes or renames the lock file. No live-holder expiry or stale-PID stealing. Dynamic Bun/Node SQLite backends preserve Node-based Pi support. Fail closed on unsafe/corrupt lock infrastructure; do not open/close that inode through ordinary fs while held. Validate parent containment and ownership, not just leaf shape. Same-user noncooperating path replacement and mixed old versions are explicit trust limits, not solved by a verify-before-write claim. Real cross-process/crash/backend tests and generated bundle qualification are required before acceptance. Tests inject isolated lock roots shared by contenders.

### Accepted restart recovery direction (architect revisions 9–10, Lead qualification)

Canonical regeneration replaces journal replay. Hold the existing mutation lease before recovery assessment and effects; exclusion is not proof of the previous process's death. Validate committed and pending writer/schema compatibility, including syntactic version validity, before mutation. Unknown/newer provenance remains unchanged. Resolve current generator inputs independently; journal paths and hashes cannot extend the exact current inventory or authenticate existing executable content. Verify canonical outputs and normal launch admission before clearing pending state.

Preserve recovery binding in the atomic fence as a rotated recovery marker, durable global/project scope, and original adapter references. Keep original references until every bound live journal has been archived; retain marker and scope when starting the new adapter operation. Recording new references must preserve that prefix and enforce capacity before effects. Project scope requires the matching explicit project context and survives every interruption. Missing journal bytes alone prove neither consistency nor global scope.

Use a private same-filesystem hard-link archive with no overwrite, identity checks, archive-directory fsync before live unlink, and live-parent fsync before releasing references. Retry a same-inode link idempotently. Validate existing directory ownership, permissions and containment; do not chmod an unsafe directory into acceptance. Newly created directory components require parent synchronization before child publication. Preserve current private staging and symlink defenses.

Prune unbound Deck archive entries under the lease before admitting another archive, not only after successful commit. Never prune a live-linked, bound or foreign entry. The bounded retention target is eight unbound historical entries plus the finite current transaction set; count linked entries explicitly rather than pretending nlink>1 files do not occupy storage. Unsupported link operations or failed barriers preserve pending evidence and stop effects. Archive data is forensic only, never rollback authority. Test repeated failed publication followed by successful retry; a recovered transaction must not depend on an old unbound archive.

Qualify process-crash recovery through real child termination at publication boundaries, plus ordering/failure injection and global/project-scope retry. No power-loss guarantee is established by these tests. Reject the report's categorical Bun syscall claim: timing differences alone do not establish F_FULLFSYNC behavior. Do not introduce FFI or change toolchain from that inference.

Revision 10's orphan adoption and dev-channel missing-scope shortcut are NOT blanket authority. A channel label alone cannot establish scope, and an orphan without compatible writer provenance must not silently override newer state. Keep these cases unchanged with a precise diagnostic unless existing trusted current inventory and independent scope/version evidence prove a bounded reconciliation. Claude no-fence recovery requires the revision 9 read-only precheck of journal/manifest identity, exact shape, version, scope and canonical postimages before any mutation; no journal-target fallback reads.

Implementation remains pending with the existing Apply Deep owner after the Codex bundle blocker. Reports: architect attempt 9 (141325/141326) and attempt 10 (145107/145108). This is design adoption, not runtime verification or acceptance of all report claims.
