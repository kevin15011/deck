# Deck-managed artifact authority

## Intent and authorization

The user explicitly authorized a product-wide correction on 2026-11-04: Deck has final authority over everything it installs or generates. Edits and missing receipts from older installations must not force repeated manual conflict resolution. This includes all runners, shared generated content, and project-scoped generated artifacts. The immediate incident is OpenCode preserving unreceipted read-only role tool settings and an execution plugin, then rejecting its own installation and rolling back.

Scope is source, tests, documentation and generated-content policy. It is not an instruction to repair the user's live environment through this session. Existing approved queue UI edits must be preserved. No commit or publication is requested.

## Outcome

Canonical generators replace Deck-managed content during authorized installation/update/reconciliation. Unrelated entries in shared files and user inputs/data remain untouched. Missing or mismatched receipts do not establish a customization veto; regenerated and verified output establishes new receipts. Read-only launch authentication remains strict.

## Dependencies and evidence

Build on runner-integration-resilience writer fences, rollback, journals and generation leases. Architecture task task-098dc6bb-a5b1-4fff-a1b6-fac0ad562681 attempt 3 is advisory design evidence (90750/90751), subject to design.md corrections. OpenCode investigation task task-743e3c89-a32c-4671-aa8a-7583be4fcae6 attempt 3 supplies the motivating trace. This change supersedes preservation of customized Deck-generated slots, not unrelated user-content preservation or launch trust requirements.

## Rollback

Retain transaction preimages and bounded private recovery backups before replacing noncanonical managed content. Failed apply must restore preimages without authenticating partial output. Existing unresolved transactions must be recovered from evidence; never clear their fences merely to permit a write.
