# Live preparation review

Scope: session `20261022T003008-6f199c`, project `/home/kevin15011/deck`, after verified canary activation at `2026-10-22T12:44:01.442Z`. Investigator task `task-1cf2011b-0318-4587-84f5-47cef713f609`, attempt 1, result sequence 10573 / ended sequence 10574. Lead independently reviewed sanitized milestone fields from the local event ledger; no conversation text is included.

| Task / attempt | Tool preparation | Codebase readiness | Starting runner → native turn.started | Checking runner → first activity |
| --- | --- | --- | --- | --- |
| Lead / 26 (Codex) | 18 ms | 11 ms | 10.424 s | 15.419 s |
| Lead / 27 (Codex) | 17 ms | 12 ms | 8.488 s | 14.471 s |
| Lead / 28 (Codex) | 13 ms | 6 ms | 9.387 s | 14.599 s |
| Investigator / 1 (Claude) | 6554 ms | 6049 ms | 5.757 s | 14.149 s |

Evidence sequences: Lead 26 uses 9272, 9274, 9277, 9312, 9324, 9446; Lead 27 uses 9458, 9460, 9464, 9499, 9511, 9669; Lead 28 uses 9681, 9683, 9687, 9722, 9734, 10188; Investigator uses 9863, 9870, 9874, 9877, 9880, 10572. All four attempts completed. The latter two completions occurred after the investigator's initial snapshot.

Review corrections: Claude's first activity at sequence 9880 was `tool.started`, not first text output. Lead readiness measured 6–12 ms, not approximately 4 ms. The first Lead startup interval was over 10 seconds; the report's 8.4–9.3 second range omitted it. This document consistently uses `turn.started` for the native boundary, not the nearby `turn-started` diagnostic.

The sample locates delay but does not establish its internal cause. Lead tool preparation was consistently short. The initial Claude task had one expensive readiness call; this is compatible with a cold preparation but does not prove that explanation or a runner-wide difference. Startup intervals include adapter/transport/native activity and must not be attributed entirely to the model or context. Native events are correlated by task and event order, not universal attempt IDs. This is not a controlled benchmark or evidence of a performance improvement.

Next investigation: trace the cold-readiness path and cache ownership/key differences using existing source and retained evidence. Preserve integrity checks, task ownership, runner-native context, and effective-environment isolation. Do not create disposable model tasks merely to generate measurements. A useful continuation of the same investigator may also provide a second observed readiness sample.

## Readiness cache follow-up

Investigator attempt 2 (result 11568 / ended 11569) was reviewed against source and local timing records. Lead attempt 29 spent 5297 ms in readiness (sequence 10198); Lead 30 spent 12 ms (10732); investigator continuation 2 spent 4 ms (10990). The earlier fast Lead preparation was therefore not representative of every subsequent turn.

`createCrossSessionService` shares a readiness instance across its tasks and runners. `SessionCodebaseReadiness.ensure` keys entries by executable file identity, full spec, real project root and effective environment. On creation of a new key it marks other entries for the same project obsolete and retires their connections. Lease counts postpone disposal until consumers drain. Returning to an existing key does not execute that invalidation loop again. This distinction explains why a warm Claude continuation is compatible with the proposed invalidation sequence; the report's wording that each runner switch necessarily retires the other connection was too broad.

The installed Codex and Claude Codebase executables are distinct files (299891744 bytes each, different inodes), which can produce distinct identity keys. Executable verification is cached by identity and performs a full integrity hash on a miss. Cold initialization also creates a runtime, spawns a supervised process and performs the MCP handshake/tools probe. No recorded per-stage timings separate those costs. Do not claim that hashing consumes six seconds or that model context caused this delay.

The report suggested adding key-component fingerprints and merging cache identity around content digests. Neither is adopted: deterministic fingerprints of credential-bearing inputs add unnecessary disclosure risk, and sharing across launch inputs needs a stronger isolation justification. Next is a deterministic two-spec lease-lifecycle reproduction with fake processes, preserving exact environment/identity keys. It should establish whether cross-spec retirement causes an avoidable respawn and propose a bounded correction without weakening integrity, cleanup or credential isolation. No runtime cache change has been made.

## Reproduction verified

Investigator attempt 3 (result 12246 / ended 12247) provided `/tmp/deck-readiness-repro/repro.ts`, importing production readiness with a fake supervisor and injected verification counter. Lead inspected and reran it: all assertions passed. Same-spec A reuse takes one spawn and one verification. Adding B while A is leased raises counts to two spawns/two verifications without draining A early. Releasing A drains its retired connection. Returning to unchanged A produces a third spawn, retaining two verifications; returning to B stays warm. This proves the avoidable respawn mechanism, not the production duration of its internal stages or the community incident root cause.

The proposed two-connection hard cap cannot hold while more connections have active leases. The implementation brief instead requires an explicit bounded retained cache with active leases counted and deferred cleanup described honestly. Same-environment compatible configurations may coexist; credential/environment supersession, executable replacement and lease safety require regression coverage. See `readiness-cache-fix-brief.md`. No production cache fix is active yet.
