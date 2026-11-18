# Sprint 2 verification

Status: bounded S2 accepted by Lead at 105655 and installed on 2026-11-11 after the independent review's two corrections were verified. Current candidate is `183edadf…`, binary `3d2efe82…`. Existing live hosts were not restarted. Earlier candidate/review evidence below is retained as history, followed by the accepted correction record.

## Candidate and behavior

Apply Deep attempt 6 reports candidate `unborn-head:implementation-sha256:7356632304a6fc0c8ccec1f875278c62476bf8410edc2fdc36d713207ec17d86`, binary SHA-256 `47f89d4ae731073acda83f0a4a4b4e75801cce38726a0225ae4dd6b22ecefe64`. Lead independently matched all 71 implementation inputs, 22 embedded asset inputs and five bound evidence records, and preserved them under `target/review-s2-73566323/`. Lead-owned documentation is outside this implementation digest.

The supported journey is an explicit reviewed-edit mode for one existing ordinary UTF-8 file inside the selected project. The current target is limited to 64 KiB. Symlinks, hardlinks, binary targets, multi-file operations, rename/delete, broad shell grants and external writes are unavailable. Codex 0.166.0 remains in its read-only profile; each supported file escalation requires its own complete proposal and user decision.

Project trust enables the mode but grants no file effect. Informational answers grant nothing. The host persists action and native identities, response identity, grant consumption and dispatch intent separately from observed native/file settlement. Cancellation, revocation and restart cannot replay an uncertain response. Proposed and observed diffs are rendered as inert text. Schema 1 migrates transactionally to schema 2; unknown/corrupt state remains rejected.

## Reviewed evidence

The full owner handoff is `target/s2-verification/handoff.md`; `candidate.json`, `gates.json` and `evidence.json` bind the inputs and records. Lead read the material decision, native approval/control/event, migration and React review paths. Deck-next has no indexed graph project; exact project coverage reports unindexed, so source fallback was used.

| Check | Owner result |
|---|---|
| Rust formatting, Clippy and workspace tests | Passed; 29 tests, workspace test wall time 8.676 s |
| TypeScript and browser API checks | Passed; three API tests |
| Packaged build | Passed; reported 9.94 s is Rust release compilation time, not total build wall time |
| Real reviewed-edit browser journey | Passed in 40.755 s: deny, allow once, pending reload, cancel, observed diff, mobile draft and motion checks |
| Real informational question | Passed in 9.988 s; settled without a grant or file change |
| Read-only browser, input/auth and motion regressions | Passed against final binary; individual wall times were not captured |

Lead inspected the desktop pending-proposal and mobile cancelled-result screenshots. They show functional decisions within the retained Deck presentation; there is no claim of pixel parity with old approval screens. Native qualification records also show that a second patch requires fresh approval and a conflicting stale target remains unchanged by the proposed patch. Shell approval requests are denied; a default-sandbox diagnostic is not proof that its denied command executed inside a sandbox.

RED was captured for explicit mode admission before implementation. Other authority/fault tests were added alongside implementation; their independent oracles and coverage must be assessed without inventing prior failures. No tests were retired.

## Predecessor review

Lead's independent packaged replay passed in 42.498 seconds using `NODE_PATH=/home/kevin15011/deck-next/node_modules node scripts/reviewed-edit-acceptance.cjs` from the frozen snapshot. It exercised real native proposal, deny/allow once, pending reload, cancellation, observed diff, keyboard, mobile draft retention and reduced-motion/rapid reversal paths. Main and snapshot implementation inputs still matched afterward. `target/lead-s2-checks/result.json` binds the command, duration, candidate and hashed browser record; captures and fixture results are under `target/review-s2-73566323/target/s2-verification/`.

Apply Deep 6 is integrated at 102933 as a reviewed implementation candidate. Quality continues the same review task; installation and S2 acceptance remain pending that independent assessment. S1-Q07 remains open for actual Windows automatic browser authentication. Qualified Linux/manual-link entry does not resolve it.

Current bytes are checked immediately before releasing an approval, but this is not an atomic filesystem lock against other editors. Observed snapshots may include concurrent changes. No automatic rollback or reset is promised. S3 and later sprints are not delivered by this candidate.

## Quality review 10 — corrections required

Quality attempt 10 (103894/103895), integrated at 104027 after Lead rematched the candidate and inspected the cited paths, supports the approval architecture but requires the following narrow repairs before acceptance:

