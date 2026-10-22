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

## Reviewed cache correction build

After the investigation and independent review recorded in `live-preparation-review.md` and `readiness-cache-fix-brief.md`, the correction was committed as `1a371a3`. `bun run canary:install` succeeded and the version smoke check reports that commit. Installed payload SHA-256: `1f7613dff72c40524a42848fe0cbe0baef2e9fb4e4f5af425f4f8cf60e63d47e`. Build log: `/tmp/deck-readiness-cache-canary-install.log`.

Post-install daemon inspection still showed PID `3827933` running the earlier measurement payload with active work. A bounded 180-second idle-only restart worker was launched; it checks the original daemon identity and pinned target digest, respects active work and pending controls, and verifies the restarted executable. Outcome: `/tmp/deck-readiness-restart-kfd1n_p1/result.json`. Activation of this correction is **pending**, not established by installation or scheduling. Check the outcome and live daemon digest before claiming activation or a measured improvement.

Activation subsequently verified after the user's restart report: the worker recorded `restarted` at `2026-10-22T13:31:02Z`. Live `deck-canary daemon status --json` independently confirms PID `3847352`, start time `2026-10-22T13:31:00.283Z`, channel `canary`, and the expected `1f7613dff72c40524a42848fe0cbe0baef2e9fb4e4f5af425f4f8cf60e63d47e` digest for commit `1a371a3`. This supersedes the pending activation status above. Real latency improvement remains to be measured.

## Compaction and failure-reporting build

P-012 was independently approved and committed as `fc3ea86`; this build also includes reviewed compaction commit `484fd39` and fixture correction `503b5ae`. `bun run canary:install` succeeded; version smoke check reports commit `fc3ea86`. Installed payload digest: `73808b6a6a6240e64710b9f2377eebc49291e83c3f0b535d158e766129fed13a`. Build log: `/tmp/deck-provider-failure-canary-install.log`.

The live daemon still reported the previous cache-fix digest and PID `3847352` with active work. A bounded 180-second idle-only restart worker was scheduled, preserving daemon identity/target verification and refusing active-work cancellation. Result file: `/tmp/deck-provider-restart-2i6ls0li/result.json`. Activation of this combined build remains pending until the result and live daemon digest are verified.

After the user's subsequent restart report, live status still returned PID `3847352`, started at `2026-10-22T13:31:00.283Z`, with the previous `1f7613df...` cache-fix digest and active work. The installed alias still resolves to the expected `73808b6a...` payload. The restart worker recorded `not-restarted` at `2026-10-22T14:57:41Z`, reason `idle-deadline-exceeded`. The connected daemon has therefore not activated `fc3ea86`; installation and runtime remain different. No forced restart was performed during this verification.

Following the next user restart report, live `deck-canary daemon status --json` confirms activation: PID `3909813`, nonce `8dea1819-d941-4d70-aa14-175dd3805363`, started `2026-10-22T15:26:16.746Z`, channel `canary`, digest `73808b6a6a6240e64710b9f2377eebc49291e83c3f0b535d158e766129fed13a`. This matches the installed `fc3ea86` candidate and supersedes pending activation above. P001/P012 are active; live incident behavior and the reason for earlier unsuccessful Web UI attempts remain unverified.
