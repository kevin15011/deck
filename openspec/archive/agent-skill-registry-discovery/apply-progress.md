# Apply Progress: Agent Skill Registry Discovery

## Status

- Phase: Apply
- Status: Completed for evidence reconstruction; T-RR-V2E-001 evidence gap is satisfied by preserved actual plus isolated reconstructed RED; awaiting fresh V3
- Mode: Interactive
- Modification authorization recorded: 2026-07-23T14:18:56.114Z
- T-RR-V2E-001 authorization: user-authorized documentary evidence repair only; no source, test, behavior, Verify-report, Review-report, state, events, registry, or Git modification
- T-RR-V2E-002 authorization: user-authorized isolated RED reconstruction only; no real-repository source, test, behavior, Verify-report, Review-report, state, events, registry, or Git modification
- Historical T-RR-V2E-001 tasks digest: `sha256:8d89b50d402c95f63929a4a56f5f5f956e61e8701dfd5de8c4b3757bd3a982c3`
- Current authoritative tasks.md digest for T-RR-V2E-002: `sha256:88d5736dbd7cb36ae23b3397c662b9d263dd82cc3aa7235a93800c3b4f89c737`
- Historical V2 blocker input digest: `sha256:5c47d534f2b85ac735b24b9c2215345186803e323eae76643cd07b5e1fc6faae`
- Git actions: no commit or push authorized

## T-RR-008 Pre-Edit Holistic Trace

- **Authority:** T-RR-008 from `tasks.md` (`sha256:2466dcde4556c476c746dc753bc8d1dc570fb7aa9e0c0b182f07c8cb7b9fd0c5`); R3-001 from `review-report.md` (`sha256:5fdfc06e2c67f1ad23abf06d6f02942a2fb27b2e9540af8797536b78c6a8d048`). Historical V4 (`sha256:9caac8b110292a17780582fbc8ab43c91aa060af0d737d0db6976cf6c790ff6f`) is stale once this repair edit begins.
- **Provider ingress:** OpenCode `listSources` builds and appends filesystem/inventory bindings before returning `SkillDiscoverySourceSetV1`; Pi `listSources` builds its source array, derives diagnostics with `filter`/`map`, optionally appends an opaque source, and returns it. These are read-only upstream trace points; they are outside the exact T-RR-008 modification allowlist.
- **Discovery handoff:** `discoverSkillsFromProvider` awaits `provider.listSources()` and forwards the same `sourceSet`; `discoverSkills` validates `Array.isArray(sourceSet.sources)`, iterates the provider collection with `for...of`, applies T-RR-007's at-most-501 sentinel, copies/sorts at most 500 provider bindings, then active-runner filters and evaluates bindings. It separately spreads Core generic roots and sorts final observations. This confirms the upstream narrow bound does not normalize the collection for downstream consumers.
- **CLI sites:** `runSkillRegistryCommand` selects one active runner and obtains its provider; `runDiscover` uses `discoverSkillsFromProvider`; `runValidate` calls `readSkillRegistryStatus` with `evaluateCurrent`; `runRefresh` calls `evaluateCurrentSources` before any write. In `evaluateCurrentSources` (`apps/cli/src/skill-registry-command.ts:323-367`), `sourceSet.sources` is assigned directly to `sourceDeclarations`, the raw `sourceSet` is forwarded to discovery, and the same raw collection is passed to `canonicalizeSkillRegistry`. `isSourceSet` (`:377-379`) only performs an `Array.isArray` check and does not normalize or bound indexed access.
- **Registry sites:** `canonicalizeSkillRegistry` calls `canonicalSourceDeclarations` on the incoming source collection, iterates observations, sorts/retains records, and creates the document. `canonicalSourceDeclarations` (`packages/core/src/skill-discovery/registry.ts:816-829`) re-iterates raw inputs with `for...of`, copies declarations, and sorts them. `computeSkillRegistrySourceScopeHash` maps canonical declarations; `computeSkillRegistryFingerprint` spreads/maps/sorts records and calls source-scope hashing; `orderSkillRegistryRecords` spreads and sorts records. `readSkillRegistryStatus` calls `toCurrentSnapshot`, which can canonicalize a current evaluation/input again, then recomputes source-scope and record fingerprints. These are all reachable from CLI refresh/status and are the downstream R3-001 bypasses.
- **Adjacent-consumer audit:** A code-graph search for `sourceSet`, `sourceDeclarations`, raw `.sort()`, spread, map, slice, and source hashing within the exact four source/test files found no additional production source-set consumer beyond the sites listed above. The registry status, refresh, discover, and canonicalization paths were inspected together; no target expansion is required or authorized.
- **Required defense boundary:** Reuse `SKILL_DISCOVERY_V1_BOUNDS.maxCandidateRecords = 500`; normalize provider/source arrays through bounded indexed access before forwarding or retaining them, inspect at most 501 entries, retain/sort/hash at most 500, and propagate existing truncated/indeterminate vocabulary so clipping cannot yield complete/ready. The original custom iterator must not be invoked after normalization.

## T-RR-008 Actual RED (Before Production Edits)

- **Timestamp:** 2026-07-23 (Interactive Apply; immediately before production implementation).
- **CWD:** `/home/kevinlb/deck`
- **Exact command:** `bun test apps/cli/src/skill-registry-command.test.ts packages/core/src/skill-discovery/registry.test.ts`
- **Exit code:** `1`
- **Observed counts:** `21 pass / 4 fail / 101 expect() calls`
- **Exact failing output/behavior:**
  - `skill-registry CLI command > bounds source bindings end to end across discover, refresh, and status`: `expect(counters.iteratorCalls).toBe(0)` failed — `Expected: 0`, `Received: 1` at `apps/cli/src/skill-registry-command.test.ts:275:38`.
  - `skill-registry CLI command > never invokes a pathological source iterator on the composed CLI path`: `expect(refreshed.json).toMatchObject({ outcome: "committed", status: "ready" })` failed (`error: expect(received).toMatchObject(expected)`) because the current composed path invoked the pathological iterator and converted the provider failure into a rejected/indeterminate refresh.
  - `skill registry canonicalization > bounds source bindings end to end through canonicalization and status`: `expect(counters.iteratorCalls).toBe(0)` failed — `Expected: 0`, `Received: 1` at `packages/core/src/skill-discovery/registry.test.ts:160:40`.
  - `skill registry canonicalization > never invokes a pathological source iterator on the registry status path`: exact error `pathological iterator must not be invoked` at `packages/core/src/skill-discovery/registry.test.ts:551:43`, reached from `packages/core/src/skill-discovery/registry.test.ts:207:22`.
- **RED reason:** The tests fail on the intended R3-001 defect: the current implementation invokes the provider-owned custom iterator downstream instead of performing bounded indexed normalization. No production source edit had occurred when this command ran.

## T-RR-008 GREEN and Affected Evidence

