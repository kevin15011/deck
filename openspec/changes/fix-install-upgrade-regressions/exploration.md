# Exploration: Install + Upgrade Regressions in 0.1.3

## Goal

Investigate two regressions observed in Deck 0.1.3:

1. **Install regression** — Serena (and any tool whose `source` ≠ `id`) reports a successful install but nothing is installed. MCP config is still written, so the user sees a working MCP entry pointing at a binary that does not exist.
2. **TUI upgrade regression** — `deck` TUI's home menu always shows "Update Deck" (no version suffix), and pressing Enter logs `[HH:MM:SS] No upgrade available.` even after a newer release has been published on GitHub.

The exploration is read-only: no production code is modified.

## Scope

- In scope:
  - `apps/cli/src/tui/app.tsx` — the TUI install path (`installPackages` callback) and the upgrade entry point (`continueFromCurrent` for `update-deck`).
  - `apps/cli/src/tui/runner-dashboard/action-runner.ts` — how `RunnerAction.source` / `RunnerAction.toolId` flow into the package installer.
  - `apps/cli/src/tui/release-check.ts` — release-check state machine mapping `ReleaseFetchResult` → `ReleaseCheckState`.
  - `apps/cli/src/upgrade-command/github-release.ts` — `fetchReleaseDescriptor`, `compareVersions`, `buildLegacyReleaseInfo`, cache helpers.
  - `packages/adapter-opencode/src/capability-plan.ts` — where `source` / `toolId` are populated for `install-opencode-plugin` / `npm-install` actions.
  - `packages/adapter-opencode/src/installation-plan.ts` — the `OPENCODE_INSTALLABLE_TOOLS` catalog (id vs module).
  - `packages/adapter-opencode/src/capability-catalog.ts` — the `source` field for serena/context7/rtk/etc.
- Out of scope:
  - The Pi (`pi-development`) install path uses a different catalog and installer; this exploration is limited to the OpenCode `installPackages` callback. Pi regressions would warrant a follow-up change.
  - The `deck upgrade` CLI command (`apps/cli/src/upgrade-command/index.ts`) is a separate code path; the user reported the TUI specifically.

## Current State

### Bug 1 — Install regression (Serena)

The dashboard's "Review & Install" plan produces, for each missing capability, one or more `RunnerAction` entries. For Serena the entry looks like:

```
{
  id: "capability.serena.install",
  kind: "install-opencode-plugin",
  toolId: "serena",         // ← catalog id (installation-plan.ts id)
  source: "oraios/serena",  // ← pip/uv package name (capability-catalog.ts source)
  ...
}
```

The `action-runner.runPackageInstall` resolves a `packageName` for the package installer callback:

```ts
// apps/cli/src/tui/runner-dashboard/action-runner.ts:244
const packageName = action.source ?? action.toolId ?? action.id;
...
// line 250-254
const installResults = await runner(
  dependencies.runnerCommand,
  [{ name: packageName, source: action.source ?? "" }],
  dependencies.onInstallResult ?? (() => undefined),
);
```

So the dashboard passes `name: "oraios/serena"`, `source: "oraios/serena"` to the TUI's `installPackages` callback. Inside that callback:

```ts
// apps/cli/src/tui/app.tsx:776-790
installPackages: async (runnerCommand, packages, onResult) => {
  log(`installPackages (OpenCode): installing ${packages.map(p => p.name).join(", ")}`);
  // Use the package names as tool IDs directly — the plan builder already determined these need installing
  const selectedToolIds = packages.map(p => p.name).filter(Boolean);
  // Get the tools from the catalog (not re-reviewing installed status — plan already decided)
  const toolsToInstall = OPENCODE_INSTALLABLE_TOOLS.filter(t => selectedToolIds.includes(t.id));
  log(`installPackages (OpenCode): matched ${toolsToInstall.length}/${selectedToolIds.length} tools from catalog`);
  if (toolsToInstall.length === 0) {
    return packages.map(p => ({ success: true, message: `${p.name} already installed.` }));
  }
  const installResults = await installOpenCodeTools("opencode", toolsToInstall, (r) => {
    onResult({ success: r.success, message: r.message });
  });
  ...
}
```

The `OPENCODE_INSTALLABLE_TOOLS` catalog (`packages/adapter-opencode/src/installation-plan.ts:17-44`) uses `id` as the lookup key — and for serena the catalog `id` is `"serena"`, not `"oraios/serena"`. So the filter finds zero tools, the early-return fires with `success: true` and the lie `"oraios/serena already installed."`, and `action-runner.runPackageInstall` then reports `Installed oraios/serena.` (line 271) because no `installResults[].success === false` flagged a failure.

