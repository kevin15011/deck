# Tasks: Consolidate Global Deck Configuration

## 1. Contracts and store

- [x] 1.1 Add path-parameterized Core config primitives and remove Core-to-CLI path import.
- [x] 1.2 Add CLI-owned canonical XDG `DeckConfigStore` with atomic patch/write behavior.
- [x] 1.3 Add structured legacy discovery, projection, conflict, migration, and rollback.

## 2. Production composition

- [x] 2.1 Route TUI preference reads/writes through the global store.
- [x] 2.2 Route Web Search setup through the global store transaction.
- [x] 2.3 Route Pi/OpenCode/Codex launch, install, inventory, Doctor, upgrade, and sync through caller-resolved config.
- [x] 2.4 Prevent adapters from reading project-local Deck preferences.

## 3. Compatibility and UX

- [x] 3.1 Preserve legacy sources and surface conflicts without values.
- [x] 3.2 Ensure no project `.deck/config.json` is created by normal operations.
- [x] 3.3 Document global ownership and legacy migration.

## 4. Verification

- [x] 4.1 Add field-preservation, migration, conflict, rollback, and no-local-write tests.
- [x] 4.2 Add two-project parity and ordinary-repo/workspace tests.
- [x] 4.3 Add compiled-binary global-config smoke outside a repository.
- [x] 4.4 Run focused tests, full suite, typecheck, diff check, and independent Quality review.
