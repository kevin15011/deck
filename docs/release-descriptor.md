# Release descriptor (`release.json`)

Every Deck GitHub Release ships a structured `release.json` asset
alongside the platform tarballs and `checksums.txt`. The descriptor is
the **official contract** between the release pipeline and the
self-update orchestrator, defined by
[`openspec/changes/add-self-update-system/spec.md`](../changes/add-self-update-system/spec.md)
(REQ-RD-001 .. REQ-RD-011).

It replaces the previous regex-based release-body SHA-256 parsing and
lets the upgrade orchestrator reason about typed release items
(`binary`, `content`, `migration`, `advisory`, `channel_eol`) instead
of unstructured release notes.

The schema is defined as a Zod object in
[`apps/cli/src/upgrade-command/release-descriptor.ts`](../apps/cli/src/upgrade-command/release-descriptor.ts).
A canonical spec-shaped example is committed at
[`apps/cli/src/upgrade-command/__fixtures__/release-fixture.json`](../apps/cli/src/upgrade-command/__fixtures__/release-fixture.json).

> **Field naming**: the official descriptor uses **snake_case** field
> names exactly as required by the spec (`tag_name`, `published_at`,
> `asset_name`, `sha256`, `from_schema_version`, `affected_versions`,
> `successor_channel`, ...). The earlier design-phase camelCase form
> is supported only via a `designDescriptorToSpec` compatibility
> transform; consumers that produce descriptors MUST emit the
> spec-shaped form.

## Top-level fields

| Field              | Type                                | Required | Notes                                                                  |
| ------------------ | ----------------------------------- | -------- | ---------------------------------------------------------------------- |
| `schemaVersion`    | `1` (literal)                       | yes      | Bumped on breaking schema changes. Unknown versions fail.              |
| `version`          | string                              | yes      | Semver, e.g. `1.2.0`.                                                  |
| `tag_name`         | string                              | yes      | Git tag, e.g. `v1.2.0`.                                                |
| `channel`          | `"stable"\|"beta"\|"dev"`           | yes      | Release channel.                                                       |
| `published_at`     | ISO-8601 datetime                   | yes      | e.g. `2026-06-02T12:00:00.000Z`.                                       |
| `release_notes_url`| HTTPS URL                           | no       | Human-readable release notes.                                          |
| `min_deck_version` | string                              | no       | Minimum Deck version required to apply this release.                   |
| `items`            | `ReleaseItem[]`                     | yes      | Ordered list of release items (see below).                            |

## Item kinds

Every item has a stable `id`, a `kind` discriminator, a
`required: boolean` flag, and the **required shared fields**
`asset_name`, `sha256`, and `notes` (spec REQ-RD-003). Only `binary`
items replace the Deck executable; all other kinds act on the user's
selection, runner config, or TUI advisory surface.

### `binary` — replace the Deck binary

| Field         | Type                                | Notes                                                       |
| ------------- | ----------------------------------- | ----------------------------------------------------------- |
| `id`          | string                              | Stable id; used in rollback / history.                     |
| `kind`        | `"binary"`                          | Discriminator.                                              |
| `required`    | boolean                             | If `false`, the user can skip this item.                    |
| `minDeckVersion` | string?                          | Optional minimum Deck version.                              |
| `platform`    | string                              | e.g. `linux-x64`, `darwin-arm64`.                           |
| `asset_name`  | string                              | MUST match `deck_v{VERSION}_{OS}-{ARCH}.tar.gz` (REQ-RD-005). |
| `url`         | HTTPS URL                           | Asset download URL (GitHub release asset).                  |
| `sha256`      | 64 lowercase hex                    | SHA-256 of the asset. Source of truth for verification.    |
| `notes`       | string                              | Free-form notes attached to the item.                       |

### `content` — re-apply Deck content to detected runners

| Field          | Type                                            | Notes |
| -------------- | ----------------------------------------------- | ----- |
| `id`           | string                                          |       |
| `kind`         | `"content"`                                     |       |
| `required`     | boolean                                         |       |
| `minDeckVersion` | string?                                       |       |
| `asset_name`   | string                                          | Tarball containing the content payload. |
| `url`          | HTTPS URL                                       |       |
| `sha256`       | 64 lowercase hex                                |       |
| `notes`        | string                                          |       |
| `content_kinds`| `Array<"prompts"\|"skills"\|"subagents"\|"mcp"\|"packageInstructions">` | What the payload contains. |

`content`-only releases are allowed: a release with no `binary` item
triggers a content sync without replacing the Deck binary.

### `migration` — apply a schema/data migration

