# Deck

> **Audience:** People installing or running Deck.
> **Authority:** explanatory navigation.
> **Maintainer:** Deck maintainers.
> **Evidence:** [root package metadata](package.json), [CLI source](apps/cli/src/main.tsx), and [installer](scripts/install.sh).

Deck is a CLI for installing and operating reproducible AI work environments.

## Start here

Install from source when working on the repository:

```sh
bun install
bun run build
./dist/cli/deck --help
```

For a published binary, use the supported [installer](scripts/install.sh). The CLI itself is the authority for available commands; use `deck --help` for the current command summary.

## Next steps

- [Contributing](CONTRIBUTING.md) explains repository setup and verification.
- [Architecture](docs/architecture.md) explains stable package boundaries.
- [Release guidance](docs/maintainers/releasing.md) is for maintainers preparing a release.
- [Release descriptors](docs/release-descriptor.md) explains the `release.json` compatibility reference.
- [OpenSpec](openspec/config.yaml) defines the project SDD configuration.

## Repository

Deck is maintained at <https://github.com/kevin15011/deck>.
