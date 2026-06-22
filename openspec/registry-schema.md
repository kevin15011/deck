# OpenSpec Registry Schema Reference

## Overview

This document defines the canonical schemas for OpenSpec Registry files:
- `spec-registry-v1` for `state.yaml`
- `spec-registry-events-v1` for `events.yaml`

The registry is the operational authority for Deck's SDD workflow. All agents and humans write to this schema when creating or updating changes.

---

## Schema: spec-registry-v1 (state.yaml)

### Required Fields

| Field | Type | Description |
|---|---|---|
| `schema` | string | Must be `"spec-registry-v1"` |
| `changeId` | string | Unique change identifier (kebab-case recommended) |
| `currentPhase` | string | Current phase in the SDD lifecycle |
| `status` | string | Current status of the change |
| `artifacts` | object | Map of artifact kind keys to filenames |
| `provenance` | array | Array of provenance entries |

### Optional Fields

| Field | Type | Description |
|---|---|---|
| `name` | string | Human-readable change name |
| `apply_batches` | array | List of apply batch identifiers |
| `apply_fixes` | array | List of apply fix identifiers |
| `baseline_health` | string | Health status at baseline |
| `closure_reason` | string | Reason for closure (required if status is `abandoned` or `incomplete`) |
| `closed_at` | string | ISO timestamp when closed |
| `exploration_context` | string | Exploration context: `sdd` (formal SDD Explorer stopped before Proposal) or `delegated` (Orchestrator-delegated Explorer with actionable diagnosis) — optional, warning-level |
| `lifecycle_status` | string | Exploration lifecycle state: `diagnosed`, `deferred`, `closed-no-action`, `converted-to-change`, `converted-to-sdd`, or `keep-as-reference` — optional, warning-level |
| `next_action` | string | Explicit next action when lifecycle_status is `diagnosed` or recommended for `deferred` — optional, warning-level |
| `lifecycle_reason` | string | Brief reason for `deferred`, `closed-no-action`, or `keep-as-reference` — optional, warning-level |
| `lifecycle_ref` | string | Reference to proposal/change for `converted-to-change` or resulting SDD for `converted-to-sdd` — optional, warning-level |

### Phase Values

```
explore → proposal → spec → design → tasks → apply → verify → review → archive → closed
```

Valid phases:
- `explore`
- `proposal`
- `spec`
- `design`
- `tasks`
- `apply`
- `verify`
- `review`
- `archive`
- `closed`

### Status Values

Valid statuses:
- `in_progress`
- `completed`
- `passed`
- `passed_with_warnings`
- `failed`
- `approved`
- `archived`
- `abandoned`
- `incomplete`

### Phase/Status Consistency Rules

| Phase | Required Status |
|---|---|
| `archive` | `archived` |
| `closed` | `abandoned` or `incomplete` |

### Artifact Keys

| Key | Description |
|---|---|
| `exploration` | Exploration artifact |
| `proposal` | Proposal artifact |
| `spec` | Spec artifact |
| `design` | Design artifact |
| `tasks` | Tasks artifact |
| `preconditions` | Preconditions artifact (optional, for Apply-bound changes) |
| `repair_incident` | Repair incident telemetry artifact (optional, `repair-incident.md`) |
| `apply_progress` | Apply progress artifact |
| `verify_report` | Verify report artifact |
| `review_report` | Review report artifact |
| `archive_report` | Archive report artifact |

> **Note**: `artifacts.preconditions` is optional. The Task Agent SHOULD produce `preconditions.md` for changes advancing to Apply. The Orchestrator evaluates this artifact before launching Apply.

> **Repair telemetry note**: `artifacts.repair_incident` is optional and should point to `repair-incident.md` when a bounded repair loop starts. Legacy and non-repair changes do not need to add it. If `repair.*` lifecycle events exist without this artifact reference, validators warn first rather than fail the change. If an Apply/Verify change references `artifacts.repair_incident`, the referenced file must exist.

### Provenance Entry

Each provenance entry must contain:
- `phase` (string): Phase name
- `agent` (string): Agent that performed the write
- `model` (string): Model used
- `timestamp` (string): ISO 8601 date
- `registryWrite` (string): `"non-deferred"` or `"deferred-reconciled"`

Optional:
- `note` (string): Free-text note about the write

---

## Schema: spec-registry-events-v1 (events.yaml)

### Required Fields

| Field | Type | Description |
|---|---|---|
| `schema` | string | Must be `"spec-registry-events-v1"` |
| `events` | array | Array of event entries |

### Event Entry

Each event must contain:
- `phase` (string): Phase name
- `status` (string): Status at time of event
- `event` (string): Event name in `{phase}.{status}` format
- `artifact` (string): Artifact filename
- `timestamp` (string): ISO 8601 date
- `actor` (string): Agent or human that triggered the event

Optional:
- `notes` (array): Array of strings with event notes
- `registry_write` (string): `"non-deferred"` or `"reconciled-by-orchestrator"`

### Auxiliary Repair Lifecycle Events

Repair lifecycle events are known auxiliary events. They record bounded repair-loop telemetry and do not advance `currentPhase` by themselves:

- `repair.started`
- `repair.retry_recorded`
- `repair.checkpoint_reached`
- `repair.replanned`
- `repair.escalated`
- `repair.blocked`
- `repair.resolved`

When any of these events is recorded, the event `artifact` should be `repair-incident.md` and `state.yaml` should reference `artifacts.repair_incident: repair-incident.md`. Missing repair-incident references are warning-first to preserve compatibility with existing changes.

---

## Severity Rules

### Errors (exit code 1)

- YAML parse failure
- Missing required fields in canonical state.yaml
- Invalid enum values
- Phase/status inconsistency (e.g., `archive` without `archived` status)
- Missing artifact files for completed phases
- Missing events.yaml when phase > explore

### Warnings (exit code 0)

- Legacy drift: missing `schema` field
- Legacy field names (`current_phase` vs `currentPhase`)
- Legacy provenance format (object vs array)
- Events/state phase mismatch
- Non-canonical artifact shapes
- `repair.*` lifecycle events without `artifacts.repair_incident`

---

## Examples

### Valid state.yaml (spec-registry-v1)

```yaml
schema: spec-registry-v1
changeId: my-example-change
name: Example Change
currentPhase: spec
status: in_progress
artifacts:
  exploration: exploration.md
  proposal: proposal.md
provenance:
  - phase: explore
    agent: deck-developer-explorer
    model: opencode-go/kimi-k2.6
    timestamp: "2026-06-12"
    registryWrite: non-deferred
    note: "Initial exploration"
  - phase: proposal
    agent: deck-developer-proposal
    model: openai/gpt-5.5
    timestamp: "2026-06-12"
    registryWrite: non-deferred
    note: "Created proposal"
```

### Valid events.yaml (spec-registry-events-v1)

```yaml
schema: spec-registry-events-v1
events:
  - phase: explore
    status: completed
    event: explore.completed
    artifact: exploration.md
    timestamp: "2026-06-12"
    actor: deck-developer-explorer
    notes:
      - "Completed exploration phase"
  - phase: proposal
    status: completed
    event: proposal.completed
    artifact: proposal.md
    timestamp: "2026-06-12"
    actor: deck-developer-proposal
    registry_write: non-deferred
    notes:
      - "Completed proposal phase"
```

---

## Legacy Compatibility

Changes created before this schema may use legacy formats:
- Missing `schema` field → treated as legacy, warnings issued
- `current_phase` instead of `currentPhase` → warning
- `phase` instead of `currentPhase` → warning
- `provenance` as object instead of array → warning

The validator reports these as warnings, not errors, to preserve backward compatibility.

---

## Validation Rule Codes

| Code | Severity | Description |
|---|---|---|
| `state.yaml.missing` | error | state.yaml file not found |
| `state.yaml.parse_error` | error | Invalid YAML syntax |
| `state.yaml.duplicate_key` | error | Duplicate keys in state.yaml |
| `state.schema.missing` | warning | Missing schema field (legacy) |
| `state.schema.invalid` | error | Invalid schema value |
| `state.changeId.missing` | error | Missing changeId field |
| `state.currentPhase.missing` | error | Missing currentPhase field |
| `state.status.missing` | error | Missing status field |
| `state.phase_status.invalid_archive` | error | archive phase requires archived status |
| `state.phase_status.invalid_closed` | error | closed phase requires abandoned/incomplete status |
| `state.artifacts.missing` | error | Missing artifacts map |
| `state.provenance.missing` | error | Missing provenance array |
| `state.closure_reason.required` | error | closure_reason required for abandoned/incomplete |
| `events.yaml.missing` | error | events.yaml required when phase > explore |
| `events.yaml.parse_error` | error | Invalid YAML in events.yaml |
| `events.events.missing` | error | Missing events array |
| `events.event.required_field_missing` | error | Event missing required field |
| `events.event.name_mismatch` | error | Event name doesn't match phase.status |
| `events.state.last_event_mismatch` | warning | Last event doesn't match currentPhase |
| `artifact.missing_for_completed_phase` | error | Artifact file not found |
| `repair_incident.artifact.missing` | warning | repair lifecycle event exists but `artifacts.repair_incident` is not referenced |
| `legacy.drift` | warning | Legacy format detected |
| `preconditions.artifact.missing` | warning | preconditions.md missing at Apply+ phase |
| `preconditions.artifact.not_referenced` | warning | preconditions.md exists but not referenced |
| `lifecycle.unknown_context` | warning | Unknown exploration_context value |
| `lifecycle.missing_context` | warning | lifecycle_status present but exploration_context missing |
| `lifecycle.unknown_value` | warning | Unknown lifecycle_status value |
| `lifecycle.missing_next_action` | warning | diagnosed without next_action |
| `lifecycle.incomplete_deferred` | warning | deferred without reason or reactivation |
| `lifecycle.incomplete_closed_no_action` | warning | closed-no-action without reason |
| `lifecycle.missing_conversion_reference` | warning | converted-to-change without reference |
| `lifecycle.missing_sdd_reference` | warning | converted-to-sdd without reference |
| `lifecycle.missing_reference_rationale` | warning | keep-as-reference without rationale |