| Finding | Evidence and required correction | State |
|---|---|---|
| S2-Q01 | The actual Review component retained an answer identity before sending. A 2,000-character multibyte answer passed the input's character limit but exceeded the host's 4,096 UTF-8-byte limit; after HTTP rejection, correcting it to a short answer failed locally and reload preserved the blockage. Quality reproduced this with the actual component and fake HTTP. Validate bytes before retaining identity, and support correction only after authoritative evidence of non-acceptance. Generic failure or ambiguous delivery must retain identity. | Resolved at 105655 |
| S2-Q02 | Native file completion discarded snapshot-read errors and always claimed the current snapshot was observed. The browser called `after: null` not observed yet, including settled work. Source review confirmed this path. Preserve native outcome separately from unavailable comparison, carry a useful reason and present accurate settled-state recovery without claiming observation or rollback. | Resolved at 105655 |

Quality independently passed three browser API tests in 8 ms and reused matching broader records. Its read-only execution environment could not run Rust filesystem fixtures, so independent reviewed-edit/native contract and new counterexample execution remains assigned to Lead after repair. Existing Lead real-native/browser evidence remains valid for the predecessor, not an automatic pass for a changed candidate. S1-Q07 stays open independently.

## Accepted corrections and installation

Apply Deep 7 supplied candidate `unborn-head:implementation-sha256:183edadf212c5734ecb2cff87be002058c272ed6a481057ac9bb92134afa7e1d`, binary `3d2efe8288a0ae8494c552b7f7826fa91339414ff99a9e01b6e293c1a9a21919`. Lead matched all 72 implementation inputs, 22 asset hashes and the binary before and after independent checks, read the complete correction diff and preserved `target/review-s2-183edadf/`. The full correction handoff/gates are under `target/s2-corrections/`.

The browser validates UTF-8 size before retaining a new answer. The host emits an identity/revision-bound non-acceptance proof only for pre-persistence answer validation, after existing identity and ownership checks. Accepted conflicts, generic failures and ambiguous delivery retain the response identity. Legacy oversized retained answers recover only after explicit correction and authoritative rejection of the original payload. Optional `snapshot_error` preserves a failed post-edit read separately from native completion; old records remain readable.

Lead independently executed:

| Command / boundary | Result and wall time |
|---|---|
| `cargo test --locked -p deck2 --test reviewed_edits` | Eight tests passed, 1.699 s |
| `cargo test --locked -p deck2 --test contracts reviewed_edit_default` | Passed, 1.191 s |
| `cargo test --locked -p deck2 --test contracts rejected_answers` | Passed, 0.266 s |
| `node scripts/review-corrections.cjs answers` | Packaged React/HTTP with fake-native edge passed, 8.372 s |
| `node scripts/review-corrections.cjs snapshot` | Production event/HTTP/browser missing-file case passed, 2.968 s; screenshot inspected |
| `node scripts/reviewed-edit-acceptance.cjs --questions` | Real Codex/browser informational request passed, 9.893 s; no grant or file effect |

Each browser invocation used a distinct owned `DECK2_EVIDENCE_DIR`. Command/input-bound records are in `target/lead-s2-corrections/{rust,browser,real-canary}.json`. The owner also supplied 30 passing Rust tests, four API tests, static/build checks and real reviewed-edit/question acceptance on matching production inputs. Full-gate reuse after final test-only deltas is scoped explicitly in its `gates.json`; affected checks were rerun. Both counterexamples failed on the predecessor before repair. A real-browser readiness timeout is retained as a failed run; the corrected acceptance script waits for enabled Send, and the final real run passed.

Lead's correction review and missing independent executions satisfy Quality 10's requested follow-up; this is not a claim that Quality reviewed a later candidate. S2-Q01/Q02 were closed structurally at 105655 and the bounded S2 dependency accepted. S1-Q07 remains open; broad Windows/platform support and S3–S12 remain outside this acceptance.

The exact frozen binary was atomically installed at `/home/kevin15011/.local/bin/deck2`, with prior `c1bd9c4c…` preserved under `target/installed-backups/`. Version/help checks passed; `target/deck2-s2-install-evidence.json` records hashes and timestamp. No live host was restarted and installation itself did not open or migrate user state. Opening recognized S1 state with S2 migrates it to schema 2; the older binary backup does not make that migrated state backward-compatible.
