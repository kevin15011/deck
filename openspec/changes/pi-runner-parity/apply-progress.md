# Apply progress: pi-runner-parity

## Phases 7 and 8 (deck-apply-deep, 2026-10-02)

- Phase 7: legacy detection in every Pi plan (`PI_LEGACY_ARTIFACTS`), opt-in transactional cleanup (`deck pi developer --cleanup-legacy`, backup first, rollback on failure), and Doctor coverage (`pi-doctor.ts`) wired into `deck doctor`. See design deviations 31-35.
- Correction: Grep/Glob graph guidance is advisory (the search runs; one `tool_result` note per session). Deviation 29 and `specs/pi-tool-interception` updated.
- Phase 8: support matrix (Claude column, tool-interception rows, accurate Pi memory, global install), `docs/runners.md`, `docs/runner-support.md`, `docs/adaptive-memory.md` (Pi event flow), `docs/reference/cli.md`, `docs/configuration.md`, `docs/troubleshooting.md`. Limitations documented: `--append-system-prompt` replaces the user's `APPEND_SYSTEM.md` in children, MCP servers inherit non-memory env secrets, `deck-setup` delegation fail-closed pending `developer-team-execution-convergence`, read-only roles have no shell, Pi >= 1.0.0 only.

## Gates (task 8.3)

- `bunx tsc --noEmit`: clean.
- `bun test packages apps scripts tests` (default 5 s timeout, one process): 5566 tests, 8 failures, all explained by the baseline or fixed:
  - baseline: `external/skills content > generated bundle is idempotent` (generator requires Bun 1.3.12; installed 1.4.0), `Codex global ownership and migration > assignments are global` (blocked Codex plan), and three 5 s timeouts under full-suite load (`D-REACH-SKILL-08E`, `D-REACH-SKILL-08G`, Claude global plugin model discovery) that pass with the project's `--timeout 30000`.
  - fixed in this batch: documentation governance (new `--cleanup-legacy` command form), the production-preference audit (`deckConfig?:` on a Core contract), and a cross-test leak in the `deck-memory` child test (late request from a previous test's fake host).
- Focused: `bun test packages/adapter-pi` 946+ passing; Pi extensions 120 passing; doctor and CLI argument tests passing.

## Canary smoke (hermetic, temp HOME/XDG/`PI_CODING_AGENT_DIR`, tmux pseudo-terminal)

- `deck-canary pi developer` installed the global package and started Pi 1.0.0's interactive TUI: `[Context]` = Deck lead profile, `[Skills]` = the 9 Deck skills, `[Extensions]` = deck-memory, deck-subagents, deck-tool-policy, developer-team-execution, no load errors; `/mcp` listed `web-search connected - 5 tools - direct - global`; clean exit 0.
- A plain `pi` in the same agent directory lists the skills and extension names but no Deck context (extension code inert).
- Legacy flow: a Deck-added `pi-mcp-adapter`/`pi-subagents` entry was removed by the install; a modified legacy agent file was kept and reported; `deck doctor` reported every Pi item ok.

## Explicit memory tools for Pi and Codex (deck-apply-deep, 2026-10-03)

- Host: loopback `search`/`save` (additive), role policy, 16 KiB/1 KiB limits, canonical tag, redaction, idempotent replay.
- Pi: `memory_search`/`memory_save` through `deck-memory`; real Pi 1.0.0 contract tests (lead search+save, read-only child, disabled).
- Codex: `deck internal memory-mcp`, marker-owned `deck-memory` MCP entry, loopback hosted for the Codex launch when the entry is installed (token file, cleanup, fail-open); lead-level authorization because Codex gives the MCP server no agent identity.
- Triage: Codex "assignments are global" fails on clean `main` (pre-existing); see design deviation 50.
- Gates and counts: see the final report of this batch.

## Pi compaction memory extension (2026-10-03)

- Ownership: Investigate checked installed Pi 1.0 event types and native call paths; Apply Fast owned the complete implementation and RED/GREEN tests; Quality independently reviewed security, persistence and native behavior; Lead owns documentation, final gates and commits.
- Fresh profile/search context enriches native compaction without a replacement result; lead-only completion saves use the existing host redaction/eligibility and canonical tag. D13 records preparation-array semantics and the scoped persistence exception.
- TDD evidence: initial implementation 2 failing tests; native split test 1 failing test; Quality replay regression 2 failing tests before repair. Final focused command `bun test packages/adapter-pi/src/pi-extensions/memory apps/cli/src/supermemory-runtime-host.test.ts scripts/generate-pi-extension-assets.test.ts`: 95 passed. Neutralization: 2 passed. Test-only TypeScript fixture fix: 29 extension tests passed; `bunx tsc --noEmit` passed.
- Quality found native repeated-summary entry-ID reuse colliding with host replay protection. Repaired with distinct per-occurrence event IDs and replay-aware regression tests; scoped independent re-review found no remaining blocker.
- Assets regenerated with `bun run scripts/generate-pi-extension-assets.ts`. Tests isolate HOME and PI_CODING_AGENT_DIR and use fake provider/loopback effects, not live Supermemory.
- Limits: native SDK manual normal/split compaction exercised; threshold/overflow are synthetic-event/source evidence, not native automatic end-to-end runs. Live Supermemory ingestion is not verified. Summary eligibility and the 16-KiB cap remain in force; successful compaction does not guarantee accepted ingestion. Empty split history adds one native summary request.
- Final requested gates: `bun test packages/adapter-pi apps/cli` passed (2,156 tests, 157 files, 8,928 assertions, 516.71 seconds); `bunx tsc --noEmit` passed. The first broad run exceeded the command transport duration and had no terminal result; the complete rerun above is the authoritative evidence. `git diff --check` passed.
- Source commits: `fe90f7d` (host additive recall), `9802bc4` (Pi enrichment, summary save, timeout/replay contracts and regenerated assets). User-owned `.serena/project.yml` and `.bun-cache` were excluded. No push.
