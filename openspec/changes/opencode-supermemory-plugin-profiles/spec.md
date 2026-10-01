# Spec: OpenCode Supermemory Plugin Profiles

## Requirements

**REQ-OSP-001 (MUST):** Deck MUST expose non-secret OpenCode profile labels from eligible literal SSH `Host` aliases without opening private key material. Credential values MUST reside in protected storage and MUST NOT appear in Deck config, diagnostic text, preview, process arguments, or persisted OpenCode configuration.

**REQ-OSP-002 (MUST):** A uniquely resolved, configured SSH origin alias MUST select its token. Every unresolved specific profile (unknown, ambiguous, invalid/unreadable SSH config, absent Git origin, HTTPS, unsupported remote) MUST select the configured default. A selected token MUST NOT retry under a different profile on API failure.

**REQ-OSP-003 (MUST):** If neither a matching credential nor a default exists, managed launch MUST stop before spawning OpenCode; global Supermemory login/configuration and inherited credentials MUST NOT be silent fallback paths.

**REQ-OSP-004 (MUST):** Deck MUST install and verify a pinned official Supermemory artifact before enabling OpenCode adaptive memory. An optional loader-only compatibility adapter MUST forward to official hooks unchanged. Modified, missing, conflicting, duplicate, or uninspectable Supermemory registrations MUST block activation without deleting user-owned entries.

**REQ-OSP-005 (MUST):** Only the managed OpenCode child MUST receive the selected `SUPERMEMORY_API_KEY`, reviewed official API endpoint, and (when verified) canonical project tag. Other child processes MUST NOT receive the credential through a shared environment allowlist. The selected credential MUST NOT be serialized in a launch result. Co-loaded plugins in that OpenCode process are trusted to see that environment credential, per user decision.

**REQ-OSP-006 (MUST):** Deck MUST NOT retrieve, capture, inject, transform, migrate, or summarize memory for OpenCode after activation. Deck MAY supply only its verified canonical repository tag as an input to the plugin; the plugin MUST exclusively own memory operations, storage, and behavior. Deck MUST preserve unrelated plugins, other runners and Context Mode MCP.

**REQ-OSP-007 (MUST):** Failed installation, failed retirement of a Deck-owned raw Supermemory MCP entry, or failed verification MUST NOT persist adaptive memory as enabled. A verified absent legacy entry MUST allow a clean install. Unknown user-owned registrations MUST remain untouched.

**REQ-OSP-008 (MUST):** Existing historical OpenCode-specific requirements for Deck-managed recall, capture, project-scope and advisory instructions in `expose-managed-project-memory-recall`, `fix-adaptive-memory-project-isolation-recall`, and prior archived memory specifications are superseded **only when this change is approved**. Other-runner requirements and strict-mode validation requirements remain in force; this OpenCode cohort does not activate invocation-required mode until its trusted host authority exists.

**REQ-OSP-009 (MUST):** OpenCode TUI setup MUST present default and every eligible discovered SSH Host alias as selectable entries, rather than requiring the user to type an alias. Each entry MUST display only a non-secret configured/unconfigured indicator. Saving or replacing one token MUST return to that list without discarding other configured profiles; a separate Continue action MUST let the user finish. Existing Pi/Codex setup is unaffected.

**REQ-OSP-010 (MUST):** For a verified GitHub repository origin, Deck MUST derive `sm_project_v1_<owner>_<repository>` through its existing canonical resolver and pass it to the plugin as `SUPERMEMORY_REPO_TAG` only for that managed child. HTTPS, direct SSH, trusted SSH aliases and clone/worktree paths for the same owner/repository MUST resolve to the same tag. A conflicting higher-priority plugin project tag override MUST NOT silently displace it.

**REQ-OSP-011 (MUST):** If the canonical repository identity cannot be verified, including non-Git/no-origin projects, Deck MUST NOT supply a tag or inherit one from its parent environment, and MUST NOT block the session solely for this reason. The official plugin chooses its own fallback scope; the configured default token remains available. Deck MUST NOT migrate content from earlier plugin-generated tags.

**REQ-OSP-012 (MUST):** The user-selected OpenCode cohort MUST match the stable binary's `static-compatible` Apply behavior and MUST NOT inject `invocation-required` without a reachable trusted authority provider. OpenCode-native permissions remain applicable. This explicitly offers less Deck invocation-scoped protection than strict mode; strict-mode checks and other runners MUST NOT be weakened by this choice.

## Acceptance scenarios

### Work alias

**Given** an eligible literal `Host work` profile, a default token, and origin `git@work:org/repo.git`
**When** Deck launches a managed OpenCode session
**Then** it passes only the work token to that process, keeps the endpoint reviewed, and the official plugin owns all memory calls.

### Unknown or ambiguous alias

**Given** a configured default and a remote whose SSH alias cannot be uniquely established
**When** Deck selects a profile
**Then** it selects the default, discloses the fallback label without a secret, and never guesses from private keys or Git author metadata.

### Missing credentials

**Given** no usable profile and no configured default
**When** managed launch is requested
**Then** OpenCode is not spawned and global login credentials are not substituted.

### Broken installation

**Given** a failed plugin install or unresolved raw MCP registration
**When** the TUI applies its configuration plan
**Then** Deck does not enable adaptive memory, even if unrelated config actions succeed.

### Stable-compatible delegation

**Given** the official plugin, Deck's execution plugin, and unrelated user plugins
**When** the managed OpenCode session starts without a trusted invocation authority provider
**Then** it does not enable `invocation-required` and does not falsely claim Deck invocation-scoped Apply denial
**And** OpenCode-native permissions remain responsible for tool effects.

### Canonical tag and non-Git fallback

**Given** a newly created GitHub repository with verified `origin` and an eligible credential
**When** Deck launches OpenCode from either its main checkout or a linked worktree
**Then** the plugin receives the same `sm_project_v1_<owner>_<repository>` tag.

**Given** a non-Git directory with a configured default token
**When** Deck launches OpenCode
**Then** the child receives the default token but no Deck tag, and the plugin determines its own container.

### Configure several SSH identities

**Given** three eligible SSH Host aliases and no configured tokens
**When** the user selects the first alias, saves its token, then selects the second and saves its token
**Then** the list is shown after each save, each saved alias has a non-secret configured indicator, the third remains unconfigured, and no token is displayed or overwritten by configuring another alias.
