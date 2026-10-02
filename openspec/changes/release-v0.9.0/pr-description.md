# Release v0.9.0: Linux sandbox, frontend design routing, and runner setup improvements

Deck now provides a disposable Linux sandbox for testing installation against the stable Codex, OpenCode, and Claude Code CLIs, with either Deck Canary included or runners only. Runner setup has visible installation and model-loading/saving feedback, neutral environment labels, and preselected packages that still require Review & Install.

The shared Developer Team can select compatible frontend aesthetic and supporting skills from an expanded standalone catalog, record their responsibilities, and replace a rejected direction. All supported adapters materialize the canonical resources, with upstream licenses and source provenance retained. Codex sessions allow Lead-directed delegation, use the active Deck executable for Serena, and can launch with session-only memory and hook suppression when no verified project identity is available. OpenCode exposes Context7 again.

Root version and changelog are prepared for 0.9.0. Validation evidence is recorded in `openspec/changes/release-v0.9.0/working-brief.md`. The release workflow generates signed platform artifacts and the production descriptor; this PR does not publish or tag a release.

Validation: all 339 Deck test files were exercised (5,170 passes before five fixture corrections, three skips); the affected files then passed 113 tests and the remaining sync regression passed separately. Vendor resource tests are excluded from discovery. Descriptor/helper tests, frozen dependencies, TypeScript, memory benchmark, compiled runtime smoke, OpenSpec validation, generated freshness, and the Linux host build passed. The final workflow will run a fresh full suite and build the four-platform release matrix.
