# Tasks: Complete Skill Discovery Runtime

## Phase 1: Descriptor compatibility

### 1.1 RED fixtures

- Add a failing test for ordinary `metadata.author/version` frontmatter.
- Add explicit accepted depth-three and rejected depth-four map/sequence cases.
- Preserve adversarial alias, tag, duplicate/merge key, malformed, size, and traversal cases.

### 1.2 Parser correction

- Implement logical collection-depth accounting in the descriptor parser.
- Improve safe diagnostic categorization without leaking paths or bodies.
- Run focused Core discovery and CLI registry tests.

### 1.3 Registry integration

- Add an isolated project plus OpenCode-user-root refresh test.
- Prove failed refresh preserves prior registry and `.gitignore` bytes.
- Prove authorized refresh becomes ready after valid ordinary metadata.

## Phase 2: Additive runtime contracts

### 2.1 Contract-first tests

- Define candidate query/result, selection reference, preparation result, and load outcome unions.
- Add parser/bound tests for all external contract inputs.

### 2.2 Core search and verification

- Implement ready-registry search and bounded direct fallback.
- Bind selection to observation identity and trusted runtime context.
- Reverify generic project candidates without exposing absolute paths.

## Phase 3: OpenCode vertical slice

### 3.1 Adapter contract

- Wire production native inventory into the OpenCode provider.
- Resolve the selected observation exactly and reject same-name ambiguity.
- Add native load preparation and observed outcome translation.

### 3.2 Session composition

- Provide real bounded discovery status to Lead and child specialist contexts.
- Keep candidate records out of delegation payloads.
- Ensure parent and child load evidence are isolated.

### 3.3 Acceptance

- Exercise one project skill and one user skill through the built OpenCode composition.
- Prove Lead and delegated specialist independently discover and load the exact candidate.
- Prove missing, stale, denied, ambiguous, and no-candidate outcomes fail open honestly.

## Phase 4: Verification and follow-up

### 4.1 Independent quality

- Run focused tests, affected-area tests, typecheck, and independent architecture/security review.
- Verify generated outputs are unchanged unless regenerated through their canonical command.

### 4.2 Runner parity decision

- Implement Pi parity as a separate bounded slice after OpenCode passes.
- Correct support documentation or implement Codex parity; do not claim unproven support.
