# Preselect all available runner packages

## Intent and acceptance

Fresh installation/configuration screens show every available Packages option selected for Pi, OpenCode, Claude Code and Codex, including Context7 extras. Users can deselect configurable options. Respect persisted explicit false values and installed Claude receipt selections. Unsupported packages stay outside each runner's list. Enabling Adaptive Memory instruction guidance does not select a memory provider or supply credentials; Web Search remains separately configured.

## Decisions and protected boundaries

Use canonical supported instruction defaults and shared dashboard defaults, then correct runner-specific extra-option hydration. Code Economy remains the existing always-on baseline.

Serena preselection must not authorize bootstrap at startup. Only the user's explicit dashboard Review & Install input confirms the currently displayed selected packages for the matching current operation. Use a narrow confirmation flag at the input-handler boundary; general/programmatic enter-review, stale/missing operation, and deselected Serena cannot acquire authorization. Existing execution authorization checks remain independent. Entering review does not run installations.

## Routing and evidence

Lead owns this brief. Investigate traced initial selection, config loading, Claude receipt overrides, and protected Serena markers. Apply Fast owns the complete config/state/input/composition/test slice. Graph deck generation2026-08-20 is stale; coverage of all relied production paths reported changed metadata and current source was read directly. Feedback changes were committed separately as10e50be and478d002; local Serena/cache preserved.

## Verification

Completed. Canonical configuration and dashboard tests cover all four runners' visible package defaults, saved false values, receipt omissions, and rejection of implicit/stale Serena authorization. The focused configuration/reducer/input/action-runner suites passed 162 tests. The full synthetic runner suite passed 34 tests (249 assertions), including actual Ink fresh-package selection and zero installation/download effects both at dashboard opening and before Run install. Five old interaction assumptions were updated to deselect unwanted packages explicitly rather than toggle newly preselected packages off accidentally. Existing installation outcome assertions remain intact.

Independent read-only Investigate review found no confirmed defect and checked startup, interactive confirmation, model Finish, receipt hydration, and execution authorization boundaries against current source. TypeScript and git diff --check passed. The installed deck-canary was rebuilt with the final production changes; subsequent changes were tests only. Existing feedback commits remain separate; this preselection candidate is uncommitted. Local .serena/project.yml and .bun-cache remain untouched.
