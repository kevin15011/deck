# Canary activation

The user authorized compiling/installing the measurement candidate and restarting the daemon with canary on October 22.

- `bun run canary:install` completed. The installed alias is `/home/kevin15011/.local/bin/deck-canary`.
- Version smoke check: Deck 0.13.0, commit `eaa82bc`, build date 2026-10-22, linux-x64. Build metadata labels the build `dev`; daemon executable provenance separately identifies stable/canary installation channels.
- Installed payload SHA-256: `057f03bf46bec20909b1019ce51946a1bea628c1ad980d36ee1fb04c772a125c`.
- `deck-canary daemon restart --json` was attempted and refused with `busy`: the current daemon has active work. No cancellation, forced stop, or ownership bypass was performed.
- The bounded detached retry expired after 180 seconds without restarting: `/tmp/deck-canary-restart-v0sc1k4m/result.json` reports `not-restarted`, reason `idle-deadline-exceeded`.
- After the user reported restarting, `deck-canary daemon status --json` independently confirmed PID `3827933`, started at `2026-10-22T12:44:01.442Z`, executable channel `canary`, version `0.13.0`, and digest `057f03bf46bec20909b1019ce51946a1bea628c1ad980d36ee1fb04c772a125c`. This matches the installed candidate built from `eaa82bc`; activation is verified. This does not establish a performance improvement or validate live measurement results.

Build log: `/tmp/deck-preparation-canary-install.log`. Initial refusal: `/tmp/deck-preparation-daemon-restart.json`. The stable executable and source files were not replaced by installation. No model inference was requested for this activation.

## Live session observation

The user selected this ongoing session as the live test and requested delegation. Investigator task `task-1cf2011b-0318-4587-84f5-47cef713f609` owns a bounded, read-only review of post-activation timing events. It must distinguish preparation stages from native startup and report incomplete attempts separately. No synthetic inference workload or runtime change is authorized by this observation task. Findings are pending Lead review; the task assignment alone is not verification.