- **Targeted GREEN:** CWD `/home/kevinlb/deck`; exact command `bun test packages/core/src/skill-discovery/registry.test.ts apps/cli/src/skill-registry-command.test.ts`; exit code `0`; `25 pass / 0 fail / 161 expect() calls`; `Ran 25 tests across 2 files.`
- **Full Core skill-discovery targeted suite:** CWD `/home/kevinlb/deck`; exact command `bun test packages/core/src/skill-discovery/discovery.test.ts packages/core/src/skill-discovery/persistence.test.ts packages/core/src/skill-discovery/registry.test.ts`; exit code `0`; `46 pass / 0 fail / 284 expect() calls`; `Ran 46 tests across 3 files.`
- **Affected CLI/OpenCode/Pi source-composition and registry-consumption suites:** CWD `/home/kevinlb/deck`; exact command `bun test apps/cli/src/skill-registry-command.test.ts packages/core/src/skill-discovery/discovery.test.ts packages/adapter-opencode/src/runner-adapter.test.ts packages/adapter-opencode/src/runner-adapter.inventory.test.ts packages/adapter-pi/src/runner-adapter.test.ts packages/adapter-pi/src/registry-consumption.test.ts`; exit code `0`; `68 pass / 0 fail / 372 expect() calls`; `Ran 68 tests across 6 files.`
- **Typecheck:** CWD `/home/kevinlb/deck`; exact command `bunx tsc --noEmit`; exit code `0`; no diagnostic output.
- **Allowlist diff check:** CWD `/home/kevinlb/deck`; exact command `git diff --check -- apps/cli/src/skill-registry-command.ts apps/cli/src/skill-registry-command.test.ts packages/core/src/skill-discovery/registry.ts packages/core/src/skill-discovery/registry.test.ts openspec/changes/agent-skill-registry-discovery/apply-progress.md`; exit code `0`; no output.
- **Bound proof:** CLI and registry end-to-end matrices passed at `499`, `500`, `501`, and `10,000` bindings. Indexed reads were exactly `min(count, 501)` per composed evaluation; no provider-owned iterator call occurred. Oversized inputs returned `truncated_output`/non-ready semantics and did not commit or report ready. The pathological throwing iterator was never invoked; each path performed only the bounded indexed read.

## T-RR-008 Final Scope and No-Bypass Audit

- **Changed targets:** exactly the four authorized source/test files plus this evidence file. No task/spec/design/review/verify/state/events file was edited; no generated/dependency file, shared registry YAML, `runner-capability-standardization`, or Git state was touched.
- **No-bypass result:** post-implementation graph/search and adjacent-consumer review found the CLI `runDiscover` wrapper and `evaluateCurrentSources` as the only source-set ingress paths in the CLI target, and registry normalization as the only source-declaration ingress before canonical declaration filtering. Raw source arrays are never iterated with `for...of`, spread, `.sort()`, `.map()`, `.filter()`, or hashed after the new boundary. Registry source hashing/fingerprinting receives only the bounded local declaration array. Generic Core roots, active-runner filtering, deterministic ordering, duplicate observations, and last-valid status behavior remain covered by the affected suites.
- **Worktree scope:** the initial and final audits contain the same pre-existing unallowlisted worktree paths; no forbidden target was introduced by T-RR-008. The only repair-owned targets are the exact allowlist above.
- **Final allowlist whitespace evidence:** scoped `git diff --check` exit code `0`; an additional exact-allowlist trailing-whitespace scan found `0` lines.
- **Authority/freshness digests:** tasks `sha256:2466dcde4556c476c746dc753bc8d1dc570fb7aa9e0c0b182f07c8cb7b9fd0c5`; R3 review `sha256:5fdfc06e2c67f1ad23abf06d6f02942a2fb27b2e9540af8797536b78c6a8d048`; historical V4 verify `sha256:9caac8b110292a17780582fbc8ab43c91aa060af0d737d0db6976cf6c790ff6f`.

## Batch Progress

| Batch | Tasks | Status | Evidence |
|---|---|---|---|
| 1 | T1 | Completed | RED missing skill-discovery module; GREEN adapter-registry 21/21; typecheck clean |
| 2 | T2, T5a, T5b | Completed | RED evidence per task; combined GREEN 28/28; affected adapter/core suites green; typecheck and diff-check clean |
| 3 | T3 | Completed | RED missing registry module; GREEN T3 8/8, affected 57/57, core 1536/1536; typecheck clean |
| 4 | T4, T6 | Completed | Writer 11/11 plus 14 failpoints; shared content 94/94 and Git safety 29/29; typecheck clean; downstream prompt fixture remains RED for T9 |
| 5 | T7, T8, T9, T10, T11, T11r, T12 | Completed | Task-level checks green; user-approved T11r repaired stale Pi oracle to 16/16; affected Pi checks 49/49; typecheck and diff-check clean |

## Deviations and Blockers

- Apply blocker: `packages/adapter-pi/src/registry-consumption.test.ts` still compares the Pi materialized prompt against core instructions without the newly required `{ activeRunnerId: "pi" }` discovery context. The production behavior matches T11; the stale test oracle is not included in any current task allowlist. A bounded task-plan amendment and separate authorization are required before editing it.
- Repair authorization: the user approved test-only task T11r; `tasks.md` now authorizes only `packages/adapter-pi/src/registry-consumption.test.ts` for this repair.
- Resolved: T11r updated the stale expectation without changing production behavior. All 36 modified paths are covered by the revised task allowlists; no unexpected files were found.

## Review Repair Progress

| Wave | Tasks | Status | Evidence |
|---|---|---|---|
| RR-1 | T-RR-001, T-RR-003, T-RR-004, T-RR-005 | Applied | Individual targeted checks green; integration fixture repaired by T-RR-001i |
| RR-2 | T-RR-002, T-RR-006, T-RR-001i | Applied | Targeted checks green: discovery 16/16, OpenCode 8/8, CLI 7/7; combined repair suite 65/65 |
| RR-4 | T-RR-V2E-002 | Completed | Four isolated reconstructed RED runs: T-RR-001 17/2, T-RR-003 13/1, T-RR-004 6/1, T-RR-005 12/1; real repository remained byte-identical for source/test files |

## Next Gate

- T-RR-V2E-002 is complete. Its four separately labeled `isolated reconstructed RED` runs satisfy the four unavailable RED anchors without rewriting the historical ledger.
- T-RR-V2E-001 evidence gap is satisfied by the preserved actual RED entries for T-RR-002, T-RR-006, and T-RR-001i plus the reconstructed entries below for T-RR-001, T-RR-003, T-RR-004, and T-RR-005.
- Fresh independent V3 is required next. R2 and broad checks remain blocked pending V3.

## Immutable RED Evidence Ledger (T-RR-V2E-001)

This ledger separates actual executed RED evidence from R1 inspection evidence, planned RED scenarios, and GREEN successor evidence. `null` and `unavailable` are intentional values: no count, command, output, or provenance is inferred when the immutable specialist/session anchor was not recovered. The ledger is bound to the preserved historical T-RR-V2E-001 tasks digest above and the historical V2 blocker digest above.

