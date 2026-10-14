# OpenCode 1.18.31 contract evidence

The local `opencode --version` and `opencode serve --help` were inspected without
provider calls on 2026-10-12. The server supports `--pure`, `--hostname` and
`--port 0` (random port).

The fake HTTP/SSE tests in `../../driver.test.ts` derive the session, synchronous
message, permission list/reply and abort endpoint contracts from the repository's
`openspec/changes/cross-runner-session-core/spike/opencode-serve.mjs` and
`opencode-permission-abort.mjs`. Event fixtures in those tests are constructed
contract fixtures, not transcripts captured from a paid provider turn.

Official documentation inspected on 2026-10-12:

- https://docs.opencode.ai/docs/cli/ confirms `OPENCODE_SERVER_PASSWORD` enables
  Basic authentication and the default username is `opencode`.
- https://docs.opencode.ai/docs/config/ says `OPENCODE_CONFIG_DIR` is additive
  after global/project configuration. The driver also replaces `XDG_CONFIG_HOME`,
  disables project configuration and verifies `/mcp` against the exact child set.

No runner credential file was read. Native isolation, effective task-denial,
provider response/event shape and authenticated native-session resumption still
require the opt-in live contract harness. The driver version probe deliberately
reports `mcpIsolationVerified: false`; every task verifies `/mcp` before prompting.
