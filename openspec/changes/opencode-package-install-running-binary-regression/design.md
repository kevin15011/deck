# Design: OpenCode Package Install Running-Binary Regression

## Phase Result and Authority

- **Change ID:** `opencode-package-install-running-binary-regression`
- **Mode / phase / role:** Automatic / Design / `deck-developer-design`
- **Status:** Final; Spec/Design reconciliation is complete and Task may start after the coordinator accepts the returned registry intent.
- **Approved Proposal:** `proposal.md` at SHA-256 `1ca7292f6ba579e95698ee6af33902e86519c7ca661761d5470dd62402fa8951`.
- **Exploration:** `exploration.md` at SHA-256 `fde0cbd4b3f6f9ee34ca868ef39e13c66b06cd1e6e85edb7aff96417c7fb5fe2`.
- **Completed parallel Spec:** `spec.md` at SHA-256 `984049ed80f97ce9868126844f01c4022baa8d53a1e0d839fc7856e7ac834ba1`.
- **Reconciled Design base:** prior `design.md` at SHA-256 `1bbf7457bfe5d9382203e51220124fd401c1bdaf6f74b51a12a270081c21593f`.
- **Registry bases:** `state.yaml` at SHA-256 `9b3d71f435e62f8a825527237a0c6c83e7636b0153a8170fc7d0d5a9e36ef91c`; `events.yaml` at SHA-256 `f3f96640a79dcef8ea225e30a1bf0851566ccad7e5c12abed4cd06595e320f9d`.
- **Modification boundary for this phase:** only this `design.md`. Source, tests, configuration, user-home state, shared registry YAML, archived history, and every path under `runner-capability-standardization` remain unchanged.
- **Official context:** the artifacts above plus current source/tests and the current OpenCode adapter interfaces named below.
- **Adaptive context:** loaded as advisory evidence. It agreed with install-if-missing and no-process-management constraints and did not alter official scope or requirements.
- **Overall risk:** Medium. There is no persistence migration, but installed-evidence false positives/negatives and untrusted external diagnostics are safety-sensitive.

## Reconciliation Outcome

All four Spec open questions are resolved:

| Open question | Final decision |
|---|---|
| `OQ-01` outcome vocabulary | Add the adapter-local outcome union `already-present | executed | failed | skipped`; preserve the public action status union. Represent already-present as action `status: "skipped"` plus local `packageOutcome: "already-present"`, and treat it as dependency-satisfying. |
| `OQ-02` effective evidence | Reuse one shared adapter-owned local config-source/parser authority; support the exact user/custom/project/inline surfaces and executable surfaces in Decision 1. A broken higher config entry blocks lower config entries but cannot erase independent positive PATH/canonical executable evidence. Declarations alone never prove readiness. |
| `OQ-03` sanitation/bounds | Apply the exact capture, control removal, redaction, selection, truncation, and fallback algorithm in Decision 4. Raw captured diagnostics remain only in the adapter result's non-enumerable internal fields and never cross into dashboard state/logs. |
| `OQ-04` dashboard treatment | Render one inline, indented, bounded cause under the identified failed action in progress and completion views. Do not add an interaction mode, modal, expandable panel, or new screen state. |

The Spec's normative headings contain **34 requirements and 51 scenarios**. Its non-normative count tables and existing registry notes say 22/45, and two group subtotals also differ from the parsed headings. This Design does not modify the immutable Spec or historical registry entries; the complete matrix below covers every actual `REQ-*` and `*-S*` heading. The count drift is therefore recorded and closed as metadata-only, not treated as permission to omit any requirement.

No Spec requirement requires active-binary replacement, process management, a cross-runner status redesign, or another Proposal expansion. All requirements are implementable inside the exact future implementation allowlist below.

## Chosen Architecture

Keep Runner Setup as install-if-missing desired-state convergence and repair four existing boundaries:

1. A shared OpenCode local-config source/parser authority enumerates supported config layers once. `required-tools.ts` uses it to resolve package-relevant installed evidence for planning and effect-time checks.
2. `install-tools.ts` rechecks that evidence inside a scoped per-tool single-flight immediately before the first external effect and, for downloaded scripts, again before the mutating shell effect. It emits one discriminated adapter result.
3. The adapter/TUI projection preserves tool ID, package outcome, safe cause, and safe structured diagnostics while dropping raw captures. Dependency gating distinguishes a satisfied already-present no-op from an unsatisfied ordinary skip.
4. Existing progress and completion views show action identity and one bounded inline cause. No raw stream reaches Ink state or rendering.

This is prevention and truthful reporting, not replacement. Deck does not inspect, enumerate, match, signal, stop, restart, overwrite, stage, activate, roll back, checksum, reinstall, or upgrade a running MCP binary.

## Current Interface Evidence

| Current symbol | Runtime evidence that constrains this Design |
|---|---|
| `collectOpenCodeDiscoveryContext` / `parseJsonc` in `model-discovery-context.ts` | Already enumerates global JSON/JSONC, `OPENCODE_CONFIG`, project traversal, `OPENCODE_CONFIG_DIR`, project `.opencode`, and `OPENCODE_CONFIG_CONTENT`; this must be factored/reused rather than duplicated by a new scan. |
| `reviewOpenCodeTools` in `required-tools.ts` | Returns every tool missing before PATH evaluation when both default files are absent, splits PATH with `:`, checks existence rather than full executable validity, and promotes package/config names. It is synchronous and has many production callers, so its call shape remains synchronous. |
| `buildInstalledNameSet` / `isCapabilityInstalled` in `capability-inventory.ts` | Re-promotes `installedPackages` declarations even if `tools[].installed` becomes strict; command-backed capabilities therefore need evidence-aware inventory consumption. |
| `installOpenCodeTools` in `install-tools.ts` | Owns shell, npm, plugin, MCP, and Python branches; directly spawns downloaded scripts, accumulates raw output, logs raw snippets, and returns only `{ tool, success, message? }`. |
| `OpenCodeRunnerAdapterImpl.runAction` | Re-reviews without `RunnerActionContext.projectRoot` and maps every `success: true` result to public `executed`; it must map already-present without changing the Core status union. |
| `DeckApp` package installer composition in `apps/cli/src/tui/app.tsx` | Narrows adapter results to `{ success, message }` and matches by display name; it must project by required `toolId` and discard raw captures. |
| `PackageInstallerFn`, `runPackageInstall`, and `runRunnerReviewPlan` | The local contract lacks IDs/outcomes/causes, emits a generic failure sentence, and gates only action status `failed`. These are the correct local normalization and dependency boundaries. |
| `InstallProgressScreen` / `DashboardCompleteScreen` | Existing Ink views already render results inline and need only bounded identified text; no new UI state is justified. |
| Core `RunnerActionRunResult` | Public status is exactly `executed | informational | skipped | failed` with existing `raw?: unknown`; no new public status member is necessary. |

