# Native memory and hook evidence — 2026-10-14

## Scope and ownership

The user approved native Supermemory parity for cross and requested all observed native hooks in Activity. D-28 replaces daemon-only D-18. Normal developer launch helpers already prepare the canonical project scope; cross reuses them. The implementation does not change Pi, install plugins, change global runner configuration or restart the user's daemon.

Read-only preparation against the installed configuration returned `ready` for Claude, Codex and OpenCode with the same `sm_project_v1_kevin15011_deck` scope. Only status/reason/scope metadata was inspected; no provider calls or credential output were used as evidence.

## Pinned native observations

- Claude 2.1.296: the installed official plugin declares SessionStart, UserPromptSubmit, PreToolUse and asynchronous Stop hooks, and a top-level `supermemory` MCP declaration. Cross selectively supplies the verified plugin, excludes optional inherited settings and uses an explicit strict MCP file. Its native stream exposes hook lifecycle events, which are normalized without command/output/path payloads.
- Codex 0.162.1: an isolated native `hooks/list` probe confirmed that inline hook overrides alone do not exclude `hooks.json`. Per-process `hooks.state` entries disable inherited TOML and JSON hooks without changing either file. The final inventory can prove that only the two admitted command hooks are enabled and trusted. Authentication and native resume storage remain in their existing home. Probe artifacts: `/tmp/deck-codex-hook-isolation-probe.cjs`, `/tmp/deck-codex-hook-state-probe.cjs`.
- OpenCode 1.18.31: `--pure` suppresses external plugins, including explicitly configured ones. An isolated synthetic-plugin probe confirmed that a private configuration without that flag admits the chosen loader and registers a `supermemory` native tool through `/experimental/tool/ids`. Cross verifies the expected plugin configuration and tool before prompt delivery while retaining private configuration and disabling default plugins.

These probes used isolated fixtures and did not create model turns or call Supermemory. Configuration and native tool registration are activation evidence, not successful provider recall/storage evidence.

## Capture and observation limits

Claude's official asynchronous Stop capture has no verified drain barrier in the managed per-turn lifecycle. Codex's official flush command awaits its own capture operation and native hook lifecycle is observable, but hook exit alone does not prove provider persistence. The prepared descriptor deliberately reports automatic capture as unverified.

OpenCode's native plugin event dispatcher ignores returned promises. The pinned plugin's default final capture relies on a disposal event and has no awaited dispose hook. A synthetic probe observed `/instance/dispose` returning in about 2 ms without the plugin callback completing; that callback was still not observed after 400 ms. The endpoint is therefore not a capture-completion barrier. The implementation reports this limitation instead of adding an arbitrary delay or asserting a successful save.

Claude and Codex hook events are observable. OpenCode's internal plugin hooks have no verified equivalent protocol event; explicit native tool calls remain visible. A generic hook completion means only that the reported hook completed. Provider attribution requires trusted execution/configuration evidence. Unknown outcomes, incomplete history and malformed hook payloads must not turn into fabricated success or raw output disclosure.

## Verification state

Implementation is complete and independently approved. The frozen candidate passed 658 affected tests, TypeScript, 45 browser groups, all four target builds and 22 compiled host checks. Final details are recorded in `verify-report.md` and `review-report.md`. These gates do not imply live provider recall/capture acceptance, and the native lifecycle limitations above remain explicit.