```json
{
  "ledger_version": "T-RR-V2E-001/RED-evidence-v1",
  "authority": "OpenSpec tasks.md and preserved specialist/session evidence; advisory memory was used only to locate evidence",
  "entries": [
    {
      "task_id": "T-RR-001",
      "finding_id": "R1-001",
      "red_evidence_status": "incomplete",
      "red_runs": [
        {
          "label": "repair-target RED",
          "executed_command": null,
          "command_status": "unavailable",
          "observed_pass_count": null,
          "observed_fail_count": null,
          "observed_result": "Unavailable: no immutable specialist phase return or saved session anchor preserving the executed command and count was recovered.",
          "failing_assertion_output_behavior": "Unavailable as executed output. The planned defect was omission of project-agents-skills and project-generic-skills from production composition, but tasks.md planned RED text is not execution evidence.",
          "limitation": "The V2 report records a non-authoritative /tmp/opencode/t-rr-001-red.log summary of 16 pass / 2 fail; it is explicitly excluded and is not recorded as official RED evidence."
        }
      ],
      "planned_red_command_not_execution_evidence": "bun test packages/adapter-opencode/src/runner-adapter.test.ts packages/adapter-pi/src/runner-adapter.test.ts",
      "specialist_provenance": "deck-developer-apply-backend, RR-Wave 1; saved specialist session summaries preserve the GREEN repair result but not an immutable RED command/count/output anchor",
      "official_anchors": {
        "task": "tasks.md § T-RR-001, lines 621-641",
        "requirements": ["REQ-008", "REQ-031"],
        "tests": ["packages/core/src/skill-discovery/discovery.test.ts", "packages/adapter-opencode/src/runner-adapter.test.ts", "packages/adapter-pi/src/runner-adapter.test.ts"]
      },
      "green_successor_evidence": {
        "observed_result": "31/31 preserved in the specialist/session GREEN summary",
        "exact_command": null,
        "command_limitation": "The preserved GREEN summary does not retain the exact command."
      }
    },
    {
      "task_id": "T-RR-002",
      "finding_id": "R1-002",
      "red_evidence_status": "actual-executed",
      "red_runs": [
        {
          "label": "focused RED",
          "executed_command": "bun test packages/core/src/skill-discovery/discovery.test.ts",
          "command_status": "preserved",
          "observed_pass_count": 13,
          "observed_fail_count": 3,
          "observed_result": "13 pass / 3 fail",
          "failing_assertion_output_behavior": "Filesystem width performed unbounded work; the opaque iterator consumed 10,000 observations instead of stopping at 501; diagnostics consumed 1,000 entries instead of stopping at 51.",
          "provenance": "Current-session immutable T-RR-002 specialist result supplied in the delegation; Interactive backend Apply phase"
        }
      ],
      "specialist_provenance": "deck-developer-apply-backend, RR-Wave 2; current-session immutable RED result and saved specialist execution evidence",
      "official_anchors": {
        "task": "tasks.md § T-RR-002, lines 643-663",
        "requirements": ["REQ-022", "REQ-032"],
        "tests": ["packages/core/src/skill-discovery/discovery.test.ts"]
      },
      "green_successor_evidence": {
        "exact_command": "bun test packages/core/src/skill-discovery/discovery.test.ts",
        "observed_result": "16/16 pass; 90 assertions",
        "source": "Current-session immutable T-RR-002 specialist result"
      }
    },
    {
      "task_id": "T-RR-003",
      "finding_id": "R1-003",
      "red_evidence_status": "incomplete",
      "red_runs": [
        {
          "label": "repair-target RED",
          "executed_command": null,
          "command_status": "unavailable",
          "observed_pass_count": null,
          "observed_fail_count": null,
          "observed_result": "Unavailable: no immutable specialist phase return or saved session anchor preserving the executed command/count was recovered.",
          "failing_assertion_output_behavior": "Unavailable as executed output. The planned defect concerned tampered records, mismatched observation IDs, malformed timestamp/digest metadata, and stale source-scope hashes being accepted as ready; tasks.md planned RED text is not execution evidence.",
          "limitation": "The saved specialist/session evidence preserves the GREEN result but not the actual RED command/count/output anchor."
        }
      ],
      "planned_red_command_not_execution_evidence": "bun test packages/core/src/skill-discovery/registry.test.ts",
      "specialist_provenance": "deck-developer-apply-backend, RR-Wave 1; saved specialist session evidence preserves the GREEN result but not an immutable RED anchor",
      "official_anchors": {
        "task": "tasks.md § T-RR-003, lines 665-685",
        "requirements": ["REQ-003", "REQ-004", "REQ-012", "REQ-029"],
        "tests": ["packages/core/src/skill-discovery/registry.test.ts"]
      },
      "green_successor_evidence": {
        "observed_result": "14/14 preserved in the specialist/session GREEN summary",
        "exact_command": null,
        "command_limitation": "The preserved GREEN summary does not retain the exact command."
      }
    },
    {
      "task_id": "T-RR-004",
      "finding_id": "R1-004",
      "red_evidence_status": "incomplete",
      "red_runs": [
        {
          "label": "repair-target RED",
          "executed_command": null,
          "command_status": "unavailable",
          "observed_pass_count": null,
          "observed_fail_count": null,
          "observed_result": "Unavailable: no immutable specialist phase return or saved session anchor preserving the executed command/count was recovered.",
          "failing_assertion_output_behavior": "Unavailable as executed output. R1 inspection evidence shows that an existing readable empty .gitignore was collapsed with missing/unreadable text and blocked refresh; that inspection evidence is not an executed RED result.",
          "limitation": "The T-RR-004 task subsection preserves the finding but not an actual RED command/count/output block. The saved specialist/session evidence preserves the GREEN result only."
        }
      ],
      "planned_red_command_not_execution_evidence": "bun test apps/cli/src/skill-registry-command.test.ts",
      "specialist_provenance": "deck-developer-apply-backend, RR-Wave 1; saved specialist session evidence preserves the GREEN result but not an immutable RED anchor",
      "official_anchors": {
        "task": "tasks.md § T-RR-004, lines 687-695 (finding/serialization anchor)",
        "review_finding": "review-report.md § R1-004, lines 82-90",
        "requirements": ["REQ-020"],
        "tests": ["apps/cli/src/skill-registry-command.test.ts"]
      },
      "green_successor_evidence": {
        "observed_result": "7/7 preserved in the specialist/session GREEN summary",
        "exact_command": null,
        "command_limitation": "The preserved GREEN summary does not retain the exact command."
      }
    },
    {
      "task_id": "T-RR-005",
      "finding_id": "R1-005",
      "red_evidence_status": "incomplete",
      "red_runs": [
        {
          "label": "repair-target RED",
          "executed_command": null,
          "command_status": "unavailable",
          "observed_pass_count": null,
          "observed_fail_count": null,
          "observed_result": "Unavailable: no immutable specialist phase return or saved session anchor preserving the executed command/count was recovered.",
          "failing_assertion_output_behavior": "Unavailable as executed output. R1 inspection evidence describes candidate bytes remaining after failed restoration and possible .gitignore truncation during whole-file write; that inspection evidence is not an executed RED result.",
          "limitation": "The saved specialist/session evidence preserves the GREEN result and repair scope but not an actual RED command/count/output anchor."
        }
      ],
      "planned_red_command_not_execution_evidence": "bun test packages/core/src/skill-discovery/persistence.test.ts",
      "specialist_provenance": "deck-developer-apply-backend, RR-Wave 1; saved specialist session evidence preserves the GREEN result but not an immutable RED anchor",
      "official_anchors": {
        "task": "tasks.md § T-RR-005, lines 697-717",
        "review_finding": "review-report.md § R1-005, lines 92-103",
        "requirements": ["REQ-017", "REQ-018", "REQ-020"],
        "tests": ["packages/core/src/skill-discovery/persistence.test.ts"]
      },
      "green_successor_evidence": {
        "observed_result": "13/13 targeted; 40/40 affected, preserved in the specialist/session GREEN summary",
        "exact_command": null,
        "command_limitation": "The preserved GREEN summary does not retain the exact command."
      }
    },
    {
      "task_id": "T-RR-006",
      "finding_id": "R1-006",
      "red_evidence_status": "actual-executed",
      "red_runs": [
        {
          "label": "focused RED",
          "executed_command": "bun test packages/adapter-opencode/src/runner-adapter.test.ts",
          "command_status": "preserved",
          "observed_pass_count": 7,
          "observed_fail_count": 1,
          "observed_result": "7 pass / 1 fail",
          "failing_assertion_output_behavior": "After the opaque exposure was removed, resolve-time verification still returned `available` from the stale cached inventory.",
          "provenance": "Current-session immutable T-RR-006 specialist result supplied in the delegation; Interactive Apply phase"
        }
      ],
      "specialist_provenance": "deck-developer-apply-backend, RR-Wave 2; current-session immutable RED result and saved specialist execution evidence",
      "official_anchors": {
        "task": "tasks.md § T-RR-006, lines 719-739",
        "requirements": ["REQ-014"],
        "tests": ["packages/adapter-opencode/src/runner-adapter.test.ts"]
      },
      "green_successor_evidence": {
        "exact_command": "bun test packages/adapter-opencode/src/runner-adapter.test.ts",
        "observed_result": "8/8 pass",
        "source": "Current-session immutable T-RR-006 specialist result"
      }
    },
    {
      "task_id": "T-RR-001i",
      "finding_id": "R1-001/R1-004 integration",
      "red_evidence_status": "actual-executed-with-aggregate-limitation",
      "red_runs": [
        {
          "label": "focused RED",
          "executed_command": "bun test apps/cli/src/skill-registry-command.test.ts",
          "command_status": "preserved",
          "observed_pass_count": 3,
          "observed_fail_count": 4,
          "observed_result": "3 pass / 4 fail",
          "failing_assertion_output_behavior": "The fake adapter still declared `.skills` after Core owned the generic `.skills` root, producing duplicate physical-root/source semantics, stale candidate_count expectations, and refresh rejection.",
          "provenance": "Current-session immutable T-RR-001i specialist result supplied in the delegation; test-only Interactive Apply phase"
        },
        {
          "label": "inherited combined RED",
          "executed_command": null,
          "command_status": "unavailable",
          "observed_pass_count": 61,
          "observed_fail_count": 4,
          "observed_result": "61 pass / 4 fail",
          "failing_assertion_output_behavior": "All four failures were in the CLI fixture path for the same duplicate `.skills` declaration and stale candidate_count/refresh expectations.",
          "limitation": "The aggregate count is preserved by the current-session result and tasks.md lines 745 and 754, but the exact aggregate command/output is not preserved; no command is inferred."
        }
      ],
      "specialist_provenance": "deck-developer-apply-backend, RR-Wave 2; current-session immutable focused and inherited RED results plus saved test-only session evidence",
      "official_anchors": {
        "task": "tasks.md § T-RR-001i, lines 741-760",
        "requirements": ["REQ-005", "REQ-008", "REQ-031"],
        "tests": ["apps/cli/src/skill-registry-command.test.ts"]
      },
      "green_successor_evidence": {
        "exact_command": "bun test apps/cli/src/skill-registry-command.test.ts",
        "observed_result": "CLI 7/7; inherited combined repair suite 65/65",
        "command_limitation": "The exact aggregate command is not preserved; the focused CLI command and both counts are preserved.",
        "behavior": "The fixture uses the active-runner-specific `.opencode-fixture-skills` provider root; Core retains ownership of generic `.agents` and `.skills`; production duplicate observations are not merged."
      }
    }
  ]
}
```

