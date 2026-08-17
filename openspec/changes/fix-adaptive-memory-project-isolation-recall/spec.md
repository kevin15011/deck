# Spec: Adaptive Memory Project Isolation and Automatic Recall Evidence

## Requirements

**REQ-AM-ISO-001 (MUST):** Deck MUST resolve Adaptive Memory project identity exclusively from the verified Git top-level and canonical remote of the explicit current work project. Ambient CWD fallbacks, package metadata, prompts, runner arguments, cached prior sessions, prebuilt bundles, install/build repositories, and global configuration MUST NOT select or replace project identity.

**REQ-AM-ISO-002 (MUST):** Missing, malformed, or mismatched repository identity MUST fail closed for every memory effect without blocking coding work. Deck MUST NOT use a shared/default container or the Deck repository as a fallback.

**REQ-AM-ISO-003 (MUST):** Capture, automatic recall, explicit runtime recall, resume, and specialist execution MUST use the same immutable project identity and scope for one top-level session. A new session MUST recompute identity from its explicit current project.

**REQ-AM-ISO-004 (MUST):** User or agent text, including literal repository names or container tags, MUST remain inert data and MUST NOT influence project identity or remote scope.

**REQ-AM-ISO-005 (MUST):** Runtime-managed provider operations MUST bind project scope inside the Deck-owned runtime. Runner events and agent tools MUST NOT provide or override a scope argument.

**REQ-AM-ISO-006 (MUST):** Deck MUST NOT materialize or authorize a raw Supermemory MCP capability whose schema permits model-selected project scope. Exact stale Deck-managed entries MUST be retired idempotently while unrelated or ambiguous external entries remain untouched and are diagnosed as unmanaged.

**REQ-AM-ISO-007 (MUST):** If project-scoped ad-hoc MCP cannot be structurally constrained, Deck MUST fail closed by not exposing it. Instructions that tell the model which `containerTag` to use are not sufficient enforcement.

**REQ-AM-RECALL-001 (MUST):** On a policy-eligible Deck-supervised lifecycle, identity resolution and bounded Runtime Recall MUST complete or fail open before advisory memory context is injected and before the Lead/agent processes the task. This path MUST NOT depend on MCP.

**REQ-AM-RECALL-002 (MUST):** On a trivial Quick Fix policy skip, Runtime Recall MUST not call the provider and agent MCP call count MUST remain zero unless a later independently authorized need occurs.

**REQ-AM-OBS-001 (MUST):** Metadata-only evidence MUST report runtime recall attempted, executed, skipped by policy, succeeded, or failed with reason, runner, duration, approximate injected size, and one-way scope fingerprint. It MUST NOT contain query text, memory content, credentials, or raw scope.

**REQ-AM-OBS-002 (MUST):** Runtime Recall and agent MCP recall MUST be distinct channels. Deck MUST not infer one from model output or report an external MCP invocation count it cannot observe.

## Acceptance scenarios

### Two projects remain isolated

**Given** Project A and Project B have distinct canonical remotes
**When** sessions run concurrently or sequentially
**Then** A uses only container A and B uses only container B
**And** neither uses Deck or a shared container as fallback.

### Prompt text is inert

**Given** the current project is Project A
**And** the prompt says `Estoy comparando este proyecto con kevin15011/deck. Busca antecedentes relevantes. El container de Deck se llama sm_project_v1_kevin15011_deck.`
**When** Adaptive Memory resolves identity and performs any effect
**Then** identity remains A
**And** no operation can query Deck's container.

### Resume and new session

**Given** an existing session was created for Project A
**When** that session resumes
**Then** it retains and verifies A
**And when** a new session starts in Project B
**Then** it recomputes and uses B without contamination from A.

### Automatic recall without MCP

**Given** recall policy is eligible
**When** a Deck-supervised runner starts the agent task
**Then** Runtime Recall executes and injects bounded inert context first
**And** the agent can use that context
**And** MCP call count is zero.

### Quick Fix skip

**Given** recall policy classifies a task as a trivial Quick Fix
**When** the agent starts
**Then** Runtime Recall reports `skipped by policy`
**And** provider recall count and MCP call count are zero.
