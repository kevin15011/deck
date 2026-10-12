# Handoff: cross-runner-session-core (read this first)

Last updated: 2026-10-12. Repo `/Users/kevinlondono/Proyects/deck`, branch `fix/claude-model-config-blocked-plan` (created from an up-to-date `main`). Nothing has been pushed. The user wants everything to ship from this branch when they launch.

## What this is
A cross-provider Deck feature: each developer-team member (lead included) can run on a different runner (Claude Code, Codex, OpenCode), each in its own native CLI, while Deck supervises ONE session (one OpenSpec change, shared Supermemory memory, owner-contract re-delegation to the same agent with prior context). Architecture: a Deck-owned local session daemon (`@deck/session-host`) plus thin clients; first client is a desktop web UI on `127.0.0.1`. Pi is NOT the host.

Authoritative artifacts (read in this order): `working-brief.md` (decisions + spike evidence), `proposal.md`, `spec.md` (XR-* requirements), `design.md` (D-* decisions), `tasks.md` (stages S0-S5, task IDs), `apply-progress.md` (per-task status and evidence), `state.yaml`/`events.yaml` (registry). Spike scripts: `spike/`.

## User decisions (final)
- Daemon + web client; Pi is not the host. Local service only: bind `127.0.0.1`; Tailscale is NOT required (optional late helper `deck cross expose`, task 4.10); no mobile/PWA/offline/push; no launchd/systemd service.
- Personal single-user use of the user's own subscriptions; spawn the unmodified native CLIs as the signed-in user; never extract/reuse OAuth tokens; never use Claude `--bare`.
- Claude ToS residual risk ACCEPTED behind a one-time acknowledgement (Claude is the S1 driver).
- Codex in cross sessions KEEPS the already-approved always-on bypass; approval relay with sandbox on is opt-in.
- Deck ships as per-user compiled binaries WITHOUT the repo: daemon, web assets and schemas must be embedded; no repo paths at runtime; four targets (linux/darwin x64/arm64).
- Lead-level decisions applied: `boot-changed` settles ownership in recovery; `approval.respond` accepts `allow` and `allow-once` (events emit `allow-once|deny`); command idempotency receipts persist via the event log (survive daemon restart).

## Progress
- Done and verified by the Lead (independent `tsc`, tests, git status): S0 (contracts, config `crossRunner`, Codex 0.162.1 audit, BIN gate) and S1a (session-host core: paths, EventLog, ledger, child anchor, recovery, daemon, control server, MCP bridge, ApprovalBroker, hidden `deck internal` routes).
- S1b (tasks 1.11-1.19) was IN PROGRESS when this was written: Claude driver and single-member Lead SessionManager were committed; CLI commands (`deck cross developer`, `deck session ...`), self-test manifest, ToS acknowledgement gate and the S1 BIN gate were being written (uncommitted files may exist in the worktree: `apps/cli/src/session-commands*.ts`, `session-self-test*.ts`, `session-service*.ts`, `cli-args*`). Check `git status`, `git log --oneline 6970400..HEAD` and `apply-progress.md` for the true state; a delegated agent may still be running or may have finished after this note.
- Not started: S2 (Codex + OpenCode drivers), S3 (proxied Lead, delegation tools, memory broker, ledger continuation), S4 (desktop web client), S5 (TUI cross runner, docs, final BIN gate).

## How to continue
1. Verify before trusting: `git status --short`, `bunx tsc --noEmit`, `TMPDIR=$(realpath /tmp) bun test packages/session-host packages/core/src/session`, `deck openspec validate --change cross-runner-session-core`.
2. Finish S1b if incomplete (see `apply-progress.md`), run its BIN gate, commit.
3. Then run stages in order S2, S3, S4, S5, one implementation agent per stage (split large stages), TDD, logical conventional commits, update `apply-progress.md` per task, and verify each stage yourself before moving on. Use `deck-apply-deep` for protocol/process work and `deck-apply-fast` for clear routine work.
4. Stop and ask the user only for unresolved design decisions or actions blocked by permissions; the SDD resolves everything else.

## Environment gotchas (learned the hard way)
- Run tests with `TMPDIR=$(realpath /tmp)`: the macOS `/var` symlink otherwise fails ~15 config tests.
- Host Bun is 1.3.11 but the release pins 1.3.12: build with `npx -y bun@1.3.12 run scripts/build-binaries.ts --dry-run` (npm cache only). Never run `canary:install` or modify installed binaries/global tools without the user's say-so.
- Never run a bare `bun install` (apps/cli pins ink/react to `latest` and breaks `tsc`); use `--frozen-lockfile`.
- Known pre-existing failures: skill-bundle idempotency (needs Bun 1.3.12), preference audit flagging Pi `supervisor.ts`, OpenCode SSH-alias launch test; `codex-supermemory-launch.test.ts` is a full-run timeout flake (passes alone).
- Codex 0.130.0 on macOS had a REVOKED OpenAI signing certificate (binary killed/deleted); fixed with `npm install -g @openai/codex@0.162.1`. Binary path moved to `vendor/aarch64-apple-darwin/bin/codex`. Always check `codesign --verify` before bypassing a macOS malware alert; never disable protections.
- No `timeout` on macOS: use `perl -e 'alarm N; exec @ARGV'`. `codex exec` needs `< /dev/null`. Claude `-p` without `--strict-mcp-config` loads all user MCP servers and hooks.
- `.gitignore` ignores `*.generated.ts`: `schema.generated.ts` is force-added; never hand-edit generated files. `.serena` is gitignored but `project.yml` is tracked.
- Live provider calls cost the user's subscription: keep them to trivial prompts (`--model haiku --tools ""` for Claude, free models for OpenCode) and record them.

## Branch contents (oldest to newest, summarized)
`ab2f624` Claude model-config blocked-plan fix (the original reason for the branch; works on all OSes/binaries, platform-independent logic) -> spike and SDD docs -> `fdd4ab2`/`bfd056c`/`878bafd`/`144f6ea` preserved user's WIP (Pi supervisor, Supermemory account validation, a second OpenSpec brief, Serena config; marked `wip`, never verified as a whole) -> `6970400` regenerated runner bundles + S0 close -> S1a commits -> S1b commits. The branch mixes the Claude fix, Pi/Supermemory WIP and cross-runner work; if a cleaner PR is wanted, the Claude fix is isolated in `ab2f624`.

## Open items for the user's later attention
- Regenerate/verify Pi and OpenCode generated bundles and the `wip` Pi/Supermemory commits before release.
- Remaining unverified items listed as named tasks: memory inside delegated children, Codex decline path, Codex auth with user config ignored, OpenCode isolation via a Deck-owned config dir, Claude `--safe-mode` with explicit MCP config, Tailscale Funnel header name.
- 4-target build, Docker Linux smoke and live 3-runner acceptance are still to be run in their stages (S2 3.11, S5 5.6).
