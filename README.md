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

### Codex CLI

Codex CLI `0.145.0` or newer is a registered Developer Team environment:

```bash
deck codex developer --dry-run
deck codex developer --yes
deck codex developer exec -- --your-prompt
deck codex developer resume <session-id>
deck codex developer resume --last
```

Deck previews project-local changes before applying `.codex/config.toml`, `.codex/agents/deck-*.toml`, `.agents/skills/**`, and its marker-owned `AGENTS.md` section. Deck never enables repository trust. Interactive, exec, resume-by-ID, and resume-latest are public `static-compatible` routes; the adapter does not install or expose a trusted-hook host surface.

See [runner support](docs/runner-support.md) for MCP, memory, ownership, rollback, and known-gap details.

- [Contributing](CONTRIBUTING.md) explains repository setup and verification.
- [Architecture](docs/architecture.md) explains stable package boundaries.
- [Release guidance](docs/maintainers/releasing.md) is for maintainers preparing a release.
- [Release descriptors](docs/release-descriptor.md) explains the `release.json` compatibility reference.
- [OpenSpec](openspec/config.yaml) defines the project SDD configuration.

## Repository

Deck is maintained at <https://github.com/kevin15011/deck>.
