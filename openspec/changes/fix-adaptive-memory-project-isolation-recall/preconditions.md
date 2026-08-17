# Preconditions: Adaptive Memory Project Isolation and Automatic Recall

## Authority

- The user explicitly authorized the P0 isolation and Automatic Recall repair.
- Existing archived requirements `REQ-SM-001..007`, `REQ-SM-010..019`, `REQ-SM-040..046`, and `REQ-SM-060` define the baseline contract.

## Safety gates

- No remote Supermemory migration, deletion, synthetic live fixtures, or real provider writes.
- Tests use fake transports and temporary state/configuration.
- No retrieval tuning, reranking, query rewriting, `entityContext`, Profile Buckets, Mem0, or benchmark execution.
- Raw external MCP is not treated as a trusted project-isolation boundary.

## Verification gates

- Project A/B and adversarial prompt isolation.
- Runtime Recall ordering and Quick Fix skip with MCP count zero.
- Metadata-only observability.
- Typecheck, full suite, rooted OpenSpec validation, and independent Quality GO.
