# Apply Fast handoff — U1 / R1 / R2 / R4

Status: functional candidate implemented; acceptance remains limited by the broad fast-tier run, audit-dependent classification and CI timing. No commits, no test removals, no destructive Git operations. Seven renames are staged by the required `git mv`; all other edits remain unstaged. Lead session-host edits and historical OpenSpec records are preserved. The approved change artifacts were not edited.

## U1 — structural content and runner parity

Changed: `packages/core/src/teams/developer/content-invariants.test.ts`, `apps/cli/src/verification-parity.test.ts`; minimal named exports in `apps/cli/src/session-service.ts` and `packages/adapter-claude/src/runner-adapter.ts`.

Checks protect canonical Git/authority blocks, required headings, catalog/legacy/explicit Deck ID resolution, skill frontmatter and byte budgets. Both profiles are covered. Doctrine/banned-phrase entries remain inactive for U2. Parity builds production Pi/OpenCode/Codex/Claude plans, checks canonical skill bytes and agent/skill sources, and checks every session role. Existing capability-parity helpers do not enumerate content files, so materialization entry points are used. OpenCode Lead correctly uses the canonical team session prompt, with existing memory-claim filtering normalized.

Evidence:
- Initial U1: 27 pass / 0 fail, 1.270s.
- Final expanded parity: 13 passing cases (included in the combined 31-pass run, 2.37s). Final expanded content-only run: 20 pass / 0 fail, 0.844s.
- Temporary source mutation removed Git protection from compact roles: exit 1, 7 failures; source restored byte-for-byte. Log `/tmp/deck-u1-mutation.log`.
- Isolated parity fault probe drops Claude `api-and-interface-design`: exit 1; error explicitly `claude: missing api-and-interface-design`; 2 pass, 1 expected failure, 1.169s. `/tmp/deck-parity-fault.log`.
- Isolated ordinary wording probe: 20 pass / 0 fail, 0.618s. `/tmp/deck-wording-probe.log`.

Existing gap for Lead/U2: adaptive roles requested with `legacy` do not currently receive `ADAPTIVE_TEAM_RUNTIME_CONTRACT` or Git protection (Claude uses that profile). The U1 baseline maps protection to the surfaces that currently carry it instead of changing shipped prompts in this guard-only slice. Retained legacy workflow roles retain their canonical Git and finding-authority blocks.

## R1 — tiers and changed selection

Changed: `scripts/test.ts`, `scripts/test.test.ts`, `scripts/test.int.test.ts`, root scripts, release full-suite command/assertions, CONTRIBUTING, AGENTS, baseline-health reference, plus the renames below.

Wrapper enumerates tracked and nonignored untracked tests, honors bunfig vendor exclusions, partitions by suffix, passes explicit paths, defaults to four parallel workers when supported, uses native `--changed` plus import selection when safe, and uses a transitive import-graph fallback for older Bun and non-import package inputs. Root configuration, lockfile and preload inputs expand to all fast/int tests. Empty selection never falls through to bare `bun test`. Retry/selection bypass flags are rejected. Quarantine validation and filtering are built in.

Bun spike (actual binaries): 1.4.0 supports changed and parallel; 1.3.12 silently ignores these unknown flags (help omits them). CLI `--path-ignore-patterns` replaces the bunfig ignore list on both versions. Wrapper therefore applies the configured list itself and detects flags from help. Logs `/tmp/deck-bun-spike.log`, `/tmp/deck-bun-1312.log`.

Evidence:
- Wrapper pure + production-composition fixture: 6 pass / 0 fail, 0.646s on 1.4.0; 6 pass / 0 fail, 1.050s on 1.3.12.
- The real temporary-repository fixture selects 1/20 tests (5%) for one source-module edit, propagates its deliberate assertion failure, and safely exits for an empty e2e tier.
- Inventory self-check: 626 files = 616 fast + 6 int + 4 e2e. This checks the Git-based partition; it is not an independent native Bun discovery-count proof.
- Current mixed workspace `test:changed -- --list`: 622/626 selected, 2.19s, expected due to root manifest/config changes. Not a claim of typical narrow-edit timing.
- Integration tier: 34 pass / 0 fail across 6 files, 3.56s Bun / 3.75s wall, exit 0. `/tmp/deck-int.log`.

Renames (content unchanged):
- `packages/adapter-opencode/src/context-mode-integration.test.ts` → `packages/adapter-opencode/src/context-mode.int.test.ts`
- `packages/adapter-opencode/src/opencode-supermemory-composition.integration.test.ts` → `packages/adapter-opencode/src/opencode-supermemory-composition.int.test.ts`
- `packages/session-host/src/__tests__/recovery.integration.test.ts` → `packages/session-host/src/__tests__/recovery.int.test.ts`
- `apps/cli/src/tui/__tests__/tui-integration.test.tsx` → `apps/cli/src/tui/__tests__/tui.int.test.tsx`
- `apps/cli/src/tui/__tests__/runner-install-e2e.test.tsx` → `apps/cli/src/tui/__tests__/runner-install.e2e.test.tsx`
- `packages/core/src/runner-capability-parity-e2e.test.ts` → `packages/core/src/runner-capability-parity.e2e.test.ts`
- `apps/web/src/provider-failure.integration.test.tsx` → `apps/web/src/provider-failure.int.test.tsx`

Historical OpenSpec paths are deliberately retained. The slow-file audit is still needed to move incorrectly named subprocess/slow tests out of the fast tier. No successful pre-change full-suite count exists in the handoff; full-count equivalence and speedup versus that baseline cannot be asserted.

## R2 — repository testing policy

Changed only `openspec/config.yaml`: proportional policy, red-first triggers, moment commands, tier definitions and quarantine location; removed strict-TDD flags/stale layer claims; preserved baseline and security constraints. Block-style YAML.

