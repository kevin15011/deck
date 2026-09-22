# Spec: Architecture-Only AGENTS.md

## Requirements

**REQ-AGR-001 (MUST):** The root `AGENTS.md` MUST contain only stable repository architecture, authority, contribution safety, local verification, and navigation guidance. It MUST NOT contain Deck-managed runtime role prompts, capability bundles, provider procedures, memory policy, or session-specific instructions.

**REQ-AGR-002 (MUST):** Fresh Codex installation, repair, and content-only synchronization MUST NOT create `AGENTS.md` or append a Deck-managed instruction block to an unmarked file.

**REQ-AGR-003 (MUST):** Codex native roles and skills MUST continue to receive their canonical content and applicable translated capability instructions independently of `AGENTS.md`.

**REQ-AGR-004 (MUST):** Deck MAY remove a legacy `<!-- deck:developer-team:start -->` through `<!-- deck:developer-team:end -->` block only when exactly one ordered marker pair exists and the current whole-file bytes match the prior Deck ownership manifest entry.

**REQ-AGR-005 (MUST):** Legacy cleanup MUST preserve every byte outside the owned marker span, preserve file mode, use existing preimage checks and operation-scoped backup/rollback, and remain idempotent.

**REQ-AGR-006 (MUST):** Missing ownership evidence, changed bytes, malformed markers, duplicate markers, unsafe paths, symlinks, or non-regular targets MUST fail closed for cleanup without deleting or rewriting the target.

**REQ-AGR-007 (MUST):** After successful cleanup, Codex ownership manifests and upgrade ownership metadata MUST release `AGENTS.md` without deleting the remaining file or immediately registering it again.

**REQ-AGR-008 (MUST):** A user-authored unmarked `AGENTS.md` MUST NOT by itself establish a Deck Codex installation. An exact legacy marker MAY remain a remediation signal but MUST NOT authorize writes without matching ownership evidence.

**REQ-AGR-009 (SHOULD):** Repository documentation SHOULD describe core contracts, adapter ownership, capability composition, CLI composition, all operational runner adapters, and the `deck-canary` development path without duplicating volatile inventories.

## Acceptance scenarios

### Fresh Codex materialization preserves repository guidance

**Given** a project has an unmarked user-authored `AGENTS.md`
**When** Deck builds a fresh or content-only Codex installation plan
**Then** the plan does not create or modify `AGENTS.md`
**And** native roles and skills still contain selected capability guidance.

### Owned legacy block is retired

**Given** `AGENTS.md` contains one valid legacy marker block
**And** its current bytes match the prior ownership manifest
**When** Deck applies and verifies the Codex plan
**Then** only the marker span is removed
**And** surrounding bytes and file mode are preserved
**And** `AGENTS.md` is absent from continuing ownership metadata.

### Changed or ambiguous legacy content is preserved

**Given** marker content is duplicated, malformed, unowned, or changed after the recorded manifest hash
**When** Deck reviews the Codex plan
**Then** cleanup is blocked with an actionable diagnostic
**And** no `AGENTS.md` bytes are changed.

### Repeated synchronization is stable

**Given** a legacy block has been retired successfully
**When** content synchronization runs again
**Then** no `AGENTS.md` mutation is planned
**And** ownership metadata does not reacquire the file.

### Obsolete ownership is released without touching the guide

**Given** the prior Codex manifest owns `AGENTS.md`
**And** the file is confirmed absent or is a regular unmarked repository guide
**When** Deck reviews, applies, and verifies the retirement
**Then** Deck does not create, delete, or rewrite `AGENTS.md`
**And** apply and verification fail if the reviewed path state changes
**And** unsafe, unreadable, symlinked, or non-regular targets retain ownership and block retirement.

### Retirement survives deferred external reconciliation

**Given** native cleanup succeeds before upgrade ownership metadata is updated
**When** a later sync runs with a fresh adapter instance
**Then** the native version-1 manifest re-emits the narrow `AGENTS.md` release
**And** interrupted reconciliation can retry idempotently without modifying the guide.

### Cleanup uses one authoritative snapshot

**Given** a legacy owned marker block is reviewed
**When** `AGENTS.md` changes during discovery or before apply
**Then** ownership validation, cleanup derivation, and mutation preconditions use one authoritative snapshot
**And** Deck rejects the stale plan without overwriting the concurrent edit.

### Architecture guide remains focused

**Given** the repository documentation governance test runs
**When** it inspects root `AGENTS.md`
**Then** it finds the package-boundary and verification navigation
**And** it rejects Deck-managed Developer Team markers and runtime memory policy.
