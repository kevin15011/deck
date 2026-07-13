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
bun run build
bunx tsc --noEmit
```

3. The current workflow generates `release.json` for both the stable-tag release path and the main-branch pre-release path. Use the source-backed helper only to inspect or prepare descriptor data locally when needed:

```sh
bun run scripts/prepare-release.ts --help
```

The [helper](../../scripts/prepare-release.ts) and [runtime schema](../../apps/cli/src/upgrade-command/release-descriptor.ts) remain authoritative for flags and accepted content.
4. Review the working tree, version, changelog, tests, generated freshness, and descriptor assets. Before creating a `v*` tag, pushing it, or publishing, stop and obtain explicit user confirmation in a new message. Do not automatically tag, push, or publish.
5. After confirmation, create and push the stable tag using the agreed release process. Observe the [release workflow](../../.github/workflows/release.yml): it builds binaries, generates build information and the skill bundle, creates checksums, prepares `release.json`, and attaches release assets.
6. After publication, confirm the release page contains the expected archives, checksums, and descriptor when applicable. Run the installed CLI's help/version or the relevant supported smoke check. Record any discrepancy before announcing completion.

## Rollback

Use a normal revert or follow-up restoration commit for a release mistake. Do not use destructive reset, restore, clean, or history-rewriting commands. If an artifact or descriptor is wrong, stop publication where possible, correct the source-owned input, and rerun the verification sequence with explicit confirmation gates.
