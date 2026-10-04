# Pi background delegation and progress
## ADDED Requirements
### Requirement: Conversational background delegation
The Pi subagent tool SHALL return accepted job identifiers without waiting for child completion. Single, parallel and chain behavior SHALL remain available with a session-wide concurrency bound. Lead SHALL receive current completion/failure state at a safe native turn boundary, including while initially idle. Progress SHALL update the panel/history without chat messages or model turns. Child content SHALL be fetched explicitly as untrusted evidence, never authority.
#### Scenario: Lead available
- GIVEN an active child with unfinished work
- WHEN delegation is accepted and the user sends Lead another message
- THEN the delegation call has already returned and Lead can respond before the child finishes
#### Scenario: Completion
- GIVEN Lead is idle or responding
- WHEN a job completes
- THEN current result identities enter a native Lead context without interrupting the active response/tool batch or requiring another user message
- AND already-integrated results do not enqueue a redundant follow-up behind the current tool loop
### Requirement: Observable honest progress
The UI SHALL expose each task's human role name, short title distinct from the internal assignment, execution/integration state, HH:MM:SS elapsed time and meaningful observed activity. Terminal clocks SHALL freeze; another task completing SHALL NOT stop active clocks. IDs, command hints and activity-age noise SHALL remain out of the floating panel; timestamped history remains available in details. Tool events and agent reports SHALL be distinguishable. Tool success SHALL NOT be presented as task verification. Silence SHALL NOT be reported as failure, network retry or progress without evidence. Retry activity MAY use genuine Pi retry events; no blind restart of write-capable work.
#### Scenario: Silent child
- GIVEN a running child emits no new event
- WHEN time elapses
- THEN elapsed time advances without fabricating progress, failure or a retry
### Requirement: Floating right panel
In native fullscreen mode, a non-modal right-side overlay SHALL remain anchored to the viewport when conversation scroll changes, preserve editor focus, avoid covering the input area, and respect terminal size. In regular mode, the extension SHALL instead provide a compact status indicator with detail access; anchoring over terminal-owned scrollback is not required. The extension SHALL NOT change the user's TUI mode/settings automatically. A discoverable toggle SHALL minimize/restore the panel. Minimized state SHALL not be overridden by progress/completion. Narrow terminals SHALL use a compact indicator. Detail view SHALL support bounded history and task selection without losing conversation state. Text and icons SHALL accompany color.
#### Scenario: Scroll while working
- GIVEN native fullscreen mode, an expanded panel and active child
- WHEN the user scrolls conversation history and returns
- THEN the panel remains at its viewport position, readable, without moving into transcript history or stealing input
#### Scenario: Minimized
- GIVEN the user minimizes the panel
- WHEN updates or completion arrive
- THEN only the compact state changes and the panel remains minimized
### Requirement: Parent-session isolation and explicit recovery
Jobs SHALL belong to the exact parent Pi session and stable task ID, not a cwd/project-wide latest job. A new parent session SHALL not load previous jobs. Native /resume SHALL select a previous parent session; the extension SHALL only restore that session's records and SHALL not resume execution automatically. Same-job continuation SHALL reuse the exact child session, preserve role policies and avoid concurrent execution of the same job. Lifecycle changes SHALL cancel owned children, invalidate callbacks and suppress stale notifications. Explicit continuation SHALL increment the attempt identity for previously started work; old-attempt activity, outcomes and acknowledgments SHALL NOT mutate or describe the new attempt. Failed recovery SHALL be visible and SHALL not fall back to an unrelated session.
#### Scenario: New session
- GIVEN an abandoned parent session with interrupted tasks
- WHEN a new session starts
- THEN none of the old tasks are adopted, resumed or displayed
#### Scenario: Native resume
- GIVEN the user selects an old session through Pi /resume
- WHEN its task state is restored
- THEN interrupted tasks can be inspected and explicitly continued using their own child history, never auto-started
#### Scenario: Ambiguous effects
- GIVEN an interrupted mutation or test command
- WHEN explicit continuation is requested
- THEN the child is told to inspect previous effects rather than blindly replay the original task
### Requirement: Distribution and privacy
The feature SHALL ship from Deck source through generated Pi extension assets and the existing TUI installation flow. Existing model/thinking/tool restrictions, child markers and runtime memory handoff SHALL be preserved. Persistence SHALL use private bounded records without credentials or raw environment dumps. Terminal output SHALL be sanitized.
#### Scenario: Installation
- GIVEN repository-generated assets
- WHEN the existing Pi installation/materialization flow runs in an isolated test
- THEN it includes the new extension with no manual home-file patch
### Requirement: Pi-only Lead task integration
Pi SHALL maintain execution, native-context admission and Lead integration as distinct states without changing core team policy or other runners. A fresh ephemeral task board SHALL identify current tasks/attempts, dependencies, pending outcomes and blockers. Lead SHALL review evidence and explicitly resolve the current outcome as integrated or blocked with a concrete summary. Receiving a message SHALL NOT imply integration; integrated resolution requires a review transition. The board and wake messages SHALL NOT grant new execution authority or override user pauses/no-delegation instructions.
#### Scenario: Lead follow-through
- GIVEN an idle Lead and a completed task
- WHEN the result becomes available
- THEN native scheduling admits a continuation, Lead reviews and validates the report, resolves it and provides a concise synthesis without another user prompt
#### Scenario: Result during Lead tool work
- GIVEN Lead is executing its own tools
- WHEN an independent child completes
- THEN the next natural context includes the result board
- AND integration during that tool loop does not cause a duplicate final synthesis afterward
#### Scenario: Failure of notification or UI
- GIVEN a completed outcome and a throwing renderer/persistence/delivery effect
- WHEN terminal handling runs
- THEN the outcome remains inspectable, persistence is retried and non-durable state is visible
- AND failed native admission is retried at most three times per activation, with the same outcome identity
- AND admitted-but-unresolved work gets at most one follow-through reminder and remains visibly pending rather than entering an unbounded model loop
#### Scenario: Obsolete result
- GIVEN a task has an explicitly resumed attempt
- WHEN an old message, activity callback or resolve request arrives
- THEN it cannot acknowledge, close or overwrite the current attempt
### Requirement: Continuation diagnostics and advisory context
Failed execution SHALL preserve a structured failure kind and available exit/signal evidence rather than treat the last progress text as success. Delegated shell timeout semantics SHALL be explicit to the child. Native custom-message continuations SHALL preserve only the exact parent's existing ephemeral advisory memory when its prompt override is absent, without another provider recall, raw child capture, duplicate injection or session persistence.