### Documentary repair disposition

- T-RR-002, T-RR-006, and T-RR-001i have preserved actual RED facts in the ledger; T-RR-001i has an explicit unavailable aggregate-command limitation.
- T-RR-001, T-RR-003, T-RR-004, and T-RR-005 have truthful ledger rows but their actual RED command/count/output anchors could not be recovered from preserved specialist/session evidence. Their task-plan and R1 inspection text is explicitly not promoted to executed RED evidence.

## Isolated Reconstructed RED Evidence (T-RR-V2E-002)

This section is a separate evidence class. It does not rewrite, backfill, or relabel the historical T-RR-V2E-001 ledger above. Every entry below is explicitly **isolated reconstructed RED**, produced by applying one defect-reintroducing mutation to an independent copy of the current repaired repository. It is not original historical execution and does not recover original timestamps or original specialist counts.

- **Task:** `T-RR-V2E-002`
- **Label:** `isolated reconstructed RED`
- **Current tasks.md digest:** `sha256:88d5736dbd7cb36ae23b3397c662b9d263dd82cc3aa7235a93800c3b4f89c737`
- **Disposable root:** `/tmp/opencode/T-RR-V2E-002.3S0EoR/`
- **Copy method:** one pristine current repository copy at `base/`; each defect used a fresh independent case copy (`rr-001`, `rr-003`, `rr-004`, `rr-005`). No Git metadata was copied or used, no network/package installation occurred, and package resolution used the copied existing `node_modules` context.
- **Pristine temp source/test digest (each case):** 454 files, 5,744,140 bytes, manifest `sha256:28c0af7d9d2ad37de3d4b0fd6274caa6ade5fbb762729d085e9df817ceec8a89`.
- **Real-repository pre/post source/test digest:** 454 files, 5,744,140 bytes; pre-anchor and post-reconstruction manifest both `sha256:28c0af7d9d2ad37de3d4b0fd6274caa6ade5fbb762729d085e9df817ceec8a89` — byte-identical.
- **Real-repository source/test scope definition:** all regular code files under `apps`, `packages`, `scripts`, and `tests`/`test`/`src` paths, plus test/spec-named code files; `.git`, `node_modules`, build/cache directories excluded.
- **Execution rule:** each RED command below ran only against its mutated disposable case. The current real repository was not reverse-patched.

### T-RR-001 / R1-001 — Core generic project roots omitted

- **Mapping:** T-RR-001; R1-001; REQ-008 and REQ-031; R1 code anchor `packages/core/src/skill-discovery/discovery.ts`, `discoverSkills`, current repaired `const bindings` at line 221 and Core generic-root spread at line 222.
- **Pristine case:** `/tmp/opencode/T-RR-V2E-002.3S0EoR/rr-001`; target `packages/core/src/skill-discovery/discovery.ts`; target digest before mutation `sha256:aae6151a62c7d66ede0ca3f519f688a96377543d16aa3fc8585ff6935ad62ae5`.
- **Exact mutation:** removed only `...createCoreGenericProjectSources(canonicalProjectRoot),` from the `discoverSkills` bindings array. The selected-runner provider source filter and deterministic sort were left unchanged. This reintroduced the R1 production-composition omission of `project-agents-skills` and `project-generic-skills` without changing adapter-owned runner source behavior.
- **Mutated case digest:** source/test manifest `sha256:90e9130d49a5925a4aa35a9a573c4c8b56c4c8470954235129b4e84a94ad763a` (454 files, 5,744,078 bytes); target digest `sha256:98a9c498abc47cb36fb172a833743de52847b7185b3a5f3ccbb2699cdedccc06`.
- **Exact RED execution:** cwd `/tmp/opencode/T-RR-V2E-002.3S0EoR/rr-001`; command `bun test packages/adapter-opencode/src/runner-adapter.test.ts packages/adapter-pi/src/runner-adapter.test.ts`; exit code `1`.
- **Observed result:** `17 pass / 2 fail` (`35` assertions were not used as a pass-count substitute). Failed tests were exactly `OpenCode RunnerAdapter developer team install plan > composes Core generic roots with OpenCode sources and excludes Pi roots` and `Pi active-runner skill discovery provider > composes Core generic roots with Pi sources and excludes OpenCode roots`.
- **Failing-output anchor:** the composition assertions expected `generic-agents` and `generic-skills`; the received arrays omitted both (`Expected - 2`, `Received + 0`). The other 17 adapter tests passed, including active-runner source behavior. No package-resolution, type, or unrelated adapter failure occurred in the mandated targeted command.

### T-RR-003 / R1-003 — Stored registry fingerprint trusted without parsed-metadata recomputation

