# Spec: Canonical Deck-Managed Session Runtime

## Requirements

**REQ-DSR-001 (MUST):** Deck-managed execution MUST be the canonical Full Deck topology. A runner started directly outside Deck MUST be classified as `runner-standalone` and `static-compatible`; this intentional degradation MUST NOT be treated as an installation error.

**REQ-DSR-002 (MUST):** The existing generic runner launch orchestration MUST be the only production owner of managed install, verification, runtime initialization, process spawn, signal forwarding, event drain, and cleanup. Deck MUST NOT add a second launcher, runtime, daemon, loopback protocol, or runner-initiated autobootstrap path.

**REQ-DSR-003 (MUST):** A managed session MUST resolve the explicit structural working project, runner, enabled capabilities, canonical project identity, and Deck session identity before starting dynamic effects. The project identity MUST remain immutable for recall, explicit recall, capture, resume, and specialist events.

**REQ-DSR-004 (MUST):** Prompt or model text, including repository names, organizations, credentials, providers, project IDs, and literal `containerTag` values, MUST remain inert and MUST NOT select or replace runtime scope.

**REQ-DSR-005 (MUST):** A managed executable launch MUST create at most one lifecycle lease and one existing Adaptive Memory runtime host. Dry-run, setup, review, Doctor, install-only, and standalone execution MUST create no runtime host, authenticated bridge, session persistence, or child process.

**REQ-DSR-006 (MUST):** The managed lifecycle MUST have explicit planned, starting, active, closing, and closed states. Startup MUST execute at most once; cleanup MUST be idempotent and MUST converge through one `finally`-owned path on normal exit, signal exit, spawn failure, cancellation, or exception.

**REQ-DSR-007 (MUST):** Adaptive Memory automatic recall on an eligible managed session MUST complete or fail open before the runner processes the task. It MUST use Deck-owned scope, retrieval policy, context budget, and inert advisory context, and MUST NOT depend on MCP.

**REQ-DSR-008 (MUST):** A trivial Quick Fix policy skip MUST execute no profile or search operation and MUST emit metadata showing recall skipped by policy. Base managed-session supervision MUST remain available without memory ceremony.

**REQ-DSR-009 (MUST):** Automatic capture and explicit remember MUST pass through the same Deck-owned runtime, Capture Policy, sanitization, canonical project scope, and stable top-level conversation identity. Supermemory remains responsible for extraction, learning, deduplication, and temporal updates.

**REQ-DSR-010 (MUST):** Explicit recall MAY accept a model-defined query but MUST NOT accept model-defined scope, provider, credential, or container. It MUST share the active managed runtime and report separately from Automatic Recall.

**REQ-DSR-011 (MUST):** Concurrent duplicate event IDs MUST share one in-flight effect. Successful IDs MUST be replay-suppressed and failed IDs MUST remain retryable. Deck MUST NOT claim cross-process exactly-once effects unless the provider honors an idempotency key.

**REQ-DSR-012 (MUST):** The child runner MAY receive only bounded ephemeral bridge endpoint/token values required by the adapter. Provider credentials and raw project scope MUST remain outside runner configuration, prompts, output, previews, logs, and portable files.

**REQ-DSR-013 (MUST):** Runtime observability MUST distinguish runtime started, identity resolved, automatic recall attempted/succeeded/skipped/failed, explicit recall, capture attempted/succeeded/skipped/failed, and cleanup. Evidence MUST be metadata-only and MUST exclude query text, memory content, credentials, raw scope, raw session identity, and provider responses.

**REQ-DSR-014 (MUST):** Core readiness MUST distinguish static integration readiness from managed runtime readiness and per-capability state (`ready`, `disabled`, `degraded`, or `blocked`). Adapters MUST declare runner-specific translation/support without owning shared memory rules.

**REQ-DSR-015 (MUST):** Doctor MUST be read-only and MUST report static integration, Deck-managed execution readiness, Adaptive Memory readiness when managed, and standalone automatic memory as not provided by design. Expected standalone degradation MUST not make Doctor fail when managed readiness is healthy.

**REQ-DSR-016 (MUST):** The existing CLI managed launch commands MUST remain valid. The TUI MAY offer a direct “launch configured runner” action only by returning a launch intent to the CLI host, which MUST invoke the same generic lifecycle after TUI teardown; the TUI MUST NOT own a second process/runtime lifecycle.

**REQ-DSR-017 (MUST):** OpenCode MUST be the first full managed proof. Pi MUST converge on the generic lifecycle while preserving its supported flags/profile/model behavior. Codex MUST retain its supported interactive, exec, and resume behavior. No runner adapter may attempt runtime autobootstrap in standalone mode.