The user's debug log is the smoking gun:

```
installPackages (OpenCode): installing oraios/serena
installPackages (OpenCode): matched 0/1 tools from catalog
... result=executed msg=Installed oraios/serena.
... capability.serena.mcp-config result=executed msg=Serena MCP config written successfully
```

The MCP-config action is a separate `write-mcp-config` entry in the same plan (`packages/adapter-opencode/src/capability-plan.ts:286-299`), so it runs to completion independently. The net result is `opencode.json` gains a Serena MCP entry, but no `serena` binary is on PATH.

#### Tools affected by the same shape mismatch

The mismatch is general: every catalog entry where `source !== id` is broken. From the user-facing capability catalog and the installer plan:

| Capability    | `capability-catalog.ts` `source`         | `installation-plan.ts` `module` / `id`        | Lookup match? |
|---------------|------------------------------------------|----------------------------------------------|---------------|
| serena        | `oraios/serena`                          | `module: oraios/serena`, `id: serena`        | ❌            |
| context7      | `@upstash/context7-mcp`                  | `module: @upstash/context7-mcp`, `id: context7` | ❌ (and mcp-only — never installed via this path anyway, but its MCP config is written by a separate `write-mcp-config` action) |
| context-mode  | `context-mode`                           | `module: context-mode`, `id: context-mode`   | ✅            |
| codebase-memory (capability-plan.ts override) | `codebase-memory`             | `module: DeusData/codebase-memory-mcp`, `id: codebase-memory` | ✅ (overridden) |
| rtk (capability-plan.ts override)             | `rtk`                        | `module: rtk-ai/rtk`, `id: rtk`              | ✅ (overridden) |

So serena is the most visible victim, but **any new capability whose catalog `source` is the upstream package name (rather than the catalog id)** is silently broken. This is a class of bug, not a one-off.

#### Why the false-positive "Installed" message is dangerous

`runPackageInstall` decides success based on whether every `installResults[].success === true`. When `toolsToInstall.length === 0`, the TUI's `installPackages` callback returns `success: true` for every input package (line 784). The action-runner never sees a failure, so it reports `status: "executed"` with `Installed <packageName>.`. This is the literal source of the "result=executed msg=Installed oraios/serena." line.

### Bug 2 — TUI upgrade regression ("No upgrade available")

The TUI fires one release check on mount:

```ts
// apps/cli/src/tui/app.tsx:480-499
useEffect(() => {
  let cancelled = false;
  const deps: ReleaseCheckDeps = {};
  runReleaseCheckWithTimeout(DEFAULT_RELEASE_CHECK_TIMEOUT_MS, deps)
    .then((state) => { if (!cancelled) setReleaseCheck(state); ... })
    .catch((err) => { ... setReleaseCheck({ kind: "network-error", error: ... }); });
  return () => { cancelled = true; };
}, []);
```

The result is rendered on the home screen (no banner for `none` per `home-screen.tsx:46`) and the "Update Deck" menu entry reads `"Update Deck"` (no version suffix) when `releaseCheck.kind !== "available"` (`menu-options.ts:39-42`).

When the user presses Enter on that menu entry, `continueFromCurrent` falls through to the `none` branch:

```ts
// apps/cli/src/tui/app.tsx:1190-1195
addLog(
  releaseCheck.kind === "pending"
    ? "Release check still running; try again in a moment."
    : releaseCheck.kind === "network-error"
      ? `Release check failed (${releaseCheck.error}); cannot upgrade.`
      : "No upgrade available."
);
```

This is the source of the user's `[3:29:21 PM] No upgrade available.` log line (timestamps come from `app.tsx:341` — `new Date().toLocaleTimeString()`).

For `releaseCheck.kind === "none"` to fire, `toReleaseCheckState` must return `{ kind: "none" }` for the actual fetched release. The two paths are:

```ts
// apps/cli/src/tui/release-check.ts:165-181
function descriptorToState(descriptor: ReleaseJson, currentVersion: string): ReleaseCheckState {
  if (compareVersions(currentVersion, descriptor.version) >= 0) {
    return { kind: "none" };
  }
  ...
}
```

