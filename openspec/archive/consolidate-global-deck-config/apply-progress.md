# Apply Progress: Consolidate Global Deck Configuration

## Completed

- Added CLI-owned XDG `DeckConfigStore` and path-parameterized Core file primitives.
- Removed Core-to-CLI path dependency and project-root preference coupling.
- Required caller-resolved global config across runner launch, inventory, install, content, Doctor, upgrade, and sync contracts.
- Added canonical-only runtime resolution plus migration-only legacy discovery and explicit conflict handling.
- Added private atomic writes, safe reads, ownership/ancestry/containment checks, lock serialization, CAS, operation receipts, and rollback.
- Converted production preference mutations to locked field-level patches preserving unrelated settings.
- Prevented normal operations from creating or updating project `.deck/config.json`.
- Updated documentation and standalone two-project behavior.

## Operational Repair

With explicit user authorization, the contaminated canonical XDG config was backed up privately and replaced atomically from the authorized current-project legacy source. The repaired canonical file is mode `0600`, contains Pi/OpenCode/Codex preferences, keeps Supermemory and Web Search enabled, and no longer contains synthetic runner `atlas`.

After canonical verification, the user explicitly authorized final legacy cleanup. The tracked project `.deck/config.json` and `~/.deck/config.json` were deleted, both now-empty `.deck` directories were removed, and `.deck/config.json` was added to `.gitignore`. The private contaminated-XDG backup remains as the sole rollback preimage.
