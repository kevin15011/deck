# First delivery

Status: local canary built and installed; daemon activation pending.

Accepted behavior: fresh sessions for all runners with stable logical tasks, bounded handoff and separate interrupted-continuation metrics. Codex native support is deferred as P-015; internal native databases/histories are outside this change. Claude effective compaction evidence is also unverified. High interruption recovery cost prioritizes P-014 steering.

Local delivery uses `bun run canary:install`. Installation alone does not establish that the active daemon uses the new binary. The active daemon and post-activation measurements must be reported separately. No public release or remote push is part of this delivery.

After activation, use actual task continuations to collect the offline metrics described in verify-report.md. Compare operator-interrupted samples separately by runner/model/role, preserving pending/no-edit/partial samples. The existing historical baseline is not equivalent to new reliable request coverage, and no token or latency improvement is claimed before comparable measurements.

## Installed artifact

- Implementation commit: `c1e88ea` (`feat: reseed delegated continuations with bounded handoffs`).
- `bun run canary:install`: exit0; compilation, installer smoke checks and atomic installation completed. Log: `/tmp/delegated-continuity-canary-install.log`.
- Installed command: `/home/kevin15011/.local/bin/deck-canary`; `--version` reports0.13.0,commit c1e88ea,date2026-10-22,target linux-x64.
- Digest-named payload: `838f05a5990cb251de593c3d827a11f23f26f829455081622e868fba21063270`.
- The installer does not restart the daemon. Status after installation still reports the previous digest `10daee171e51c200933697e2d0c00338aa819661226e0792c06527e32f2875b2`, started2026-10-22T18:09:55.113Z, with running work. The candidate is installed but not active.

Once running work has ended, `deck-canary daemon restart` activates the invoking canary executable. The normal command refuses running work or pending approvals; no forced interruption or restart diagnostic work was performed. After restart, verify executable digest and then collect actual continuation/cohort samples. No production comparison or demonstrated latency gain exists yet.
