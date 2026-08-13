# Spec: Canonical Supermemory Conversation Memory

## Normative requirements

### Project identity and isolation

**REQ-SM-001 (MUST):** Deck MUST resolve one canonical, versioned project memory scope from the verified project root and canonical repository identity, not from ambient `process.cwd()`.

**REQ-SM-002 (MUST):** Equivalent Git HTTPS, SSH, SCP-style, and SSH-host-alias remotes for the same owner/repository path MUST resolve to the same scope.

**REQ-SM-003 (MUST):** Every Deck-directed Supermemory operation whose exposed schema accepts `containerTag` MUST explicitly pass the canonical project scope in that argument. An MCP `x-sm-project` header MUST NOT be treated as supplying an omitted tool argument.

**REQ-SM-004 (MUST):** Missing or invalid project identity MUST disable adaptive-memory effects for that runner and emit a redacted diagnostic. Deck MUST NOT fall back to `sm_project_default`, a directory basename, or an unrelated legacy scope.

**REQ-SM-005 (MUST):** Provider authentication MUST remain independent from project scope, and Deck MUST NOT persist provider credentials in Deck configuration or generated prompts.

**REQ-SM-006 (MUST):** Deck MUST derive the scope from the verified current repository and materialize the same immutable value into Lead/session, specialist/agent, delegation, and relevant skill instructions.

**REQ-SM-007 (MUST):** Agents MUST NOT derive, choose, rewrite, or accept an arbitrary replacement for the Deck-materialized canonical scope.

### Agent-mediated automatic memory

**REQ-SM-010 (MUST):** Selecting Supermemory MUST preserve Deck's agent-mediated automatic save and materially relevant recall policy without adding UI, a per-call scope choice, or a second consent decision.

**REQ-SM-011 (MUST):** Until a trusted authenticated execution boundary or native runner plugin exists, Deck MUST describe this behavior as agent-mediated tool use, not automatic whole-conversation ingestion, stable-session document capture, or guaranteed dynamic dreaming.

**REQ-SM-012 (MUST):** Every automatic save or recall attempted by an agent MUST use a project-scoped operation with the explicit canonical `containerTag`; otherwise the operation MUST be skipped.

**REQ-SM-013 (MUST):** Deck MUST continue to allow high-signal automatic agent saves and proactive recall when prior project context is materially relevant.

**REQ-SM-014 (MUST):** Failure to resolve or apply project scope MUST fail open for coding work and fail closed for the memory operation, with only a redacted diagnostic.

**REQ-SM-015 (MUST):** Deck MUST NOT require agents to fill a semantic quota, create manual topic keys, or write a mandatory session summary. Agents MAY automatically preserve high-signal durable information through the scoped MCP tools.

**REQ-SM-016 (MUST):** Deck MUST deprecate `maxMemoriesPerSession` as a behavioral control. Any remaining compatibility parser MUST ignore it safely and report deprecation without treating it as an ingestion target.

**REQ-SM-017 (MUST):** Account/readiness operations that do not accept project scope MAY be used only for non-memory effects such as authentication status.

**REQ-SM-018 (MUST):** Active-space-only interactive operations MUST NOT participate in automatic project save or recall, and agents MUST NOT change active space as a substitute for explicit `containerTag`.

**REQ-SM-019 (MUST):** A document-ID operation without `containerTag` MAY be used only with an ID obtained through a canonically scoped operation in the same workflow.

### Privacy and authority

**REQ-SM-020 (MUST):** Agents MUST NOT save credentials, private keys, authorization headers, raw environment dumps, or other secrets through automatic memory operations.

**REQ-SM-021 (MUST):** Agents MUST NOT automatically save OpenSpec artifacts, provider responses, web content, tool output, or raw logs merely because they appear in the conversation.

**REQ-SM-022 (MUST):** Adaptive-memory context MUST remain advisory and MUST NOT override OpenSpec, source, tests, or current runner evidence.

**REQ-SM-023 (MUST):** Telemetry and diagnostics MUST NOT include raw conversation content, queries, credentials, or unredacted project identifiers.

### Retrieval

**REQ-SM-030 (MUST):** Agents SHOULD load bounded project-profile context once when starting or resuming a session when the provider is healthy and the exposed operation can be explicitly scoped.

**REQ-SM-031 (MUST):** Agents MUST execute query search only when prior context is materially relevant or the user requests recall; they MUST NOT perform unconditional search on every turn.

**REQ-SM-032 (SHOULD):** General contextual retrieval SHOULD use hybrid mode, at most five results, and a maximum default injected-context budget of 1,500 tokens.

**REQ-SM-033 (MUST):** Query rewriting and reranking MUST remain disabled by default until Deck benchmarks justify their latency cost.

**REQ-SM-034 (MUST):** Retrieval MUST NOT silently broaden from the canonical project container to personal, default, or legacy containers.

### Runner installation and diagnostics

**REQ-SM-040 (MUST):** OpenCode, Pi, and Codex materializations MUST contain the same canonical scope value and operation rules across session, agent, delegation, and relevant skill surfaces; adapter differences MAY be limited to native configuration serialization, authentication handoff, and verified project-root plumbing.

