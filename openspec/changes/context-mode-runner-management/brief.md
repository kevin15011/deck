# Native Context Mode lifecycle in Deck
Research recommendation only. Add a Settings tool entry with install and targeted update per supported runner. Reuse RTK's lifecycle UI and delegation to the vendor installer. RTK's runner setup currently invokes its Codex integration and detects the files it owns. Context Mode requires distinct adapters for plugins, marketplace and npm packages. Keep execution, routing, hooks, tool output and storage under the runner and Context Mode. Do not add per-call Deck interception or a project policy. Detect existing MCP-only, full native and duplicate configurations in the effective runner home before installation; preserve manually configured instances and avoid parallel registration.

This machine has a global context-mode CLI, an explicit Codex MCP server, and an OpenCode MCP configuration. Node 24.19.0 satisfies npm stable 2.2.1's >=24.15.0. The local Codex 0.170.0 supports marketplaces and plugin add. The installed OpenCode 1.19.5 uses plugin <module> --global and --force, unlike the newer upstream README syntax. Claude Code has native marketplace installation and targeted update. Pi 1.0.0 can update one npm extension. Verify exact upstream/native install and targeted upgrade on supported versions in disposable runner homes, then observe one registration after restart from Deck for Lead and member. Test coexistence with RTK; expose incomplete setup as diagnostic information. No installation performed.

References: https://github.com/mksglu/context-mode#install and https://www.npmjs.com/package/context-mode . Local evidence: crates/host/src/rtk_runners.rs, connected_opencode/runtime.rs, local CLI help and npm package metadata.

## Approved implementation scope

User requested Codex only and removal of older Context Mode installations across runners. Native lifecycle implementation in progress. Lead removed and verified the standalone OpenCode MCP entry while preserving the remaining JSON settings. Found global npm 1.0.169, an old Codex MCP registration, and persistent runner-specific data in Claude, Gemini, Pi and OpenCode. Await an explicit decision on permanent data deletion; retain normal runner histories and unrelated configuration backups. Stage replacement before retiring the old Codex executable.

## Manual lifecycle correction

Only the user may initiate installation, migration, update or synchronization from Settings. Live migration and cleanup by Lead are superseded. Read-only inspection after the interruption found the marketplace registered, no native plugin registration, and the legacy standalone MCP entry still present. The currently packaged UI rejects that state. Implement an explicit migration action with passive status inspection, recoverability and preservation of unrelated runner configuration and session data. Verify with fakes.

## Approved Settings wording and confirmation

Use Install as the primary action for both a clean installation and a recognized legacy MCP registration. For the legacy case, explain that the official Codex plugin will replace the standalone MCP registration and ask for confirmation before any write or installation POST. Cancel leaves the original registration intact. After installation show Update. Viewing or refreshing Settings is read-only. Verify these requirements with fakes before delivery.

Delivered the explicit Install confirmation in the project release executable. Fake Chromium requests verified passive initial load and Refresh, cancellation with zero mutation requests, confirmed replacement, repair after partial failure, and Update. Typecheck and the release build passed. The live Codex configuration, installed Deck launcher and daemon were left alone.
