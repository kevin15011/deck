# Spec: consolidate-code-review-quality

## Summary

**Change ID**: consolidate-code-review-quality  
**Requirements Owner**: deck-developer-spec

## Requirements

### R1: REVIEW_AGENT_BODY References

**R1.1**: The `REVIEW_AGENT_BODY` Instructions section MUST contain a reference to `code-review-and-quality` for five-axis review criteria.

- **Location**: `packages/core/src/teams/developer/review-content.ts`, `REVIEW_AGENT_BODY` constant, Instructions section
- **Format**: Plain text reference (e.g., "Use code-review-and-quality skill for five-axis criteria")
- **Validation**: Source inspection + test assertion

### R2: REVIEW_SKILL_BODY Step 3 Preamble References

**R2.1**: The `REVIEW_SKILL_BODY` Step 3 preamble MUST contain a reference to `code-review-and-quality` for five-axis criteria methodology.

- **Location**: `packages/core/src/teams/developer/review-content.ts`, `REVIEW_SKILL_BODY` constant, Step 3 section
- **Format**: Plain text reference
- **Validation**: Source inspection + test assertion

### R3: REVIEW_SKILL_BODY Rules References

**R3.1**: The `REVIEW_SKILL_BODY` Rules section MUST reference `code-review-and-quality` for five-axis methodology, severity classification, and honesty/evidence-based assessments.

- **Location**: `packages/core/src/teams/developer/review-content.ts`, `REVIEW_SKILL_BODY` constant, Rules section
- **Format**: Plain text reference
- **Validation**: Source inspection + test assertion

### R4: Deck SDD Contract Preservation

**R4.1**: Scopes MUST be preserved: `general`, `backend`, `frontend`, `integration`.

- **Validation**: Source inspection

**R4.2**: Registry persistence and deferred-mode instructions MUST be preserved.

- **Validation**: Source inspection

**R4.3**: `review-report.md` artifact path and persistence logic MUST be preserved.

- **Validation**: Source inspection + test assertion

**R4.4**: Output templates (review report, return summary) MUST be preserved.

- **Validation**: Source inspection + test assertion

**R4.5**: Severity labels MUST be preserved: BLOCKER, MAJOR, MINOR, NIT.

- **Validation**: Source inspection + test assertion

**R4.6**: Backend/frontend/integration criteria sections MUST be preserved.

- **Validation**: Source inspection

### R5: Test Coverage

**R5.1**: Test file `review-content.test.ts` MUST include assertions verifying:
- `REVIEW_AGENT_BODY` contains reference to `code-review-and-quality`
- `REVIEW_SKILL_BODY` contains reference to `code-review-and-quality`
- Deck SDD contract elements are present (scopes, registry, artifacts, templates, severity labels)

- **Validation**: Test execution (20 tests pass)

### R6: Build and Typecheck

**R6.1**: `bun run build:dry-run` MUST pass.

- **Validation**: Build command execution

**R6.2**: TypeScript compilation for affected files MUST succeed.

- **Validation**: tsc on affected files

## Acceptance Scenarios

| ID | Scenario | Validation Method | Pass Criteria |
|---|---|---|---|
| AS1 | REVIEW_AGENT_BODY has code-review-and-quality reference | Source inspection + test | Reference present in Instructions |
| AS2 | REVIEW_SKILL_BODY Step 3 has reference | Source inspection + test | Reference present in Step 3 preamble |
| AS3 | REVIEW_SKILL_BODY Rules has reference | Source inspection + test | Reference present in Rules |
| AS4 | Scopes preserved | Source inspection | general, backend, frontend, integration present |
| AS5 | Registry/artifact/template contract | Source inspection + test | All contract elements present |
| AS6 | Severity labels | Source inspection + test | BLOCKER/MAJOR/MINOR/NIT present |
| AS7 | Tests pass | Test execution | 20/20 pass |
| AS8 | Build passes | Build command | Exit code 0 |

## Non-Goals

- No modification of actual review behavior or logic
- No changes to skill implementation files
- No raw backticks inside template literals
- No generated file changes
