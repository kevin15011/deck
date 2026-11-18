# Proposed operating model

Status: the earlier operating/update synthesis passed bounded independent planning review. The subsequent bounded instruction-audit synthesis also passed Quality attempt 5. Implementation, exact runner/tool compatibility and performance remain unverified. This consolidates instructions, reliability and C15 updates; see the [instruction audit](instruction-audit.md) for the current evidence boundary.

## Shared foundation

Keep the browser, native daemon and contract boundaries. The approved browser is React/TypeScript with GSAP; the daemon and launcher remain Rust. Use ordinary daemon modules for definitions/artifacts, admission, native exposure, operations and diagnostics. The evidence does not require a policy language, plugin framework or another service layer.

Store verified Deck-owned tool artifacts and instruction content by stable identity/revision. Shared installation must not imply shared credentials, unrestricted access or shared writable project state. If a service cannot enforce the required session/project separation, isolate it or make that sharing mode unavailable.

Before dispatch, record the runner integration/mode, instruction revisions, required tool identities, project scope and applicable authority. Record exposure, connection/delivery and observed loading separately. An attempt receipt describes what Deck observed; it does not reveal the complete provider prompt or prove model compliance.

## Instructions and authority

| Content | Ownership and treatment |
|---|---|
| Permission, decision freshness and task ownership | Enforce at the operation boundary; prose cannot grant authority. |
| Project test commands, gates and budgets | Keep with applicable project configuration/tooling; generic verification references sources instead of copying Deck-specific values. Surface disagreement. |
| Current user requirements/project conventions | Preserve actual provenance and scope; generic skill defaults yield where governing instructions permit. |
| Managed team, role and capability fragments | Maintain canonical definitions/revisions and generate necessary runner surfaces from them. |
| External skills/native instructions | Record actual sources and observed availability; self-declared metadata cannot elevate authority. |
| Reports and history | Preserve as evidence, separate from current instructions and grants. |

A managed-content record needs identity, source/maintainer, version when known, digest, applicability and kind. Record provenance through the actual acquisition channel. Compose deterministically; detect conflicting revisions of the same managed fragment and deduplicate within one context while retaining inclusion reasons. Each specialist still needs its own safety context. Do not delete arbitrary external prose based on similarity.

Validate required relative policy resources when packaging managed skills. A missing referenced body must be reported as unavailable, not silently treated as reviewed or loaded. This structural check does not prove natural-language consistency; the [audit](instruction-audit.md) supplies concrete scope/verification scenarios for bundled guidance.

The attempt receipt records selected definitions, configuration revision, delivery surfaces, exclusions/reasons and delivery/load evidence. Configuration changes affect future admissions. Explicit steering remains possible as a current event; revocation applies immediately at the effect boundary. Pinning content never preserves revoked authority.

Check existing scoped authorization before asking again. Loading a skill alone does not invalidate it. Changed effects, expired/consumed grants, revocation or stale reviewed preconditions require renewed evaluation. Historical approval language is not a grant; genuine fresh-confirmation protections remain binding.

Code Economy and verification are compatible: prefer the simplest sufficient solution and cheapest sufficient proof, preserve requirements/security/accessibility, and reuse matching evidence. A reviewer unable to execute a required protected check leaves that evidence pending or has the responsibility explicitly assigned to an independently authorized capable evaluator. Do not silently add shell access or relabel another report as independent re-execution.

Define required instruction fragments and their role applicability centrally. Runner translation must neither omit required Code Economy guidance nor broaden its recipients through an extra wrapper. Verify supported delivery for the actual role/mode before use, and record unavailable support explicitly. Matching installed headings or ownership receipts alone cannot establish completeness; I37 in the audit illustrates this distinction.

## Native exposure

Prefer supported process/session configuration preserving existing runner binaries and global profiles. Verify exact-version precedence and required controls. Normal native credential refresh, cache or history writes may still occur and must be described honestly.

An alternate Deck-owned profile requires separate authentication, skill and continuation evidence. Runtime-loaded extensions remain executable code even without persistent installation. Do not copy credentials automatically. Any necessary persistent profile change is a separate reviewed operation; selecting a shared tool does not authorize it.

| Boundary | Minimum evidence |
|---|---|
| S1 first conversation | One exact runner/version/mode with read-only enforcement, authentication, lifecycle evidence and required instruction delivery. Optional helpers/native skill discovery/old-history reuse do not gate it unless required by its accepted scope. |
| S4 cross-runner team | Both selected runner/role combinations, required tools/restrictions, delegation provenance and cancellation. Missing required enforcement blocks assignment. |
| S5 configurable resources | Current ownership and preparation semantics per resource. Inspection/use does not imply update support; manual-update completion requires a qualified helper path. |

