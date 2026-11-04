# Conversational capability retirement requirements

## Complete product removal

Deck MUST NOT offer, install, compose, invoke or emit conversational memory
providers, plugins/extensions, capture, recall, injection, loopback bridges,
memory MCP tools, provider readiness, configuration selection or instructions.
Dedicated dependencies, assets, tests and benchmarks MUST be removed. Shared
authorization, isolation, lifecycle and ownership guarantees MUST remain.

Given a new installation, when roles and capabilities are prepared, then no
conversational memory artifact, instruction or environment binding is generated.

Given a resumed transcript calls an absent memory tool, when the bridge dispatches
it, then the generic unknown-tool result is returned with no provider invocation.

## Existing state and safe decommissioning

Legacy config keys MAY be recognized only to discard them from normalized output
and canonical writes, with a bounded retired-field diagnostic. Reading MUST NOT
silently rewrite user files or weaken secret-field validation.

Existing session ledgers MUST remain readable. Retired event kinds MAY be accepted
on replay only; new memory events MUST NOT be emittable or appended.

Given an upgrade with receipted retired contributions, when reviewed installation
or upgrade cleanup executes, then only proven owned bytes/trees are removed and
unrelated content remains unchanged. Unknown/customized content MUST be preserved
with an actionable explanation. A marker/name/shape alone MUST NOT authorize
deletion of a previously receipted but modified contribution.

Given active session/native leases, when cleanup is requested, then destructive
mutation is deferred without terminating work. Old installed per-event commands
MAY have bounded inert transition handling so they cannot break native work.

## Scope and residual accounting

Codebase Memory graph intelligence, Context Mode, personal MCP and ordinary session
history MUST remain functional. A user's independent provider registrations are
treated through generic personal integration rules, not a retired provider policy.
No remote account/data destruction is permitted. Dedicated Deck-owned local
artifacts and settings are subject to exact ownership and the approved cleanup plan.

Every surviving active-tree retired-capability reference MUST have a specific
read-compatibility/decommissioning purpose, fixed scope and removal criterion in
the residual audit. The allowlist MUST NOT hide active provider/runtime behavior.
Current official specs and generated outputs MUST reflect removal. Historical
OpenSpec/Git evidence is not current product functionality and MUST NOT be rewritten
to falsely claim prior integration never existed.

## Superseded implementation authority

This retirement supersedes prior conversational/adaptive-memory implementation
directives in historical OpenSpec changes. Their original evidence and lifecycle
records remain historical; they do not authorize reinstalling the retired feature.
Codebase Memory graph intelligence is a separate continuing capability.
