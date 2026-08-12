# Spec: Canonical Supermemory Conversation Memory

## Normative requirements

### Project identity and isolation

**REQ-SM-001 (MUST):** Deck MUST resolve one canonical, versioned project memory scope from the verified project root and canonical repository identity, not from ambient `process.cwd()`.

**REQ-SM-002 (MUST):** Equivalent Git HTTPS, SSH, SCP-style, and SSH-host-alias remotes for the same owner/repository path MUST resolve to the same scope.

**REQ-SM-003 (MUST):** Every Deck-managed Supermemory write, profile request, and search MUST include the canonical project scope as `containerTag` or the transport's equivalent immutable project header.

**REQ-SM-004 (MUST):** Missing or invalid project identity MUST disable adaptive-memory effects for that runner and emit a redacted diagnostic. Deck MUST NOT fall back to `sm_project_default`, a directory basename, or an unrelated legacy scope.

**REQ-SM-005 (MUST):** Provider authentication MUST remain independent from project scope, and Deck MUST NOT persist provider credentials in Deck configuration or generated prompts.

### Conversation ingestion

**REQ-SM-010 (MUST):** Selecting Supermemory MUST enable conversation capture without an additional installation option or confirmation step.

**REQ-SM-011 (MUST):** Deck MUST model one runner session as one conversation document identified by a stable, non-secret `customId`.

**REQ-SM-012 (MUST):** Subsequent captured turns from the same session MUST reuse the same `customId` and canonical project scope.

**REQ-SM-013 (MUST):** Production ingestion MUST use Supermemory dynamic dreaming unless a bounded test or explicit immediate-read operation requires instant dreaming.

**REQ-SM-014 (MUST):** Conversation ingestion MUST be asynchronous and fail open for the coding session while surfacing a redacted health diagnostic.

**REQ-SM-015 (MUST):** Deck MUST NOT ask agents to extract routine facts, create topic keys, fill a semantic quota, or write a mandatory session summary when conversation capture is active.

**REQ-SM-016 (MUST):** Deck MUST deprecate `maxMemoriesPerSession` as a behavioral control. Any remaining compatibility parser MUST ignore it safely and report deprecation without treating it as an ingestion target.

### Privacy and authority

**REQ-SM-020 (MUST):** Deck MUST reject or redact recognized credentials, private keys, authorization headers, and raw environment dumps before remote ingestion.

**REQ-SM-021 (MUST):** Deck MUST NOT automatically ingest OpenSpec artifacts, provider responses, web content, tool output, or raw logs merely because they appear in the conversation.

**REQ-SM-022 (MUST):** Adaptive-memory context MUST remain advisory and MUST NOT override OpenSpec, source, tests, or current runner evidence.

**REQ-SM-023 (MUST):** Telemetry and diagnostics MUST NOT include raw conversation content, queries, credentials, or unredacted project identifiers.

### Retrieval

**REQ-SM-030 (MUST):** Deck MUST load bounded project-profile context once when starting or resuming a session when the provider is healthy.

**REQ-SM-031 (MUST):** Deck MUST execute query search only when prior context is materially relevant or the user requests recall; it MUST NOT perform unconditional search on every turn.

**REQ-SM-032 (SHOULD):** General contextual retrieval SHOULD use hybrid mode, at most five results, and a maximum default injected-context budget of 1,500 tokens.

**REQ-SM-033 (MUST):** Query rewriting and reranking MUST remain disabled by default until Deck benchmarks justify their latency cost.

**REQ-SM-034 (MUST):** Retrieval MUST NOT silently broaden from the canonical project container to personal, default, or legacy containers.

### Runner installation and diagnostics

**REQ-SM-040 (MUST):** OpenCode, Pi, and Codex MUST implement the same semantic Supermemory contract; adapter differences MAY be limited to native configuration serialization, authentication handoff, and verified project-root plumbing.

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

### Scenario: selecting Supermemory captures conversations without another choice

**Given** the user selects Supermemory in Review & Install
**When** Deck builds and applies the installation plan
**Then** conversation capture is configured by default
**And** no additional capture mode, opt-in, or confirmation row is shown

### Scenario: one session reuses one document identity

**Given** an authenticated runner starts a Deck session
**When** multiple eligible conversation turns are captured
**Then** each write uses the same canonical project scope and stable session `customId`
**And** production writes request dynamic dreaming

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
