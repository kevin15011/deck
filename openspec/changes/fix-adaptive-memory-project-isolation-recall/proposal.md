# Proposal: Fix Adaptive Memory Project Isolation and Automatic Recall Evidence

## Intent

Close the P0 blocker where a runner started in another repository could retain Deck's globally materialized Supermemory MCP scope and where an agent-initiated MCP search was mistaken for Automatic Runtime Recall.

## Outcome

Adaptive Memory effects are authorized only from the verified current Git repository identity. Deck Runtime binds that identity server-side for capture and recall before agent execution. Deck-managed raw Supermemory MCP exposure is removed unless a transport can enforce the same scope structurally; prompt instructions are not an authorization boundary.

## In scope

- Verified working-repository root, canonical remote identity, project scope, session identity, runner lifecycle, loopback binding, and resume/new-session behavior.
- Removal or retirement of stale Deck-managed global Supermemory MCP entries that can cross repository boundaries.
- Runtime-owned scope for profile, search, and capture.
- Metadata-only observability that distinguishes runtime recall from agent MCP activity or from an unobservable external MCP.
- Hermetic project-isolation, adversarial-prompt, resume/new-session, MCP-escape, and automatic-recall tests.

## Out of scope

- Retrieval tuning, reranking, query rewriting, `entityContext`, Profile Buckets, Mem0, benchmarks, remote data migration, and unrelated refactors.
- Real Supermemory writes from automated tests.

## Rollback

Revert only this change's runtime/MCP materialization delta. Do not restore a raw Deck-managed Supermemory MCP entry unless project scope is structurally enforced outside the model. Remote Supermemory records are never modified by this repair.