**REQ-DSR-018 (MUST):** One standalone Deck binary MUST remain sufficient for setup and managed launch. Installation MUST NOT require an externally installed Node, npm, Bun, provider SDK/CLI, daemon, manual secret export, or manual runtime startup.

**REQ-DSR-019 (MUST):** Existing requirements in `fix-adaptive-memory-project-isolation-recall` and `canonical-supermemory-conversation-memory` remain authoritative and MUST NOT be weakened.

**REQ-DSR-020 (MUST):** The repository MUST provide a hermetic developer helper that compiles the exact current checkout for the host and exposes it globally as `deck-canary` without replacing stable `deck`. Activation MUST use a staged-smoke-verified immutable digest payload and atomic relative alias, fail closed for unsafe destinations/locks/aliases, require no release publication, and perform no shell-profile, PATH, runner-config, secret, daemon, or stable-binary mutation.

**REQ-DSR-021 (MUST):** Canonical project identity MAY accept an exact SSH host alias only for SCP-style or `ssh://` remotes when trusted structural OS-account configuration maps that exact alias to `github.com` or `ssh.github.com`. Deck MUST NOT execute `git` or `ssh`, use ambient `HOME`, `PATH`, or `GIT_*`, expand `Include`/`Match`, accept wildcard or command-capable SSH semantics, trust unsupported URL protocols, or consume an SSH config other than the same no-follow descriptor it validated. Unsupported or ambiguous identity MUST fail closed for memory effects without blocking coding work.

## Acceptance scenarios

### Managed OpenCode lifecycle (tests 1–8)

**Given** a configured project and enabled Adaptive Memory
**When** Deck launches OpenCode through the canonical route
**Then** Deck creates one managed session, resolves the canonical project/session identities, initializes one existing memory runtime, and starts OpenCode
**And** eligible Automatic Recall completes before task processing
**And** Automatic Capture completes or fails open according to policy
**And** the bridge drains and closes exactly once.

### Project isolation and inert prompt text (tests 9–11)

**Given** Projects A and B have distinct canonical structural identities
**And** a Project A prompt names Project B or contains a literal `containerTag`
**When** recall, explicit recall, or capture occurs
**Then** only Project A scope is used
**And** caller-supplied scope-like fields are rejected before provider effects.

### Exactly-once runtime ownership (tests 12–14)

**Given** native hooks and the supervised bridge emit duplicate lifecycle events
**When** events overlap or replay
**Then** one in-flight provider effect is shared and one successful event is retained
**And** failed events remain retryable
**And** no plugin, compatibility helper, or legacy launcher starts a second runtime or capture path.

### Quick Fix (tests 15–16)

**Given** policy classifies a managed task as a trivial Quick Fix
**When** the session starts
**Then** recall is recorded as skipped by policy
**And** profile/search/MCP counts remain zero
**And** the base session lifecycle proceeds without additional ceremony.

### Standalone mode (tests 17–20)

**Given** OpenCode is launched directly
**When** Deck-installed static assets are inspected or diagnosed
**Then** agents, prompts, skills, and independent static integrations remain available
**And** Automatic Adaptive Memory is not promised
**And** the degradation says `requires Deck-managed session`
**And** no hook attempts to start or reconnect to Deck Runtime.

### Installer and everyday UX (tests 21–23)

**Given** Deck was installed using the current single-command standalone flow
**When** the user opens a configured repository
**Then** no external Node, npm, or Bun installation is required
**And** one existing CLI action or a TUI handoff launches the configured runner through the canonical managed lifecycle.

### Other runners (tests 24–25)

**Given** Pi and Codex configured launch modes
**When** their regression suites execute
**Then** Pi has no separate runtime owner and preserves supported launch behavior
**And** Codex remains on the generic lifecycle with no material regression.

### Separate live canary command

**Given** stable `deck` is already installed
**When** a developer runs `bun run canary:install`
**Then** the current checkout is available as `deck-canary`
**And** stable `deck` remains byte-for-byte unchanged
**And** only a verified immutable canary payload and atomic relative alias are activated
**And** the developer can run `deck-canary opencode developer` from another project.

### Verified SSH host alias

**Given** a real Git project whose origin uses `git@github-work:owner/repository.git`
**And** the trusted OS-account SSH config maps exact `Host github-work` to `HostName github.com`
**When** Deck resolves project identity
**Then** the canonical scope contains only normalized owner/repository identity
**And** prompt text, alias text, HOME, PATH, Git environment, unsupported protocols, and unsupported SSH directives cannot alter it.
