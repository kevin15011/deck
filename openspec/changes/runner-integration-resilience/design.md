# Runner integration resilience design

## Accepted outcome

Installation, upgrade, doctor and session entry points evaluate compatible managed
state consistently. Generation protection fences mutations, not otherwise valid
work. Required trust, scope and approval checks remain mandatory. This design
implements the accepted Working Brief; it does not authorize live user repair.

## Contracts and boundaries

Core owns admission/check/remediation contracts, contribution provenance and pure
writer policy. Runner adapters translate native installed state into read-only
checks. Session-host owns daemon negotiation and task continuity without importing
adapters. CLI injects actual build identity, adapters and executable operations.

An admission result distinguishes admissible, explicitly degraded and blocked
states, with reviewed check identifiers, whether each check is required, and a
concrete remediation. Selected required capabilities participate in the verdict.
Install artifact validity and operational admission are separate reported facts.
No skipped mutation or optional failure can masquerade as successful application.

## Generation decisions

Build identity contains release version, source/build identity and channel; a
payload digest is included when trustworthy. Identity equality is not ordering.
Explicit transaction epochs protect concurrent plans; compatible state schemas
protect readers and writers. Commit hashes and digests never determine freshness.

Evaluate installed admission read-only before preparation refresh. A compatible
installed generation may continue without writes while refresh is busy, stale or
unnecessary. Same-version/channel differences alone do not block work. Explicit
installation and upgrade intents remain distinct from opportunistic refresh.

Use existing locks and journals. Under the lock, recheck the planning epoch before
effects and finalize it only for actual committed changes. An interrupted effect
requires transaction recovery and inspection of installed state; do not merely
discard a pending record and assume nothing changed. Missing/corrupt provenance
never grants ownership. Pre-fence binaries cannot be assumed to enforce new rules.

## Daemon convergence

Negotiate protocol compatibility separately from optional build identity. Compatible
legacy peers with unknown identity must not enter restart loops. Busy daemons and
active sessions are preserved. Idle replacement must prove an installed successor
and converge under alternating stable/canary clients. A digest mismatch alone is
advisory. Only affected operations requiring incompatible protocol/state are deferred
or blocked with an actionable code. No whole-session cancellation for a cosmetic
or optional update mismatch.

## Contribution recovery

Keep bounded exact history of provably Deck-written canonical contributions, using
existing contribution transaction infrastructure where possible. Historical bytes
are migration evidence, not execution authorization. Rewrite adopted contributions
to the desired verified content before issuing a current receipt. Preserve user
edits and classify conflicts explicitly. Legacy shape recognizers remain narrow,
tested migration boundaries with a documented retirement window.

The existing Codex MCP change is part of the candidate, not evidence of completed
remediation. Tests must prove that adoption rewrites foreign legacy commands and
receipts refer to new canonical bytes; no old command is authorized by resemblance.

## Upgrade and executable continuity

After replacing a binary, synchronize content through the verified new executable,
not the old process's adapter registry. Content-only operations may reuse the
current process. Synchronization failure is explicitly incomplete/deferred with
recovery; it must not imply that required capabilities are ready.

Prefer native overlay/config isolation where supported. Reuse validated stable
aliases and existing generation references if sufficient; do not create mutable
global tool pointers without evidence of need. Any executable indirection validates
ownership, permissions, links, arguments and environment trust. A running session
keeps its verified compatible payload contract. A missing required pinned executable
cannot silently fall back to incompatible code. Keep referenced generations until
safe collection and preserve a coherent rollback generation.

## Diagnostics and verification

Use shared reviewed preparation reason codes across producers and host transport.
Preserve credential redaction and restrict check detail. Each failed check offers
its actual remediation instead of unconditional reinstall advice.

Extend the existing migration harness with admission. Hermetic fast tests cover
fresh/repeat, supported old state, edited/missing receipts, interrupted writes,
alternating builds, mixed runners and error transport. Heavy historical/native
checks remain separate from the 120-second fast suite. Release evidence identifies
exact supported runner/tool/build combinations; unknown versions are unverified.

Independent review re-executes protected ownership and generation oracles. Live
canary checks must preserve unrelated work and obey remote-effect authority.

## Implementation ownership and open details

Apply Deep task `task-3996560e-97cc-4baf-8758-75c9f99c5310` owns the backend vertical
slice. Architect attempt 2 report is an implementation handoff, subordinate to this
design and the Working Brief. Its exact proposed filenames are advisory. Simpler
reuse is preferred when it satisfies the acceptance oracles. Meaningful deviations
and unresolved native behavior must be reported to Lead for this design to update.
UI files are owned separately by Apply Fast. Lead writes all OpenSpec artifacts.

## Historical manual-provisioning evidence decision

Lead accepts an explicit manual external-tool fixture variant for published
0.0.1/0.0.2 OpenCode/Pi states. Their original installers did not automatically
provision the selected tools. Preserve those inventory rows and original source
evidence; independently pinned fixture/operator provisioning is distinct from
historical Deck installer effects. Require provenance, successful provisioning,
candidate migration and admission before completeness passes. This does not waive
rows, invent historical acquisition or claim a heavy Linux matrix has executed.
Apply Deep attempt 3 implements the evidence mapping; RIR-04 stays unresolved
until independent review and applicable acceptance evidence.