The supported local config order is also consistent with the adapter's current candidate set and the official OpenCode configuration documentation (`https://opencode.ai/docs/config/`, consulted 2026-07-24). Remote organization and managed administrator layers are deliberately not inferred by this offline repair.

## Decision 1: One Authoritative Installed-Evidence Resolver

### Shared config-source authority

`model-discovery-context.ts` exports its JSONC parser and a pure local source enumerator. Both model discovery and required-tool evidence consume those helpers; Task must not copy the candidate list or create a second parser.

Supported layers merge from lowest to highest precedence. Within one location, `.json` is read before `.jsonc`, so `.jsonc` wins conflicting fields. `mcp` objects are deep-merged by server key and field; arrays/scalars replace lower values.

1. `${XDG_CONFIG_HOME ?? join(homeDirectory, ".config")}/opencode/opencode.json`, then `opencode.jsonc`.
2. The exact file named by `OPENCODE_CONFIG`, resolved against `projectRoot` only when relative.
3. Direct project `opencode.json` then `opencode.jsonc` files from `workspaceRoot` (the adapter-resolved nearest Git/workspace root) toward `projectRoot`, with the nearer directory later/higher.
4. `projectRoot/.opencode/opencode.json`, then `opencode.jsonc`, preserving the bounded project `.opencode` surface already enumerated by the adapter.
5. `OPENCODE_CONFIG_DIR/opencode.json`, then `opencode.jsonc`, when distinct from earlier roots.
6. Parsed JSON/JSONC from `OPENCODE_CONFIG_CONTENT` as the highest supported local override, with relative command paths based at `projectRoot`.

`OPENCODE_DISABLE_PROJECT_CONFIG` removes layers 3 and 4. `OPENCODE_PURE` removes all config/package-declaration layers and leaves only executable evidence. Missing files are normal. An existing unreadable or malformed supported layer makes config projection `indeterminate`; it is not silently ignored. JSONC supports comments and trailing commas only; no shell evaluation, `{env:...}`/`{file:...}` interpolation, or executable probing occurs while parsing.

Only the effective merged `mcp` entries and plugin/package identifiers are projected. Secrets, headers, environment values, provider values, and unrelated settings are never retained. Remote `.well-known` config, managed OS config/preferences, and network-derived effective state are unsupported in this offline resolver: they cannot create positive evidence or override independent filesystem executable evidence.

The only package-manifest declaration retained for backward-compatible review output is the current global OpenCode manifest at `${XDG_CONFIG_HOME ?? ~/.config}/opencode/package.json`. Its dependencies, plugin strings, MCP keys, disabled entries, remote entries, and command-shaped strings are declarations only unless the executable rules below independently succeed.

### Resolver interface

```ts
export type OpenCodeInstalledEvidenceState =
  | "usable"
  | "declared"
  | "broken"
  | "absent"
  | "indeterminate";

export type OpenCodeInstalledEvidenceSource =
  | "configured"
  | "PATH"
  | "canonical-target"
  | "absent";

export type OpenCodeInstalledEvidenceReason =
  | "configured-usable"
  | "configured-disabled"
  | "configured-remote"
  | "configured-command-invalid"
  | "configured-target-missing"
  | "configured-target-not-file"
  | "configured-target-empty"
  | "configured-target-not-executable"
  | "configured-unreadable"
  | "configured-malformed"
  | "PATH-usable"
  | "PATH-missing"
  | "PATH-non-file"
  | "PATH-empty"
  | "PATH-non-executable"
  | "PATH-dangling-symlink"
  | "canonical-target-usable"
  | "canonical-target-missing"
  | "declaration-only"
  | "no-evidence";

export type OpenCodeInstalledEvidence = {
  toolId: InstallableOpenCodeToolId;
  state: OpenCodeInstalledEvidenceState;
  source: OpenCodeInstalledEvidenceSource;
  reasonCodes: readonly OpenCodeInstalledEvidenceReason[];
};

export type ResolveOpenCodeInstalledEvidence = (
  toolId: InstallableOpenCodeToolId,
  context: OpenCodeEvidenceContext,
) => OpenCodeInstalledEvidence;
```

`OpenCodeEvidenceContext` is synchronous to preserve current `reviewOpenCodeTools` callers. It contains required `projectRoot`, resolved/injected `workspaceRoot`, `homeDirectory`, environment, platform, current directory, and injected `readFile`, `stat`, `realpath`, and `access` functions. Production defaults use current process values; every automated test supplies temporary/in-memory boundaries. The public evidence contains no resolved path.

### Package relevance and executable validity

The resolver derives supported IDs and detector commands from the current catalog/installable-tool data:

| Tool ID | Expected command | Supported canonical target |
|---|---|---|
| `rtk` | `rtk` | `${homeDirectory}/.local/bin/rtk` |
| `context-mode` | `context-mode` | `${homeDirectory}/.local/bin/context-mode` |
| `codebase-memory` | `codebase-memory-mcp` | `${homeDirectory}/.local/bin/codebase-memory-mcp` |
| `serena` | `serena` | `${homeDirectory}/.local/bin/serena` |
| `context7` | no installed package command | none; only the exact enabled local MCP binding described below |

