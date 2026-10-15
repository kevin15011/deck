# Explicit directory completion

## User outcome and evidence

The user reports completion still stops at `/Users/kevinlondono/Proyects/` and requests Ctrl+Space to show its internal folders. Read-only filesystem inspection confirms that directory exists, with 25 visible subdirectories including `deck` (seventh in lexical ordering); the existing 30-result cap does not explain this specific example. Source uses native `datalist`, which provides no reliable application-controlled open action. Prior completion verification proved API queries and actual option values, but did not prove native-popup mouse/keyboard selection. That evidence must not be overstated as a solved interaction.

The earlier trailing-separator fix remains useful. The instruction to keep native datalist is superseded by the user's explicit interaction request. Existing UI owner implements this bounded follow-up; Lead retains documentation and activation. No backend contract change is intended.

## Interaction agreement

- A controlled visible directory combobox/listbox replaces native datalist.
- Ctrl+Space in the focused Directory input opens or refreshes suggestions even if the value has not changed. A trailing slash lists child folders; a partial final component filters the containing directory.
- Typing still provides suggestions. Actual mouse/touch or ArrowUp/Down and Enter selection completes a folder with a trailing slash and continues to its children. Selecting a suggestion must not submit project registration.
- Escape dismisses suggestions before dismissing the enclosing dialog. Keep ordinary manual path entry and explicit registration.
- A compact SVG button provides the same show-folders action for pointer/touch use and environments where an OS consumes the shortcut. Provide a short shortcut hint.
- Surface loading, no-results and request-error states; support retry. Invalidate earlier requests on typing, selection, close and reopen so stale results cannot replace the current path's list.
- Preserve authenticated home-directory confinement, canonical registration, spaces, current subtle dark/light styling, dialog focus handling and all sidebar/session behavior.

## Verification

Require a failing shortcut/list-visibility regression before implementation, followed by actual keyboard, click and touch selections against SessionManager/WebService. Cover three or more nested levels with spaces, terminal folders, prefix/manual slash, repeated Ctrl+Space, stale responses and outside-home rejection. Assigning the value of an option directly is not selection evidence. Inspect desktop/mobile captures and run the affected UI/assets and TypeScript checks. Canary activation follows installed isolated smoke and a guarded idle restart.

Status: complete and activated. `DirectoryInput` replaces the datalist with controlled suggestions and implements the interaction agreement above. Acceptance exposed an outside-pointer dismissal bug: closing the inline list on pointerdown moved the registration button before pointerup. Dismissal now follows click hit-testing, preserving the held gesture and successful registration.

Verification: the original shortcut regression failed with the native control; the final actual-host isolated browser fixture passed 11 focused groups and 17 workspace groups. Evidence covers actual mouse, keyboard and touch selection, nested paths with spaces, same-path refresh, empty/error/retry states, stale responses including close/reopen, held-pointer registration geometry and home confinement. Root inspected desktop and 320px mobile screenshots. UI/assets passed 41 tests/206 assertions, TypeScript passed, and installed compiled smoke passed 31 checks. Independent Quality approved the frozen UI interaction delta. Logs: `/tmp/deck-directory-combobox-{red,green,workspace,tests,tsc,installed-web}.log`. Interactive fixtures use temporary directories; the reported user directory was inspected read-only, not registered by automation.

Canary payload `3acf4eab1b3d7cad18e39573ecb134351c1014225c18236fee290bfff1046c8a` activated through guarded idle restart PID68618→46567 at 2026-10-15T14:28:24.394Z. Web: http://127.0.0.1:7421. No real provider inference, user configuration mutation, new dependency, commit or publication.
