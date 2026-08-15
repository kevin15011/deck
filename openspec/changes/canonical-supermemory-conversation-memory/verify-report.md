# Verify Report: Canonical Supermemory Conversation Memory

## Result

PASS. The first-class Supermemory runtime candidate satisfies the approved implementation and security contract.

## Evidence

- Full repository: 4,604 passed, 0 failed; 19,307 assertions across 301 files.
- Adversarial bridge/security bundle: 151 passed, 0 failed.
- Acceptance-area bundle: 424 passed, 0 failed.
- TypeScript: `bunx tsc --noEmit` passed.
- DeckMemoryBench: 13/13 scenarios, precision 1.0, recall 1.0, local p95 approximately 0.26 ms.
- Compiled runtime: Linux x64 executed; Linux arm64 and macOS x64/arm64 compiled.
- Extracted binary: ran outside the workspace with empty PATH; authenticated loopback capture, read-only Doctor, and standalone Codex hook execution passed.
- OpenSpec validation: 0 errors, 0 warnings.
- `git diff --check`: passed.

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

- CI uses deterministic fake provider ranking and an HTTP-only local fixture; it does not prove live Supermemory ranking or live TLS with real credentials.
- Non-host release targets are compile-only in the current Linux CI environment.
- External MCP usage is outside Deck Runtime observability.
- Remote provider-record copy/deletion remains unavailable and unauthorized.
