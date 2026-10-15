# Opt-in runtime UI proof delta

The Deck UI user authorized a bounded dynamic runtime interaction slice. This adds an explicit --interactive-client mode to the source-level Pi proof, not a released CLI/SDK or a dependency on deck-ui. Legacy default proof behavior still cancels runtime dialogs; normal Deck terminal behavior is unchanged.

The proof validates and bounds supported select/confirm/input/editor requests, keeps pending request identities, and accepts only exact-ID, method-valid, single-use responses. Select values must belong to the emitted options. Unsupported/invalid requests fail closed, expiry/abort/closure settle pending questions, and preparation mutation consent remains independent. A submitted UI response is not acknowledged completion of the requested action.

Lead independently verified 14 proof unit/native tests with 72 assertions. Native fixtures exercise changing payloads for all four methods, legacy cancellation, expiry, untimed pending close/abort and prior supervised-child lifecycle cases. Untimed close/abort fixtures address the review concern that a 150 ms runtime timeout could conceal broken cleanup.

The consuming application's source review found a dialog draft-loss bug, reproduced and fixed by retaining forms by session/request. Its complete suite passes 27 tests/224 assertions; those app tests are not a new dependency of Deck. Native tests use disposable roots and a faux provider; browser evidence is separate. No user dialog was answered, live runner update applied, release performed or production/platform compatibility promised.

## Read-only command discovery follow-up

The later session-navigation/slash follow-up adds only get_commands (type/id) to the proof command allowlist, with a focused no-extra-fields test. Runtime extension, prompt-template and skill descriptors remain native Pi data; the proof exposes no arbitrary RPC or attach/resume operation. Lead passed the full affected proof unit/native suite: 15 tests / 74 assertions. Existing legacy cancellation and interactive question coverage remain passing.

The consuming application's independent review caught a mismatch between its slash recognition and Pi's character-zero slash/ASCII-space command parsing. Lead reproduced and fixed that application-side issue with rejection-before-send regressions, including isolated native HTTP evidence that invalid leading whitespace or tab/newline command separators cause no additional runtime command. This is app-side validation, not a new Deck dependency. At initial validation the live evaluation owner was not restarted or controlled; activation was deferred while the user's session remained active. The user subsequently authorized closure and restart: Lead awaited the owned driver closing, gracefully replaced the idle app owner, and verified the new catalog capability without starting a new session or provider turn. The app-side sessions-and-slash-brief.md records this activation separately from the proof tests.

Official app-side details: ../deck-ui/openspec/changes/define-local-deck-ui/runtime-interactions-brief.md (sibling repository path from the Deck repository root).