```ts
// apps/cli/src/tui/release-check.ts:183-196
function legacyToState(info: ReleaseInfo, currentVersion: string): ReleaseCheckState {
  if (!info.version) return { kind: "none" };
  if (compareVersions(currentVersion, info.version) >= 0) {
    return { kind: "none" };
  }
  return { kind: "available", version: info.version, ... };
}
```

Both paths only return "none" when `currentVersion >= latestVersion`. With the user on `0.1.3` and a published `>=0.1.4`, this should be impossible — so the most actionable hypothesis is that the **fetch is returning the wrong version** in practice, not that the comparator is wrong.

#### Concretely, four plausible failure modes for the fetch (ranked by how likely they are to produce this symptom)

1. **The GitHub release's `release.json` was never attached (or is malformed) and the legacy fallback happens to round-trip to a "same or older" version.** The release workflow attaches `release.json` only on `v*` tag pushes (`release.yml:130`); pre-release main-push artifacts use a `build-*` tag and `dev` channel, and the legacy path in `buildLegacyReleaseInfo` strips the leading `v` from the tag. If the release was published manually (e.g., a hot-fix after a failed CI run) without `release.json`, the user gets whatever the tag says. If the tag was re-used (`v0.1.3` again) the comparator correctly returns "none".
2. **The descriptor's `version` field is stale/wrong relative to the tag.** `scripts/prepare-release.ts` reads `--version` and `--tag` separately; it is possible (a maintainer mistake) to publish `tag=v0.1.4` with `version=0.1.3` in the descriptor. The comparator would then return "none" even though the tag is newer. Nothing in `fetchReleaseDescriptor` cross-checks `descriptor.version` against `descriptor.tag_name` / GitHub's `tag_name`.
3. **Network error masquerading as "none".** The fetch path is `curl -sL ...` with no `--fail`; an HTTP 4xx/5xx on either the API call or the asset call returns a non-zero `exitCode` and a `network-error` (not "none"). So this is unlikely to be the cause, but a *partial* failure (e.g., `release.json` is fetched but `JSON.parse` throws) is reported as `legacy` with `reason: "invalid"` — and the legacy `version` is then read from `tag_name`, not from the broken descriptor. If `tag_name` is missing, `buildLegacyReleaseInfo` defaults to `v0.0.0` and the comparator returns 1 (current > latest) → "none". The user would still see the symptom.
4. **Caching/staleness from a prior failed run.** `fetchReleaseDescriptor` *writes* a sidecar cache at `$XDG_CACHE_HOME/deck/releases/latest-release.json` after every successful parse, but the TUI's `runReleaseCheckWithTimeout` does **not** read it (`github-release.ts:282-290` defines `readReleaseCache`; it is exported but unused by the TUI path). The 6 h TTL mentioned in the design comment is enforced by the orchestrator, not the TUI. So the TUI always re-fetches — no stale-cache path. This rules out caching as a cause.

The most likely root cause is therefore **(1) or (2)**: the published artifact does not actually carry a `version` strictly greater than `0.1.3` in the field the TUI reads (descriptor.version, falling back to the tag), even though the user expects a newer release to be available. The code path itself is correct; the data on the wire is the problem.

A secondary issue is that the TUI's release check is **fire-once on mount with no manual refresh** (`app.tsx:480-499`). If the user opens the TUI before the new release is published, the check resolves to "none" and stays "none" until the TUI is restarted. There is no "Re-check for updates" affordance. This is a UX gap, not the cause of the immediate symptom, but it is the reason the user has to relaunch the TUI to pick up a newly-published release.

## Root Cause

### Bug 1 — Install regression

`apps/cli/src/tui/app.tsx:776-791` resolves the catalog lookup key from `packages[i].name`, but the value passed in is `action.source` (`"oraios/serena"`) rather than the catalog id (`"serena"`). The catalog filter therefore matches zero rows and the callback short-circuits to "already installed" with `success: true`. The `action-runner` then synthesizes a misleading `Installed oraios/serena.` message because none of the per-package results failed.

Affected file: `apps/cli/src/tui/app.tsx`.
Adjacent file: `apps/cli/src/tui/runner-dashboard/action-runner.ts:244` decides the value passed in; both ends need to agree on the contract.

### Bug 2 — TUI upgrade regression

There is no obvious code bug in the comparator or in the fetch. The most likely root cause is upstream data (missing `release.json`, wrong `version` in the descriptor, or a re-used tag) on the specific release(s) the user is looking at. A secondary UX gap is that the TUI's release check is fire-once and has no manual refresh.

