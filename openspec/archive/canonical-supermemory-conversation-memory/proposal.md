# Proposal: Canonical Supermemory Conversation Memory

## Intent

Replace Deck's fragmented, provider-selectable, prompt-driven adaptive-memory integration with one first-class, runner-neutral Supermemory runtime. Deck owns lifecycle, scope, security, budgets, permissions, and observability; Supermemory owns learning, graph relationships, updates, forgetting, profiles, ranking, and retrieval.

## User-visible outcome

The user enables or disables Adaptive Memory from Deck. Enabling it configures Supermemory from the Deck TUI, starts automatic role-aware recall and capture through Deck Runtime, and keeps MCP available only for optional ad-hoc recall. Conversations use one stable project container and one stable session document. The standalone Deck binary includes the integration and requires no Node/npm, SDK installation, or manual runner configuration.

## In scope

- Canonical, versioned project-scope resolution independent of current working directory and SSH host aliases.
- One session/conversation document per stable `customId` with provider-native learning in production.
- Complete removal of Engram, provider selection, and provider-specific product configuration.
- A Deck-owned runtime execution boundary above OpenCode, Pi, Codex, and future runners.
- Central role-aware retrieval, capture, sanitization, context-budget, fail-open, and observability policies.
- TUI-managed authentication, setup, Doctor/readiness, and MCP materialization.
- Standalone compiled-binary validation and an initial DeckMemoryBench.
- Equivalent Supermemory scope and endpoint behavior for OpenCode, Pi, and Codex.
- Removal of the arbitrary seven-memory semantic limit and immediate manual-save instructions.
- Profile plus query retrieval with bounded result context.
- Unified install status and Doctor diagnostics without a new capture option.
- Non-destructive inventory, classification, and copy migration for legacy containers.
- Privacy filtering, secret rejection, redacted telemetry, and isolation tests.

## Out of scope

- Deleting any existing Supermemory container or document.
- Uploading OpenSpec artifacts automatically.
- Adding team-shared or organization-wide memory routing.
- Replacing Supermemory's extraction, graph, profile, ranking, or deduplication logic.
- Adding a general hosted Deck memory service or a persistent Deck daemon.
- Mem0, dual-write, another memory provider, or a Deck-owned semantic memory engine.
- Deck-owned extraction, semantic deduplication, ranking, graph, contradiction, temporal, or forgetting logic.

## Approach

1. Introduce a provider-neutral canonical project memory identity resolved from the verified project root and canonical repository identity, with no default-container fallback.
2. Execute profile/search/capture through a Deck-owned runtime host using the official Supermemory API/SDK and a server-bound canonical scope; agents never choose a container.
3. Normalize runner lifecycle events through one authenticated, versioned bridge contract and inject bounded advisory context before relevant agent execution.
4. Replace per-fact prompt saving with a central capture/skip policy that sends eligible rich conversation context after deterministic secret filtering.
5. Keep Supermemory MCP as a separately diagnosed, project-scoped ad-hoc capability and prevent automatic double ingestion.
6. Migrate legacy configuration conservatively: `supermemory` becomes enabled, `none` becomes disabled, and `engram` becomes disabled with an actionable removal warning.
7. Package and verify the client inside Deck's compiled release binaries and benchmark automatic memory against the prior MCP-primary baseline.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Runner-native OAuth cannot be delegated to a local gateway | Complete a transport capability spike first; retain native OAuth only when the canonical scope and conversation contract can still be enforced. |
| Conversation ingestion captures secrets or excessive raw content | Apply local secret-pattern rejection/redaction and bounded payload rules before remote writes; never log content. |
| A repository fork inherits another project's identity | Bind scope derivation to canonical repository owner/path and detect mismatches; never use directory-name fallback. |
| Legacy spaces contain unrelated records | Classify and dry-run before copy; ambiguous records remain untouched. |
| Prompt and adapter contracts drift again | Add cross-runner contract tests and Doctor diagnostics derived from one canonical contract. |
| Provider latency harms runner responsiveness | Use asynchronous dynamic ingestion, one profile load, bounded query search, and measured feature gates for rerank/rewrite. |

## Rollback

- Disable Deck-managed adaptive memory while leaving remote data intact.
- Restore the previous runner MCP entries from mutation preimages.
- Keep the canonical resolver and diagnostics inert if the provider is disabled.
- Never require remote deletion for rollback.

## Success measures

- Zero cross-container leakage in deterministic canary tests.
- One canonical project scope across all supported runners.
- No Deck-managed write or search without project scope.
- No `sm_project_default` fallback.
- No arbitrary semantic write quota or mandatory session-summary prompt.
- Retrieval context is bounded to five items and 1,500 tokens by default.
- No new installation decision after selecting Supermemory.
