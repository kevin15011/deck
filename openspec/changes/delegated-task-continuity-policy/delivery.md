# First delivery

Status: reviewed implementation; local canary preparation in progress.

Accepted behavior: fresh sessions for all runners with stable logical tasks, bounded handoff and separate interrupted-continuation metrics. Codex native support is deferred as P-015; internal native databases/histories are outside this change. Claude effective compaction evidence is also unverified. High interruption recovery cost prioritizes P-014 steering.

Local delivery uses `bun run canary:install`. Installation alone does not establish that the active daemon uses the new binary. The active daemon and post-activation measurements must be reported separately. No public release or remote push is part of this delivery.

After activation, use actual task continuations to collect the offline metrics described in verify-report.md. Compare operator-interrupted samples separately by runner/model/role, preserving pending/no-edit/partial samples. The existing historical baseline is not equivalent to new reliable request coverage, and no token or latency improvement is claimed before comparable measurements.
