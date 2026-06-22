# Exploration: Deck TUI fails to detect 0.1.8 update

## Goal
Diagnose why a Deck binary built at `0.1.7` reports “No upgrade available” when release `0.1.8` exists, and identify the smallest fix or workaround.

## Current State
- The TUI fires a non-blocking release check on mount (`apps/cli/src/tui/release-check.ts`).
- The check delegates to `fetchReleaseDescriptor()` in `apps/cli/src/upgrade-command/github-release.ts`.
- `fetchReleaseDescriptor()` first calls the GitHub Releases API at:
  `https://api.github.com/repos/{GITHUB_OWNER}/{GITHUB_REPO}/releases/latest`
- The owner/repo constants are hard-coded as `gentleman-programming/deck`.
- The actual repository that contains the published releases is `kevin15011/deck` (confirmed by `git remote -v` and `gh release list`).
- `curl` is invoked without `-f`, so a 404 response returns exit code `0` with a JSON body `{"message":"Not Found"}`.
- The code parses that body, finds no `tag_name`/`assets`, falls back to legacy mode with a default `v0.0.0`, and `compareVersions("0.1.7", "0.0.0")` reports the local build as newer.
- The TUI therefore receives `kind: "none"` and logs `No upgrade available.`

## Relevant Files
- `apps/cli/src/upgrade-command/github-release.ts` — release fetch, owner/repo constants, version comparison, availability decision.
- `apps/cli/src/tui/release-check.ts` — TUI wrapper that translates backend result into `ReleaseCheckState`.
- `apps/cli/src/tui/app.tsx` — mounts the release check and routes the “Update Deck” menu action.
- `apps/cli/src/doctor-command/doctor-diagnostics.ts` — also calls `fetchReleaseDescriptor()`; affected by the same issue.
- `apps/cli/src/runtime/build-info.generated.ts` — current source build info is `0.1.7`.
- `apps/cli/src/upgrade-command/release-descriptor.ts` — schema for `release.json`.
- `scripts/prepare-release.ts` / `scripts/generate-build-info.ts` — release/build metadata generation.

## Constraints
- No product code changes during exploration.
- No destructive git operations.
- Network reads only via `gh` / safe commands.

## Risks
- Changing the owner constant to `kevin15011` fixes the immediate symptom but hard-codes a personal fork; if the canonical upstream is supposed to be `gentleman-programming/deck`, the release process should move there instead.
- Several tests reference `gentleman-programming/deck` URLs; a constant change will require test updates or the tests will fail/ become misleading.
- Simply making curl fail on 4xx improves robustness but would change the user-facing message from `No upgrade available.` to a network-error message; it does not by itself restore update detection.

## Options and Tradeoffs

1. **Align constants with the actual release repository (`kevin15011/deck`)**
   - Pros: One-line fix. Immediately makes 0.1.8 detectable. Matches current git remote and release location.
   - Cons: Hard-codes a fork owner; may diverge from intended upstream branding. Tests referencing `gentleman-programming/deck` need updating.
   - Effort: Low.

2. **Make owner/repo configurable at build/runtime**
   - Pros: Supports both upstream and fork builds cleanly; avoids future hard-coding issues.
   - Cons: Larger change; requires build-info and release-script updates.
   - Effort: Medium.

3. **Harden curl calls (add `-f` / check HTTP status) without changing owner**
   - Pros: Prevents silent false negatives on 404/rate-limit; surfaces real network problems.
   - Cons: Does not fix the missing update on `gentleman-programming/deck` because releases are not published there.
   - Effort: Low, but insufficient alone.

## Recommendation
Adopt **Option 1** as the immediate fix (change `GITHUB_OWNER` to `kevin15011` in `github-release.ts`) and add **Option 3** as a defensive hardening measure so 404s and rate-limits surface as `network-error` instead of `none`. If the project intends `gentleman-programming/deck` to remain canonical, the release assets should be published there and the constant kept as-is; however the observed evidence points to `kevin15011/deck` as the active release repo.

## Actionable Diagnosis
**Yes.** The root cause is identified: the update check targets a non-existent repository (`gentleman-programming/deck`) and the 404 response is mis-parsed as a valid older release, producing a false negative.

## Suggested Lifecycle Outcome
`propose` — a small proposal should be created to change the owner constant and harden curl error handling, followed by spec/design tasks if build-time configurability is desired.

## Open Questions
- Is `gentleman-programming/deck` still intended to be the canonical upstream, or has the project permanently moved to `kevin15011/deck`?
- Should the owner/repo be derived from `git remote` or build-time environment variables to avoid future mismatches?
- Do CI release workflows already publish to `kevin15011/deck`, or are they misconfigured?

## Ready for Proposal
Yes. The next step is a short proposal to:
1. Update `GITHUB_OWNER` in `apps/cli/src/upgrade-command/github-release.ts` to `kevin15011`.
2. Add `-f` (fail-on-error) and/or HTTP-status inspection to `curlReleasesApi` / `curlReleaseJsonAsset`.
3. Update tests and release-descriptor references that still assume `gentleman-programming/deck`.

## Commands Run
- `git remote -v` — confirmed origin is `kevin15011/deck`.
- `gh api repos/kevin15011/deck/releases/latest` — confirmed latest release is `0.1.8`, assets include `release.json`, `target_commitish` is `main`.
- `gh release download 0.1.8 --repo kevin15011/deck --pattern release.json --dir /tmp/deck-release` — downloaded descriptor; verified `version: "0.1.8"`, `tag_name: "0.1.8"`.
- `gh api repos/gentleman-programming/deck/releases/latest` — returned 404 `{"message":"Not Found"}`.
- `curl -s -L -w ... https://api.github.com/repos/gentleman-programming/deck/releases/latest` — confirmed HTTP 404 with curl exit code 0.
- Read source paths listed in Relevant Files.