Affected file: `apps/cli/src/tui/app.tsx` (release-check `useEffect` and "no upgrade available" log); `apps/cli/src/tui/release-check.ts` (state mapping); `apps/cli/src/upgrade-command/github-release.ts` (cross-check between `descriptor.version` and `tag_name` is missing).

## Relevant Files

| File | Role |
|------|------|
| `apps/cli/src/tui/app.tsx` | TUI home/upgrade flow; contains the buggy `installPackages` callback (lines 776-791), the `addLog` "No upgrade available." branch (lines 1190-1195), and the fire-once release-check `useEffect` (lines 480-499). |
| `apps/cli/src/tui/runner-dashboard/action-runner.ts` | Resolves `packageName` from `action.source ?? action.toolId ?? action.id` (line 244) and forwards it as `name` to the TUI's `installPackages`. |
| `apps/cli/src/tui/release-check.ts` | Maps `ReleaseFetchResult` → `ReleaseCheckState`. `descriptorToState` (165-181) and `legacyToState` (183-196) are the only places "none" is produced. |
| `apps/cli/src/upgrade-command/github-release.ts` | `fetchReleaseDescriptor` (199-276), `buildLegacyReleaseInfo` (311-358), `compareVersions` (409-433), `readReleaseCache` / `writeReleaseCache` (282-299). |
| `packages/adapter-opencode/src/capability-plan.ts` | Builds the plan's `install-opencode-plugin` / `npm-install` actions with `source: tool.module` (e.g. 283) and `toolId: tool.id` (139, 175, 239, 285). |
| `packages/adapter-opencode/src/installation-plan.ts` | The `OPENCODE_INSTALLABLE_TOOLS` catalog. Catalog `id` is the lookup key; `module` is the install-time package name. |
| `packages/adapter-opencode/src/capability-catalog.ts` | Authoritative `source` field per user-facing capability (line 85 for serena, 96 for context7, 63 for codebase-memory, 74 for rtk, 52 for context-mode). |
| `apps/cli/src/upgrade-command/release-descriptor.ts` | Zod schema for `release.json`; `parseReleaseDescriptor` (210-220) is the only validation gate. |
| `apps/cli/src/menu-options.ts` | Renders the "Update Deck" label; always shows plain `"Update Deck"` when `releaseCheck.kind !== "available"`. |
| `apps/cli/src/tui/screens/home-screen.tsx` | Suppresses the banner for `none` (line 46), which is consistent with the contract but reinforces why the user only sees a "no upgrade" log when they press Enter. |
| `apps/cli/src/doctor-command/doctor-report.ts:148` | Doctor's "No upgrade available" message is in `renderBinary`, which is unreachable because `runDoctorDiagnostics` never returns a `binary` field. Unrelated to this regression but a dead-code smell. |
| `openspec/changes/fix-opencode-package-instructions/exploration.md` | Earlier sibling change that followed the same exploration format — useful template. |

## Constraints

- **Backward compat of the install result contract.** `installPackages` returns `Array<{ success: boolean; message?: string }>`. The action-runner keys off `success` to decide `executed` vs `failed`. Any fix must keep the success/failure semantics honest — never synthesize `success: true` for an action that was not actually executed.
- **Action shape is the contract between the plan builder and the executor.** `action-runner.runPackageInstall` reads `action.source` / `action.toolId`; `capability-plan.ts` populates both. The fix needs to agree on which one is authoritative for the install lookup.
- **Multiple install kinds are routed through the same callback.** `install-opencode-plugin`, `npm-install`, `mcp-server` actions all reach this callback via `runPackageInstall`. A fix that special-cases serena would be fragile; a fix that uses the catalog `id` consistently is robust across kinds.
- **No write access to production code from this phase.** Only OpenSpec exploration + registry files are written.
- **TUI release check is fire-once on mount.** Any "refresh" UX change is a follow-up, not part of this fix.
- **The `0.1.3` build is committed in `apps/cli/src/runtime/build-info.generated.ts`**, so the TUI's `getBuildInfo().version` is `0.1.3` unless the user is on a different binary. Any test that exercises the upgrade path must inject `currentVersion` to avoid coupling to the committed value.

## Risks

