# Proposal: Canonical Supermemory Conversation Memory

## Intent

Replace Deck's fragmented, prompt-driven Supermemory integration with one canonical project scope and Supermemory's recommended conversation-ingestion model across OpenCode, Pi, and Codex.

## User-visible outcome

When a user selects Supermemory, Deck configures it without an additional capture decision. Conversations are associated with one stable project container and one stable session document, allowing Supermemory to extract and evolve useful memories. The same project does not silently fall back to `sm_project_default`, and all supported runners expose equivalent behavior.

## In scope

- Canonical, versioned project-scope resolution independent of current working directory and SSH host aliases.
- One session/conversation document per stable `customId` with dynamic dreaming in production.
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
- Adding a general hosted Deck memory service.

## Approach

1. Introduce a provider-neutral canonical project memory identity resolved from the verified project root and canonical repository identity, with no default-container fallback.
2. Validate the current official Supermemory MCP/API capability for stable `customId`, dynamic dreaming, OAuth/API-key delegation, and scoped writes before selecting the exact transport.
3. Route Deck-managed Supermemory capture and recall through one governed contract that injects the canonical scope and does not expose arbitrary container selection to agents.
4. Install the same semantic contract through runner-specific serializers.
5. Replace manual memory-save prompt policy with conversation capture and provider-native learning.
6. Add dry-run migration tooling that never deletes or mutates source containers.

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
