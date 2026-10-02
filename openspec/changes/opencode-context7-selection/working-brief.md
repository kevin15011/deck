# Restore OpenCode Context7 selection

## Problem and outcome

OpenCode still implements Context7 installation/configuration, but the Packages screen lists instruction packages and explicit adapter extra selectable capabilities. Context7 is not an instruction package and OpenCode omitted that extra option. Restore its selectable MCP entry without treating it as an instruction bundle.

## Scope and acceptance

OpenCode adapter UI metadata plus focused selector/render and review-plan evidence. Selecting Context7 must use selectedCapabilities and generate the existing MCP configuration action; deselecting must omit its installation/configuration. Preserve pending runner-name cleanup, install activity, and Codex active executable fix. Lead owns this brief; Apply Fast owns the complete implementation/test slice.

## Evidence and verification

Parent graph generation2026-08-20 is stale; task-directed coverage and direct current-source reads confirmed the metadata/selector mismatch. The focused regression demonstrated RED then GREEN and checks visibility, real reducer toggling, preserved instruction selections, selected MCP action and deselected omission. All 26 OpenCode adapter tests passed. Final TypeScript and git diff --check passed after correcting test-only types; the focused regression was rerun successfully. Rebuilt and installed canary. Full interactive installation remains manual acceptance. No claim that merely having npx installed establishes Context7 readiness.
