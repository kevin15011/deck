# Archive report: session-skill-availability

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

- `004f42d`, `e40b0a2`: shared review policy, Codex enforcement checks, verified native role descriptors/selection and Codex bootstrap split.
- `ccfed70`, `8ac27d0`: shared bounded readiness/catalog/evidence, native delivery, authenticated Setup, OpenSpec additive repair and registry repair/refresh; Pi session driver and native Pi/OpenCode Setup.
- PQ3 typed Codebase omission preserves enabled intent and installed bytes, restricts omission to exact owned identities and permits ordinary work on independently evidenced unavailability. Quality attempt 10 identified PQ3-Q1; correction integration 90152 and 52 passing targeted checks closed it.
- Quality attempts 7/9 integrated the bounded RQ and earlier PQ corrections (integration 68433/78378). Their old PQ2 unavailability disposition was later revoked by the user.
- Quality attempt 16 closed the four attempt-15 findings: disabled search suppression, fresh native configuration, OpenCode lifecycle refresh and typed parity evidence. Quality attempt 19 accepted Slice 3 after attempts 17/18 corrections, including route binding and transport selection. Their reports explicitly exclude live model-backed acceptance.
- Quality attempt 21 closed the attempt-20 customized MCP subtree loss defect. Commit `0b70080` preserves complete customized MCP policy and uses local Context7. These were scoped reviews, not independent repetitions of the final full suite.

Durable evidence copies are in `handoff-evidence/archive-quality-16.txt`, `archive-quality-19.txt`, `archive-quality-21.txt` and `archive-final-gate.md`. Original Quality task: `task-7c45aa40-578d-43d0-ba38-41ae88e0ea70`. Existing historical handoffs remain preserved.

## Deferred or superseded acceptance

The complete historical S1–S8/R1–R5 checklists contain stronger live/native acceptance than the evidence establishes. The closure checklist in tasks.md records delivered outcomes; unchecked legacy tasks are not silently marked complete. Native Codex enforcement parity, native Claude/Codex repair authentication and final live consumption are accepted limitations. Production automatic project indexing and adaptive-memory redesign remain deferred. The old S7 no-Pi-driver fence is superseded by delivered Pi support.

## File inventory

Created `openspec/specs/session-skill-availability/spec.md`. Moved every file from `openspec/changes/session-skill-availability/` to `openspec/archive/2026-10-28-session-skill-availability/`. Updated only tasks.md within the original files. Added archive-report.md, state.yaml, events.yaml and the four evidence copies listed above. Exact moved-file inventory and hashes are in `archive-manifest.json`.

## Closure validation

Archive-only verification passed on 2026-10-28: Python structural/hash/link/index checks; Bun `yaml.parse` for both state/event files; and `git diff --check` (all exit 0, combined shell execution about 0.14 s). Oracles: every original path must move, historical bytes must survive, existing promoted specs and unrelated work must stay unchanged, new local links must resolve, archive state must parse, and the index must match the before snapshot. All 26 original files moved; the 24 originals other than tasks.md remain byte-identical. No runtime tests were added or rerun for this documentation-only change. Evidence inputs are the archive manifests, new promoted specs and `/tmp/deck-archive-20261028/baseline.json`; source HEAD remains d639d93.