- **Fixing only serena is a partial fix.** The bug is in the lookup, not in serena. A targeted fix that just renames the catalog `source` for serena would also work, but a contract-level fix in `app.tsx` / `action-runner.ts` is more durable.
- **Changing the action contract is a wider blast radius.** `action.source` and `action.toolId` are both read by the existing code; touching one without the other risks the Pi path (which uses a different installer and a different catalog) regressing. The fix should keep both fields populated and decide at the consumer which is authoritative.
- **For Bug 2, the most likely fix is in the data, not the code.** A code change that "always says available" would mask real upgrade issues. Cross-validating `descriptor.version` against `tag_name` in `fetchReleaseDescriptor` is a safer, more targeted change.
- **Existing tests for `runReleaseCheckWithTimeout` only inject happy-path fixtures** (`tui-integration.test.tsx:218-246`); no test covers the case where the descriptor `version` disagrees with the tag, or where the legacy fallback must handle a missing `tag_name`. A fix that adds a `version vs tag_name` check needs new tests.
- **TUI release-check timeout is 5 s.** Any new network call (e.g., an additional fetch for cross-validation) must stay under that budget or move to a fire-and-forget pattern.

## Options and Tradeoffs

### Bug 1 — Fix the install lookup

1. **Make the TUI `installPackages` callback use the catalog `id` as the lookup key (preferred).** Change the package object passed to the callback to include both `id` (catalog id) and `source` (install-time package name); use `id` for the catalog filter and `source` for the actual install command. This aligns with how `installOpenCodeTools` is already structured (it looks up by `t.id` and uses `t.module` / `t.shellInstallUrl` internally).
   - Pros: durable, fixes every `source ≠ id` capability, no change to `installation-plan.ts` or `capability-catalog.ts`, no change to `action-runner.ts` semantics.
   - Cons: changes the `PackageInstallerFn` signature in `action-runner.ts:31-35`; both ends must update together.
   - Effort: Low.

2. **Augment `action-runner.runPackageInstall` to send both `id` and `source` and use `id` in the TUI.** Same fix but framed at the action-runner boundary.
   - Pros: explicit, makes the contract visible.
   - Cons: spreads the same logic across two files; still requires the TUI to use the right field.
   - Effort: Low.

3. **Hardcode a `source → id` alias table in the TUI `installPackages` callback.**
   - Pros: minimal diff.
   - Cons: brittle, needs maintenance every time a new capability is added; does not fix context7 etc.
   - Effort: Low (anti-pattern).

4. **Add a new `OPENCODE_INSTALLABLE_TOOLS_BY_SOURCE` map and look up by source first, then id.**
   - Pros: backwards-compatible if anyone consumes the catalog by source.
   - Cons: two lookup paths to keep in sync; doubles the API surface.
   - Effort: Medium.

### Bug 2 — Make the TUI release check correctly surface "newer is available"

1. **Cross-validate `descriptor.version` against `tag_name` in `fetchReleaseDescriptor`.** If they disagree, return `{ kind: "legacy", reason: "invalid" }` with an error string; the legacy path will then use the tag version. This catches the "descriptor says 0.1.3 but tag is 0.1.4" maintainer mistake and makes the TUI return "available" correctly.
   - Pros: targeted, low risk, reuses the legacy fallback. Catches the most common data bug.
   - Cons: does not help when `release.json` is entirely missing (already handled by the existing legacy path).
   - Effort: Low.

2. **Add a "Re-check for updates" affordance on the home screen and in the doctor command.** Even if the original fetch returned "none", the user can force a re-fetch.
   - Pros: addresses the secondary UX gap; useful regardless of Bug 2's root cause.
   - Cons: new TUI surface; needs design and tests.
   - Effort: Medium.

3. **Have the TUI also read the state.yaml `lastCheck` cache.** If a previous orchestrator run saw an upgrade, surface it even if the latest TUI fetch failed.
   - Pros: makes the TUI more robust to transient network issues.
   - Cons: a separate code path that needs to be kept in sync with the orchestrator; not the cause of the current symptom.
   - Effort: Medium.

4. **Force the legacy fallback to always prefer the tag for the version when `release.json` is missing.** (This is already the case in `buildLegacyReleaseInfo`.) No change needed.
   - Pros: clarifies the existing behavior in a doc/test.
   - Cons: not a fix.
   - Effort: Low (test only).

## Recommendation

For **Bug 1 (install)**: ship option 1 — make the TUI's `installPackages` callback use the catalog `id` (not `source`) for the `OPENCODE_INSTALLABLE_TOOLS` lookup, and pass both `id` and `source` from the action-runner so the callback can install by source when the catalog id is not enough. This is a one-callback + one-runner-line change, makes the contract explicit, and fixes serena, context7, and any future capability whose `source ≠ id`.

