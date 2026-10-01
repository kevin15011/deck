# Exploration: Support macOS SSH Alias Project Identity

## Diagnosis

Deck correctly verifies the Git top-level and reads `origin` structurally, but production alias validation depends on resolving the effective account home. The prior implementation only obtained that home from descriptor-validated `/etc/passwd` on Linux. On macOS it rejected aliases before reading the user's protected direct SSH configuration.

The reported repository stores `git@work:comodin-software/espritec-theme.git`; its effective account's exact `Host work` block maps to `github.com`. The stable runtime therefore reported `managed-runtime-project-missing` and performed no provider call.

## Constraints

- Project identity remains Deck Runtime authority.
- No ambient account or Git environment may influence scope.
- Deck may not execute `git`, `ssh`, a shell, or SSH configuration commands.
- Exact alias mapping must retain no-follow descriptor validation, strict ownership and permissions, bounded parsing, and fail-closed behavior.
- The user must not need to rewrite Git remotes or SSH configuration.

## Selected direction

Use the fixed macOS account database utility `/usr/bin/dscacheutil` with the validated effective UID, a replacement locale-only environment, fixed working directory, timeout and output bounds, executable/path validation, and strict one-record parsing. Reuse the existing direct SSH configuration parser, adding only structurally validated non-command `AddKeysToAgent` values required by the real macOS configuration.

Alternatives rejected: `os.homedir()` and Bun `os.userInfo()` because hostile startup environment values may influence them; `/etc/passwd` because it is not the authoritative complete macOS account database; native FFI because it adds ABI and packaging risk; remote rewriting because identity ownership belongs to Deck.