- **Mapping:** T-RR-003; R1-003; REQ-003, REQ-004, REQ-012, and REQ-029; R1 code anchors `packages/core/src/skill-discovery/registry.ts`, `parseSkillRegistryDocument` and `readSkillRegistryStatus`, current repaired stored-fingerprint computation at line 564.
- **Pristine case:** `/tmp/opencode/T-RR-V2E-002.3S0EoR/rr-003`; target `packages/core/src/skill-discovery/registry.ts`; target digest before mutation `sha256:cb89c208dacc3a6486262d2675d8154934ed04616ba875eec75e649e8d460d02`.
- **Exact mutation:** replaced the parsed-record recomputation block in `readSkillRegistryStatus` with `const storedFingerprint = parsed.frontmatter.fingerprint;`. Observation-ID validation, digest-shape checks, timestamp checks, source-scope comparison, and current-snapshot recomputation remained enabled. This is the smallest mutation that restores the R1 stored-fingerprint/metadata self-consistency trust gap.
- **Mutated case digest:** source/test manifest `sha256:6a3eac655278703a9e540358ccff9f5e31dbee2f00e797dbb0eecfcb0eb844e6` (454 files, 5,743,979 bytes); target digest `sha256:155ead35972cac7301e3aa4d155fb1dbc0f74b86575ff9291ab9829228dcf981`.
- **Exact RED execution:** cwd `/tmp/opencode/T-RR-V2E-002.3S0EoR/rr-003`; command `bun test packages/core/src/skill-discovery/registry.test.ts`; exit code `1`.
- **Observed result:** `13 pass / 1 fail`, `58 expect()` calls. The only failed test was `skill registry parser and read-only status > rejects a tampered authoritative record even when the stored fingerprint is unchanged`.
- **Failing-output anchor:** `Expected: "stale"`; `Received: "ready"`; assertion at `packages/core/src/skill-discovery/registry.test.ts:193:27`. This proves the dedicated tamper test detects the exact trust gap; no package-resolution, type, or unrelated registry failure occurred.

### T-RR-004 / R1-004 — Empty readable `.gitignore` collapsed to unavailable

- **Mapping:** T-RR-004; R1-004; REQ-020; R1 code anchor `apps/cli/src/skill-registry-command.ts`, `readRefreshSnapshots`, current repaired guard at line 406.
- **Pristine case:** `/tmp/opencode/T-RR-V2E-002.3S0EoR/rr-004`; target `apps/cli/src/skill-registry-command.ts`; target digest before mutation `sha256:acbc7257241f8be634d9301e374256fd65bd60a7142e9d4aaad37f56024cd338`.
- **Exact mutation:** changed only the `readRefreshSnapshots` guard from `ignore.snapshot.text === undefined` to `!ignore.snapshot.text`; the later possible-target calculation guard was left unchanged. This exactly reintroduced the falsy empty-string defect identified by R1-004.
- **Mutated case digest:** source/test manifest `sha256:4c9f8ab15222409a3bf17542258c5acc41b3208a0dfc14e7f43c95495392922d` (454 files, 5,744,127 bytes); target digest `sha256:a738b8ab7ff0151aca73f4390c3c1a1366776896f6e02b21cd381ef1c6507463`.
- **Exact RED execution:** cwd `/tmp/opencode/T-RR-V2E-002.3S0EoR/rr-004`; command `bun test apps/cli/src/skill-registry-command.test.ts`; exit code `1`.
- **Observed result:** `6 pass / 1 fail`, `32 expect()` calls. The only failed test was `skill-registry CLI command > refreshes with an existing empty .gitignore`.
- **Failing-output anchor:** at `apps/cli/src/skill-registry-command.test.ts:114:29`, `Expected: 0`, `Received: 1`. The empty-readable-ignore refresh test alone detected the defect; no package-resolution, type, or unrelated CLI failure occurred.

### T-RR-005 / R1-005 — Restoration failure reported as an ordinary rejection

- **Mapping:** T-RR-005; R1-005; REQ-017, REQ-018, and REQ-020; R1 code anchors `packages/core/src/skill-discovery/persistence.ts`, `commitWrite` and `restorePriorRegistry`, current recovery-gated return at line 367.
- **Pristine case:** `/tmp/opencode/T-RR-V2E-002.3S0EoR/rr-005`; target `packages/core/src/skill-discovery/persistence.ts`; target digest before mutation `sha256:8af1a34b359024dd58b93607cccc91fd7da9ce1750ee1b9a9cb86bf43594e79f`.
- **Exact mutation:** changed only the restoration-failure return from `return rejected("recovery_required", [` to `return rejected(primaryReason, [` inside `commitWrite`. Atomic replacement, backup restoration attempt, preservation-safe `.gitignore` replacement, and all other persistence paths remained unchanged. This reintroduced the R1 recovery gap: candidate bytes can remain after a failed restore while the result reports a normal rejection instead of recovery-required state.
- **Mutated case digest:** source/test manifest `sha256:5943c7c91d0d5f1465ad9261edc17523582f75d5c74366d835551bc947b26f07` (454 files, 5,744,134 bytes); target digest `sha256:794c3744dd5b001f993af5361e540530bfa7f2dccbce2d8ab75355be4d4621ec`.
- **Exact RED execution:** cwd `/tmp/opencode/T-RR-V2E-002.3S0EoR/rr-005`; command `bun test packages/core/src/skill-discovery/persistence.test.ts`; exit code `1`.
- **Observed result:** `12 pass / 1 fail`, `96 expect()` calls. The only failed test was `authorized skill registry persistence > surfaces recovery-required when restoring the prior registry fails`.
- **Failing-output anchor:** at `packages/core/src/skill-discovery/persistence.test.ts:306:32`, `Expected: "recovery_required"`, `Received: "directory_sync_failed"`. The fault-injection test detected the exact recovery-reporting gap; no package-resolution, type, or unrelated persistence failure occurred.

### Reconstructed RED disposition and GREEN successor evidence

- The four reconstructed failures are independently attributable to the four named R1 defects and each uses one isolated mutation. No combined mutation was used, and no reconstructed result is presented as historical RED.
- Unchanged real-repository GREEN successor checks, run after all reconstructions, passed: discovery plus OpenCode/Pi adapters `35/35` tests and `0` failures; registry `14/14`; CLI `7/7`; persistence `13/13`; `bunx tsc --noEmit` exited successfully with no diagnostics.
- The historical T-RR-V2E-001 limitations remain intact above: T-RR-001, T-RR-003, T-RR-004, and T-RR-005 still state that original specialist command/count/output anchors were unavailable. The reconstructed entries satisfy the evidence gap only as newly labeled isolated evidence.
- T-RR-V2E-001 is therefore marked satisfied by the preserved actual entries for T-RR-002, T-RR-006, and T-RR-001i plus these four reconstructed entries. V3 may use this ledger, subject to its independent freshness and scope checks.
- Temporary residue disposition: the disposable root and all case copies/logs were removed after the final repository audit; `/tmp/opencode` remains as the verified intended parent and no matching `T-RR-V2E-002` residue remains.
- Historical T-RR-V2E-001 disposition before reconstruction: incomplete and blocking; that limitation is retained as historical context. The current evidence gap is satisfied by the separate T-RR-V2E-002 section above. No source, test, behavior, Verify-report, Review-report, state, events, shared-registry, generated, or Git content was changed.

## T-RR-007 / R2-001 — Actual RED Evidence

