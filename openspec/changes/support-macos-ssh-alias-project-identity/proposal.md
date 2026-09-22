# Proposal: Support macOS SSH Alias Project Identity

## Problem

Deck-managed Adaptive Memory derives its mandatory project scope from the verified Git top-level and canonical `origin`. Exact SSH aliases can currently be validated from trusted account configuration on Linux, but production macOS launches reject the same aliases because Deck cannot resolve the effective account home there. A valid origin such as `git@work:comodin-software/espritec-theme.git` therefore produces `managed-runtime-project-missing`, even when `Host work` maps exactly to `github.com` in the effective user's protected SSH configuration.

This forces users to rewrite repository remotes or bypass their account-specific SSH setup. Project identity is Deck Runtime authority and must be handled by Deck without weakening project isolation.

## Outcome

Deck securely resolves the effective macOS account home, validates an exact SSH alias from that account's direct SSH configuration, and derives the same canonical project scope as the corresponding literal GitHub remote. The example origin derives `sm_project_v1_comodin_software_espritec_theme` without changing Git configuration.

## Scope

- Add a bounded, fail-closed Darwin account-home resolver using the fixed macOS account database utility.
- Reuse the existing no-follow SSH configuration validation and exact-host parser.
- Cover the reported `git@work:` origin and adversarial account lookup outcomes.
- Verify the behavior in the compiled standalone binary path.

## Non-goals

- Expanding `Include`, `Match`, wildcard, command-capable, or multi-hop SSH semantics.
- Trusting `HOME`, `PATH`, `USER`, `GIT_*`, project configuration, or model input as identity authority.
- Executing `git` or `ssh` to infer identity.
- Supporting aliases for HTTPS remotes or unsupported operating systems.

## Risk and rollback

Account lookup becomes a protected subprocess boundary. Deck will use an absolute executable, fixed arguments, a replacement environment, bounded output and duration, structural response validation, and the same effective UID across account and file-ownership checks. Any ambiguity fails closed before provider access.

Rollback removes the Darwin resolver and its call site, restoring the prior non-Linux fail-closed behavior. No persisted scope, credential, Git configuration, or migration is introduced.
