# Codex Lead delegation policy

## Intent
Keep the existing Deck Lead and Developer Team instructions. Remove Codex's injected explicit-request-only delegation hint from Deck-launched Developer Team processes using a process-local native configuration override. Do not change Core, skills, model selection, effort settings or global Codex configuration.

## Change
`packages/adapter-codex/src/launch.ts` supplies `-c features.multi_agent_v2.multi_agent_mode_hint_text=""` before the interactive, exec or resume route. The override is limited to teamId developer-team. Root bootstrap still applies only to new sessions; resume retains history and model settings.

## Evidence
- Isolated Codex 0.159.3 and 0.160.0 debug prompt-input probes demonstrated that the empty native hint removes the multi_agent_mode fragment, without replacing it with Codex's proactive message or requiring ultra effort.
- The exact existing Deck root bootstrap remained present in the generated model context with high effort.
- Native app-server thread/start with multiAgentMode proactive returned explicitRequestOnly; it is not claimed as a working alternative.
- New regression test failed before implementation (one failure), covering all four launch modes, process-only scope and unchanged effort. Existing exact-argv expectations were updated; no safety, stdin or bootstrap assertions were removed.

## Limits and status
Implementation complete: 90 focused launch, adapter and CLI execution tests passed (1,102 assertions); TypeScript and git diff --check passed. Rebuilt and installed the checkout canary at ~/.local/bin/deck-canary; version smoke and binary inspection confirmed the override is included. Context probes certify hint removal, not an actual model-driven delegation. Native built-in roles remain available; Developer Team selection is guided by existing Deck instructions rather than a new runtime allowlist. No actual provider turn, commit or push is authorized by this change.


## Workspace relocation
The user requested continuing in `/home/kevin15011/deck`. The branch and all 17 candidate files were transferred there and verified byte-for-byte against the saved candidate. Original local Serena configuration and the untracked Bun cache were preserved; both transfer stashes remain available. The canary was rebuilt from the active primary workspace.