- **Authority and anchors:** T-RR-007; R2-001; REQ-016; REQ-022; Design `Exact V1 Bounds`, `Bounded discovery`, and startup denial-of-service mitigation; prior T-RR-002 completion obligation that no unbounded allocation/sort/retention path remains. The authoritative task plan digest at execution start was `sha256:a2cb7baedeab3abf6a4d04fd7154d2fac463e6c71089ba20828605a8fc31194b`; the immutable R2 input was `sha256:136b0ede2f4aa64b5c5822690fd401908136c9133072661172356cc108d938c6`.
- **Exact RED execution:** cwd `/home/kevinlb/deck`; command `bun test packages/core/src/skill-discovery/discovery.test.ts`; exit code `1`; targeted test file was modified only to add the T-RR-007 adversarial source-binding-width test before production editing.
- **Observed result:** `16 pass / 1 fail`; `91 expect()` calls; `17` tests across one file.
- **Failing-output anchor:** the new test `bounded skill discovery > bounds provider source-binding width before copy, sort, and active-runner filtering` expected the `above` (`maxCandidateRecords + 1`) and `very-large` (`maxCandidateRecords * 20`) all-other-runner source sets to return `indeterminate` with `truncated_output`, but the current implementation returned `complete` with no reason code for both cases. Bun reported:

  ```text
  Expected: outcome "indeterminate", reasonCode "truncated_output"
  Received: outcome "complete", reasonCode undefined
  ```

- **Failure meaning:** source-set width was copied/sorted in full before active-runner filtering, so the new below/at/above/very-large deterministic work-counter test reproduced R2-001's unbounded provider source-binding path. No production file had been edited when this RED evidence was recorded.

## T-RR-007 / R2-001 — GREEN and Affected Evidence

- **Chosen existing authority:** `SKILL_DISCOVERY_V1_BOUNDS.maxCandidateRecords` (`500`) is the existing authoritative V1 candidate/count bound from `contracts.ts`, Design `Exact V1 Bounds`, REQ-016's same I/O/count-bound requirement, and REQ-022's maximum candidate count. No new constant, public contract, status, reason code, trust/ranking behavior, or cross-runner scan was introduced. The existing `candidate_limit_reached` diagnostic and `truncated_output` result vocabulary are reused.
- **Production repair:** provider bindings are consumed through a bounded loop before provider-array copying/sorting, declaration validation, or active-runner filtering. The loop consumes at most `maxCandidateRecords + 1` source bindings to detect overflow, records `candidate_limit_reached`, marks the result truncated, and stops. Only the bounded accepted prefix is copied into a local array and deterministically sorted; Core generic roots remain canonical and provider duplicates of their IDs remain excluded. Active-runner filtering and all downstream filesystem/opaque work remain unchanged.
- **Exact GREEN targeted execution:** cwd `/home/kevinlb/deck`; command `bun test packages/core/src/skill-discovery/discovery.test.ts`; exit code `0`; `17 pass / 0 fail`; `94 expect()` calls; `17` tests across one file.
- **Adversarial boundary evidence:** the all-other-runner source-set matrix passed for below (`499`), at (`500`), above (`501`), and very-large (`10,000`) bindings. Below/at remained `complete`; above/very-large became `indeterminate/truncated_output`. Deterministic counters confirmed source-array reads and iterator yields never exceeded `501`, and the provider array's `filter` accessor was never used (`0`) in every case.
- **Exact GREEN affected-area execution:** cwd `/home/kevinlb/deck`; command `bun test packages/adapter-opencode/src/runner-adapter.test.ts packages/adapter-pi/src/runner-adapter.test.ts apps/cli/src/skill-registry-command.test.ts`; exit code `0`; `26 pass / 0 fail`; `127 expect()` calls; `26` tests across three files.
- **Exact GREEN typecheck:** cwd `/home/kevinlb/deck`; command `bunx tsc --noEmit`; exit code `0`; no output/diagnostics.
- **Exact GREEN diff check:** cwd `/home/kevinlb/deck`; command `git diff --check`; exit code `0`; no output.
- **Scope/check boundary:** no broad test was run. Only `packages/core/src/skill-discovery/discovery.ts`, `packages/core/src/skill-discovery/discovery.test.ts`, and this `apply-progress.md` were edited during T-RR-007; no other source/test/OpenSpec/state/events/generated/registry/Git target was edited.

## T-RR-009 — Blocked Before RED (Design-Instruction Ambiguity)

- **Authority:** T-RR-009 from `tasks.md` (`sha256:56e00ef56deb8c42699381ac6dc80128e7b2bb6acbd773c0de2d94e8e767d1df`); R4-001 from Review R4 (`sha256:7ff17878c4c18849d5940695f048fd027d1ce8dd4a9b1a1adb732c406a3eed5d`); V5 (`sha256:208c5bd670b6f264db23a86f7043ed29d8f7bdd86eee03853e9651adc929b870`).
- **Mode and decision:** Interactive Apply stopped before source/test edits with `design-instruction-ambiguous`. No RED test was added or executed, so no RED count/failure is claimed and no GREEN/affected evidence is claimed.
- **Holistic trace:** `apps/cli/src/skill-registry-command.ts:409-457` (`evaluateCurrentSources`) receives the active provider source set, normalizes it in the disallowed CLI file, passes that provider-only array to `discoverSkills` and `canonicalizeSkillRegistry`, and returns that same provider-only declaration array. Core discovery composes generic bindings separately at `packages/core/src/skill-discovery/discovery.ts:237-239` through the private `createCoreGenericProjectSources` factory at `:289-293`. Registry canonicalization at `registry.ts:155-218` only normalizes its incoming declarations; `normalizeSourceInputs` (`:827-853`) performs bounded indexed access, `normalizeSourceDeclarations` (`:855-871`) filters/copies/sorts, and `isSafeSourceDeclaration` (`:888-897`) rejects slash-bearing project-relative bases through `SAFE_TOKEN_PATTERN`.
- **Integrity path traced:** `computeSkillRegistrySourceScopeHash` (`registry.ts:240-252`) hashes only declarations surviving registry normalization; `computeSkillRegistryFingerprint` (`:255-282`) binds that same incomplete source scope; `createFrontmatter` (`:597-629`) records both values; `toCurrentSnapshot` (`:1282-1314`) re-canonicalizes current evaluations; and `readSkillRegistryStatus` (`:479-592`) compares stored scope hash, stored recomputed fingerprint, and current fingerprint before returning `ready/fingerprint_match`. The current mismatch is therefore provider-only source-scope input plus rejection of `.agents/skills`, `.skills`, and Pi `.pi/skills`, allowing incomplete scope metadata to participate in a ready comparison.
- **Canonical-reuse blocker:** the only T-RR-001 Core generic-source factory is private to the disallowed `discovery.ts`; it is not exported or otherwise reachable from the exact two-file allowlist. The production composition function named by T-RR-009 is in the disallowed CLI file. Completing the repair would therefore require either editing a blocked file to expose/pass the canonical factory output, duplicating the generic-root definitions in `registry.ts`, or changing the approved public contract. T-RR-009 explicitly forbids all three alternatives.
- **Current authoritative probe values:** R4 records provider-only `source_scope_hash = sha256:293666847f6b150e6a5f892790db2b88dd12e4c224a76be062f8f939142a5408`; the Design-prescribed complete generic-plus-active-runner payload is `sha256:8bd876b10a1172ffa80f40cf76f377932c814ea4af664c5f4274996b2eb0032d`. These values are reported as immutable prior evidence, not as RED evidence from this blocked attempt.
- **Locator validation matrix at the stop:** `.agents/skills` — rejected; `.skills` — rejected; `.pi/skills` — rejected; `.opencode/skills` — rejected; absolute paths, traversal segments, empty/ambiguous values, backslashes, and escapes — rejected; token-safe runner-relative values — accepted when all other declaration fields are valid. No validator change was made.
- **Preservation audit:** T-RR-008's existing bounded indexed normalization and 499/500/501/pathological-iterator behavior was not modified or re-run in this blocked attempt. No active-runner filtering, duplicate-observation, deterministic-ordering, status/reason vocabulary, or last-valid behavior was changed.
- **Scope evidence:** no source or test file was modified; only this evidence section was appended to the allowlisted `apply-progress.md`. No task/spec/design/review/verify/state/events/generated/dependency/shared-registry/Git/network/excluded-target effect occurred. No broad check was run. The supplied V5 report remains the prior immutable verification input; no fresh V6 evidence exists.

