# Linux installation sandbox

## Short launch commands

Added `bun sandbox` (with checkout canary), `bun sandbox:clean` (runners only), and `bun sandbox:update` (refresh stable runners). Documentation and launcher help use these aliases; the existing sandbox:linux entry remains available. This only simplifies command routing and does not change container behavior.

Validated all three aliases through Bun with an isolated shell shim, without creating a real container. All 24 focused sandbox/documentation tests passed; Bash syntax and git diff --check passed.

## Intent and acceptance
Provide a disposable Linux terminal for manual Deck installation through its TUI on stable OpenCode, Codex and Claude Code. Exactly two launch modes: runner-only for official Deck download tests, and checkout-built deck-canary for TUI installation tests. Resolve stable channels at image refresh, cache the base image, permit same-daemon agent inspection, and remove session configuration on exit. No host configuration or credentials are mounted.

## Decisions and targets
- `sandbox/linux-install/Dockerfile`: Debian/Node LTS base, unprivileged tester, native Claude stable and npm latest OpenCode/Codex; no Deck-managed tools.
- `scripts/linux-install-sandbox.sh`: explicit update, cached launch, isolated temporary canary build or provided binary, named disposable container, cleanup and refusal to overwrite an existing session.
- `sandbox/linux-install/README.md`: launch, refresh, official installation and agent access.
- `scripts/linux-install-sandbox.test.ts`: mocked Docker behavior; no downloads or installations in test gates.

## Risks and non-goals
Docker daemon access is required for outside agents. Docker is Linux-only here; a provided canary must match its architecture. Stable channels change over time; record actual versions. Third-party installation scripts run only in the image. No automated provider sessions, additional scenarios, publication or host credential forwarding.

## Evidence and progress
Launcher tests were written first: three failed before implementation. All six launcher tests passed after implementation (20 assertions); together with documentation governance, 24 tests passed. Repository TypeScript and shell syntax checks passed.

Real Docker acceptance on Linux x64: the image built successfully with OpenCode 1.18.34, Codex 0.160.0 and native Claude Code 2.1.285. Both launcher modes opened interactive shells as UID 1001; the runner-only mode had no Deck binary or runner configuration. Docker inspection confirmed zero mounts and automatic removal. External docker exec read the same filesystem. A marker from the first session was absent in the second. The with-deck mode built the current checkout into a temporary canary, copied its dereferenced executable and opened the production TUI through the environment selection screen. Canary identity: Deck 0.8.0, commit df3f0c1, linux-x64, dev. Exiting removed the session and temporary canary directory.

The real npm installer required explicit allow-scripts permission for the OpenCode postinstall; the image grants it only to that package. Image startup/version checks are not evidence that every Deck runner installation succeeds: those manual tests are the purpose of this environment. No provider authentication, complete installation, official Deck download, commit, push or publication was performed.


## Workspace relocation
The user requested continuing in `/home/kevin15011/deck`. The branch and all 17 candidate files were transferred there and verified byte-for-byte against the saved candidate. Original local Serena configuration and the untracked Bun cache were preserved; both transfer stashes remain available. The canary was rebuilt from the active primary workspace.
