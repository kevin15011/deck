# Recovered proof verification

## Outcome
The functional stdio proof works in the tested Linux environment. A separate client starts the actual Deck source driver, actual native Pi lead, and actual Deck-managed native child using a deterministic local faux provider. It observes task identity and integration and closes cleanly.

This is an opt-in source-checkout proof, not a released CLI/API or browser application.

## Executed by Lead after recovery
- Deck driver unit tests: 5 passed, 0 failed (~0.8 s).
- Deck native lifecycle tests: 4 passed, 0 failed (~32 s): integration, child failure, controller EOF, malformed input; child execution-lease settlement checked.
- Separate client native tests after the review fix: 2 passed, 0 failed (~12.7 s): no-consent preview/block, and end-to-end native lead/child integration.
- Total: 11 tests passed. Earlier single-test client success is superseded by the two-test run, not counted twice.
- Narrow client-only strict TypeScript check passed (~6.3 s):
  `bun ../deck/node_modules/typescript/bin/tsc --noEmit --skipLibCheck --module preserve --moduleResolution bundler --target esnext --strict --types bun --typeRoots ../deck/node_modules/@types proof/client.ts`

## Review fix and regression
Independent bounded review found that the client hid Deck preparation previews and the driver omitted the blocking reason. Lead reproduced this with a failing no-consent native-client test, then forwarded preview records and the blocked message. Both client tests passed afterward. The existing mutation guard was never bypassed.

## Limits / open checks
- The broader proof tsconfig check (including the Deck native harness dependency graph) was stopped after 15 seconds. It is incomplete, not a pass and not evidence of a type error.
- No complete Deck typecheck or repository-wide regression suite was run.
- Host Bun is 1.4.0; Deck pins 1.3.12. Pinned-runtime and macOS verification are outstanding.
- Model behavior is simulated locally; no paid provider, MCP network service, or enabled memory provider was exercised.
- SIGINT/SIGTERM and slow-consumer cleanup lack native end-to-end verification. Hung extension disposers and forced process termination are not certified.
- No HTTP/WebSocket listener, login, application authentication, full GUI, project library, reconnect or arbitrary terminal attach.
- Existing production launch code is unchanged; only opt-in proof files were added. This does not replace a full ordinary-launch regression gate.

## State
Functional feasibility demonstrated; full compatibility/type/lifecycle certification remains open. Keep the change in verification, not archived or release-ready.