## T-RR-009 — Actual RED Evidence (Five-File Re-Authorization)

- **Authority:** Revised tasks digest `sha256:ba63f37b4eab65a8f3dea3a245926c66a8834aac781c7505bfdd6d7e945e51aa`; prior blocked apply-progress base `sha256:8b5135dfb441e3a4b3b7ac4c26fcccce952b23566e049e25f9703529b434de0e`; R4 `sha256:7ff17878c4c18849d5940695f048fd027d1ce8dd4a9b1a1adb732c406a3eed5d`.
- **Timestamp/context:** 2026-07-24, Interactive Apply; RED tests were added to both allowlisted test files before any production edit.
- **Exact RED execution:** cwd `/home/kevinlb/deck`; command `bun test packages/core/src/skill-discovery/registry.test.ts apps/cli/src/skill-registry-command.test.ts`; exit code `1`.
- **Observed result:** `25 pass / 7 fail`; `172 expect()` calls; `Ran 32 tests across 2 files. [2.40s]`.
- **Failing behavior:**
  - OpenCode complete source-scope oracle expected `sha256:18c7b581942f33f366740594478b7935274ca798d34cf0aa4de2c8fb84660545`, received provider-only `sha256:0533d26cff4b56bd7b25f41598db026c8473440dec159e83f788e4108d76f810`.
  - Pi complete source-scope oracle expected `sha256:db86a369c6ec8d342cbdd4e0d452f1f401c66dec2127de57c9460a451340450c`, received `sha256:8bf873c668ad746ad45e81080fc85df3908320bb8f3cb02915bc3f20cc1e205a`.
  - CLI provider-only stored registry returned `ready` instead of the expected `stale/fingerprint_mismatch`.
  - Registry rejected valid `.agents/skills`, `.skills`, `.pi/skills`, and `.opencode/skills` bases; the valid-base assertion received an empty canonical declaration set.
  - Registry active-runner canonical-scope assertion received no declarations instead of generic plus selected OpenCode declarations.
  - Registry provider-only stored-scope test expected `stale`, received `ready`.
- **Failure meaning:** the RED failures reproduce R4-001: production CLI hashing omits Core generic declarations, registry validation rejects valid slash-bearing project-relative bases, and provider-only metadata can still classify as ready. No production source edit had occurred when this RED command ran.

## T-RR-009 — GREEN Targeted Evidence

- **Production changes:** exported the existing `createCoreGenericProjectSources` from `discovery.ts` for direct internal-module reuse only; CLI `evaluateCurrentSources` now composes those canonical Core bindings with the bounded active-provider bindings before discovery and registry canonicalization; discovery does not count already-composed fixed Core bindings against the provider width budget; registry derives Core declaration identity from the reused factory, preserves Core bindings while bounding provider inputs, canonicalizes duplicate Core IDs, and validates slash-bearing project-relative bases without weakening absolute/traversal/separator/escape rejection.
- **Exact GREEN targeted execution:** cwd `/home/kevinlb/deck`; command `bun test packages/core/src/skill-discovery/registry.test.ts apps/cli/src/skill-registry-command.test.ts`; exit code `0`; `32 pass / 0 fail`; `193 expect()` calls; `Ran 32 tests across 2 files. [2.89s]`.
- **Targeted GREEN coverage:** OpenCode oracle `sha256:18c7b581942f33f366740594478b7935274ca798d34cf0aa4de2c8fb84660545`; Pi oracle `sha256:db86a369c6ec8d342cbdd4e0d452f1f401c66dec2127de57c9460a451340450c`; provider-only stored scopes classify stale; valid slash bases are retained; unsafe bases and other-runner declarations are excluded; existing 499/500/501/10,000 and pathological iterator tests remain green.

## T-RR-009 — Affected Checks and Final Apply Evidence

- **Full Core skill-discovery:** cwd `/home/kevinlb/deck`; command `bun test packages/core/src/skill-discovery/`; exit code `0`; `50 pass / 0 fail`; `308 expect()` calls; `Ran 50 tests across 3 files. [5.99s]`.
- **Affected CLI/OpenCode/Pi/discovery:** cwd `/home/kevinlb/deck`; command `bun test packages/core/src/skill-discovery/discovery.test.ts packages/adapter-opencode/src/runner-adapter.test.ts packages/adapter-opencode/src/runner-adapter.inventory.test.ts packages/adapter-pi/src/runner-adapter.test.ts packages/adapter-pi/src/registry-consumption.test.ts apps/cli/src/skill-registry-command.test.ts`; exit code `0`; `71 pass / 0 fail`; `380 expect()` calls; `Ran 71 tests across 6 files. [8.69s]`.
- **Typecheck:** cwd `/home/kevinlb/deck`; command `bunx tsc --noEmit`; exit code `0`; no diagnostics.
- **Scoped diff check:** cwd `/home/kevinlb/deck`; command `git diff --check -- packages/core/src/skill-discovery/discovery.ts packages/core/src/skill-discovery/registry.ts packages/core/src/skill-discovery/registry.test.ts apps/cli/src/skill-registry-command.ts apps/cli/src/skill-registry-command.test.ts openspec/changes/agent-skill-registry-discovery/apply-progress.md`; exit code `0`; no output. Independent exact-allowlist scan found `0` trailing-whitespace lines.
- **Exact complete source-scope oracles:** OpenCode `sha256:18c7b581942f33f366740594478b7935274ca798d34cf0aa4de2c8fb84660545`; Pi `sha256:db86a369c6ec8d342cbdd4e0d452f1f401c66dec2127de57c9460a451340450c`.
- **Locator matrix:** accepted `.agents/skills`, `.skills`, `.pi/skills`, `.opencode/skills`, and normalized multi-segment project-relative bases; rejected empty, `.`, `./skills`, duplicate separators, `..` traversal, absolute POSIX/Windows/UNC paths, backslashes, percent escapes, and unsafe characters.
- **Active-runner proof:** OpenCode scope contains `project-agents-skills`, `project-generic-skills`, and `opencode-fixture-skills`; Pi scope contains the two generic roots plus `pi-project-skills`, `pi-user-agent-skills`, and `pi-user-skills`; other-runner declarations and observations are excluded.
- **Boundedness proof:** provider arrays are indexed at most `501` and retain at most `500`; fixed canonical Core roots do not consume the provider width budget; composed local registry inputs preserve 499/500 completion and 501/10,000 truncation; pathological provider iterators remain at `0` downstream calls; truncated evaluations cannot become ready or commit.
- **No-bypass/public-export audit:** CLI has one current-evaluation composition path; registry has one canonical declaration normalization path feeding frontmatter, source-scope hash, fingerprint, and ready comparison; the factory is exported only from the direct `discovery.ts` module and is absent from both package/index export surfaces. No duplicate Core factory exists.
- **No broad:** broad tests were not run, as required.

