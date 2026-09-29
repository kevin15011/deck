# Design: OpenCode Supermemory Plugin Profiles

## Boundary

Deck owns installation, protected credential custody, SSH-alias label discovery, token selection, verified canonical GitHub repository identity, and child-process handoff. The official plugin owns the entire memory lifecycle. The OpenCode adapter may expose a stable loader-only compatibility entry with `server()` forwarding to the official V1 export and `setup()` forwarding to the official V2 export; it does not call memory hooks or provider APIs itself.

## Launch sequence

```text
TUI -> Deck installer: verify pinned official package and owned loader
TUI -> Deck config: enable only after install and safe MCP retirement succeed
deck opencode developer -> alias resolver: inspect logical Git origin and safe SSH config
alias resolver -> profile store: exact alias if trusted, else default
profile store -> Deck launcher: one token reference, no serialized token
verified Git origin -> Deck launcher: existing sm_project_v1 owner/repo tag when available
Deck launcher -> OpenCode child: reviewed endpoint + token + optional canonical tag in child-only env
OpenCode child -> official Supermemory plugin: recall/capture/compaction
OpenCode child -> Deck execution plugin: stable-compatible mode; native permissions remain
```

No token/default stops the sequence before spawning. Missing canonical Git identity does not: omit Deck's tag and allow the official plugin's own fallback. An invalid selected token fails without trying another profile. Normal global/project plugins are deliberately preserved; the process environment is a shared trust boundary, not a per-plugin sandbox. Plugin-generated `repo_*` memories are not silently migrated into `sm_project_v1_*`.

## Safety decisions

- Parse literal origin SSH host, not identity filename, `ssh -G`, email, URL rewrite, or git credential helper. Ambiguous or unreadable SSH config produces default-only routing.
- Protect all storage and owned-install ancestry; reject symlinks, unsafe ownership/modes, malformed credentials, and conflicting plugin registrations. Writes must be atomic and serialized for concurrent TUI processes.
- Verify the published package name, exact version, registry integrity, and shipped entry hashes; keep one stable owned loader locator and do not allow duplicate official registration.
- Keep the token out of shared environment sanitizers; set it at the verified OpenCode spawn boundary. Override inherited Supermemory endpoint/config-content variables without changing unrelated parent environment.
- Reuse the hardened canonical owner/repository resolver for `SUPERMEMORY_REPO_TAG` only when verifiable. Strip inherited tags; absent identity means no Deck tag. The pinned plugin's `.claude/.supermemory-claude/config.json` override outranks the environment: inspect its effective base (main checkout for linked worktrees by default), block conflicting/unsafe higher-priority overrides, and do not rewrite user config.
- Retire only known Deck-owned memory wiring on OpenCode. Do not mutate other runners or historical specs. Do not force `invocation-required` for this cohort without its missing host authority; the user explicitly accepts stable-compatible Apply behavior and its weaker guarantee. Keep Config/MCP registration for Context Mode and RTK.

## Rollback and verification

On a failed install or retirement, leave the previous Deck activation state untouched and disclose the failure. Never delete another tool's configuration or remote memory. Focused TDD covers alias fallback, file trust, explicit activation dependencies, loader integrity, generated-asset parity, launch redaction and authorization; published-artifact hook tests establish capture/compaction. An actual pinned OpenCode-process composition test remains the final acceptance gate; a fixture invoking hooks directly is not equivalent.