A command-backed MCP entry is package-relevant only when its normalized key is an exact catalog tool/MCP alias and its non-empty command vector's first token basename is the expected detector command. A bare command resolves through injected PATH. An absolute token resolves directly. A relative token containing a path separator resolves from the declaring config directory. Shell strings, shell metacharacters, substitutions, whitespace-split strings, unrelated launchers, and arbitrary substring matches are declarations only.

`context7` is configuration-only. Its configured evidence is usable only for an enabled `type: "local"` entry with the exact catalog server key, exact package token `@upstash/context7-mcp`, and a resolvable executable first token for the existing local launcher contract (`npx`). A remote URL, key name alone, or missing launcher is not readiness.

A target is executable evidence only when `realpath` resolves, `stat` reports a non-empty regular file, and platform launch semantics pass. POSIX requires `X_OK`. Windows requires a regular non-empty file whose extension matches injected `PATHEXT` (default `.COM;.EXE;.BAT;.CMD`); no POSIX mode assumption is made. PATH uses `node:path.delimiter`; an empty/relative PATH segment resolves against injected current directory. Symlinks are accepted only when their resolved target passes all checks.

### Selection and broken-target precedence

For each tool:

1. Merge supported local config and inspect the effective matching entry. A valid executable command is `usable/configured`.
2. A disabled, remote, malformed command, or unusable configured target is recorded as `declared`, `broken`, or `indeterminate`. It blocks lower-precedence **config entries** from rescuing it.
3. Independently evaluate the exact detector command in PATH. Positive PATH evidence makes the installation state `usable/PATH` even when the effective config binding is broken; the broken-config reason remains in `reasonCodes`. This deliberately prevents a stale config pointer from forcing reinstall of a real executable.
4. If PATH has no usable target, evaluate only the exact canonical target in the table. Positive evidence makes the state `usable/canonical-target`, again retaining any config warning.
5. With no executable/configuration proof, declaration-only data yields `declared`; an explicit unusable target yields `broken`; an unreadable/malformed relevant layer yields `indeterminate`; otherwise the result is `absent`.

`reviewOpenCodeTools` maps `tools[].installed` to true only for `state: "usable"`; all other states remain install-unsatisfied. The primary `source` remains one of the Spec's `configured | PATH | canonical-target | absent` vocabulary. Detailed cases such as `PATH-non-executable` are exact `reasonCodes`, satisfying both source-level and disposition-level assertions.

No health/version command is run. `usable` means package-relevant and OS-launchable, not protocol-healthy or current-version. An older launchable binary is already installed because Runner Setup is not an upgrade surface.

### Planning and inventory

`OpenCodeToolsReview` gains additive evidence by tool while retaining `installedPackages`, `tools`, `toolStatuses`, and `error`. `capability-inventory.ts` uses strict evidence for command-backed capabilities and must not re-promote `installedPackages`. Existing internal plugin-only handling remains unchanged. The TUI uses the preflight review already stored in runtime state; direct adapter paths pass `CapabilityInventoryInput.projectRoot` or `RunnerActionContext.projectRoot` rather than silently re-reading process CWD.

## Decision 2: Exact Package and Action Results

### Adapter result

```ts
export type OpenCodeToolInstallOutcome =
  | "already-present"
  | "executed"
  | "failed"
  | "skipped";

export type OpenCodeRawInstallDiagnostic = {
  stage: "evidence" | "download" | "install" | "post-install";
  exitCode?: number;
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  stdoutBytes: number;
  stderrBytes: number;
};

export type OpenCodeInstallDiagnostic = {
  stage: OpenCodeRawInstallDiagnostic["stage"];
  code: string;
  exitCode?: number;
  lines: readonly string[]; // redacted and bounded
  original?: OpenCodeRawInstallDiagnostic; // adapter-internal, non-enumerable
};

type OpenCodeToolInstallResultBase = {
  toolId: InstallableOpenCodeToolId;
  tool: string;
  message: string;
  cause?: string;
  diagnostic?: OpenCodeInstallDiagnostic;
  raw?: OpenCodeRawInstallDiagnostic; // adapter-internal, non-enumerable
};

export type OpenCodeToolInstallResult =
  | (OpenCodeToolInstallResultBase & {
      outcome: "already-present";
      success: true;
      installerInvoked: false;
    })
  | (OpenCodeToolInstallResultBase & {
      outcome: "executed";
      success: true;
      installerInvoked: true;
    })
  | (OpenCodeToolInstallResultBase & {
      outcome: "failed";
      success: false;
      installerInvoked: boolean;
    })
  | (OpenCodeToolInstallResultBase & {
      outcome: "skipped";
      success: false;
      installerInvoked: false;
    });
```

One result factory creates every branch and enforces these combinations:

| Outcome | `success` | `installerInvoked` | Meaning |
|---|---:|---:|---|
| `already-present` | true | false | Immediate evidence is usable; no installer ran. |
| `executed` | true | true | This invocation completed its configured mutating install pipeline and required post-evidence succeeded. |
| `failed` | false | stage-dependent | Evidence, download, installer, post-install, verification, or result integrity failed. A shared single-flight failure may have run in the leader rather than follower. |
| `skipped` | false | false | No mutating install ran because of pre-effect cancellation, manual/unsupported handling, or an unmet prerequisite. |

`success` remains for source compatibility but never determines fresh-install semantics. `outcome` and `toolId` are required. A nonzero configured install/post-install result remains failed; later stale or concurrent evidence cannot redeem it. A zero exit cannot become `executed` when supported post-install evidence is still unusable.

Raw `stdout`, `stderr`, and exit status are preserved byte-faithfully after UTF-8 decoding when under capture limits, and with deterministic tail/truncation metadata on overflow, in both `diagnostic.original` and `raw` as required by `FAL-02-S1`. Those two properties are attached non-enumerably by the factory. They are available only to immediate adapter-internal tests/debug consumers, are omitted by `JSON.stringify`/spread, and must be explicitly dropped by every adapter/TUI projection. The enumerable `diagnostic.lines` is the fuller redacted debug evidence.

### Runner action representation without public union breakage

The Core `RunnerActionRunResult.status` union is unchanged. The TUI-local result adds only:

```ts
packageOutcome?: OpenCodeToolInstallOutcome;
cause?: string;
```

Mapping is exact:

| Package outcome | Local action status | Dependency satisfied? |
|---|---|---:|
| `already-present` | `skipped` | yes |
| `executed` | `executed` | yes |
| `failed` | `failed` | no |
| ordinary `skipped` | `skipped` | no |

The direct adapter `runAction` uses the same public statuses and places the safe package outcome in its existing safe structured `raw` summary; it does not add a Core status or expose adapter raw streams.

`PackageInstallerFn` returns required generic results `{ id, outcome, success, message, cause?, diagnostic? }`. `app.tsx` maps by exact `toolId`, not display text, and projects only redacted/bounded diagnostic fields. Missing, duplicate, unknown, or mismatched IDs are integrity failures.

For an aggregate action, any failed/integrity-invalid item is `failed`; any mix containing an ordinary unsatisfied skip is `failed` as incomplete; all already-present items map to satisfied `skipped`; all ordinary skips map to unsatisfied `skipped`; otherwise all executed items map to `executed`. Current actions request one package, but this rule removes future array ambiguity.

`runRunnerReviewPlan` tracks unsatisfied install capability prefixes, not merely `status === "failed"`. Failed and ordinary-skipped package outcomes gate only the matching dependent config action. Already-present and executed outcomes permit it. Unrelated capability actions continue.

## Decision 3: Effect Boundary, Single-Flight, Cancellation, TOCTOU, and Isolation

`InstallOpenCodeToolsOptions` adds the synchronous evidence resolver/context, injected downloaded-script runner, and optional `AbortSignal`; the existing positional `runInstallCommand` injection remains compatible.

For each input item, in input order:

1. If cancellation is already requested, emit ordinary `skipped` without entering an effect.
2. Enter a module-local single-flight keyed by canonical unlogged `{ projectRoot, homeDirectory, toolId }`.
3. Re-resolve installed evidence **inside** the gate immediately before downloader/npm/plugin/uv/pipx activity.
4. If evidence is usable, return `already-present`; downloader, shell, npm, plugin, fallback, and post-install call counts are zero.
5. If evidence is `indeterminate`, return `failed` at stage `evidence`; uncertainty is not permission to reinstall.
6. If absent/broken/declared, execute the existing configured branch. A shell-script branch downloads into bounded memory, checks cancellation, and performs a second evidence recheck immediately before the mutating shell seam. Evidence that appeared during download discards the script and returns already-present without shell execution.
7. Once a mutating installer starts, cancellation is cooperative only at the next package boundary. Deck awaits the whole current package pipeline, including supported fallback/post-install/evidence, and reports its truthful outcome; it never signals or kills the child.
8. Emit exactly one result for this input and continue with the next package unless cancellation now prevents new work.

A same-scope follower never starts duplicate work. It waits for the leader unless its own signal is already canceled; follower cancellation does not affect the leader. After leader execution, the follower rechecks and normally returns already-present. After leader failure or skip, the follower returns the same safe failed/skipped outcome and does not retry. The map entry is removed in `finally`; later non-concurrent user attempts are not poisoned.

There is no filesystem lock, cross-process lock, process scan, retry loop, or ownership inference. A different Deck process or external installer can still race after the final check. A nonzero external result remains failed rather than being hidden. This bounded residual TOCTOU is explicit.

Different tool IDs use different gates. Concurrent different-package requests may progress independently. One call remains sequential and input-ordered. Every input receives exactly one result keyed by `toolId`; a duplicate input ID makes the later occurrence an integrity failure without another effect. Exceptions are caught per package and never overwrite or suppress another package's evaluation.

Cancellation during the non-mutating download is handled by awaiting the downloader, discarding its in-memory body, and returning skipped before shell execution when the download itself succeeded. No installer script is written to an install target. If the downloader itself fails, failure truth takes precedence. This satisfies the Spec by relying on existing installer atomicity once mutation begins rather than attempting unsafe mid-process cancellation.

## Decision 4: Exact Diagnostic Capture and Sanitation

### Capture and allowed retention

- Downloaded script content has a hard 1 MiB UTF-8 byte limit. Overflow fails at `download` before shell execution; executable content is never truncated and run.
- Installer/post-install stdout and stderr each retain at most the final 65,536 UTF-8 bytes plus total-byte and truncation metadata. Truncation ends on a valid UTF-8 boundary. Under the cap, the captured strings are the original decoded streams.
- Unsanitized captures may exist only in `OpenCodeToolInstallResult.raw` and `diagnostic.original` during the immediate adapter return/callback lifetime. They are non-enumerable and must not enter `app.tsx` state, `PackageInstallerFn` results, `RunnerActionRunResult`, Ink props, persisted files, telemetry, or logs.
- Adapter debug logging may retain only package ID, outcome, stage, code, exit code, byte counts/truncation flags, and the bounded sanitized `diagnostic.lines`. Existing raw stdout/stderr snippets and whole-result logging are prohibited.
- TUI action `raw` may contain only `{ id, outcome, diagnostic: { stage, code, exitCode, lines } }` after defense-in-depth sanitation. In this Core-compatible field, `raw` means structured internal evidence, never raw external bytes.

### Deterministic sanitizer order

For stderr followed by stdout (deduplicated while preserving selected order):

1. Normalize CRLF to LF and bare carriage returns to LF.
2. Apply `stripVTControlCharacters` from `node:util`; remove any remaining ESC, OSC terminators, C0/C1/DEL controls except LF, and Unicode format/bidirectional controls (`\p{Cf}`). Replace tabs with one space.
3. Remove progress/spinner glyphs in Unicode box-drawing `U+2500–U+257F`, block `U+2580–U+259F`, and braille `U+2800–U+28FF`, plus `◐◓◑◒◴◷◶◵⟳`. Drop lines that become empty; collapse repeated inline spaces and trim.
4. Redact case-insensitive key/value or header values for `token`, `secret`, `password`, `passwd`, `api-key`, `api_key`, `authorization`, `proxy-authorization`, `cookie`, `set-cookie`, `credential`, `client-secret`, `client_secret`, `access-key`, and `access_key`. Redact `Bearer` values, JWT-like three-segment values, `sk-` values of at least 8 token characters, `gh[pousr]_...`, and `github_pat_...` values.
5. Recognize `http`, `https`, `ws`, `wss`, and `git+https` URLs before path redaction. Replace URL user-info and values for query keys matching the secret-key set with `[REDACTED]`; retain scheme/host/non-sensitive path/query text.
6. Replace injected roots longest-first: XDG config/cache/state roots with `$XDG_CONFIG_HOME`, `$XDG_CACHE_HOME`, `$XDG_STATE_HOME`, then the injected home with `~`. Replace every other POSIX absolute path, Windows drive-absolute path, and UNC path with `<path>`. No real absolute user path may remain.
7. Re-run secret and path redaction after line composition, then apply bounds.

