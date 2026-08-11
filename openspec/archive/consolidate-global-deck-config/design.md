# Design: Consolidate Global Deck Configuration

## Decisions

1. **CLI-owned path, Core-owned schema:** Core exposes path-parameterized read/validate/write primitives. The CLI resolves XDG paths and composes a `DeckConfigStore`; Core no longer imports CLI path modules.
2. **One active store:** production code receives a normalized config/store from the composition root. Project root is passed separately.
3. **No local overrides:** project `.deck/config.json` is legacy-only. Project-specific SDD policy belongs to `openspec/config.yaml`, not an implicit Deck preference layer.
4. **Migration is non-destructive:** legacy files remain untouched. Canonical creation uses validation, private temporary files, atomic rename, and preimage rollback.
5. **Conflict visibility:** multiple differing valid candidates return structured metadata with paths/digests only. TUI/CLI must ask or block; no timestamp/path-order winner.

## Data flow

```text
XDG path resolver -> DeckConfigStore -> normalized global preferences
                                      -> TUI / launch / upgrade / sync
Target project root ------------------> adapters / runner project artifacts
```

## Active global fields

- Adaptive Memory provider and non-secret settings.
- Web Search enablement/provider.
- Per-runner package-instruction selections.
- Orchestrator personality.
- Developer Team execution controls.

`profiles` and `activeProfile` remain schema-compatible but are not imported from project-local candidates or treated as project overrides. Existing local files remain preserved for future explicit OpenSpec/profile migration.

## Migration candidates

1. Canonical XDG config.
2. Legacy global `$XDG_CONFIG_HOME/.deck/config.json`.
3. Legacy global `~/.config/.deck/config.json`.
4. Legacy global `~/.deck/config.json`.
5. Existing current-target `<project>/.deck/config.json`.

If canonical exists, it wins and legacy differences are reported, not merged automatically. If canonical is absent, one unique validated global-field projection may be imported. Distinct projections block for explicit selection.

## Compatibility

Deprecated local read/write functions remain available for migration/tests during this release. New production use is prohibited by tests. Existing runner-native project configuration remains unchanged.

## Security

- Reject unknown/secret fields through existing validation.
- Never include config content in migration diagnostics.
- Atomic writes use same-directory private temporary files.
- Preserve legacy sources and exact canonical preimages on rollback.