**REQ-SM-041 (MUST):** Deck MUST stop emitting the deprecated Pi Supermemory endpoint.

**REQ-SM-042 (MUST):** All install paths MUST use one reviewed provider-install plan and MUST NOT retain a legacy Pi-only side path.

**REQ-SM-043 (MUST):** The UI MUST clearly report provider, canonical scope fingerprint, authentication readiness, and runner parity but MUST NOT add another conversation-capture choice after Supermemory is selected.

**REQ-SM-044 (MUST):** Doctor MUST detect missing scope, scope mismatch, deprecated endpoint, runner disagreement, ungoverned direct provider entries, and accidental credential persistence.

### Migration

**REQ-SM-050 (MUST):** Legacy migration MUST begin with a read-only inventory and dry-run classification into confirmed, unrelated, duplicate, and ambiguous records.

**REQ-SM-051 (MUST):** Migration MUST copy only explicitly approved confirmed records and MUST preserve source containers unchanged.

**REQ-SM-052 (MUST):** Duplicate detection MUST use deterministic source identity and normalized content hashing; semantic near-duplicates MUST remain reviewable rather than being silently removed.

**REQ-SM-053 (MUST):** Remote deletion MUST remain unavailable in this change.

## Acceptance scenarios

### Scenario: SSH alias and HTTPS identify the same project

**Given** one checkout has origin `git@github-p:kevin15011/deck.git`
**And** another has origin `https://github.com/kevin15011/deck.git`
**When** Deck resolves the project memory scope from each verified root
**Then** both scopes are identical
**And** neither scope contains the SSH alias

### Scenario: no project identity fails closed

**Given** a project has no resolvable repository identity
**When** Deck prepares Supermemory configuration
**Then** no adaptive-memory write or search binding is installed
**And** Deck reports a redacted project-scope diagnostic
**And** Deck does not emit `sm_project_default`

### Scenario: selecting Supermemory preserves automatic agent memory without another choice

**Given** the user selects Supermemory in Review & Install
**When** Deck builds and applies the installation plan
**Then** high-signal automatic agent save and materially relevant recall instructions are configured by default
**And** no additional mode, project-space choice, opt-in, or confirmation row is shown

### Scenario: transport header is not trusted as a tool default

**Given** the runner has the correct `x-sm-project` header
**When** Deck materializes automatic Supermemory save and recall behavior
**Then** every scoped tool example and instruction still passes the exact canonical `containerTag`
**And** no instruction claims that the header supplies an omitted tool argument

### Scenario: all prompt surfaces receive one immutable scope

**Given** canonical scope `sm_project_v1_kevin15011_deck`
**When** OpenCode, Pi, and Codex materialize Developer Team content
**Then** Lead, specialists, delegations, and relevant skills contain that exact scope
**And** no other project tag or default-space fallback appears

### Scenario: automatic save is explicitly scoped

**Given** the agent identifies high-signal durable project information
**When** it invokes `supermemory_add_memory`
**Then** it passes `containerTag: "sm_project_v1_kevin15011_deck"`
**And** it does not rely on active space or `sm_project_default`

### Scenario: automatic recall is explicitly scoped

**Given** prior project context is materially relevant
**When** the agent invokes `supermemory_search_memory`
**Then** it passes `containerTag: "sm_project_v1_kevin15011_deck"`
**And** results from personal, default, or legacy spaces are not requested

### Scenario: configured scope mismatch fails closed

**Given** the repository-derived scope differs from the configured MCP scope
**When** Deck prepares adaptive-memory instructions
**Then** no project save or recall operation is authorized
**And** Deck reports a redacted mismatch diagnostic

### Scenario: active space is not an isolation mechanism

**Given** Supermemory has a different active space or no active space
**When** automatic project save or recall occurs
**Then** the agent neither changes nor relies on active space
**And** it passes the canonical project tag directly

### Scenario: sensitive content is not ingested

**Given** a captured turn includes a private key or authorization header
**When** the ingestion boundary validates the payload
**Then** the secret is rejected or redacted before the provider call
**And** no diagnostic or telemetry field contains the secret

### Scenario: runner parity

**Given** Supermemory is selected for OpenCode, Pi, and Codex
**When** each adapter builds its configuration
**Then** all configurations resolve the same project scope and semantic tool contract
**And** none uses the deprecated Pi endpoint

### Scenario: retrieval remains bounded

**Given** a healthy project profile and prior project conversations
**When** a query materially needs past context
**Then** Deck searches only the canonical project container
**And** at most five results and 1,500 tokens are injected
**And** reranking and rewriting remain off unless benchmark-approved

### Scenario: legacy migration is non-destructive

**Given** legacy containers contain confirmed, unrelated, duplicate, and ambiguous records
**When** the user runs migration dry-run
**Then** Deck reports aggregate classifications and redacted examples
**And** it performs no remote mutation
**And** no deletion operation is offered
