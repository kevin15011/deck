# Verify Report: Canonical Supermemory Conversation Memory

## Result

PASS. The first-class Supermemory runtime candidate satisfies the approved implementation and security contract.

## Evidence

- Final full repository after real-install repairs: 4,627 passed, 0 failed; 19,413 assertions across 301 files.
- Adversarial bridge/security bundle: 151 passed, 0 failed.
- Acceptance-area bundle: 424 passed, 0 failed.
- TypeScript: `bunx tsc --noEmit` passed.
- DeckMemoryBench: 13/13 scenarios, precision 1.0, recall 1.0, local p95 approximately 0.26 ms.
- Compiled runtime: Linux x64 executed; Linux arm64 and macOS x64/arm64 compiled.
- Extracted binary: ran outside the workspace with empty PATH; authenticated loopback capture, read-only Doctor, and standalone Codex hook execution passed.
- OpenSpec validation: 0 errors, 0 warnings.
- `git diff --check`: passed.
- Real OpenCode reinstall: completed successfully through Review & Install with every plan action ready and `blockerCount: 0` under `DECK_DEBUG=1`.
- Installed state: materialized OpenCode plugin matched the generated repository asset byte-for-byte; MCP configuration contained only the canonical project-scope header and no runtime credential.
- Runtime credential: owner-only secret-store entry present with mode `0600`; Doctor reported enabled runtime, canonical scope, credential readiness, and valid OpenCode configuration.
- Live provider acceptance: authenticated health, profile, capture, and search succeeded over TLS; the authenticated OpenCode loopback recalled and injected canary `deck-sm-canary-20260815-02` within the 6,000-byte physical ceiling.

## Adversarial boundaries verified

- Project scope is server-bound and runner input cannot replace it.
- Provider credentials and inherited secret-like environment variables do not reach runner processes.
- Common environment, URI/DSN, password, token, authorization, cookie, and private-key forms are rejected before capture.
- Ordinary memory failures fail open; explicit recall/remember failures are surfaced.
- Replay is recorded only after provider success and is bounded.
- Resume identity preserves the same conversation document.
- Provider-controlled content cannot escape the advisory data frame or gain instruction authority.
- Combined profile/search context remains within five items, 1,500 conservative tokens, and 6,000 UTF-8 bytes.
- OpenCode, Pi, and Codex native assets use the shared authenticated lifecycle contract and inject advisory context through runner-consumed fields.
- Automatic lifecycle and MCP complement do not double-capture the same event.

## Limitations

- CI uses deterministic fake provider ranking and an HTTP-only local fixture. Separate post-install live acceptance proves endpoint/TLS/authentication and canary recall, but not broad production ranking quality.
- Non-host release targets are compile-only in the current Linux CI environment.
- External MCP usage is outside Deck Runtime observability.
- Remote provider-record copy/deletion remains unavailable and unauthorized.
