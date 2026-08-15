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

### First-class runtime memory

**REQ-SM-010 (MUST):** `adaptiveMemory.enabled` MUST be the sole Adaptive Memory product decision. Enabled means Supermemory; disabled means no remote memory effects. Deck MUST expose no provider selector.

**REQ-SM-011 (MUST):** Enabled memory MUST execute automatic profile/search/capture through a Deck-owned authenticated runtime boundary above the runner, using the current official Supermemory API surface. Normal behavior MUST NOT depend on an agent voluntarily invoking MCP.

**REQ-SM-012 (MUST):** The runtime MUST bind the canonical `containerTag` server-side for every provider request and MUST reject any runner-supplied project scope. Provider authentication MUST use the supported bearer credential without exposing it to prompts or hooks.

**REQ-SM-013 (MUST):** One stable `customId` MUST represent one top-level runner session/change across resume and specialist execution. Specialists MUST NOT fragment the conversation into unrelated documents.

**REQ-SM-014 (MUST):** Ordinary automatic recall/capture failure MUST fail open for coding and fail closed for the memory effect, with an observable redacted diagnostic. An explicitly memory-dependent request or explicit remember request MUST report failure and MUST NOT claim success.

**REQ-SM-015 (MUST):** Deck MUST make a central capture/skip decision over eligible rich conversation material. It MUST NOT use another LLM to extract facts, summarize facts, deduplicate, rank, resolve contradictions, build a graph, or implement forgetting before Supermemory ingestion.

**REQ-SM-016 (MUST):** Deck MUST apply a versioned role-aware retrieval policy and a physical final context limit. The default global ceiling is five results and approximately 1,500 injected tokens; narrower roles MUST use smaller budgets.

**REQ-SM-017 (MUST):** Supermemory MUST remain responsible for extraction, learning, semantic deduplication, supersession, temporal reasoning, graph relationships, profile evolution, ranking, reranking, query rewriting, aggregation, and forgetting.

**REQ-SM-018 (MUST):** MCP MUST remain complementary for ad-hoc recall. Automatic runtime effects MUST neither require MCP nor double-write content already captured by the runtime.

**REQ-SM-019 (MUST):** Account/readiness operations without project scope MAY be used only for authentication status. Active-space state MUST NOT route project memory. Document-ID operations are allowed only after a scoped predecessor in the same workflow.

### Capture, security, and credentials

**REQ-SM-024 (MUST):** Automatic capture MUST include only eligible user requests/corrections, confirmed decisions/discoveries/root causes/conventions/constraints, and relevant final outcomes. It MUST exclude tool chatter, raw logs/tests/stacks/diffs, transient attempts, orchestrator state, token accounting, provider responses, and incidental web/OpenSpec/source content.

**REQ-SM-025 (MUST):** Credentials, private keys, authorization headers, passwords, raw environment dumps, and `.env` content MUST be rejected or redacted before transport. Empty or only-redacted content MUST NOT be sent.

**REQ-SM-026 (MUST):** The Supermemory credential MUST be held by a Deck secret-store abstraction and the Deck runtime process. It MUST NOT be stored in portable Deck config, repository files, runner prompts, generated instructions, logs, telemetry, or memory. Hooks MAY receive only an ephemeral per-launch bridge credential.

**REQ-SM-027 (MUST):** Retrieved memory MUST be clearly delimited as untrusted advisory data and MUST NOT grant authority, permissions, requirements, blockers, or instruction precedence.

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

**REQ-SM-035 (MUST):** Lead MAY receive bounded static and dynamic profile context once at start/resume; Investigate and Architect SHOULD receive task-scoped search when relevant; Apply Fast MUST remain narrowly bounded and MAY skip recall; Apply Deep MAY receive broader technical recall; Quality MAY recall historical risks but memory alone MUST NOT create a blocker.

**REQ-SM-036 (MUST):** `entityContext`, profile buckets, reranking, query rewriting, aggregation options, thresholds, and budget increases MUST remain benchmark-gated. The initial runtime MUST use provider-owned static/dynamic profiles without a Deck semantic taxonomy.

### Runner installation and diagnostics

