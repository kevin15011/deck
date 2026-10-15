# Supervised client proof requirements

## ADDED Requirements

### Requirement: Optional structured supervised launch
Deck SHALL provide an opt-in proof path for an external client to launch Pi with the same applicable preparation, extension, policy, memory scope, and lifecycle ownership as the supported supervised path. Deck SHALL NOT depend on the client package.

#### Scenario: Start through the proof client
- **GIVEN** a valid explicit project and an isolated supported runtime
- **WHEN** the separate client requests a new supervised session
- **THEN** Deck creates the lead using its existing composition and returns structured session/control evidence.

### Requirement: Observe actual delegation
The proof SHALL show structured lead activity and one real Deck-managed child task using runtime identities, distinguishing completion from integration.

#### Scenario: Child reports a result
- **GIVEN** a deterministic local provider fixture drives the lead to delegate
- **WHEN** the Deck child completes
- **THEN** the client can observe the child/task identity and terminal outcome without guessing from OS ancestry.

### Requirement: Preserve cleanup and isolation
Deck SHALL retain ownership of process cleanup and SHALL handle shutdown, malformed input, child failure, and bounded output without allowing one client to control an unrelated session.

#### Scenario: Client requests shutdown or disconnects
- **GIVEN** an owned supervised session
- **WHEN** its control channel ends or requests closure
- **THEN** the documented policy closes or settles owned work without orphaning children or affecting unrelated processes.

### Requirement: Preserve terminal behavior
The existing interactive Pi launch SHALL remain usable without the optional client.

#### Scenario: Existing terminal use
- **WHEN** a user follows the ordinary supervised interactive launch
- **THEN** no client package, web server, account, or authentication flow is required.

### Requirement: No application authentication
The proof SHALL NOT introduce login, accounts, app credentials, or browser authentication tokens. Existing Deck internal runtime handoffs and provider security SHALL remain unchanged.

#### Scenario: Local proof invocation
- **WHEN** a developer runs the separately installed local proof client
- **THEN** no application authentication is requested
- **AND** any network control surface, if introduced, is loopback-only with hostile-origin/Host rejection.

### Requirement: Honest deterministic verification
Tests SHALL avoid real provider/MCP network calls, user profile writes, and installations, and SHALL distinguish actual native Pi execution from mocks.

#### Scenario: Evidence report
- **WHEN** verification completes
- **THEN** the report names exact commands, runtime paths, simulated components, and tested platforms without claiming unperformed macOS validation.
