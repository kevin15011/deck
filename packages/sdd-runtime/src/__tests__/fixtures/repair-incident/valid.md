# Repair Incident Fixture

## Repair Manifest (machine-readable)

```yaml
schema: repair-incident-v1
incidentId: repair-fixture-001
changeId: bounded-developer-team-repair-loops
status: open
createdFrom:
  phase: verify
  artifact: verify-report.md
budgets:
  incident:
    verifyCyclesSoft: 3
    verifyCyclesHard: 5
    repairAttemptsSoft: 2
    repairAttemptsHard: 4
  fingerprint:
    repairThreshold: 2
    replanThreshold: 3
    escalationThreshold: 4
runtimeBudget:
  tokensUsed: null
  turnsUsed: null
  timeElapsedMs: null
  toolCallsUsed: null
failures:
  - id: fp-fixture-001
    status: open
    sourcePhase: verify
    taskGroup: "Task 10"
    ownerHint: General Apply
    failingContract: REQ-ORT-004
    requirementIds:
      - REQ-ORT-004
    scenarioIds: []
    errorClass: assertion
    changedFiles:
      - packages/adapter-opencode/src/command-generation.ts
    evidence:
      command: bun test packages/adapter-opencode/src/command-generation.test.ts
      latestResult: fail
      artifact: verify-report.md
      excerpt: repair incident handoff was absent from generated commands
    attempts:
      count: 1
      history:
        - attempt: 1
          phase: apply
          artifact: apply-progress.md
          summary: scoped adapter wording attempted
          verificationStage: targeted
          result: failed
    generatedArtifacts:
      - path: packages/adapter-opencode/src/command-generation.ts
        classification: not_generated
        evidence: normal checked-in TypeScript source
    nextVerificationStage: targeted
    nextAction: repair
  - id: fp-fixture-002
    status: open
    sourcePhase: verify
    taskGroup: "Task 11"
    ownerHint: General Apply
    failingContract: REQ-RFM-002
    requirementIds:
      - REQ-RFM-002
    scenarioIds: []
    errorClass: assertion
    changedFiles:
      - packages/sdd-runtime/src/contracts/repair-incident.ts
    evidence:
      command: bun test packages/sdd-runtime/src/contracts/repair-incident.test.ts
      latestResult: fail
      artifact: verify-report.md
      excerpt: fixture parser did not report deterministic field-level errors
    attempts:
      count: 0
      history: []
    nextVerificationStage: targeted
    nextAction: verify
lifecycle:
  - event: repair.started
    phase: verify
    artifact: verify-report.md
    at: "2026-06-22T10:00:00Z"
    summary: fixture incident opened
```