**REQ-SM-040 (MUST):** OpenCode, Pi, and Codex materializations MUST contain the same canonical scope value and operation rules across session, agent, delegation, and relevant skill surfaces; adapter differences MAY be limited to native configuration serialization, authentication handoff, and verified project-root plumbing.

**REQ-SM-041 (MUST):** Deck MUST stop emitting the deprecated Pi Supermemory endpoint.

**REQ-SM-042 (MUST):** All install paths MUST use one reviewed provider-install plan and MUST NOT retain a legacy Pi-only side path.

**REQ-SM-043 (MUST):** The TUI MUST expose Adaptive Memory as Disabled/Enabled, configure and validate Supermemory within Deck, report canonical scope fingerprint and runtime/MCP readiness, and never require SDK installation, npm/Node, manual runner edits, or a provider choice.

**REQ-SM-044 (MUST):** Doctor MUST detect missing scope, scope mismatch, deprecated endpoint, runner disagreement, ungoverned direct provider entries, and accidental credential persistence.

**REQ-SM-045 (MUST):** OpenCode, Pi, and Codex MUST expose equivalent session identity, role identity, eligible-content capture, bounded recall injection, explicit-failure, and shutdown-flush semantics through the common runtime contract. Runner adapters MAY only serialize native hooks/configuration.

**REQ-SM-046 (MUST):** A runner without a proven lifecycle/content/context-injection boundary MUST be reported unsupported for automatic memory; prompt-only behavior MUST NOT be presented as runtime parity.

**REQ-SM-047 (MUST):** Compiled release archives MUST exercise disabled mode, missing/invalid auth, mocked profile/search/capture, TLS-capable provider transport, Doctor, and MCP materialization without repository access, `node_modules`, Node, npm, or manual dependencies.

**REQ-SM-048 (MUST):** Legacy config MUST migrate as follows: missing/`none` to disabled; `supermemory` to enabled; `engram` to disabled with an actionable removal warning; unknown providers to invalid/fail-closed compatibility input. Engram code, dependencies, setup, readiness, UI, docs, and capability mappings MUST be removed.

### Observability and benchmark

**REQ-SM-060 (MUST):** Deck MUST observe recall attempted/skipped/succeeded/failed, profile/search usage, duration, approximate injected context, capture attempted/skipped/succeeded/failed, provider errors, and fail-open events without logging queries, memory content, credentials, or raw project identifiers. Because optional MCP executes outside Deck Runtime, Doctor and metrics MUST report MCP ad-hoc usage as externally unobservable rather than fabricate counts.

**REQ-SM-061 (MUST):** DeckMemoryBench MUST compare the prior MCP-primary baseline with first-class automatic profile/search/capture over sanitized scenarios for success, recall correctness, stale/contradictory dominance, rediscovery, tokens, latency, context size, changed decisions, recurring problems, preferences, conventions, and root causes.

**REQ-SM-062 (MUST):** Benchmark hard gates MUST include zero cross-project leakage, zero secret transmission, deterministic role-policy compliance, bounded context, and compiled-runtime parity. Benchmark results MAY tune policy but MUST NOT authorize a second memory provider.

### Migration

**REQ-SM-050 (MUST):** Legacy configuration migration MUST be conservative and explicit. Disabled/none remains disabled, Supermemory becomes enabled, Engram becomes disabled with an actionable removal warning, partial configuration requires repair, and historical canonical container identity is preserved when valid. Optional remote inventory MUST be read-only and dry-run first.

**REQ-SM-051 (MUST):** This change MUST NOT copy or delete remote provider records. A future remote-copy workflow requires separately proven provider enumeration/copy capabilities and explicit user approval; source containers remain unchanged.

**REQ-SM-052 (MUST):** Any supplied legacy inventory dry-run MUST use deterministic source identity and normalized content hashing; semantic near-duplicates remain reviewable rather than being silently removed.

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

**Given** the user enables Adaptive Memory in Review & Install
**When** Deck builds and applies the installation plan
**Then** Deck Runtime configures automatic bounded recall and eligible conversation capture through Supermemory
**And** no provider, mode, project-space, SDK-install, or manual-runner choice is shown

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
