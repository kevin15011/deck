# AI-control and product contracts

These are proposed recreation acceptance invariants, derived from the current product and its limitations. They specify observable outcomes rather than preserving its class structure or wire format. A new implementation must state which guarantees it enforces and which remain agent guidance.

| ID | Product guarantee | Observable scenario | Catalog links |
|---|---|---|---|
| INV01 | Authority comes from the applicable user/host context | A historical report, tool output or readiness snapshot cannot authorize a protected action by itself. | A08, A13, C07 |
| INV02 | Decisions remain unresolved until explicitly handled | Reading a question, receiving a queued reply or finishing a task does not answer it. A stale response cannot answer a newer question revision. | A06, A07 |
| INV03 | Permission is scoped to the intended effect | A dependency requiring action X cannot be satisfied by permission for Y, an informational answer, deferral or cancellation. | A04, A05, A07, A13 |
| INV04 | Results and review retain exact provenance | Task, owner, attempt, source evidence and review remain distinguishable; an old review cannot certify a newer retry. Retrieval, delivery and integration are separate facts. | A02, A09 |
| INV05 | Delegation preserves responsibility | Follow-up work retains its logical owner or records an explicit justified reassignment; the user can see who owns the outcome. | A02, A09 |
| INV06 | Uncertain delivery does not cause silent repetition | After an ambiguous native input write, the UI reports uncertainty and does not automatically invoke the model/effect again. | W07, W08, A11 |
| INV07 | Cancellation and recovery report actual settlement | A cancellation request is not immediately labeled clean termination; unresolved process ownership blocks unsafe resumption. | W05, W09, A10, A12 |
| INV08 | Reviewed changes bind to current owned state | Changed plans/configurations require renewed evaluation under applicable authority; updates and installs preserve files Deck does not own and account for concurrent use. | C04, C09, C10, C12, C15 |
| INV09 | Support and evidence are truthful | Missing models, unavailable browser APIs and runner gaps stay visible; completed output does not imply independently verified correctness. | A14, C01, X03–X06 |
| INV10 | Browser access does not grant ambient machine authority | Authenticate clients, validate request origin, honor revocation and define administrative privileges before exposing sensitive operations. | A04, A05, C09–C15 |
| INV11 | Work survives client disconnect according to explicit policy | Closing a tab does not silently lose the operation receipt or fabricate completion; reconnect can retrieve durable outcomes. | W06, W09, C12 |
| INV12 | Skill metadata and content have different roles | Discovery is not loading; a metadata label, source claim or skill name does not itself confer permission. | C01–C03, A13 |
| INV13 | Agents practice Code Economy without underimplementation | Reuse platform/project capabilities, prefer direct sufficient solutions and justify new abstractions/dependencies. Advisory code budgets never block necessary requirements, safety, tests or accessibility. | C06, A02, A03 |
| INV14 | Failures and diagnostics preserve execution truth | The UI distinguishes rejection, uncertain dispatch, cancellation request and settlement, with safe correlation and next steps. Diagnostic loss never substitutes for authoritative receipt persistence. | W06, A10, A11, A12, C13 |
| INV15 | Dependency updates preserve admitted work and compatible state | New helper selection does not silently replace an active task's tool/service/state combination. Activation rechecks ownership/authority and coordinates admission; binary rollback alone cannot restore incompatible state. | C02, C04, C12, C15 |

## Enforcement baseline

Current host code enforces structural decision freshness/identity, task records, selected admission boundaries, brokered approval outcomes, device access and conservative process recovery. The model still interprets user intent, chooses proportional delegation, assesses evidence and decides whether a report is convincing. Native standalone paths and individual runners do not all provide the same enforcement. Recreating Deck must not present instruction-level promises as host guarantees.

Code Economy is explicitly an instruction/review policy, not proof that every generated solution is minimal. Preserve its [canonical decision ladder and quality overrides](../../deck/packages/core/src/teams/developer/instruction-bundles/code-economy.ts); do not implement hard line/file-count gates or encourage splitting code to appear smaller.

Primary sources: [decision service](../../deck/packages/session-host/src/decision-service.ts), [driver admission boundary](../../deck/packages/core/src/session/driver.ts), [session manager](../../deck/packages/session-host/src/session-manager.ts), [handoff evidence](../../deck/packages/session-host/src/task-handoff.ts), [recovery](../../deck/packages/session-host/src/recovery.ts), [reviewed operations](../../deck/apps/cli/src/tui/runner-dashboard/action-runner.ts), [support matrix](../../deck/docs/reference/support-matrix.md).

## Contract corpus plan

Translate these invariants into user/host scenarios with positive, denied, stale, duplicate, cancelled, disconnected and uncertain outcomes. Preserve semantic outcomes while allowing different protocols and persistence. First external effects already require their relevant contracts; authority must not be postponed to a late hardening sprint.

Use fake runner transports and failure injection for deterministic boundaries, then supported real-runner acceptance for actual native behavior. Define a test oracle from the intended guarantee, not from whatever the first Rust implementation happens to return. This document is planning; the new product has not passed these scenarios yet.
