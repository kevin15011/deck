# Invalid Repair Incident Fixture

## Repair Manifest (machine-readable)

```yaml
schema: repair-incident-v1
incidentId: repair-fixture-invalid-001
changeId: bounded-developer-team-repair-loops
status: invalid_status
createdFrom:
  phase: verify
  artifact: verify-report.md
budgets:
  incident:
    verifyCyclesSoft: 2
    verifyCyclesHard: 4
    repairAttemptsSoft: 2
    repairAttemptsHard: 4
  fingerprint:
    repairThreshold: 2
    replanThreshold: 3
    escalationThreshold: 4
failures:
  - id: ""
    status: open
    sourcePhase: verify
    taskGroup: "Task 11"
    failingContract: REQ-RFM-002
    errorClass: assertion
    evidence:
      command: bun test packages/sdd-runtime/src/contracts/repair-incident.test.ts
      latestResult: fail
      artifact: verify-report.md
      excerpt: invalid fixture intentionally omits required fields
    attempts:
      count: 0
      history: []
lifecycle:
  - event: repair.started
    phase: verify
    artifact: verify-report.md
    at: "2026-06-22T10:00:00Z"
    summary: invalid fixture
```