| Field                 | Type                | Notes |
| --------------------- | ------------------- | ----- |
| `id`                  | string              |       |
| `kind`                | `"migration"`       |       |
| `required`            | boolean             |       |
| `minDeckVersion`      | string?             |       |
| `asset_name`          | string              |       |
| `url`                 | HTTPS URL?          |       |
| `sha256`              | 64 lowercase hex    |       |
| `notes`               | string              |       |
| `from_schema_version` | number (REQ-RD-007) | e.g. `1` |
| `to_schema_version`   | number (REQ-RD-007) | e.g. `2` |

`migration` items require an automatic backup before applying.

### `advisory` — surface a notice in the TUI

| Field                | Type                                | Notes |
| -------------------- | ----------------------------------- | ----- |
| `id`                 | string                              |       |
| `kind`               | `"advisory"`                        |       |
| `required`           | boolean                             |       |
| `minDeckVersion`     | string?                             |       |
| `asset_name`         | string                              |       |
| `url`                | HTTPS URL?                          |       |
| `sha256`             | 64 lowercase hex                    |       |
| `notes`              | string                              |       |
| `severity`           | `"info"\|"warning"\|"critical"`     | Drives banner color in the TUI. |
| `affected_versions`  | `string[]` (REQ-RD-008)             | e.g. `["<=1.0.0"]`.             |

`advisory` items do not mutate any files; they are rendered as a red
banner in the TUI when the descriptor includes them.

### `channel_eol` — notify that the release channel is being deprecated

| Field                | Type   | Notes |
| -------------------- | ------ | ----- |
| `id`                 | string |       |
| `kind`               | `"channel_eol"` |       |
| `required`           | boolean |       |
| `minDeckVersion`     | string? |       |
| `asset_name`         | string |       |
| `url`                | HTTPS URL? |   |
| `sha256`             | 64 lowercase hex | |
| `notes`              | string |       |
| `successor_channel`  | string (REQ-RD-009) | Suggested successor channel (e.g. `"stable"`). |

## Binary asset naming pattern (REQ-RD-005)

`binary` items' `asset_name` MUST match the regex

```
^deck_v[0-9A-Za-z.\-+]+_[a-z0-9]+-[a-z0-9]+\.tar\.gz$
```

This is enforced by the Zod schema (`BINARY_ASSET_NAME_PATTERN`) and
exposed as a re-export from `release-descriptor.ts` so maintainers can
validate filenames before committing.

## Validation rules (summary)

The full table lives in
[`openspec/changes/add-self-update-system/spec.md`](../changes/add-self-update-system/spec.md)
under *Validation Rules* and *Error Contracts*. Highlights:

- `release.json` MUST be valid JSON. Malformed input is rejected with
  `DESCRIPTOR_INVALID`.
- `items[].kind` MUST be one of the five supported values. Unknown
  kinds are rejected.
- `items[].sha256` MUST be 64 lowercase hex characters. Mixed case
  or wrong length is rejected.
- A release without a `release.json` falls back to the legacy
  binary-only upgrade path (`FALLBACK_LEGACY`).
- SHA-256 mismatch aborts the upgrade and triggers rollback
  (`CHECKSUM_MISMATCH`).

## Generating a descriptor

The maintainer-facing helper lives at `scripts/prepare-release.ts`
and emits the spec-shaped form by default.

```sh
# Interactive: prompts for every field
bun run scripts/prepare-release.ts

# Non-interactive: every required field from flags
bun run scripts/prepare-release.ts \
  --non-interactive \
  --version 1.2.0 \
  --tag v1.2.0 \
  --channel stable \
  --out release.json

# CI mode: scan a directory of pre-built tarballs and emit a
# descriptor whose SHA-256s are computed from the actual archives
bun run scripts/prepare-release.ts \
  --non-interactive \
  --version 1.2.0 \
  --tag v1.2.0 \
  --channel stable \
  --from-assets-dir release-assets \
  --asset-base-url https://github.com/owner/repo/releases/download/v1.2.0 \
  --out release-assets/release.json

# Just compute and print the SHA-256 of a local file
bun run scripts/prepare-release.ts --sha256-file dist/cli/deck_v1.2.0_linux-x64.tar.gz
```

The CI release workflow (`.github/workflows/release.yml`) calls the
`--from-assets-dir` mode after building all platform binaries, then
attaches the resulting `release.json` to the GitHub Release.

## Compatibility transform (camelCase → spec-shaped)

For consumers that still hold a legacy design-shaped (camelCase)
descriptor (e.g. cached release pipelines from before this change),
`releaseDescriptorToSpec(design)` in
`apps/cli/src/upgrade-command/release-descriptor.ts` normalizes the
fields into the spec contract. The official descriptor — what the
upgrade orchestrator consumes and what `prepare-release.ts` emits —
is always spec-shaped.
