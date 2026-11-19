# Claude Code runner parity research

Research only. Keep the Rust host authoritative for admission, roles, receipts, decisions, queueing and restart recovery. Evaluate a process-scoped TypeScript bridge using the official Claude Agent SDK. The bridge owns the live query, reads partial and terminal events and relays permission requests. Test packaging the bridge and selecting a compatible local CLI on a clean machine.

## Reference behavior

The local reference-projects/t3code checkout had no checked-out HEAD. Its origin is pingdotgg/t3code. In upstream commit d1f8636f4909f1cda2568391efa67ceec5567956, apps/server/package.json declares @anthropic-ai/claude-agent-sdk ^0.3.321. ClaudeAdapterV2.ts imports that SDK and calls query; the adapter includes partial messages, resume, executable selection, permission callbacks and interruption. This dependency range describes the reference, not a Deck runtime requirement.

Deck 1's packages/adapter-claude/src/session-driver/driver.ts instead exchanges stream-json with the CLI. Its fixtures are useful compatibility oracles for initialization, resume and cancellation. Deck 2's runner management recognizes the Claude CLI; that fact does not prove execution support or quota parity.

## First vertical slice

Exercise two concurrent conversations on one project, incremental text/tool events, stop, one approval, one question, durable Deck queue and resume after a daemon restart without replay. Record the native session identifier and correlate input and completion to the Deck attempt. Then exercise Lead and member dispatch through Deck's existing MCP and ledger. Preserve provider-specific capabilities for supported models, effort, billing and tools.

Do not model SDK stream input as an exact active-turn steer without a protocol witness. Anthropic documents that input submitted during tool calls can be consumed after they finish, or can start a new turn if the current turn ends first. Test uncertain delivery and interruption with pending input. Keep explicit next-turn queueing in Rust.

Decide supported authentication and packaging before promising subscription reuse. Anthropic documents approval requirements for third-party products offering claude.ai login or rate limits. Never transfer tokens from a CLI profile to implement product authentication.

## Primary references

- [T3 adapter at inspected revision](https://github.com/pingdotgg/t3code/blob/d1f8636f4909f1cda2568391efa67ceec5567956/apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts)
- [T3 server dependencies](https://github.com/pingdotgg/t3code/blob/d1f8636f4909f1cda2568391efa67ceec5567956/apps/server/package.json)
- [Agent SDK and authentication](https://code.claude.com/docs/en/agent-sdk/overview)
- [Live input and interrupt](https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode)
- [Permission and question callbacks](https://code.claude.com/docs/en/agent-sdk/user-input)
- [Session continuity](https://code.claude.com/docs/en/agent-sdk/sessions)
