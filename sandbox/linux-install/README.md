# Linux installation sandbox

A disposable Debian Linux terminal with the current stable OpenCode, Codex and Claude Code CLIs. Node/npm, Git, curl and basic archive tools support those CLIs and installation. Deck-owned tools are not preinstalled. No host HOME, repository, credentials, Docker socket or persistent volumes are mounted.

## Start a session

Requires a running Docker Engine, Bash and an interactive terminal. The first launch builds the image; subsequent launches reuse it.

From the repository root:

```sh
# Only runners: manually download Deck through its official installer.
bun sandbox:clean

# Build this checkout's canary into a temporary directory and copy it into the session.
# Requires Linux and installed checkout dependencies (bun install --frozen-lockfile).
bun sandbox
```

With Deck, run `deck-canary` to open the TUI. Without Deck, run:

```sh
curl -fsSL https://raw.githubusercontent.com/kevin15011/deck/main/scripts/install.sh | bash
export PATH="$HOME/.local/bin:$PATH"
deck
```

Both modes start as the unprivileged `tester` user in `/home/tester/project`, an empty Git project. The launcher supplies no host credentials or API keys. You can authenticate inside the session when needed. Exit the main shell to delete the container and its configuration. Do not detach if you intend to finish the session; if a host crash leaves it running, inspect it before explicitly removing it with `docker rm -f deck-install-sandbox`.

For an already-built Linux canary matching the image architecture:

```sh
DECK_SANDBOX_CANARY=/absolute/path/to/deck-canary bun sandbox
```

## Refresh stable runners

```sh
bun sandbox:update
```

OpenCode and Codex use npm's `latest` distribution tag; Claude uses its native installer's `stable` channel. Versions are not pinned. Updating re-resolves those channels and checks each CLI's version, while retaining cached Linux layers where possible. Starting a session reuses the installed image rather than downloading Linux or runners again. `/home/tester/runner-versions.txt` records the versions at build time; runners may update themselves within a session.

Official installation references: [OpenCode](https://opencode.ai/docs/), [Codex](https://github.com/openai/codex), [Claude Code](https://code.claude.com/docs/en/setup).

## Agent inspection

The active container is always named `deck-install-sandbox`. From any terminal or agent with access to the same Docker daemon:

```sh
docker exec -it deck-install-sandbox bash
docker exec deck-install-sandbox find /home/tester -maxdepth 4 -type f
docker exec deck-install-sandbox cat /home/tester/.codex/config.toml
# Optional evidence export before closing; this explicit copy persists on the host.
docker cp deck-install-sandbox:/home/tester ./sandbox-evidence
```

Inspect runner configuration under `/home/tester/.config/opencode`, `/home/tester/.codex`, `/home/tester/.claude` and project-local files as appropriate. Agents inside the container access the same files directly. A remote agent needs access to that Docker daemon or an explicit evidence export; filesystem access alone does not expose container files. A second launcher refuses to overwrite an existing session.

## Scope

This environment supports manual installation testing on one native Linux architecture. It does not certify macOS, other distributions, successful model authentication or every user's machine. No additional test scenarios or automatic runner sessions are included. The image remains cached; session writes do not modify it.
