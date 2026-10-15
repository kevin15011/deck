# Project rename and removal from the workspace

## User outcome

Add a compact three-dot SVG menu to each project row with Rename and Remove project. Removal means removing the project from the interface, not deleting directories or session history. Preserve the existing accordion, per-project plus action, compact styling, themes, status indicators and chat navigation.

## Agreement

- The ellipsis is an independent, accessible control with keyboard, Escape, outside-dismissal and focus-return behavior. It must not toggle disclosure or create a session. Keep it discoverable on touch screens.
- Rename opens a small dialog with the existing name, Save/Cancel, nonempty trimmed bounded validation and visible errors. Identity, directory, history and active work remain unchanged.
- Remove project persistently hides its project entry. It does not stop sessions, delete files or erase history. No destructive confirmation is needed for this reversible interface action.
- Automatic legacy-session discovery must respect the hidden record, including after restart. Explicit Add project for the same canonical directory restores the original project identity and history; ordinary implicit discovery does not restore it.
- Removing an inactive project preserves the current conversation. Removing the active project clears its displayed selection and shows an appropriate remaining/empty workspace, without discarding drafts or session history.
- Use existing authenticated project command composition with durable idempotency. Validate IDs and names; preserve registration confinement and legacy roots. No provider calls, configuration changes or new dependencies.

## Ownership and verification

The agreed additive workspace commands are `project.rename { projectId, name }` returning `data.project` and `project.remove { projectId }` returning `data { projectId, removed: true }`, without a session ID. Hidden records remain durable registry entries and reuse the registry's idempotent mutation receipts. Public catalog lookup hides them; internal session lifecycle access must preserve the original project identity and remain operational. Replaying an old registration receipt must not undo a later removal; a new explicit registration restores it. UI catalog request versions fence pre-mutation replies.

Known legacy projects may originate outside home. To keep removal reversible without widening browsing, explicit registration may restore an already persisted hidden record only when canonical resolution matches that record's exact existing identity/path. New outside-home registrations and directory suggestions remain rejected; replaced roots resolving elsewhere do not qualify. Independent Quality reviewed this bounded exception.

Existing host and UI owners completed their respective slices; Lead centralized OpenSpec and activation. Focused tests cover rename/remove/restart/re-add, active work preservation and command retries; actual browser checks cover menu interaction, rename, inactive/active removal, last-project empty state, re-add, desktop/mobile and failure handling. Independent Quality approved the new persistence/authentication boundary and UI behavior.

Host candidate passed 155 focused tests (742 assertions), and Root's integrated host/core/CLI run passed 432 tests (1,553 assertions). Independent review found and repaired a cross-command receipt fingerprint collision by recording mutation type while accepting old registration receipts. UI review found and repaired active-removal replay state retaining its old event cursor after clearing the view; restoration now replays full history. UI/assets/docs passed 65 tests (1,016 assertions). Actual browser re-add exposed a pending directory response changing inline suggestion geometry during an Add click; the narrow correction cancels pending lookup on outside pointerdown while preserving rendered geometry until click, and dismisses on pointer cancellation.

Final actual-host browser checks passed: project actions 6 groups, directory regression 11 groups, normal workspace 17 groups. The held-click test resolves a real directory response mid-gesture, asserts unchanged button geometry and requires successful registration; no Escape workaround is used. Re-add also requires the historical assistant message to render, not just a restored sidebar entry. Root inspected compact desktop dark and mobile 320px menu captures. Independent Quality passed 9 targeted tests (70 assertions) and approved. TypeScript, four-target builds, scoped OpenSpec validation, diff check and final installed compiled smoke (31 checks) passed. Logs: `/tmp/deck-project-actions-{integrated,ui-final,tsc-final,build-final,installed-web,openspec}.log` and `/tmp/deck-web-project-actions-{browser,directory,workspace}.log`. Browser fixtures use temporary state and fake inference; they do not mutate the user's projects or claim direct automation of the current user browser.

## Activation

Complete and active. Canary payload `7cb640e64010d0d470925123503fa4c0c9a5090a01699a8f0bc488c234e014ac` activated via guarded idle restart PID62270→68707 at 2026-10-15T15:57:17.442Z. Web remains http://127.0.0.1:7421; reload for the new menu. No real provider inference, user project mutation, user configuration change, commit or publication.
