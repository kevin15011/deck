# Spec: Complete Skill Discovery Runtime

## Requirements

### REQ-001: Logical frontmatter depth

The descriptor parser MUST count nested YAML mappings and sequences, not scalar, pair, or key representation nodes. The root mapping SHALL have logical depth zero and each nested collection SHALL add one.

#### Scenario: Ordinary metadata is accepted

```gherkin
Given a valid skill descriptor with metadata.author and metadata.version
When Deck inspects its frontmatter
Then the descriptor MUST be accepted
And discovery completeness MUST NOT be downgraded because of that metadata
```

#### Scenario: Genuine excessive nesting is rejected

```gherkin
Given a descriptor whose nested collections exceed the configured logical depth
When Deck inspects its frontmatter
Then the descriptor MUST be rejected as unsafe_frontmatter
```

### REQ-002: Existing parser protections

Deck MUST continue to reject aliases, forbidden tags, duplicate or merge keys, malformed YAML, invalid UTF-8, oversized input, and prohibited traversal. Unknown metadata MUST remain untrusted and MUST NOT become policy.

#### Scenario: Hostile YAML remains rejected

```gherkin
Given a descriptor containing a prohibited YAML construct
When Deck inspects the descriptor
Then discovery MUST reject it
And MUST NOT persist a complete registry candidate
```

### REQ-003: Diagnostic separation

Deck MUST distinguish descriptor rejection, incomplete source evaluation, and malformed persisted registry status. Diagnostics SHOULD identify the failed safety category without exposing descriptor bodies or absolute user paths.

### REQ-004: Bounded task-scoped search

Core MUST provide an additive, bounded search contract over candidate name, description, and declared signals. A ready registry SHALL be preferred; otherwise Deck MUST use the existing bounded generic-project plus active-runner discovery fallback.

#### Scenario: No relevant skill is valid

```gherkin
Given complete discovery with no relevant candidate
When an agent searches for its task
Then Deck MUST return an empty candidate set
And unrelated work MUST remain unblocked
```

### REQ-005: Agent-owned selection

Each Lead or specialist context MUST select the smallest relevant skill set for its own scope. Parent agents MUST NOT claim child load state or select candidates through delegation payloads.

### REQ-006: Observation-bound resolution

A selected candidate MUST be referenced by observation identity, rebound to the trusted project and active runner, and reverified immediately before loading. Same-name ambiguity MUST return an explicit non-loadable outcome rather than substitute another observation.

### REQ-007: Native loading outcomes

Runner adapters SHALL own native addressability and loading translation. Deck MUST distinguish `loadable`, `missing`, `ambiguous`, `not_exposed`, `denied`, `unsupported`, and `rejected` preparation outcomes, and MUST distinguish `loaded`, `failed`, and `unobserved` load outcomes.

#### Scenario: Native denial is honest

```gherkin
Given a selected observation that the active runner denies
When Deck requests native loading
Then the result MUST NOT be loaded
And Deck MUST NOT inject the skill body as a bypass
```

### REQ-008: Privacy and authority

Absolute paths and native load references MUST remain inside trusted Core/adapter execution boundaries. Discovery and loading MUST NOT grant installation, modification, execution, or registry-write authority.

### REQ-009: OpenCode vertical slice

The shipped OpenCode composition MUST prove task search, exact observation resolution, native load invocation, and observed outcome for both Lead-owned work and one delegated specialist context.

### REQ-010: Runner capability honesty

Pi and Codex MUST NOT be presented as supporting verified registry-to-native loading until equivalent production paths pass contract and runtime acceptance tests. Unsupported capability MUST fail open for unrelated work.

## Compatibility

Registry V1, existing observation identity, fingerprints, explicit refresh authorization, atomic persistence, and archived history MUST remain unchanged.