Preserve the [coexistence condition](technical-direction.md#coexistence-and-portability) before the first native configuration effect. [Research](reliability-runner-research.md) has identified mechanisms and unknowns, not universal non-invasive parity.

## Managed tools and updates

| Identity | Meaning |
|---|---|
| Installed | Local artifacts with digest, platform, source and owner. |
| Selected | Version chosen for future compatible admissions. |
| In use | Exact artifact and client/service/state combination used by active work. |
| Available | Release from an identified source, with freshness and verification status. |
| Compatible | Candidate qualified for a Deck build, platform, integration/protocol and state format. |

A newer version is not automatically compatible. External binary changes invalidate relevant evidence. Deck's updater must preserve externally/package-manager-owned resources.

The C15 operation has these observable stages:

1. **Check:** fetch availability outside message dispatch; offline checks leave healthy installed versions usable.
2. **Prepare:** stage privately and verify authenticity/integrity, platform and compatibility using the source's supported mechanism.
3. **Plan:** identify affected work/services/data; bind artifacts, ownership, selection and recovery prerequisites.
4. **Authorize:** use valid scoped authority or configured automatic policy; reevaluate changed effects/preconditions.
5. **Defer:** explain affected resources and wait when necessary; automation does not terminate active work.
6. **Activate:** coordinate with admission to prevent races after the idle check; persist intent and recheck authority/ownership/state.
7. **Qualify:** check the executable/service/protocol/state combination, not only a version command.
8. **Settle:** persist success, safe restoration, deferral or recovery-required. Reconnect retrieves this operation rather than starting another.

Distinguish interruption before activation from uncertain activation. Cancellation acts at safe boundaries; a cancellation request does not establish rollback.

For independently versioned helpers, future tasks may select the new artifact while active work retains the old one. Each invocation resolves its admitted artifact explicitly; changing a global PATH target is insufficient.

For a shared daemon/index, preserve the compatible **client, server, endpoint and data state** together. Prefer deferred maintenance initially when safe parallel operation is unproven: close new affected admissions, wait for known consumers, establish exclusive state ownership, perform a supported migration/backup/rebuild, then activate and qualify. Unknown external consumers prevent an exclusivity claim. Unrelated work may continue.

Do not assume indexes are disposable or binary rollback reverses migrations. Restore only a validated executable-and-state combination; otherwise keep the capability unavailable with actionable recovery. Retain artifacts referenced by active work, pending operations and recovery; bound retention for unreferenced versions. Historical identities do not promise indefinite artifact retention or resumability.

## Web controls and policy

Extend existing capability/task/operation views while preserving the current visual design:

- Show owner/source, installed/selected/in-use versions, compatible availability and last check.
- Offer check, review, apply when safe, cancel pending update and recovery details, with reasons for unavailable actions.
- Evaluate Manual, Notify and Automatic policies, plus pause and compatible-version retention. Recommend manual activation initially; network-check defaults and automatic behavior remain unselected product choices.
- Bind automation to named tools, trusted sources/channels, compatible changes and maintenance conditions. Revocation prevents pending activation. Unsupported migrations or broader effects lie outside that policy.
- Show **Deck-observed instructions and tools** with selected, exposed, connected/delivered and load-observed states. Expand for source/revision and applicability; unknown loading stays unknown.

Automatic helper updates never grant permission to mutate native runner profiles.

## Reliability and compatibility

Shared typed failures carry category/code, safe phase, affected operation/task/attempt, dispatch certainty, correlation and recovery disposition. Recovery advice follows receipts. Acknowledgment is not completion; cancellation requested is not process settlement.

Retain the original browser command identity across connection loss/reload and reconcile its receipt before offering a fresh attempt. Explain what failed, affected scope, what is known to have happened and a safe next action. Raw native text/stacks are not the sole message.

Keep diagnostic logging best effort, bounded and observably degraded on loss. Evaluate buffering/retention without assuming zero cost. Durable receipt persistence is authoritative: failed admission/activation persistence stops affected work. Diagnostic loss must not fabricate success/failure. Support exports are scoped, redacted, previewable and shared only under user control.

Qualify compatibility separately for runner/tool capabilities and enforcement, browser/API versions, and stored-state upgrades/recovery. An incompatible cached browser tab preserves drafts and requires a supported reload/recovery path before mutations. Unknown native versions do not inherit unproven authority guarantees.

Current Deck already has failure classification, redaction, durable input claims and conservative recovery. The bounded audit found diagnostic loss in generic startup errors and a broad HTTP invalid-request fallback; it did not show all protections absent or explain every incident.

## Responsiveness and validation

Keep installation, release checks, downloads, full discovery and service restart outside normal message handling. Necessary local validity and authority checks still run. Measure cold preparation/startup, warm admission/tool connection, reconnect, active-Lead message dispatch and background-update contention separately.

With equivalent runner/model/project/tool conditions, record browser submission, durable acceptance, native dispatch/acknowledgment and first output. Establish budgets from measurements. No zero-overhead, universal compatibility or numerical SLO is established.

Structural validation can prove managed references/digests, deterministic composition and declared state transitions. It cannot prove arbitrary prose consistency, hidden instructions or model compliance. Use contextual review/outcome evaluations, deterministic failure injection, then native/browser acceptance for the behavior claimed.

## Evidence and remaining decisions

Architect attempts 3/4 (31488/31489 and 42572/42573), reviewed Investigate5/Quality3 and the product contracts supply this synthesis. They are planning/source reviews, not runtime acceptance. Exact auth/history behavior, content precedence, artifact verification, client/server/state compatibility and latency remain feasibility gates. The [roadmap](roadmap.md) separates S5a/b/c and S10a/b into functional increments so optional update paths do not gate every useful feature.

Quality attempt 4 (44297/44298) passed the bounded planning candidate. Lead recomputed the matching 12-document manifest before adopting that result and corrected the nonblocking catalog count from 45 to 46. That review did not cover the later instruction audit. Quality attempt 5 (71416/71417) subsequently passed the combined 13-document planning synthesis. Neither review certifies implemented fixes, visual fidelity, native behavior or performance.
