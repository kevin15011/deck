# Tasks: Canonical Supermemory Conversation Memory

## Phase 0: Provider and baseline evidence

### 0.1 Capture deterministic RED tests for current defects
- Reproduce SSH alias scope drift, ambient-CWD derivation, Pi/Codex missing project scope, deprecated Pi endpoint, false UI claims, and prompt-level seven-memory behavior.
- Verification: focused tests fail for the intended reasons before production edits.

### 0.2 Prove the official Supermemory transport capabilities
- Verify stable `customId`, dynamic dreaming, immutable container scope, authentication delegation, profile/hybrid retrieval, and migration enumeration against official docs and bounded authenticated runtime evidence.
- Do not place credentials or raw remote content in artifacts.
- Verification: record supported/unsupported capabilities and select the smallest enforceable transport.

## Phase 1: Canonical identity vertical

### 1.1 Implement the pure canonical project-scope resolver
- Add versioned branded types, remote parsing, normalization, and fail-closed diagnostics in `packages/core/src/memory/`.
- Cover HTTPS, SSH, SCP, aliases, `.git`, malformed remotes, and no-origin cases.

### 1.2 Pass verified project root through the OpenCode install path
- Remove ambient `process.cwd()` identity derivation.
- Preserve native OAuth and never persist Authorization headers.

### 1.3 Complete one OpenCode conversation capture/retrieval vertical
- Use the capability-proven transport, canonical scope, stable session `customId`, dynamic ingestion, profile load, and bounded query retrieval.
- Add deterministic provider fakes; no test network.

## Phase 2: Runner parity

### 2.1 Migrate Pi to the canonical endpoint and scope contract
- Remove `supermemory-new.stlmcp.com` from Deck-managed output.
- Preserve secret values outside committed/project config.

### 2.2 Add the same contract to Codex
- Preserve native OAuth ownership and project-local config safety.

### 2.3 Add cross-runner semantic contract tests
- Assert scope, endpoint, tool semantics, missing-scope failure, redaction, and no credential persistence.

## Phase 3: Conversation and retrieval policy

### 3.1 Deprecate the manual memory quota
- Keep legacy parsing only as needed; stop using `maxMemoriesPerSession` for behavior.
- Add a migration diagnostic and tests.

### 3.2 Replace adaptive-memory instructions
- Remove immediate manual-save triggers, topic-key tables, subagent persistence guidance, and mandatory session summaries.
- Explain automatic conversation capture, advisory authority, bounded recall, and explicit user forget behavior.
- Remove duplicate provider guidance across surfaces.

### 3.3 Enforce privacy and bounded context
- Add secret-pattern rejection/redaction, payload limits, validated provider output, five-result limit, and 1,500-token default budget.

## Phase 4: Unified installation and diagnostics

### 4.1 Converge all install paths
- Remove the legacy Pi-only Supermemory write path.
- Ensure selecting Supermemory is the only product decision; do not add capture UI.

### 4.2 Add truthful UI and Doctor status
- Show provider, auth readiness, scope fingerprint, endpoint, parity, and legacy/unmanaged entries.
- Never expose credentials or raw scope identifiers in telemetry.

## Phase 5: Non-destructive migration

### 5.1 Implement inventory and dry-run classification
- Support explicit legacy source scopes and one canonical destination.
- Classify confirmed, unrelated, duplicate, and ambiguous records with redacted evidence.

### 5.2 Implement approved copy with provenance only if provider capabilities are proven
- Keep source containers untouched.
- Do not implement deletion.

## Phase 6: Verification and rollout

### 6.1 Run focused and cross-runner gates
- Scope resolver, adapters, TUI install contract, Doctor, privacy, and migration dry-run tests.

### 6.2 Benchmark retrieval policy
- Compare memories/documents/hybrid, thresholds, rerank, and rewrite on sanitized fixtures.
- Gates: zero leakage, Precision@5 >= 0.80, Recall@5 >= 0.75, context <= 1,500 tokens, gateway/local overhead < 20 ms p95 where applicable.

### 6.3 Run broad verification and independent review
- `bun test`
- `bunx tsc --noEmit`
- Relevant build/smoke commands if production CLI composition changes.
- Independent Quality review is required because this change crosses authentication, remote writes, privacy, runner contracts, and migration boundaries.