For **Bug 2 (upgrade)**: ship option 1 (cross-check `descriptor.version` vs `tag_name`) as a data-correctness fix, plus a follow-up note that the underlying issue is most likely a release-publishing mistake (missing or wrong `release.json`). Optionally also ship option 2 (Re-check affordance) as a separate change to make the TUI more resilient, but do not treat that as a fix for this bug.

## Test Strategy

### Bug 1

Add unit tests at both ends of the contract:

- `apps/cli/src/tui/runner-dashboard/__tests__/action-runner.test.ts` (new or extend existing):
  - For a `capability.serena.install` action (`source: "oraios/serena"`, `toolId: "serena"`), the `installPackages` callback should be called with `{ id: "serena", source: "oraios/serena" }` (or whatever contract is chosen) and the runner should report `executed` only when the installer actually reports success per-tool.
  - For a `capability.context7.mcp-config` action, the `writeMcpConfig` callback path is unchanged.
- `apps/cli/src/tui/__tests__/install-packages-callback.test.ts` (new):
  - Given `packages = [{ id: "serena", source: "oraios/serena" }]`, the TUI callback should resolve the matching `InstallableOpenCodeTool` from `OPENCODE_INSTALLABLE_TOOLS` and call `installOpenCodeTools` with that tool. It should NOT short-circuit to `success: true` with "already installed".
  - Given a package id that does not exist in the catalog, the callback should return `success: false` (not `success: true`) so the action-runner surfaces the failure.
- `packages/adapter-opencode/src/install-tools.test.ts` — already covers the serena path; add a regression test that asserts the catalog lookup uses `id`, not `module`/`source`.

### Bug 2

- `apps/cli/src/upgrade-command/__tests__/github-release.test.ts`:
  - New test: `fetchReleaseDescriptor` returns `legacy` (with `tag_name`-derived version) when the descriptor's `version` disagrees with `tag_name`.
- `apps/cli/src/upgrade-command/__tests__/github-release-descriptor.test.ts`:
  - New test: legacy path with missing `tag_name` falls back to `v0.0.0` (current behavior) and the resulting `ReleaseFetchResult.kind === "legacy"`.
- `apps/cli/src/tui/__tests__/release-check.test.ts` (new — there is currently no dedicated file):
  - `toReleaseCheckState` maps a `legacy` result with a higher `tag_name`-derived version to `available`, even if the descriptor would have been `none`.
  - `toReleaseCheckState` maps a `descriptor` whose `version` equals `currentVersion` to `none`.
- `apps/cli/src/tui/__tests__/tui-integration.test.tsx`:
  - Extend the home-screen test to assert that `Update Deck` label is the plain version (not `→ vX.Y.Z`) when `releaseCheck.kind === "none"`.
- Manual / smoke:
  - Reproduce the user's exact flow: open the TUI, observe the home screen, press Enter on "Update Deck", capture the log line, assert it matches the `addLog` branch in `app.tsx:1190-1195`.

## Open Questions

- Is the user on the production `0.1.3` binary or a dev build? `getBuildInfo().version` differs by mode (`0.1.3` vs `0.0.0-dev`) and could affect version comparisons. The exploration assumes the production binary; this should be confirmed with the user before spec/proposal.
- Is the GitHub release the user is looking at actually tagged with a version strictly greater than `0.1.3`? The analysis here assumes yes; a quick check of the release page would either confirm or invalidate the "upstream data" hypothesis.
- Does the maintainer want a "Re-check for updates" UX, or is the TUI's fire-once check acceptable? This is a design question for the proposal.
- Should the `action-runner.runPackageInstall` short-circuit (when `toolsToInstall.length === 0` is empty AND we genuinely want "already installed") be preserved as a legitimate "skip" path, or should every action explicitly set `status: "manual"` upstream? Currently the `app.tsx` short-circuit silently swallows the no-match case.

## Ready for Proposal

**Partially.** The install-regression root cause is well-understood and the fix is mechanical. The upgrade-regression root cause is most likely upstream data, with a small code-side hardening (`descriptor.version` ↔ `tag_name` cross-check) recommended. The proposal can proceed with the install fix as the primary deliverable and the upgrade cross-check as a secondary, lower-priority item. The "Re-check for updates" UX gap should be a separate change.