Select the final distinct meaningful lines containing, case-insensitively, `error`, `failed`, `failure`, `fatal`, `denied`, `permission`, `not found`, `no such`, `unable`, `cannot`, `text file busy`, `ETXTBSY`, `exit`, `checksum`, `timeout`, or `timed out`. If none match, select final non-empty lines. Selection is generic and never branches on the v0.9.0 message.

### Exact bounds and fallback

| Channel | Exact bound |
|---|---|
| Enumerable adapter `diagnostic.lines` | at most 6 lines; at most 240 Unicode scalar values per line; at most 1,024 UTF-8 bytes aggregate |
| User-facing `cause` | at most 2 selected lines joined by ` · `; at most 320 UTF-8 bytes aggregate |
| TUI `diagnostics` after second sanitation | at most 8 strings; at most 240 Unicode scalar values each; at most 1,280 UTF-8 bytes aggregate |
| Progress view | existing final 5 action results; at most one indented cause line per failed result |

Scalar truncation and aggregate byte truncation end on valid code-point boundaries and append one `…` only when it fits inside the same limit. Redaction always precedes truncation. If sanitation removes all external text, the fallback is exactly `<Stage> failed (exit N).` when an exit code exists, otherwise `<Stage> failed.`; `<Stage>` is one of `Evidence`, `Download`, `Install`, or `Post-install`. The fallback is passed through the same bounds.

The codebase-memory regression fixture must retain meaningful pgrep/copy/ETXTBSY failure information after sanitation while proving that no ANSI/control/progress glyph, credential, URL secret, or absolute path survives. The fixture is text only and never invokes process commands.

## Decision 5: Inline Dashboard Presentation

No details panel or new key binding is added. The existing views render:

```text
✗ [capability.codebase-memory.install] Package install failed.
  warning: process-name match was not usable · error: failed to copy binary to <path>
```

An already-present no-op renders:

```text
… [capability.codebase-memory.install] codebase-memory already present; installer not run.
```

Progress preserves its current last-five behavior. Completion preserves its current failed-action list. Each failed entry includes `[actionId]` (or its existing display label if the ID is unavailable, which is an integrity failure upstream), the stable message, and one indented `cause`. Color is supplementary; symbol, ID, and text carry meaning. Enumerable safe diagnostics remain available in the action result for tests/debugging but are not dumped to the screen.

## Data Flow

```mermaid
sequenceDiagram
  participant TUI as Runner Setup TUI
  participant Review as OpenCode evidence resolver
  participant Plan as Existing capability plan
  participant Action as Dashboard action runner
  participant Install as OpenCode install-tools
  participant Gate as Scoped per-tool gate
  participant Ext as Existing external installer

  TUI->>Review: review(projectRoot, workspaceRoot, env, injected fs/PATH)
  Review-->>TUI: evidence per tool
  TUI->>Plan: installed=true only for usable evidence
  Plan-->>Action: existing install/config actions
  Action->>Install: exact tool IDs + evidence context
  Install->>Gate: enter(scope + toolId)
  Gate->>Review: immediate fresh recheck
  alt usable
    Review-->>Install: usable
    Install-->>Action: already-present; no external effect
  else indeterminate
    Review-->>Install: indeterminate
    Install-->>Action: failed evidence result; no external effect
  else install-unsatisfied
    Review-->>Install: declared/broken/absent
    Install->>Ext: existing bounded install pipeline
    Ext-->>Install: exit + captured stdout/stderr
    Install->>Install: preserve raw internally; sanitize safe projection
    Install-->>Action: executed / failed / skipped
  end
  Action->>Action: validate IDs, aggregate, gate matching dependents
  Action-->>TUI: action ID + existing status + packageOutcome + bounded cause
```

## Compatibility, State, Migration, and Persistence

- No database, registry-schema, user-config, product-state, or binary migration.
- Existing OpenCode config and package manifests are read-only evidence; this change never rewrites them as part of detection.
- The Core action status union and shared `RunnerActionRunResult` shape remain source-compatible. Adapter install results add required discriminants while retaining `success`, `tool`, and `message`.
- Existing plan order and unrelated-action continuation remain. `installation-plan.ts` and `capability-plan.ts` are not edited.
- No package dependency, lockfile, generated file, prompt, skill, system instruction, or cross-runner behavior changes.
- No version comparison, implicit upgrade/reinstall, process discovery, binary activation, or retry is introduced.
- Raw captures are ephemeral in-memory evidence only. No new persisted diagnostic file or telemetry channel is created.

## Exact Future Implementation Allowlist and Estimate

Implementation may edit only the following targets. Any expansion must return to Design/Proposal reconciliation before modification.

