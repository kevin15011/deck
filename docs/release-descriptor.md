# Release descriptor (`release.json`)

> **Audience:** Release producers and upgrade integrators.
> **Authority:** compatibility reference; runtime schema and canonical fixture define accepted data.
> **Maintainer:** Deck maintainers.
> **Evidence:** [runtime schema](../apps/cli/src/upgrade-command/release-descriptor.ts), [canonical fixture](../apps/cli/src/upgrade-command/__fixtures__/release-fixture.json), [release helper](../scripts/prepare-release.ts), [workflow](../.github/workflows/release.yml), and [archived specification](../openspec/archive/add-self-update-system/spec.md).

`release.json` is the structured release asset consumed by Deck's upgrade flow. The [Zod schema](../apps/cli/src/upgrade-command/release-descriptor.ts) is authoritative; this page is a compatibility-oriented guide, not a duplicated schema.

## Minimal shape

This non-exhaustive example shows the stable top-level form and one binary item:

```json
{
  "schemaVersion": 1,
  "version": "1.2.0",
  "tag_name": "v1.2.0",
  "channel": "stable",
  "published_at": "2026-01-01T00:00:00.000Z",
  "items": [{
    "id": "binary-linux-x64-v1.2.0",
    "kind": "binary",
    "required": true,
    "platform": "linux-x64",
    "asset_name": "deck_v1.2.0_linux-x64.tar.gz",
    "url": "https://github.com/kevin15011/deck/releases/download/v1.2.0/deck_v1.2.0_linux-x64.tar.gz",
    "sha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    "notes": "Linux binary"
  }]
}
```

The supported item kinds are `binary`, `content`, `migration`, `advisory`, and `channel_eol`. Their required fields and validation rules belong to the runtime schema and [canonical fixture](../apps/cli/src/upgrade-command/__fixtures__/release-fixture.json).

## Compatibility behavior

The production GitHub-release consumer strictly parses schema-shaped snake_case data with `parseReleaseDescriptor`. Absent or invalid descriptor data follows the existing legacy tag-based release-info fallback. `parseDescriptorAuto` is a separate utility for explicit callers and is not the production GitHub-release path. Produce schema-shaped descriptors with [the release helper](../scripts/prepare-release.ts), then follow [release guidance](maintainers/releasing.md) for the human release process.
