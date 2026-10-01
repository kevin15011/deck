# Releasing Deck

> **Audience:** Deck release maintainers.
> **Authority:** normative human procedure; executable workflow and scripts own implementation details.
> **Maintainer:** Deck maintainers.
> **Evidence:** [root package metadata](../../package.json), [release workflow](../../.github/workflows/release.yml), [release helper](../../scripts/prepare-release.ts), [build-info generator](../../scripts/generate-build-info.ts), and [descriptor reference](../release-descriptor.md).

## Release sequence

1. Confirm the intended product version in root [package metadata](../../package.json) and update [CHANGELOG.md](../../CHANGELOG.md) with evidence-backed release history. Root metadata is the version authority for main builds; a stable `v*` tag is the release trigger in the [workflow](../../.github/workflows/release.yml).
2. Run the focused release checks and the supported verification gates:

```sh
bun test apps/cli/src/upgrade-command/__tests__/release-descriptor.test.ts
bun test scripts/prepare-release.test.ts
bun test
bun run bench:memory
bun run verify:supermemory-compiled
bun run build:dry-run
bunx tsc --noEmit
```

The release workflow owns the four-platform artifact matrix. A local all-target `bun run build` requires macOS because Darwin signing fails closed; Linux maintainers use the host-only dry run above and rely on the matrix for signed Darwin artifacts.

3. The current workflow generates `release.json` for both the stable-tag release path and the main-branch pre-release path. Use the source-backed helper only to inspect or prepare descriptor data locally when needed:

```sh
bun run scripts/prepare-release.ts --help
```

The [helper](../../scripts/prepare-release.ts) and [runtime schema](../../apps/cli/src/upgrade-command/release-descriptor.ts) remain authoritative for flags and accepted content. Developer Team compact prompts are part of the production build. For automatic runtime effects, also apply the [rollout interpretation](../developer-team-execution.md#release-interpretation): code release readiness does not imply that a runtime cohort is eligible to expand.
4. Review the working tree, version, changelog, tests, generated freshness, and descriptor assets. Before creating a `v*` tag, pushing it, or publishing, stop and obtain explicit user confirmation in a new message. Do not automatically tag, push, or publish.
5. After confirmation, create and push the stable tag using the agreed release process. Observe the [release workflow](../../.github/workflows/release.yml): it builds binaries, generates build information and the skill bundle, creates checksums, prepares `release.json`, and attaches release assets.
6. After publication, confirm the release page contains the expected archives, checksums, and descriptor when applicable. Run the installed CLI's help/version or the relevant supported smoke check. Record any discrepancy before announcing completion.

## Native compatibility gate

The release workflow also runs on pull requests and `workflow_dispatch`, with read-only contents permission by default. Neither path can publish. Stable and draft publishing jobs require successful compatibility verification and an explicit tag/main **push**, respectively; only those jobs receive contents-write permission. Existing test, typecheck and provider-runtime gates remain prerequisites.

Build jobs install frozen dependencies, regenerate runner assets with canonical Bun **1.3.12**, generate explicit version/commit/target/channel metadata and skills, and compile each archive once. The compatibility matrix downloads those exact artifacts and runs Node **20 and 24** on each native target:

| Target | Native runner |
|---|---|
| `linux-x64` | `ubuntu-22.04` |
| `linux-arm64` | `ubuntu-24.04-arm` |
| `darwin-x64` | `macos-15-intel` |
| `darwin-arm64` | `macos-14` |

All eight cells must pass before either publishing job. Hosted runner availability depends on repository/GitHub support; unavailable native runners are blockers, not grounds to substitute cross-compilation evidence. Publication downloads the already-verified `deck-*` artifacts and never recompiles them. `compatibility-*` JSON artifacts are separate from release archives/checksum inputs. The generated hook travels in a separate `runner-hook-*` sidecar for the same target build; it is downloaded for the Node fixture but excluded from published release assets.

For local development, use [the current-source sandbox](../../CONTRIBUTING.md#native-node-compatibility-sandbox). To verify an existing native candidate without downloading Node or installing dependencies, use an already-provisioned **absolute** Node executable and the generated hook from the candidate build:

```sh
bun scripts/verify-binary-compatibility.ts \
  --archive /candidate/deck_v0.4.0_linux-x64.tar.gz \
  --checksums /candidate/checksums.txt \
  --node /isolated/node20/bin/node --major 20 \
  --target linux-x64 --version 0.4.0 --commit FULL_EXPECTED_COMMIT_SHA --channel dev \
  --hook /candidate/packages/adapter-codex/assets/codex/hooks/developer-team-execution.generated.js \
  --report /reports/new-compatibility.json
```

Use exact candidate metadata, not the example placeholders, and repeat with Node 24. The verifier checks native target, archive digest and build identity, standalone startup with empty PATH, and the generated hook's Node protocol behavior. Reports explicitly distinguish these checks. No external provider is called; upstream npm package compatibility and untested OS versions remain outside the fixture's coverage. Retain failing JSON as evidence and fix the source rather than bypassing this gate.

## Rollback

Use a normal revert or follow-up restoration commit for a release mistake. Do not use destructive reset, restore, clean, or history-rewriting commands. If an artifact or descriptor is wrong, stop publication where possible, correct the source-owned input, and rerun the verification sequence with explicit confirmation gates.