## T-BROAD-001 — Historical and Actual RED Evidence (Before Source Edit)

- **Authority:** T-BROAD-001 from `tasks.md` `sha256:da80c532b2f1332b4587e7532374242d591c3ce79024730a60b7e1f4dfb294bf`; the task's exact source allowlist is `packages/core/src/teams/developer/skill-discovery-content.ts` plus this evidence file.
- **Historical broad RED (immutable input):** exact command `bun run test`; observed result `3949 pass / 1 fail`; the only failure was `core purity audit > non-test core source files do not contain concrete runner or provider string literals` at `packages/core/src/__tests__/core-purity-audit.test.ts:205`. The concrete violations were in `packages/core/src/teams/developer/skill-discovery-content.ts:34-41`, where runner-bound command examples contained concrete runner names. This historical broad result is recorded, not rerun by T-BROAD-001.
- **Actual focused RED (before source edit):** cwd `/home/kevinlb/deck`; exact command `bun test packages/core/src/__tests__/core-purity-audit.test.ts`; exit code `1`; observed result `0 pass / 1 fail / 1 expect() call`.
- **Focused failing output:** `core purity audit > non-test core source files do not contain concrete runner or provider string literals` failed at `packages/core/src/__tests__/core-purity-audit.test.ts:205`. Violations were `skill-discovery-content.ts:34` through `:36` for `deck skill-registry validate|discover|refresh --runner opencode`, and `:39` through `:41` for the corresponding `--runner pi` command examples.
- **Whole-file pre-edit literal audit:** concrete runner ID literals occurred at lines `32`, `54`, and the command-example block at `39-47`; no provider names occurred. No encoded literals, character-code decoding, or string concatenation evasion was found. The two `.join("\\n")` calls at lines `70` and `102` are ordinary block rendering, not forbidden-name construction or audit evasion.
- **Pre-edit target digest:** `packages/core/src/teams/developer/skill-discovery-content.ts` `sha256:3cedc0160f49f615b844a76cbaadd85d03fc6f226da382d5b596d5eb36a2cebe` (`5787` bytes). The source edit had not started when this RED evidence was recorded.

## T-BROAD-001 — GREEN Evidence and Semantic Fidelity

- **Minimal source change:** removed the concrete runner-specific command-example table from `packages/core/src/teams/developer/skill-discovery-content.ts`. The renderer now forms the three command forms directly from the validated `activeRunnerId`, so the source contains runner-neutral command templates while materialized output remains runner-bound for the supplied active runner. No authority text, specialist contract text, composition order, or loader behavior was changed.
- **Transient edit correction:** after the Serena symbol deletion left an invalid `const ;` residue while removing the obsolete table, the exact command `bun test packages/core/src/teams/developer/skill-discovery-content.test.ts` returned exit code `1` with `0 pass / 1 fail / 1 error`; Bun reported `Expected identifier but found ";"` and `This constant must be initialized`. The residue was removed immediately with the same source allowlist; no test or blocked target was touched. The final source parses and typechecks.
- **Resolved suite-invocation note:** the first combined core contract invocation (`bun test packages/core/src/teams/developer/skill-discovery-content.test.ts packages/core/src/teams/developer/content-registry.test.ts packages/core/src/teams/developer/orchestrator-content.test.ts packages/core/src/teams/developer/prompt-profile.test.ts`) exceeded the 120-second MCP execution budget and returned no assertion result. The four exact prescribed commands were then run independently and all passed below; no test failure is inferred from the timeout.
- **Focused GREEN:** cwd `/home/kevinlb/deck`; exact command `bun test packages/core/src/__tests__/core-purity-audit.test.ts`; exit code `0`; `1 pass / 0 fail / 1 expect() call`; `Ran 1 test across 1 file.`
- **Shared content/prompt contracts:** each exact command passed in cwd `/home/kevinlb/deck` with exit code `0`:
  - `bun test packages/core/src/teams/developer/skill-discovery-content.test.ts` — `4 pass / 0 fail / 46 expect() calls`.
  - `bun test packages/core/src/teams/developer/content-registry.test.ts` — `90 pass / 0 fail / 870 expect() calls`.
  - `bun test packages/core/src/teams/developer/orchestrator-content.test.ts` — `129 pass / 0 fail / 416 expect() calls`.
  - `bun test packages/core/src/teams/developer/prompt-profile.test.ts` — `9 pass / 0 fail / 377 expect() calls`.
- **OpenCode/Pi materialization and registry consumption:** each exact command passed in cwd `/home/kevinlb/deck` with exit code `0`:
  - `bun test packages/adapter-opencode/src/prompt-generation.test.ts` — `43 pass / 0 fail / 439 expect() calls`.
  - `bun test packages/adapter-pi/src/pi-team-profile.test.ts` — `22 pass / 0 fail / 99 expect() calls`.
  - `bun test packages/adapter-pi/src/orchestrator-prompt.test.ts` — `27 pass / 0 fail / 71 expect() calls`.
  - `bun test packages/adapter-pi/src/registry-consumption.test.ts` — `16 pass / 0 fail / 83 expect() calls`.
- **Typecheck:** cwd `/home/kevinlb/deck`; exact command `bunx tsc --noEmit`; exit code `0`; no diagnostics.
- **Diff check:** cwd `/home/kevinlb/deck`; exact command `git diff --check`; exit code `0`; no output. An independent exact-allowlist trailing-whitespace scan found `0` lines.
- **Whole-file post-edit audit:** the command-example literals no longer contain concrete runner/provider names. The only remaining exact runner IDs are the required supported-ID type/guard literals (`"opencode"` and `"pi"`) used to reject unknown runtime context; no provider names, encoded names, character-code decoding, or string concatenation/splitting evasion exists. The three command templates interpolate only the validated active runner identity; no concrete name is hidden or reconstructed.
- **EII-ASRD-002 semantic mapping:** (1) the bounded `Skill Discovery Context` is still read before substantial scope-relevant work and absent context remains indeterminate; (2) ready status still searches by project/task/paths/extensions/technologies/techniques; (3) every non-ready status still uses bounded direct discovery over generic plus active-runner sources only; (4) every field remains untrusted and selected locator/exposure is verified immediately before loading; (5) the smallest relevant set still loads only through the active runner's normal mechanism; (6) missing candidates remain non-blocking unless a required capability is unavailable; (7) the fixed authority boundary remains included and specialist generation/regeneration remains prohibited; (8) existing core composition places the contract on every non-Orchestrator agent/skill in compact and legacy profiles before capability bundles, confirmed by the shared suites. Status-only context, no registry-body/candidate pre-digestion, no direct registry authority, active-runner exclusivity, no cross-runner discovery, and bounded fallback behavior are unchanged.
- **Scope/freshness:** the source changed only within the exact T-BROAD-001 source target; this file received evidence-only additions. `tasks.md` remained `sha256:da80c532b2f1332b4587e7532374242d591c3ce79024730a60b7e1f4dfb294bf`. Final source digest before this evidence append: `packages/core/src/teams/developer/skill-discovery-content.ts` `sha256:59f256bd47c3f6b9123bf2c507c11db8d698b9c05be02e0de207d3bf7f87a16d` (`5363` bytes). No edit was made to the purity test, adapters, registry implementation, generated output, state/events/tasks, or Git history/index.
- **No broad:** `bun run test` was not rerun. T-BROAD-001 evidence is complete for handoff to the independent V7 Verify; any later source edit invalidates this GREEN evidence.
