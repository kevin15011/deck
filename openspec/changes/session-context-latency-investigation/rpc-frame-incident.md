# Live RPC frame rejection — 2026-10-22

Status: investigation in progress. Git diff/layout work paused explicitly by the user. No delegated tasks were active when the pause was checked.

## Reviewed reproduction (investigate attempt 10)

Lead inspected /tmp/rpc-repro/repro.test.ts and reran it: 4 passed, 0 failed. Synthetic small output deltas pass, an item/completed carrying a 1.17 MB aggregate fails, JSON escaping can turn 800 KB of raw output into an oversized serialized frame, and chunking the frame does not evade the incomplete-buffer limit. This confirms the parser mechanism, not the exact native envelope from the incident. The synthetic delta count is supplied by the fixture; it is not independent confirmation of Codex chunking.

The locally generated Codex 0.162.1 schema permits aggregatedOutput in command items without a declared string length limit. This does not by itself prove the native producer always sends an uncapped raw aggregate, or prove its relationship to model-facing output limits. The rejected live envelope and any thread/resume recurrence remain unmeasured. Parent and investigator file-size readings differ slightly (1,172,688 versus 1,172,431 bytes for the generated line); both exceed the parser bound and neither is the rejected frame's measured size.

The mapper bounds tool output to 16 KiB only after JSON framing/parsing. It therefore cannot protect this failure path. The parser's default 1 MiB limit is imposed by Deck, not demonstrated as a Codex/provider limit.

## Correction direction and rejected recommendation

Do not adopt the investigator's generic skip-oversized-frame recommendation as implementation-ready. A discarded frame can contain tool completion, native identities, permission requests or pending RPC responses. Method/ID extraction from an arbitrary partial JSON prefix is not guaranteed. Dropping such frames could create stuck operations or false execution states.

The corrective design must preserve protocol control fields and lifecycle/correlation while bounding large output bodies before full materialization, or use a verified native output-suppression mechanism if available. Retain explicit resource limits and payload-free diagnostics; do not simply remove the size limit or automatically repeat user actions. Validate native production behavior and any supported suppression option before selecting the implementation. Git diff/layout remains paused; no production fix has been applied.

## Confirmed evidence

- Deck session 20261022T003008-6f199c, Lead attempt 95, diagnostic seq 64475 at 2026-10-22T22:52:54.328Z (17:52:54 Colombia).
- Immediately preceding commandExecution started at seq 64321, toolCallId exec-d99196f8-1cc0-463e-b563-30ae5e7d86ea. A source search included apps/cli/src without excluding generated files and limited lines with head, not line bytes. Tool output visible to the Lead included the huge generated web-assets.generated.ts line. This was an inadequately bounded Lead search.
- The bounded ledger window contains 153 item/commandExecution/outputDelta notifications before rejection. The command completion is not present before the error.
- packages/adapter-codex/src/session-driver/rpc.ts bounds each incoming JSONL frame (and incomplete buffer) at 1,048,576 UTF-8 bytes by default. It closes pending calls and throws codex-rpc-frame-too-large on overflow.
- driver.ts feeds child stdout into that parser without overriding the default bound. It fails the task and drains the child on this parser error.
- Current diagnostic records only code and attempt, not the rejected method, measured size or completion state. Raw rejected payload is not available in this ledger evidence.

## Inference and unresolved questions

Large command output is the leading trigger. A final command item containing aggregated output could exceed the frame limit despite smaller deltas and a model-facing output cap, but the exact rejected envelope is not yet confirmed. Do not claim provider overload, context-window exhaustion, or an exact frame byte count from these records.

Next: reproduce with synthetic large command output through the supported protocol/test harness; establish whether aggregate completion or another envelope fails, examine safe bounded handling and metadata diagnostics, and report a minimal corrective approach. No native Codex database/history inspection, automatic turn replay, daemon restart or unbounded frame limit is authorized by this investigation.

Graph lookups for CodexRpc returned no symbols; generation 2026-08-20 paths were not tracked. Direct rpc.ts, driver.ts and rpc.test.ts source reads supplied the evidence above.
