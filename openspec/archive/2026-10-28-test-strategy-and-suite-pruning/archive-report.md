# Archive report: test-strategy-and-suite-pruning

## Closure decision and verification

Archived on 2026-10-28 under the explicit current instruction to close now. This is accepted closure with documented limitations and deferrals, not a claim that all historical checkboxes or live acceptance scenarios passed. Earlier pending-work instructions and reports remain historical evidence and do not reopen this accepted closure.

Final code/test evidence is reused from `/tmp/deck38-report.md` and `/tmp/deck38-four-full.log`:

| Check | Source and scope | Result | Duration |
|---|---|---|---|
| `bun run test:full` | CONTRIBUTING.md, package.json, release CI; default four workers, all 638 files | Exit 0; 7,657 pass, 0 fail, 11 existing skips; 7,668 cases, 99,407 assertions | 972.67 s |
| `bunx tsc --noEmit` | Repository conventions; workspace | Exit 0, no diagnostics | About 32 s; exact duration not instrumented |
| `git diff --check` | Archive integrity and whitespace | Rechecked for archive handoff | See closure validation below |

The full run's before/after candidate was `0b7008023b4320c5efd2d6a46a9a45eea9f1a4ce:5adf3e95bde53edce11897b467c56d701d6a0f46`. A read-only comparison of that tree with closure HEAD `d639d93fefbe4d03e62cffe6535f3aba6fe457eb` differs only at the unrelated `openspec/changes/web-terminal-feasibility/working-brief.md`; code/tests are identical. The documentation-only archive does not invalidate this runtime evidence. The full suite and typecheck were not repeated for archive moves. The nested failing subprocess in the full log is an intentional wrapper test; the top-level summary is green.

Implementation and test commits are on local `main`, inclusive range `4a13d2a..d639d93`; no push was performed. This archive operation creates no commit and does not stage. Historical earlier failed and composite runs remain recorded; the default four-worker success closes the final-gate gap without rewriting them or proving that future timing failures are impossible.

## Accepted limitations and incident record

- Live model-backed consumption of the final runner matrix was not verified; the user explicitly chose archive without it. Historical individual probes are not a final live matrix.
- Standalone native Claude/Codex Setup remains a documented limitation: no authenticated repair without trusted child/current-invocation evidence. Authenticated cross-runner Setup and native Pi/OpenCode repair are the supported paths.
- The user revoked the PQ2 blanket Codex review-role fence. Cross-runner review threads have read-only sandbox/MCP enforcement. Native Codex subagents inherit their parent's MCP and sandbox authority; role publication restores availability, not enforcement parity. See [READONLY-ROLES.md](../../../packages/adapter-codex/READONLY-ROLES.md).
- On 2026-10-28, `runner-migration-recovery.int.test.ts` inherited `CODEX_HOME` and overwrote real Codex configuration, also writing a pending manifest and retired launcher. Test isolation was fixed; commit `26d0f3f` adds worker-isolated HOME/CODEX_HOME/XDG/runner roots and environment-aware OS/Bun subprocess defaults. This is environment isolation, not filesystem enforcement. With user approval, Lead saved damaged copies under `~/.codex/deck/incident-20261028-test-overwrite/`, restored the 2026-10-27 15:08 pre-retirement backup and removed the pending manifest. Later non-Deck edits may have been lost; user reinstall was recorded as follow-up, not verified here. Archive work did not repeat recovery or touch user configuration.

## Promotion, preservation and Git handling

Both new capability directories are additive. The existing promoted specs (`adaptive-quality-control`, `artifact-state-contracts`, `runner-orchestration-resilience`) remain byte-identical; no destructive merge was needed. Original spec/design/history files remain intact in the archive. Promotion reconciles superseded draft strict-TDD, missing-install, Pi-no-driver and Codex-fence assumptions with recorded decisions; it does not delete an existing promoted requirement.

Directory moves use filesystem rename because `git mv` would stage and conflict with the explicit no-staging instruction. Git can recognize these renames when subsequently staged by an authorized owner. No index reset/restore, staging, commit or push was used. The unrelated web-terminal change remains untouched.

## Delivered scope and Quality integrations

U1 structural guards, the U2 proportional doctrine/current role content, tier/affected-selection tooling, repository policy, PR/release workflow configuration and quarantine validation landed. Strict TDD, the vendor TDD skill and legacy roles/profiles were removed rather than kept as opt-ins. The historical U2+B0/B2 composite closure remains accurately recorded: 7,511 passing cases and 11 skips, full command exit 1 after reviewer termination; user accepted that bounded earlier candidate (Quality attempt 5 integration 60541).

Commits `5ad24f8` and `d998b3b` contain the final bounded pruning and fixture corrections. The approved non-protected retirement removed 128 redundant cases. Trust revision tests retain real eviction/restart/replay; inventory tests assert returned data; metadata guards remain. Protected retirement candidates were retained. Quality attempt 22 accepted this bounded delta and found no blocking code issue; its P3 evidence-wording advisory was corrected in the later working-brief narrative. Its verdict used earlier composite evidence and is not falsely described as reviewing the later green run.

Later fixture corrections wait for teardown/input/persisted outcomes and isolate install journals without raising timeouts, adding quarantine/skips or deleting protected tests. The default four-worker full run above supersedes the prior two-worker-only final-gate limitation. General timing reliability and PR duration targets are not proven by one green run. Durable evidence copies: `handoff-evidence/archive-quality-22.txt` and `archive-final-gate.md`.

## Deferred work

- U3 runtime evidence reuse/classification wiring and optional U4 session-host candidate capture: not declared delivered by doctrine publication.
- Optional nightly/fault-probe/eval harness execution and measured PR/fast-tier performance budgets: not verified or completed.
- Protected B0/B3/B5 deletion candidates and remaining unapproved pruning: retained; archive approval does not authorize their deletion.
- Final live model-backed role/skill consumption and native limitations are as recorded above. Broad future tasks remain unchecked; closure accepts this bounded result.

## File inventory

Created `openspec/specs/test-strategy-and-suite-pruning/spec.md`. Moved every file from `openspec/changes/test-strategy-and-suite-pruning/` to `openspec/archive/2026-10-28-test-strategy-and-suite-pruning/`. Updated only tasks.md within the original files. Added archive-report.md, state.yaml, events.yaml, the two evidence copies above and `archive-manifest.json` with exact moved-file hashes.

## Closure validation

Archive-only verification passed on 2026-10-28: Python structural/hash/link/index checks; Bun `yaml.parse` for both state/event files; and `git diff --check` (all exit 0, combined shell execution about 0.14 s). Oracles: every original path must move, historical bytes must survive, existing promoted specs and unrelated work must stay unchanged, new local links must resolve, archive state must parse, and the index must match the before snapshot. All 26 original files moved; the 24 originals other than tasks.md remain byte-identical. No runtime tests were added or rerun for this documentation-only change. Evidence inputs are the archive manifests, new promoted specs and `/tmp/deck-archive-20261028/baseline.json`; source HEAD remains d639d93.