| Target | Action | Specific responsibility | Required test obligation |
|---|---|---|---|
| `packages/adapter-opencode/src/model-discovery-context.ts` | modify | Export/reuse the one local config-source enumerator and JSONC parser; preserve model-discovery safe DTO behavior. | Candidate order, project-disable/pure behavior, JSON/JSONC/inline parsing, and existing secret-safe fingerprint assertions. |
| `packages/adapter-opencode/src/model-discovery-context.test.ts` | modify | Lock shared source order/parser behavior and prove existing model discovery does not regress. | Direct deterministic fixtures only. |
| `packages/adapter-opencode/src/required-tools.ts` | modify | Evidence types/resolver, exact executable validation, strict review mapping, declaration compatibility. | Full config/PATH/canonical/broken/indeterminate/source/reason matrix with injected roots. |
| `packages/adapter-opencode/src/required-tools.test.ts` | modify | Acceptance oracle for EVD/MIS/PCV and supported package mappings. | No real HOME, PATH, network, or process access. |
| `packages/adapter-opencode/src/capability-inventory.ts` | modify | Consume usable evidence for command-backed capabilities and prevent declaration re-promotion; preserve plugin-only internal behavior. | Command-backed declaration negative cases and plugin/config-only compatibility. |
| `packages/adapter-opencode/src/capability-inventory.test.ts` | create | Focused inventory boundary tests absent today. | Ready/missing status and diagnostics for usable, declared, broken, and config-only cases. |
| `packages/adapter-opencode/src/install-tools.ts` | modify | Discriminated result factory, raw/safe diagnostic boundary, immediate/second rechecks, single-flight, cooperative cancellation, injected shell seam, per-package isolation. | Outcome invariants, call counts, raw retention/non-enumerability, sanitation bounds, concurrency, cancellation, TOCTOU, and ordering. |
| `packages/adapter-opencode/src/install-tools.test.ts` | modify | Primary RCK/APO/FAL/PAG/CTO/CAN/MPI oracle, including the v0.9.0 text fixture. | All external effects injected; no network or real process. |
| `packages/adapter-opencode/src/runner-adapter.ts` | modify | Pass project scope/reuse runtime review and truthfully map direct adapter already-present/failure results into existing Core statuses with safe `raw`. | Direct `runAction`/inventory project-scope and no-fresh-install-claim tests. |
| `packages/adapter-opencode/src/runner-adapter.test.ts` | modify | Direct adapter contract oracle. | Status union unchanged; unsafe adapter raw absent from action results. |
| `apps/cli/src/tui/app.tsx` | modify | Preserve rich OpenCode results by exact tool ID, pass evidence context, and drop raw captures before dashboard state/callbacks; Pi projection remains unchanged. | Compile-time required-field contract plus action-runner/e2e assertions that cause/outcome survive and raw strings do not. |
| `apps/cli/src/tui/runner-dashboard/action-runner.ts` | modify | Generic package result projection, second sanitizer/bounds, deterministic aggregate mapping, satisfied-vs-unsatisfied dependency gating. | Contract tests for all outcomes, missing/duplicate IDs, matching-only gates, and unrelated continuation. |
| `apps/cli/src/tui/runner-dashboard/__tests__/runner-install-contract.test.ts` | modify | Package/action outcome, integrity, sanitation, aggregation, and gating oracle. | Explicit already-present satisfied skip versus ordinary unsatisfied skip. |
| `apps/cli/src/tui/screens/runner-dashboard-screens.tsx` | modify | Identified inline message/cause in existing progress/completion composition. | Render-only assertions for ID, cause, last-five behavior, no color-only meaning, and no diagnostic dump. |
| `apps/cli/src/tui/__tests__/runner-install-e2e.test.tsx` | modify | Render regression coverage for already-present and failed OpenCode results. | Safe bounded fixtures only; no I/O. |

**Estimate:** 15 files (14 modified, 1 created), approximately 450–700 changed production-plus-test lines.

No target from the initial Design can be removed after exact interface inspection: each closes a distinct current re-promotion, truncation, scope, mapping, gating, or rendering path. The two added model-discovery targets are required to satisfy the Spec's existing-adapter-authority rule without duplicating config enumeration. `installation-plan.ts`, `capability-plan.ts`, shared Core contracts, `runner-capabilities.ts`, package manifests/locks, generated files, prompts/skills, registry YAML, user-home paths, upstream code, and `runner-capability-standardization` are explicitly excluded.

## Verification Strategy

### Focused deterministic checks

```text
bun test \
  packages/adapter-opencode/src/model-discovery-context.test.ts \
  packages/adapter-opencode/src/required-tools.test.ts \
  packages/adapter-opencode/src/capability-inventory.test.ts \
  packages/adapter-opencode/src/install-tools.test.ts \
  packages/adapter-opencode/src/runner-adapter.test.ts \
  apps/cli/src/tui/runner-dashboard/__tests__/runner-install-contract.test.ts \
  apps/cli/src/tui/__tests__/runner-install-e2e.test.tsx
```

Required focused proofs:

1. Every config layer/order/disable/pure/JSONC case and every exact tool mapping is deterministic.
2. Config declarations, missing/non-file/zero-byte/non-executable/dangling targets, malformed layers, and unrelated commands never become readiness.
3. PATH uses platform delimiter/PATHEXT and can safely prevent reinstall even when a configured pointer is broken; the broken reason remains visible.
4. Plan-stale/effect-recheck, shell second-recheck, and already-present paths keep downloader/installer/post-install calls at the required counts.
5. All adapter/action outcome invariants and dependency-satisfaction mappings are exact; no public status member is added.
6. Nonzero results remain failed and retain original captured stdout/stderr/exit code in direct internal fields while only safe lines cross outward.
7. ANSI/OSC/control/progress, secret, URL, path, line/scalar/byte, fallback, and defense-in-depth bounds pass adversarial fixtures.
8. Same-tool concurrency performs at most one mutation; different tools isolate; followers do not retry shared failures.
9. Cancellation before mutation skips; cancellation during mutation does not kill and reports the actual completed result; later packages stop.
10. Progress/completion render action identity and one bounded cause, and never render adapter raw or dump safe detail arrays.

### Affected-area and broad gates

```text
bun test \
  packages/adapter-opencode/src/context-mode-integration.test.ts \
  packages/adapter-opencode/src/runner-capabilities.test.ts \
  apps/cli/src/tui/runner-dashboard/action-runner.test.ts \
  apps/cli/src/tui/runner-dashboard/render.test.tsx
bunx tsc --noEmit
bun run build:dry-run
git diff --check
bun test
```

Type-check failure is blocking unless an authoritative policy explicitly permits a documented baseline comparison; zero-delta alone is not PASS. Record a digest of the authorized source/test set before focused verification and prove the same digest before and after affected/broad checks.