Evidence: direct `yaml.parse` succeeds and `readOpenSpecInitState(process.cwd())` returns `initialized: true`. Focused init-state tests included in the 30-pass affected check below.

## R4 — PR CI, quarantine and Bun pin

Changed `.github/workflows/ci.yml`, `tests/quarantine.yaml`, packageManager, all existing workflow pins and generator version assertion. Canonical pin is Bun 1.4.0. Release workflow now calls `test:full`. PR/non-main CI runs typecheck, fast (already includes generator freshness/parity) and integration, with a 10-minute budget. No duplicate dedicated parity run is added after fast. Quarantine is empty; metadata tests reject expiry, periods over 14 days, missing owner and protected entries without an approval reference. No protected test was quarantined.

Regenerated skill bundle, runner execution assets and Pi extension assets through their generators. Skill bundle and Codex output stayed unchanged; tracked changes are OpenCode/Pi execution bundles and Pi tool-policy bundle. No generated file was edited manually.

Evidence:
- Release workflow + generator freshness + wrapper + init-state focused run: 30 pass / 0 fail, 3.09s, exit 0.
- `bun run release:verify`: exit 0, 42.92s wall; memory benchmark, compiled Supermemory runtime checks and dry-run build passed. `/tmp/deck-release-verify.log`.
- YAML parses for CI/release/quarantine; `git diff --check` passes.
- Repository `bunx tsc --noEmit` and explicit script typecheck both pass after fixing two test/wrapper typing issues. Scripts are outside the repository tsconfig include list, so checked separately with `--ignoreConfig --module preserve --moduleResolution bundler --target es2022 --types bun --skipLibCheck --noEmit`.

Optional R4.2 nightly workflow is deferred: no fault-probe sample harness is yet available, and nightly-green/CI duration cannot be certified here. PR workflow has not run on GitHub. A full suite was deliberately not launched in addition to the fast-tier measurement and concurrent audit. No tests were retried to conceal failures.

## Candidate and limitations

Workspace evidence identity is in `/tmp/deck-apply-candidate.json`; it includes shared Lead/audit files and is not exclusive task attribution or the runtime's official candidate format. The existing source-derived guards are the oracle for U1; selection behavior and expiry/protected metadata requirements are the oracle for wrapper tests. New behavior tests were RED on the absent wrapper, then GREEN; content/config checks used structural validation rather than artificial RED.

The fast-tier measurement is summarized below. Concurrent audit and release work may affect timings; timeout causes are not proven. No full-suite pass, PR budget compliance or nightly pass is claimed.

## Fast-tier run (interrupted after budget overrun)

`/usr/bin/time -p bun run test:fast`: interrupted deliberately (exit 130) after **596.60s wall** to limit concurrent test contention. It selected 616 files. Partial log contains **5730 passing case lines**, **5 failing case lines**, and output from **413 distinct files**; these are not a completed Bun summary. No full-suite run followed. `/tmp/deck-fast.log` retains complete output.

- `packages/session-host/src/__tests__/push-attention-store.test.ts`: bounded receipts and views; older retry cannot overwrite newer revision [38644.03ms]
- `packages/session-host/src/__tests__/push-attention-store.test.ts`: capacity preserves terminal sent and failed receipts across reload without covering pending attention [72989.89ms]
- `apps/cli/src/tui/release-check-transport.test.ts`: async transport preserves sync descriptor/cache/legacy/error validation [10005.66ms]
- `packages/session-host/src/__tests__/push-attention-store.test.ts`: v1 migration preserves floor, sent/failed receipts and views without reloading index per event [47395.41ms]
- `apps/cli/src/upgrade-command/__tests__/runner-sync.test.ts`: runner-sync > Codex content-only sync repairs owned roles, support files, and bootstrap content with no optional selections [30000.13ms]

All five reported failures are timeouts (30s except release-check transport at 10s). None was retried, removed or quarantined. The configured 90s fast budget is not met; the 10-minute PR budget is not yet credible until the audit reclassifies/prunes slow cases and validates under controlled load. Historical pre-change full runs were aborted without usable counts, so no full-count equivalence or measured relative speedup is claimed.

Final affected check after typing-only and passthrough-guard deltas: `bun test apps/cli/src/verification-parity.test.ts scripts/test.test.ts`

```text

 18 pass
 0 fail
 1099 expect() calls
Ran 18 tests across 2 files. [1340.00ms]
```


## Approved bounded closure: U2+B0 and blocking B2 repairs

The user explicitly accepted composite verification after disclosure that the full command was interrupted by an unexplained CPU-active Pi Supermemory worker stall. The user deferred reconsideration of adaptive memory to another session and authorized closing this candidate as-is. This resolves the pending acceptance question for this candidate only; it does not weaken future full-gate requirements.

Accepted evidence: 7,511 passing cases, 11 unchanged skips, zero missing cases across all 613 canonical selected paths, with matching source hashes. Quality reconciliation: /tmp/deck-quality-reconciliation-59420/report.md and per-case/per-file evidence (task-7c45aa40-578d-43d0-ba38-41ae88e0ea70 attempt 5, result 60395/60396). Typecheck and protected scoped reviews remain valid. The full command's actual exit remains 1 following evaluator-induced termination; neither a successful full invocation nor a fixed stall is claimed. No additional broad rerun is required for this bounded closure.

Scope: U2+B0 and the reviewed blocking B2 fixture repairs are accepted for separate commits. U3 runtime wiring, readiness/Setup implementation, broader parity and remaining pruning are not declared complete. Adaptive-memory redesign and investigation of the unexplained stall are deferred to another session. No push authorized.
