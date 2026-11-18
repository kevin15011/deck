# Deck

Deck is being recreated with a Rust backend and a React/TypeScript web workspace, using GSAP for motion.

`deck-next` is the provisional repository/workspace name. The product remains **Deck**.

The development binary and launch command are provisionally named **`deck2`**, as requested by the user. Deck1 data is authoritative for automatic compatibility and transition. Development endpoints remain separate while Deck1 is running.

The existing Deck repository is a source of product behavior, AI-control contracts, content and visual references. Its module structure and implementation technology are not the blueprint for this new implementation.

## Run the development build

**Current installed development snapshot (2026-11-13):** `edd40c55` at `~/.local/bin/deck2`, installed at the user’s explicit request. Startup was checked with isolated state; full parity and real-provider CBM remain unqualified. Recovery: `target/user-preview/install-recovery-20261113-143230`. The accepted82 description below is historical and does not describe every change in this development snapshot.

**Product parity in progress:** the user rejected the extra ordinary-session setup and restrictions as divergent from Deck1. The implementation is being corrected to reproduce the original session, continuity, permission and tool flows. The installed build described below is a bounded technical baseline, not accepted product parity. See [the corrective scope](openspec/changes/deck-recreation/fidelity-correction.md).

The latest reviewed development candidate is installed at `/home/kevin15011/.local/bin/deck2` (binary SHA-256 `5a12706b…`, candidate `84d7c8e3`). It detects and verifies the existing Deck1 dictation model and initial language without copying or downloading the model. Obsolete experimental Deck2 preferences do not override Deck1 selection. Explicit artifact-store overrides stay isolated; later Deck2 preferences and temporary audio stay private. Deleting/replacing a source-owned model remains a Deck1 operation during coexistence. Local engine prerequisites still apply; speech accuracy and real-device microphone behavior remain unqualified.

It retains the original per-session Ask first/YOLO controls for supported Codex execution, context/Subagents/Usage, double-Escape, Stop, Enter behavior, session branch, panel resize/collapse, all 19 themes and transitions, managed Codebase Memory freshness, session continuity and delegation within their recorded scope. Full Deck1 behavior and other runners remain incomplete.

Use the same `deck2 serve --project /path/to/project` command on the next start. Direct original projects/history/images, recoverable SQLite adoption under exclusive original ownership, and supported terminal or safely recovered interrupted Codex continuation in each recorded project are installed. Same-origin original theme/font/panel preferences are retained, including legacy panel fallback; current separate ports do not share browser storage. Original device credentials, installed-app manifest/worker/cache identity and session links survive isolated replacement at the same origin; navigation preserves open editor drafts. Original notification controls, subscription/key and receipt adoption, supported attention/actions and exact final-reply display receipts are now accepted within the isolated transport/browser scope. Real device/PWA/HTTPS/Tailscale/provider delivery remains unqualified. Earlier notification/browser evidence remains valid for unchanged paths. Project/session bindings, configuration, trust, prepared tools and Git are scoped to the owning project; navigation cannot redirect admitted work. Original delegated-task cards, recorded assignments, attempts, results and separate conversations now appear in Subagents for readable and adopted sessions, including alongside new Rust tasks. Historical inspection stays passive. An explicit current Lead continuation can now bind a supported original Codex task to its next numbered attempt, retaining its recorded owner, assignment and project in one Subagents card. Current permissions and exact source checks apply; interrupted retained reports stay partial, and mandatory handoff instructions/findings are preserved. The installed browser canary passed ten groups (18.438s including process drain), covering original task continuation, historical/live identity and controls, delayed results, mobile/keyboard/reduced motion, Codex assignment, context ownership and task-free context release across restart without replay; version/help passed. Real production native-context reuse remains unqualified. Earlier two-project ownership evidence remains applicable to unchanged inputs. Native transport is fixture-owned. The previous executable and a SQLite-consistent state backup are retained. See [the current installation receipt](target/deck2-assignment-install-evidence.json). Installation did not restart either user host or migrate live original history.

Connected Codex sessions now support available model and reasoning selection for the Lead and individual members, including original configured defaults and supported adopted Deck1 sessions. Public model identifiers are preserved while native requests use the validated model and effort. Idle Lead reassignment starts a new execution generation with bounded public-history context; historical tasks retain their recorded assignments. Busy, stale, revoked and changed-source saves are rejected. Durable observations remain historical while the context indicator follows the current execution. Catalog and provider availability still apply; full OpenCode/Pi/Claude conversation and assignment support remains pending.