Changed-path/static inspection must prove no dependency/lock/generated/prompt/skill/registry edit, no `pgrep`/`pkill`/`kill` invocation, no process enumeration/signaling, no binary staging/replacement, no retry loop, no network/live-home automated fixture, and no path under `runner-capability-standardization`. The required pgrep warning fixture is inert text, not an invocation.

### Disposable Linux manual sandbox

Use a disposable container when available; otherwise a fresh `/tmp/deck-cbm-*` root containing HOME, every XDG root, project root, and PATH. Seed and checksum only the identified published v0.9.0 executable, start it only as a harness-owned child, retain its exact PID, and install a sandbox downloader/installer sentinel.

Run Runner Setup and prove: already-present outcome; no sentinel call; no target write; no implicit upgrade; unchanged binary checksum; unchanged real-user OpenCode roots and `~/.local/bin`. Harness/container cleanup may address only the exact PID it created and retained; Deck production/test code never does. A separate sandboxed absent-package lane may demonstrate truthful failure and sanitized presentation, but must not claim active-binary reinstall support.

## Complete Spec-to-Design Coverage Matrix

Test abbreviations: **CFG/EVD** = model-discovery-context + required-tools tests; **INV** = capability-inventory tests; **INS** = install-tools tests; **ADP** = runner-adapter tests; **ACT** = runner-install-contract tests; **UI** = runner-install-e2e/render tests; **STATIC** = changed-path/prohibition audit; **MANUAL** = disposable sandbox.

| Requirement | All scenarios | Design realization | Primary oracle(s) | Status |
|---|---|---|---|---|
| `REQ-EVD-01` | `EVD-01-S1`, `EVD-01-S2` | Decision 1 evaluates executable evidence even without default files. | CFG/EVD | Covered |
| `REQ-EVD-02` | `EVD-02-S1`, `EVD-02-S2`, `EVD-02-S3` | Exact package relevance plus regular/non-empty/executable validation. | CFG/EVD | Covered |
| `REQ-EVD-03` | `EVD-03-S1` | Public source plus exact reason codes on every evaluation. | EVD | Covered |
| `REQ-EVD-04` | `EVD-04-S1`, `EVD-04-S2` | Shared adapter config authority; declaration and broken target remain non-installed. | CFG/EVD, INV | Covered |
| `REQ-RCK-01` | `RCK-01-S1`, `RCK-01-S2` | Recheck inside single-flight before all first effects; shell second check. | INS | Covered |
| `REQ-RCK-02` | `RCK-02-S1` | Initial review and effect checks call the same resolver. | EVD, INS | Covered |
| `REQ-APO-01` | `APO-01-S1`, `APO-01-S2` | Required `already-present` discriminant and no-effect invariant. | INS, ACT | Covered |
| `REQ-APO-02` | `APO-02-S1` | Existing `skipped` status plus satisfied package outcome permits matching config. | ACT, ADP | Covered |
| `REQ-FAL-01` | `FAL-01-S1`, `FAL-01-S2` | Nonzero/unsuccessful attempt remains failed regardless of later/stale evidence. | INS, ACT | Covered |
| `REQ-FAL-02` | `FAL-02-S1` | Captured stdout/stderr/exit retained internally in diagnostic/raw; safe projection preserves cause. | INS | Covered |
| `REQ-FAL-03` | `FAL-03-S1` | Unsatisfied set gates matching prefix only; unrelated work continues. | ACT | Covered |
| `REQ-DIA-01` | `DIA-01-S1`, `DIA-01-S2`, `DIA-01-S3`, `DIA-01-S4` | Exact sanitizer order and 6/240/1024, 2/320, 8/240/1280 bounds. | INS, ACT, UI | Covered |
| `REQ-DIA-02` | `DIA-02-S1` | Inline action ID/label plus bounded cause. | UI | Covered |
| `REQ-DIA-03` | `DIA-03-S1` | Up to six safe debug lines remain, while cause uses at most two. | INS, ACT | Covered |
| `REQ-PAG-01` | `PAG-01-S1`, `PAG-01-S2`, `PAG-01-S3` | Resolver/result factories derive from catalog IDs and never branch on one error string. | EVD, INS | Covered |
| `REQ-PAG-02` | `PAG-02-S1`, `PAG-02-S2` | Inert v0.9.0 installed/failure fixtures prove skip and safe cause. | INS, UI | Covered |
| `REQ-SAF-01` | `SAF-01-S1`, `SAF-01-S2` | No process API/command in production or automated tests. | STATIC | Covered |
| `REQ-SAF-02` | `SAF-02-S1` | Existing installer only; no Deck staging/activation/rename mechanism. | STATIC, MANUAL | Covered |
| `REQ-SAF-03` | `SAF-03-S1` | No upstream/external target and sandbox checksum proof. | STATIC, MANUAL | Covered |
| `REQ-SAF-04` | `SAF-04-S1` | Failed attempt cannot be redeemed by stale target. | INS, ACT | Covered |
| `REQ-SAF-05` | `SAF-05-S1` | Raw boundary plus exact layered sanitation and bounded render. | INS, ACT, UI | Covered |
| `REQ-CTO-01` | `CTO-01-S1` | Fresh in-gate recheck yields already-present and suppresses effect. | INS | Covered |
| `REQ-CTO-02` | `CTO-02-S1` | Same resolver sequence detects removal and permits existing installer path. | INS | Covered |
| `REQ-MIS-01` | `MIS-01-S1` | No executable/config/canonical proof maps absent and permits install. | EVD, INS | Covered |
| `REQ-MIS-02` | `MIS-02-S1`, `MIS-02-S2` | Dangling/non-file evidence remains install-unsatisfied. | EVD | Covered |
| `REQ-PCV-01` | `PCV-01-S1` | `node:path.delimiter` with injected platform/current directory. | EVD | Covered |
| `REQ-PCV-02` | `PCV-02-S1` | POSIX X_OK / Windows PATHEXT executable validation. | EVD | Covered |
| `REQ-CAN-01` | `CAN-01-S1` | Pre-mutation skip, in-memory script discard, and no mid-effect kill. | INS | Covered |
| `REQ-MPI-01` | `MPI-01-S1` | Scoped keys, per-input catches, ordered one-result-per-ID continuation. | INS, ACT | Covered |
| `REQ-ROL-01` | `ROL-01-S1`, `ROL-01-S2` | One coherent normal inverse commit; no state/schema/user/upstream/process rollback; preserve OpenSpec. | STATIC, release review | Covered |
| `REQ-TST-01` | `TST-01-S1`, `TST-01-S2` | Injected fs/env/PATH/effect seams and temporary roots. | All focused suites | Covered |
| `REQ-TST-02` | `TST-02-S1` | All automated downloader/installer behavior injected; network absent. | All focused suites, STATIC | Covered |
| `REQ-TST-03` | `TST-03-S1` | No real process or process-management invocation in tests. | STATIC | Covered |
| `REQ-TST-04` | `TST-04-S1` | Exact disposable sandbox and harness-owned PID protocol. | MANUAL | Covered |

