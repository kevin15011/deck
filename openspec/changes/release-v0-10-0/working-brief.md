# Release v0.10.0 preparation

## User authorization and publication gates
The user requests preparation and publication of a new Deck release. Local preparation, verification and release commits are authorized. The release skill requires a NEW explicit user confirmation before pushing commits, creating tags or publishing. Do not bypass that gate; there is no publication authorization yet.

## Current official state
- Root package.json is 0.9.0; GitHub confirms v0.9.0 as the latest stable release.
- Prepare 0.10.0 (minor): this branch adds substantial Pi integration/background capabilities and explicit memory tools, not only bug fixes.
- Branch: feat/pi-runner-parity. No existing PR was found. Origin was fetched; its additional Codex assignment-test fix was merged locally without conflicts before preparation.
- Preserve unrelated `.serena/project.yml` and `.bun-cache/`. The local Neon Grid theme is outside Deck and outside the release.
- No push, tag, PR publication, merge into remote main or release has been performed.

## Release scope
Use commits and source since v0.9.0/origin main to write evidence-backed notes. Includes Pi 1.0 global native package/MCP/tool-policy integration, session-owned background subagents, live clarifications, cumulative result recaps, compact counters, memory reload/continuation/compaction support and explicit Pi/Codex memory tools. Shared skill-context ownership, per-runner instruction rendering, preserved model assignments and conflict-aware installation are also included. Do not include the personal theme or claim host-enforced model compliance/full process sandboxing.

## Required evidence
Follow docs/maintainers/releasing.md and .github/workflows/release.yml. Use pinned Bun 1.3.12 (current global Bun is 1.4.0; the earlier temporary pinned executable is gone). Use isolated temporary tooling, never replace the user's global runtime. Verify frozen lockfile installation, focused descriptor/helper tests, full test suite with the workflow timeout, TypeScript, canonical Supermemory OpenSpec validation, deterministic memory benchmark, compiled runtime verification and Linux host dry-run build. Darwin signing/four-platform publication belongs to the workflow matrix and is not locally proven.

Run provider-independent checks with safe credential/environment isolation and retain redacted logs. Preserve unrelated work; do not exclude failures or change broad behavior to make release gates pass. Report concrete blockers for targeted repair. Generated files must come from canonical generators.

## Ownership and next action
One Apply Fast owner prepares root version/changelog and runs the release gates; Lead owns this brief, integration and confirmation-gated remote actions. Release readiness receives focused independent review, not a second full test suite. No personal installation, live provider traffic, other feature work, destructive Git operations, push, tag or publication.

Status: preparing v0.10.0 locally. Ask for remote-action confirmation only after the candidate and evidence are ready.

## Verification recovery after the first attempt
The user confirmed staying on 0.x; target remains 0.10.0, not 1.0.0. The first preparation child reached its 30-minute execution limit. Lead inspected effects: only root package.json and CHANGELOG.md changed in the product worktree; no push/tag/publication occurred. The candidate and persistent gate logs survive.

Evidence at `/home/kevin15011/.cache/deck/release-v0.10.0/status.tsv`: frozen install, focused descriptor/helper tests, TypeScript, OpenSpec validation, deterministic benchmark, compiled smoke and host dry-run build returned zero. The first full test run returned 5680 passed / 42 skipped / 23 failed; its isolated PATH omitted Node and its exported candidate lacked Git metadata, causing confirmed harness failures among those results. The attempted Node-enabled rerun was interrupted without a final result and is NOT a pass.

Lead verified no processes remained in the candidate, confirmed isolated Bun 1.3.12 and Node 24.19.0, and initialized/committed ONLY the disposable candidate snapshot so repository-boundary smoke tests can run. This is not a product release commit or a remote action. The global runtime and unrelated worktree changes remain untouched.

### Exact continuation scope
Reuse `/tmp/deck-release-v0.10.0-tooling/candidate`, its pinned `bun`/`node` siblings and isolated HOME. Read this recovery section before continuing. Do not repeat completed gates or download/install again. Inspect prior effects and rerun ONLY `bun test --timeout 30000` with the corrected PATH and candidate Git metadata, retaining a new log and explicit exit status. Do not run the old gates.sh because it truncates prior status evidence and repeats every gate. Capture bounded failing test names and causes if anything remains. No broad source repair without a concrete finding; no commits, pushes/tags/publication, OpenSpec edits or personal configuration changes. Return the final full-suite status and aggregate readiness against preserved successful gates. Stop early with actionable evidence if the remaining work cannot fit the child deadline, rather than launching another long blind rerun.

## Branch publication authorization
The user explicitly authorized pushing `feat/pi-runner-parity`, will create the PR personally, and wants the eventual tag created from updated main after the merge. Lead verified that the version/changelog exactly match the isolated candidate under verification. Commit and push the local release preparation now; the full-suite rerun is still pending and branch publication is NOT a release-readiness claim. No PR, main merge, tag or release is authorized for immediate execution by this step. Stable-tag publication remains gated on completed verification, the updated main commit and explicit confirmation at that point. Unrelated `.serena/project.yml` and `.bun-cache/` remain excluded.
