# Spec: Support macOS SSH Alias Project Identity

## Requirements

**REQ-MSA-001 (MUST):** On Darwin, Deck Runtime MUST be able to derive the effective account's trusted home without consulting ambient `HOME`, `PATH`, `USER`, `SHELL`, `GIT_*`, runner input, project configuration, or model input.

**REQ-MSA-002 (MUST):** Darwin account lookup MUST use only the absolute `/usr/bin/dscacheutil` executable with fixed query structure and the validated effective UID. Deck MUST execute no shell, `git`, or `ssh`; MUST replace rather than merge the child environment; and MUST bound execution time, stdout, and stderr.

**REQ-MSA-003 (MUST):** Deck MUST fail closed unless the account lookup returns exactly one structurally valid account record containing exactly one matching canonical UID and exactly one absolute home directory. The resolved directory MUST be canonicalized and verified before use.

**REQ-MSA-004 (MUST):** The account executable and direct SSH configuration MUST be validated against unsafe file type, ownership, permissions, symlink, race, size, control-character, malformed, duplicate, ambiguous, unsupported-directive, and truncated-input conditions. The SSH configuration MUST continue to be read from the same no-follow descriptor that Deck validated.

**REQ-MSA-005 (MUST):** An exact SCP-style or `ssh://` alias MAY authorize repository identity only when the protected direct SSH configuration maps that exact alias to `github.com` or `ssh.github.com`. `Include`, `Match`, wildcard hosts, command-capable directives, aliases for HTTPS, and noncanonical destination hosts MUST remain rejected.

**REQ-MSA-006 (MUST):** Given `Host work` mapped exactly to `github.com`, the origin `git@work:comodin-software/espritec-theme.git` MUST derive exactly `sm_project_v1_comodin_software_espritec_theme`, identical to the literal canonical GitHub remote.

**REQ-MSA-007 (MUST):** Any unsupported or failed account/alias resolution MUST disable memory effects before provider access without blocking ordinary coding work or creating a default/fallback project scope.

**REQ-MSA-008 (MUST):** Linux's existing descriptor-validated `/etc/passwd` behavior and literal canonical remotes on every supported platform MUST remain unchanged. Unsupported platforms MUST continue to fail closed for aliases.

**REQ-MSA-009 (MUST):** The standalone compiled Deck binary MUST demonstrate the Darwin account lookup and alias identity path without requiring Node, npm, an external runtime, user Git mutation, or manual secret export.

## Acceptance Scenarios

### Managed macOS alias identity

**Given** Deck runs on Darwin as the effective account
**And** that account's protected direct SSH configuration maps exact host `work` to `github.com`
**And** the verified Git origin is `git@work:comodin-software/espritec-theme.git`
**When** Deck prepares a managed runner session
**Then** Deck derives `sm_project_v1_comodin_software_espritec_theme`
**And** Adaptive Memory may proceed under that immutable scope
**And** Deck does not modify the Git remote or SSH configuration.

### Hostile ambient environment

**Given** hostile values for account, home, path, Git, shell, and loader environment variables
**When** Deck resolves Darwin account identity
**Then** none of those values influence the executable, effective UID, account home, SSH configuration path, or project scope.

### Ambiguous or unsafe account data

**Given** account lookup times out, fails, exceeds its bounds, or returns malformed, duplicate, mismatched, relative, or ambiguous fields
**When** Deck resolves project identity
**Then** alias resolution fails closed
**And** no fallback scope or provider effect occurs
**And** ordinary coding remains available.

### Existing isolation contract

**Given** an alias resolves safely for one repository
**When** a supplied remote or another repository has a different canonical owner/repository identity
**Then** Deck rejects the mismatch
**And** memory cannot cross project boundaries.