**Coverage status:** 34/34 requirements and 51/51 parsed scenarios are covered. No requirement is deferred, weakened, or moved outside the approved change.

## Alternatives and Tradeoffs

| Alternative | Decision | Rationale |
|---|---|---|
| Treat setup as upgrade/reinstall | Reject | Recreates the incident and violates the approved product decision. |
| Package/config declaration means installed | Reject | A name can be disabled, remote, unrelated, missing, or non-executable. |
| Let broken effective config veto a real PATH/canonical executable | Reject | It would force an unnecessary reinstall of a genuinely present binary; retain the warning without erasing independent proof. |
| Let lower config override a higher broken entry | Reject | Misrepresents effective local precedence. Only independent executable evidence may prevent reinstall. |
| Duplicate config scanning in `required-tools.ts` | Reject | Violates adapter-authority requirement and creates drift; factor/reuse current source/parser authority. |
| Execute a health/version probe | Reject | Adds side effects/package-specific contracts and turns install assurance into upgrade/health management. |
| Plan-time check only | Reject | Stale plans caused the unsafe effect; effect-time check is mandatory. |
| Cross-process lock/process scan/retry | Reject | Adds ownership, recovery, and hidden-repeat hazards outside scope. |
| Kill/restart/`pgrep -f` | Reject | Ambiguous ownership can disrupt the invoking or unrelated sessions. |
| Deck-owned atomic binary updater | Reject | Duplicates upstream platform/checksum/activation security ownership. |
| New Core action status | Reject | Local `packageOutcome` plus existing status/raw fields provide exact semantics without public union breakage. |
| Expandable diagnostic panel | Reject | Existing inline views can show the required identified bounded cause with fewer state/accessibility changes. |
| Sanitize only in renderer | Reject | Raw content would already have crossed trusted state/log boundaries. |

The deliberate tradeoff is conservative: an old but launchable expected executable suppresses reinstall, while declarations and unusable targets do not. A broken config pointer remains observable but does not erase a real installed binary. Protocol health and config repair beyond existing actions remain outside this package-install repair.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Config-source behavior drifts from future OpenCode | False skip or unnecessary attempt | One shared adapter helper, exact tests, bounded documented layers; unknown remote/managed state never invents positive evidence. |
| OS-launchable binary is protocol-broken | Setup may skip a broken tool | Do not claim health/version; a future side-effect-free health contract requires a separate approved change. |
| Broken config plus valid binary remains configured incorrectly | Runtime binding may still need repair | Preserve reason diagnostic and existing config-action behavior; never trade this for unsafe reinstall. Broader config repair is excluded. |
| Cross-process TOCTOU remains | Another process may race final check/effect | Same-process gate, two shell checks, truthful failure, no retry/process ownership claim. |
| Raw capture leaks through a caller | Secret/path exposure | Non-enumerable internal fields, explicit projection/drop at both adapter and TUI boundaries, serialization sentinels, no raw logging. |
| Sanitizer misses a novel secret form | Exposure | Exact layered key/token/URL/path/control defenses, second sanitation, strict aggregate bounds, adversarial fixtures. |
| Sanitizer removes useful context | Harder diagnosis | Preserve structured stage/code/exit and up to six safe lines versus two-line cause. |
| Required adapter result fields break an unupdated caller | Build/runtime mismatch | Update every production truncation/mapping path in allowlist; repository search, TypeScript, focused/affected/broad checks. |
| Cancellation leaves partial external state | Ambiguous state | Never kill in-flight mutation; complete/report current package and stop before new work; rely on existing installer atomicity. |

## Rollout and Rollback

Ship as one patch-level coherent change only after focused, affected, broad, freshness, static-scope, and disposable-sandbox gates pass. No feature flag, migration, background cleanup, or automatic upstream upgrade is needed. Release notes may say Runner Setup skips positively present tools and surfaces bounded safe causes; they must not claim that upstream active-binary replacement is repaired.

Rollback is one normal inverse commit covering shared config authority, evidence, installer result/recheck, action normalization/gating, and rendering tests together. It must preserve OpenSpec/registry history and must not delete user files, stop processes, touch upstream binaries, touch `runner-capability-standardization`, or use a destructive Git operation without the permanent informed-confirmation flow.

## Open Decisions and Blockers

- **Open decisions:** none.
- **Implementation blocker:** none within approved scope.
- **Task handoff:** unblocked after the coordinator validates this artifact digest and serializes/replays the returned registry intent against the exact base pair. A base conflict or recovery-required outcome is a hard stop.
- **Excluded external dependency:** explicit active-session reinstall/upgrade remains dependent on a fixed upstream release or separately approved ownership-safe design. It does not block this install-missing repair.

## Exact Implementation Instructions Applicability

Not applicable. This change does not modify Deck-owned prompts, skills, system instructions, generated prompt material, or capability instruction bundles. No EII is authorized or required.

## Registry Coordination

This specialist does not write `state.yaml` or `events.yaml`. Exactly one helper-built, helper-parsed `RegistryIntentV1` for final `design.completed` reconciliation is returned out-of-band because embedding it would make the artifact digest self-referential. The intent must bind this final file digest and the registry base digests recorded above. The centralized coordinator must stop on conflict/recovery-required and must not race or hand-edit shared YAML.