The build retains the [Git Changes panel](docs/sprints/sprint-08c-verification.md#acceptance-and-installation), [startup compatibility correction](docs/sprints/startup-compatibility-verification.md#acceptance-and-installation), [persistent images and cleanup](docs/sprints/sprint-08b-verification.md#acceptance-and-installation), [appearance/themes/fonts and desktop divider](docs/sprints/sprint-08a-verification.md#acceptance-and-installation), performance correction and [six native maintenance handoffs](docs/sprints/native-maintenance-verification.md#acceptance-and-installation). The current shell/theme journey passed in packaged Chromium; Firefox/Zen and full workspace-content parity remain unverified. No personal tool was updated during installation. Automatic Windows browser authentication remains unverified; use the tested private-link recovery when needed (S1-Q07).

The packaged development build is available as `dist/deck2`, with embedded static browser assets and a Rust host. No browser development server, runtime Node/Bun or CDN is required. Development builds may advance independently of the installed, accepted binary.

The installed build supports host schema17; its session protocol has advanced beyond the earlier API7/schema11 baseline. Its maintenance ownership correction passed source review and independent Lead verification. Native sign-in handoff is implemented, but successful new interactive third-party sign-in remains unverified; the real journeys use existing native authentication. Earlier executables cannot reopen state after migration to schema17.

```bash
deck2 serve --project /path/to/project
```

The host serves on authenticated loopback and attempts browser opening through the desktop opener. On WSL, missing Linux openers fall through to supported Windows dispatch; a completed opener is not proof that the browser authenticated. Failures provide the exact executable/state recovery command. Closing the tab leaves the host running; Ctrl-C stops the foreground host. Use `deck2 open` to reopen its browser or `deck2 status` to inspect recorded state. Installation replaced only the executable; an already running host keeps its previous build until the user stops it with Ctrl-C and starts it again. No live host was stopped by the update. A fresh checkout can use `./dist/deck2` after building.

A bare endpoint does not authenticate the browser. Reopen through `open` with the same state directory. If the desktop opener fails, `deck2 open --print-url` explicitly prints a private, one-use launch link for manual opening. Treat that link as a credential, not a support-log attachment. The replacement retains drafts and unresolved command identities across reauthentication and pauses forbidden polling.

The connected session path currently supports Linux and exactly Codex 0.166.0, already authenticated through its native login. The following legacy scoped-investigator launch options are separate from connected session/member assignment. Team mode can use the selected Codex as its scoped Investigator with `--investigator-codex`. The alternative qualified OpenCode 1.19.1 assignment requires Linux Landlock ABI 3 and its explicit qualified model `minimax-coding-plan/MiniMax-M2.7`; that provider’s historical quota failure does not gate the Codex route. Unsupported identities are blocked. Each private state directory holds one workspace with immutable per-session project bindings and multiple conversations; the default is `${XDG_STATE_HOME:-$HOME/.local/state}/deck2`. Use the same explicit `--state-dir` across commands when choosing another directory. Native runner configuration and credentials remain runner-owned.

Enable the Codex Investigator at launch (fixed gpt-6.1-sol for team work):

```bash
deck2 serve --project /path/to/project --investigator-codex
```

Alternatively, enable the qualified OpenCode assignment. These launch options are mutually exclusive:

```bash
deck2 serve --project /path/to/project \
  --opencode /path/to/opencode \
  --investigator-model minimax-coding-plan/MiniMax-M2.7
```

Choose Team mode and explicitly start a new execution. The investigator receives Deck's bounded scoped read/search tools and, when RTK is selected for that admission, captured-source compaction and exact snapshot retrieval. Follow-up retains task/owner/report lineage but starts a fresh native session. Team native-context continuation is unqualified. Report retrieval and adoption are not independent verification. Task-bearing conversations retain their evidence and cannot yet be released/removed. Prepared native processes use Deck-owned resources while native authentication and logging remain native behavior; this is not a zero-native-writes guarantee.

Read-only mode prevents project writes and disables inherited effectful extensions. Reviewed-edit mode requires explicit project trust and a separate Allow once decision for each supported file proposal. It currently supports existing ordinary UTF-8 files up to 64 KiB, excluding links, binary files, multi-file operations, rename/delete and broad shell grants. Questions grant no permission. An unavailable post-edit comparison is reported separately from native completion; no automatic rollback is performed.

Neither mode is a project-only read-confidentiality sandbox: the native read-only profile can read other accessible files, and native authentication/cache/model traffic still occurs. Each conversation can continue its own Deck-created persistent Codex thread, with restrictions checked again. Missing or released native context requires explicit Start new execution; old ephemeral context is never presented as resumable.

Queued input is definitely undispatched until claimed. The queue pauses after host restart and requires Resume; cancellation of waiting input prevents launch. One host execution slot and unresolved ownership span all projects and conversations; parallel project execution remains pending. Live steering is unavailable. Stop interrupts a task, Release saved native context forgets Deck's continuation reference, and Remove local conversation removes only settled local history, preserving project files and native rollouts. Limits are 64 conversations, 32 waiting inputs and 256 receipts.

Configuration distinguishes selection for new work from exact records of an execution. Disabling team investigation affects future admissions; queued/running roots and their descendants/follow-ups keep their admitted selection. This switch is not revocation or cancellation. Missing historical content remains unknown. Full standalone-skill/capability selection remains under development.

**External tools candidate (not installed):** Settings › Agents & tools has host-wide controls for Codebase Memory, RTK and Context7. Install and Update run their upstream installers into `~/.local/bin` (Context7 uses npm with prefix `~/.local`). Detection and runtime use that same executable; Deck injects distinct `deck-codebase-memory` and `deck-context7` MCP entries at launch and gives agents the explicit RTK command. Runner profiles and personal MCP entries stay under native ownership. Trusted projects index automatically on use; a persistent CBM session watches the real root and closes after idle expiry or trust revocation. Index limits and watcher options are configured through CBM's own CLI and standard configuration database. Unavailable graphs require exact-source fallback.

**Legacy compatibility:** historical receipts, selections and private artifacts remain readable under `~/.local/share/deck2-managed-v1` or the prior `--artifact-store`. New private artifact downloads are retired. Do not remove these old files while historical work still needs them. The following paragraph records the previous implementation; its new private downloads are now retired:

In Configuration, Managed helpers supports reviewed manual RTK installation and update from the fixed 0.50.0/1.2.0 Linux x86-64 musl catalog. Immutable binaries and notices are retained in `~/.local/share/deck2-managed-v1`, or the explicit `--artifact-store`; each project selects its own version. Existing admissions keep their recorded version. Other installations are not adopted or replaced. There are no automatic updates or artifact garbage collection. Codebase Memory is now available in the installed build: prepare and select a bounded source scope in Configuration, then use Team mode with the Codex Investigator for graph-assisted investigation. Exact current reads remain available when the admitted graph is unavailable or stale. External native maintenance is separate from these retained managed copies. NATIVE6-Q01 is resolved; the historical MiniMax429 is not a delivery dependency. See the [acceptance and evidence](docs/sprints/native-maintenance-verification.md).

Use the compatible packaged browser client; reload an older cached client. This build migrates recognized prior host state transactionally to schema17; earlier builds reject that state. Use fresh `--state-dir` for isolated evaluation, or preserve a backup of stopped state before activating a migration when backward recovery is needed. The prior binary is backed up, but binary backup alone cannot downgrade state. Installation does not open or migrate live state. Restart reuses the saved loopback port to preserve browser-local drafts; if it is occupied, startup fails with an actionable error.

Build with Bun 1.4.0 and the isolated repository Rust toolchain (bootstrap prepares Rust without changing the shell profile):

```bash
./scripts/bootstrap.sh
./scripts/build.sh
source scripts/env.sh
cargo fmt --all --check
cargo clippy --locked --workspace --all-targets -- -D warnings
cargo test --locked --workspace
bun run typecheck
bun test frontend/src/api.test.ts frontend/src/configuration-pending.test.ts
```

Recovery is conservative: `deck2 recover --confirm-native-stopped` requires the operator to inspect and stop previous native processes first. It acknowledges an unknown outcome and never replays commands.

## Planning

- [Product charter](docs/product-charter.md)
- [Product catalog](docs/product-catalog.md)
- [AI-control contracts](docs/product-contracts.md)
- [Instruction consistency audit](docs/instruction-audit.md)
- [Instruction coverage inventory](docs/instruction-inventory.md)
- [Reliability and non-invasive runner research](docs/reliability-runner-research.md)
- [Visual design baseline](docs/design-baseline.md)
- [Rust technical direction](docs/technical-direction.md)
- [Proposed operating model](docs/operating-model.md)
- [Roadmap and functional sprints](docs/roadmap.md)
- [First sprint candidate](docs/sprints/sprint-01.md)
- [Recreation working brief](openspec/changes/deck-recreation/working-brief.md)

Current stage: candidate 84d7c8e3 / binary 5a12706b is accepted and installed with original model/history, automatic SQLite adoption, supported Lead and delegated-task continuation/recovery, per-session project compatibility, same-origin appearance/device identity, bounded notifications, original subagent history and Codex session/member model and reasoning selection. Next is extending connected assignment and execution to the remaining original runners. Deck1 remains authoritative; experimental Deck2 state need not be merged. Current ports remain separate. Full runner parity, parallel project execution, remaining Activity/transcript behavior, installation/update, broader capability/skill parity, real device/provider qualification and S1-Q07 remain outstanding. Full original-app parity and broad performance guarantees are not established.
