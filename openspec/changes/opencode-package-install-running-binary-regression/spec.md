# Spec: OpenCode Package Install Running-Binary Regression

## Spec Status

- **Change ID:** `opencode-package-install-running-binary-regression`
- **Mode:** Automatic
- **Phase:** Spec
- **Status:** Completed
- **Approved proposal:** `proposal.md` at SHA-256 `1ca7292f6ba579e95698ee6af33902e86519c7ca661761d5470dd62402fa8951`
- **Authoritative exploration:** `exploration.md` at SHA-256 `fde0cbd4b3f6f9ee34ca868ef39e13c66b06cd1e6e85edb7aff96417c7fb5fe2`
- **Modification boundary:** This phase creates only this `spec.md`. It does not modify source, tests, configuration, user-home state, shared registry YAML, or other change artifacts.

---

## 1. Scope and Definitions

### 1.1 Change Intent

Define Runner Setup as idempotent capability assurance: confirm that required capabilities are usable and install only those that are genuinely missing. When strong evidence shows a capability is already present, Runner Setup reports an explicit already-present outcome and does not run the installer. When a capability is absent and its installer fails, the action remains failed with a bounded, sanitized, actionable cause visible in the dashboard.

### 1.2 Key Terms

| Term | Definition |
|---|---|
| **capability** | An OpenCode tool or MCP that Runner Setup is responsible for ensuring is available |
| **installed evidence** | Bounded, positive proof that a capability is present and usable: a configured command resolving to a regular executable, a regular executable in PATH, or a canonical install target |
| **already-present outcome** | An explicit structured result indicating the capability was found to be present and the installer was not invoked |
| **bounded cause** | A sanitized, size-limited, human-readable explanation of why an action failed, suitable for dashboard display |
| **effect boundary** | The immediate point before an external installer is invoked |
| **recheck** | A fresh installed-evidence evaluation performed at the effect boundary to catch stale plans |

### 1.3 Product Decision (Resolved)

Runner Setup is strictly install-if-missing capability assurance. It is not an implicit upgrade or reinstall surface. A capability that is already present SHALL NOT be reinstalled. A genuine installer failure for a missing capability SHALL remain failed. An explicit upgrade/reinstall path is excluded from this change and may be proposed separately.

---

## 2. Requirements

### 2.1 Installed Evidence Detection (EVD)

#### REQ-EVD-01: Strong evidence prevents false-missing classification
**Priority:** MUST

Runner Setup SHALL NOT classify a capability as missing solely because default configuration files are absent when strong configured-command, executable, or supported install-target evidence proves the capability is present.

**Scenarios:**

**Scenario EVD-01-S1: Default config absent, executable present in PATH**
```
Given  default OpenCode configuration files are absent
  And  the capability's expected executable exists in the injected PATH as a regular file with execute permission
When   Runner Setup evaluates installed evidence for the capability
Then   the capability is classified as present
  And  the evidence source is recorded as "PATH"
```

**Scenario EVD-01-S2: Default config absent, no executable evidence**
```
Given  default OpenCode configuration files are absent
  And  the capability's expected executable is not found in PATH
When   Runner Setup evaluates installed evidence for the capability
Then   the capability is classified as absent
  And  installation may proceed
```

---

#### REQ-EVD-02: Evidence must be package-relevant and executable
**Priority:** MUST

Installed evidence SHALL resolve to the expected package capability and to a usable regular executable or other equally strong adapter-authoritative proof. Existence of a non-executable file, a directory, or an unrelated entry SHALL NOT constitute installed evidence.

**Scenarios:**

**Scenario EVD-02-S1: Path entry exists but is not executable**
```
Given  a path entry matching the capability name exists in PATH
  And  the path entry is a regular file without execute permission
When   Runner Setup evaluates installed evidence
Then   the capability is classified as absent
  And  the evidence source is recorded as "PATH-non-executable"
```

**Scenario EVD-02-S2: Path entry exists but is a directory**
```
Given  a directory matching the capability name exists in PATH
When   Runner Setup evaluates installed evidence
Then   the capability is classified as absent
```

**Scenario EVD-02-S3: MCP config points to valid executable**
```
Given  an OpenCode MCP configuration entry references the capability
  And  the configured command resolves to a regular executable file
When   Runner Setup evaluates installed evidence
Then   the capability is classified as present
  And  the evidence source is recorded as "configured"
```

---

#### REQ-EVD-03: Evidence source must be recorded
**Priority:** MUST

Every installed-evidence evaluation SHALL record the evidence source internally (e.g., "configured", "PATH", "canonical-target", "absent") so that tests and diagnostics can distinguish the detection path.

**Scenarios:**

**Scenario EVD-03-S1: Evidence source is queryable**
```
Given  Runner Setup has evaluated installed evidence for a capability
When   the evaluation result is inspected
Then   the evidence source is present and one of: "configured", "PATH", "canonical-target", "absent"
```

---

#### REQ-EVD-04: Configuration evidence uses adapter authority
**Priority:** MUST

Configuration evidence SHALL use the existing adapter-resolved OpenCode configuration authority. Runner Setup SHALL NOT invent an independent filesystem scan or accept declaration-only configuration that does not resolve to a usable executable.

**Scenarios:**

**Scenario EVD-04-S1: Config declares capability but target is missing**
```
Given  an OpenCode configuration entry declares the capability
  And  the configured command path does not exist as a file
When   Runner Setup evaluates installed evidence
Then   the capability is classified as absent
```

**Scenario EVD-04-S2: Config declares capability but target is not executable**
```
Given  an OpenCode configuration entry declares the capability
  And  the configured command path exists but is not executable
When   Runner Setup evaluates installed evidence
Then   the capability is classified as absent
```

---

### 2.2 Pre-Install Recheck (RCK)

#### REQ-RCK-01: Recheck immediately before external installer invocation
**Priority:** MUST

Runner Setup SHALL re-evaluate installed evidence at the effect boundary, immediately before invoking any external installer. If the capability is positively present at recheck time, the installer SHALL NOT be invoked.

**Scenarios:**

**Scenario RCK-01-S1: Plan says install, but binary appears before execution**
```
Given  Runner Setup planned to install capability X
  And  capability X's executable appears (e.g., was installed by a concurrent process) before the installer is invoked
When   Runner Setup performs the effect-boundary recheck
Then   the installer is not invoked
  And  the result is an explicit already-present outcome
  And  downloader/shell invocation count is zero
```

**Scenario RCK-01-S2: Plan says install, capability still absent at recheck**
```
Given  Runner Setup planned to install capability X
  And  capability X is still absent at the effect-boundary recheck
When   Runner Setup reaches the effect boundary
Then   the installer is invoked normally
```

---

#### REQ-RCK-02: Recheck uses same evidence rules as initial detection
**Priority:** MUST

The effect-boundary recheck SHALL use the same evidence evaluation rules as the initial detection (REQ-EVD-01 through REQ-EVD-04). It SHALL NOT use a different or weaker evidence standard.

**Scenarios:**

**Scenario RCK-02-S1: Recheck applies identical evidence precedence**
```
Given  capability X is detected as present via PATH evidence during initial evaluation
  And  the same PATH evidence remains valid at the effect boundary
When   the recheck evaluates installed evidence
Then   the capability is classified as present using the same evidence source
```

---

### 2.3 Already-Present Outcome (APO)

#### REQ-APO-01: Explicit already-present result when installer not run
**Priority:** MUST

When Runner Setup determines a capability is already present and does not invoke the installer, the result SHALL be an explicit already-present outcome. The result SHALL NOT be reported as a successful install or as "executed".

**Scenarios:**

**Scenario APO-01-S1: Already-present outcome structure**
```
Given  capability X is detected as present at the effect-boundary recheck
When   Runner Setup produces the action result
Then   the result includes an explicit indicator that the capability was already present
  And  the result does not claim a fresh install occurred
  And  the installer was not invoked
```

**Scenario APO-01-S2: Already-present is distinguishable from fresh install**
```
Given  capability X was installed fresh by the installer
  And  capability Y was already present and skipped
When   the action results are compared
Then   X's result indicates a fresh install occurred
  And  Y's result indicates already-present/no-install
  And  the two results are distinguishable by outcome type
```

---

#### REQ-APO-02: Already-present outcome is compatible with existing action semantics
**Priority:** MUST

The already-present outcome SHALL be compatible with existing action-status semantics. It SHALL NOT cause downstream actions to be incorrectly gated, skipped, or marked as failed.

**Scenarios:**

**Scenario APO-02-S1: Already-present does not gate dependent config writes**
```
Given  capability X is already present
  And  capability X has dependent MCP configuration writes
When   Runner Setup completes with an already-present outcome
Then   dependent configuration writes proceed normally
  And  are not gated as if the install failed
```

---

### 2.4 Failed Installer Handling (FAL)

#### REQ-FAL-01: Genuine installer failure remains failed
**Priority:** MUST

When a capability is genuinely absent and its installer exits unsuccessfully (nonzero exit code or otherwise unsuccessful result), the action result SHALL remain `failed`. The failure SHALL NOT be converted to success merely because an older or unusable target exists.

**Scenarios:**

**Scenario FAL-01-S1: Installer exits nonzero, no prior target**
```
Given  capability X is absent
  And  the installer exits with nonzero status
When   Runner Setup processes the installer result
Then   the action result is `failed`
  And  diagnostics from the installer are preserved internally
```

**Scenario FAL-01-S2: Installer exits nonzero, stale target exists**
```
Given  capability X has a stale or unusable existing target
  And  the installer exits with nonzero status
When   Runner Setup processes the installer result
Then   the action result is `failed`
  And  the result is not converted to success because the stale target exists
```

---

#### REQ-FAL-02: Preserve original structured diagnostics
**Priority:** MUST

When an installer fails, Runner Setup SHALL preserve the original structured diagnostics (stdout, stderr, exit code) internally. The top-level action message SHALL NOT be reduced to a generic sentence that discards the original diagnostic content.

**Scenarios:**

**Scenario FAL-02-S1: Diagnostics are retained in internal result**
```
Given  the installer fails with stderr containing structured error information
When   Runner Setup processes the failure
Then   the internal result retains the original stderr in a diagnostics field
  And   the internal result retains the original stderr in a raw field
  And   the top-level message is derived from the diagnostics, not a generic placeholder
```

---

#### REQ-FAL-03: Failed installer gates only matching dependent work
**Priority:** MUST

A failed installer result SHALL gate only the matching dependent capability configuration writes under the existing policy. Unrelated actions and their dependents SHALL continue normally.

**Scenarios:**

**Scenario FAL-03-S1: Failure gates matching dependents only**
```
Given  capability X's installer fails
  And  capability X has dependent MCP configuration writes
  And  capability Y is unrelated and has its own dependents
When   Runner Setup completes the plan
Then   capability X's dependent config writes are gated/skipped
  And  capability Y and its dependents proceed normally
```

---

### 2.5 Dashboard Diagnostics (DIA)

#### REQ-DIA-01: Bounded sanitized actionable cause
**Priority:** MUST

When an action fails, the dashboard SHALL display a bounded, sanitized, actionable cause. The cause SHALL be derived from the installer diagnostics and SHALL exclude secrets, credentials, absolute user-home paths, uncontrolled terminal sequences, and unbounded output.

**Scenarios:**

**Scenario DIA-01-S1: Cause excludes ANSI control sequences**
```
Given  the installer stderr contains ANSI escape codes and progress indicators
When   Runner Setup normalizes the cause for display
Then   the displayed cause contains no ANSI escape codes
  And  the displayed cause contains no progress-bar characters
```

**Scenario DIA-01-S2: Cause redacts absolute home paths**
```
Given  the installer stderr contains an absolute path to the user's home directory
When   Runner Setup normalizes the cause for display
Then   the absolute home path is replaced with a generic placeholder (e.g., "~" or "<home>")
  And  the real home path is not visible in the dashboard
```

**Scenario DIA-01-S3: Cause excludes secrets and credentials**
```
Given  the installer stderr contains tokens, API keys, or other secret-like strings
When   Runner Setup normalizes the cause for display
Then   the secret-like strings are redacted using existing secret-redaction mechanisms
  And  no credentials are visible in the dashboard
```

**Scenario DIA-01-S4: Cause is bounded in size**
```
Given  the installer stderr is very long (e.g., hundreds of lines)
When   Runner Setup normalizes the cause for display
Then   the displayed cause is bounded by a strict line count limit
  And  the displayed cause is bounded by a strict character count limit
  And  the bounds are deterministic and testable
```

---

#### REQ-DIA-02: Action/package identity is displayed with failure cause
**Priority:** MUST

When an action fails, the dashboard SHALL display the action or package identity alongside the bounded cause. The display SHALL NOT show only the generic failure sentence without identifying which action or package failed.

**Scenarios:**

**Scenario DIA-02-S1: Failed action identity is visible**
```
Given  capability X's installer fails
When   the dashboard renders the failure
Then   the display includes the action identifier (e.g., "capability.codebase-memory.install") or its display label
  And  the display includes the bounded cause
```

---

#### REQ-DIA-03: Raw diagnostics remain available for debugging
**Priority:** SHOULD

The full redacted diagnostic evidence SHOULD remain available in debug/internal channels even when the dashboard displays only the bounded cause. This ensures that detailed failure information is not lost for troubleshooting.

**Scenarios:**

**Scenario DIA-03-S1: Debug channel retains full diagnostics**
```
Given  the installer fails with detailed stderr
When   the dashboard displays a bounded cause
Then   the full redacted diagnostics are available in the internal/debug result structure
  And  the debug diagnostics include more detail than the bounded dashboard cause
```

---

### 2.6 Package-Agnostic Behavior (PAG)

#### REQ-PAG-01: Shared behavior applies across supported OpenCode packages
**Priority:** MUST

The installed-evidence detection, pre-install recheck, already-present outcome, and failed-installer handling behaviors SHALL apply consistently to all supported OpenCode package actions for which trustworthy installed evidence exists. The behavior SHALL NOT be specific to one package (e.g., codebase-memory) or match one upstream error string as the sole decision rule.

**Scenarios:**

**Scenario PAG-01-S1: Generic evidence evaluation for npm package**
```
Given  an npm-based OpenCode capability with PATH evidence
When   Runner Setup evaluates installed evidence
Then   the same evidence evaluation rules apply as for a shell-script capability
```

**Scenario PAG-01-S2: Generic evidence evaluation for shell-script package**
```
Given  a shell-script OpenCode capability with configured-command evidence
When   Runner Setup evaluates installed evidence
Then   the same evidence evaluation rules apply as for an npm capability
```

**Scenario PAG-01-S3: No hardcoded error string matching**
```
Given  an installer fails with a new error message not seen before
When   Runner Setup processes the failure
Then   the failure is handled by the same generic failure path
  And  the handling does not depend on recognizing a specific error string
```

---

#### REQ-PAG-02: codebase-memory regression scenario preserved
**Priority:** MUST

The test suite SHALL include a fixture that preserves the observed codebase-memory v0.9.0 regression evidence (pgrep warning, failed binary copy, ETXTBSY behavior) to ensure the specific incident remains covered.

**Scenarios:**

**Scenario PAG-02-S1: codebase-memory fixture proves skip behavior**
```
Given  a test fixture simulating the codebase-memory v0.9.0 installed state
  And  the fixture uses injected PATH/config evidence (not real processes)
When   Runner Setup evaluates the fixture
Then   the capability is classified as present
  And  the installer is not invoked
```

**Scenario PAG-02-S2: codebase-memory fixture proves failure normalization**
```
Given  a test fixture simulating the codebase-memory v0.9.0 installer failure
  And  the fixture provides stderr containing the pgrep warning and copy failure
When   Runner Setup normalizes the failure
Then   the bounded cause retains the meaningful failure information
  And  the bounded cause does not contain ANSI, secrets, or absolute paths
```

---

### 2.7 Safety Constraints (SAF)

#### REQ-SAF-01: No process killing or management
**Priority:** MUST

Runner Setup SHALL NOT invoke `pgrep`, `pkill`, `kill`, or any process-management command. It SHALL NOT enumerate, signal, or terminate processes by name, command substring, PID guess, port guess, or any inference based on process presence.

**Scenarios:**

**Scenario SAF-01-S1: No process commands in code paths**
```
Given  Runner Setup is executing
When   the code path is inspected
Then   no invocation of pgrep, pkill, or kill exists in the production code path
```

**Scenario SAF-01-S2: No process commands in test code**
```
Given  the automated test suite is executing
When   the test code paths are inspected
Then   no invocation of pgrep, pkill, or kill exists in the test code
```

---

#### REQ-SAF-02: No binary overwrite or replacement mechanism
**Priority:** MUST

Runner Setup SHALL NOT overwrite an executing binary, stage a replacement binary, or implement any binary activation, rollback, checksum, or replacement mechanism. Binary replacement for active MCPs is explicitly upstream-owned.

**Scenarios:**

**Scenario SAF-02-S1: No binary staging or activation**
```
Given  Runner Setup is executing
When   the code path is inspected
Then   no code exists that stages, renames, or activates a replacement binary
```

---

#### REQ-SAF-03: No upstream mutation
**Priority:** MUST

Runner Setup SHALL NOT modify, patch, vendor, or replace upstream codebase-memory-mcp code or its release process. It SHALL NOT alter the upstream installer script.

**Scenarios:**

**Scenario SAF-03-S1: Upstream artifacts unchanged**
```
Given  Runner Setup has completed
When   the upstream codebase-memory-mcp repository and release artifacts are inspected
Then   no modifications have been made by Runner Setup
```

---

#### REQ-SAF-04: No hidden success
**Priority:** MUST

Runner Setup SHALL NOT hide a failed installer behind an existing stale target. A genuine failure SHALL remain visibly failed in the action result and dashboard.

**Scenarios:**

**Scenario SAF-04-S1: Stale target does not mask failure**
```
Given  an older version of the capability exists at the install target
  And  the installer fails to install the required version
When   Runner Setup processes the result
Then   the result is `failed`
  And  the result does not claim success based on the older version's presence
```

---

#### REQ-SAF-05: Dashboard does not expose sensitive content
**Priority:** MUST

The dashboard SHALL NOT expose raw unbounded stderr, credentials, control sequences, download progress bars, or private absolute home paths. All such content SHALL be excluded or redacted before rendering.

**Scenarios:**

**Scenario SAF-05-S1: Combined sensitive content is redacted**
```
Given  the installer stderr contains a mix of ANSI progress bars, an absolute home path, a token-like string, and a meaningful error message
When   Runner Setup normalizes the cause for dashboard display
Then   the ANSI sequences are stripped
  And  the absolute home path is replaced with a placeholder
  And  the token-like string is redacted
  And  the meaningful error message is retained
  And  the total output is within the bounded size limits
```

---

### 2.8 Concurrent and TOCTOU Behavior (CTO)

#### REQ-CTO-01: Stale plan does not trigger unnecessary install
**Priority:** MUST

When a plan becomes stale between planning time and execution time (i.e., the capability was installed between plan creation and effect boundary), the effect-boundary recheck (REQ-RCK-01) SHALL prevent the unnecessary install attempt.

**Scenarios:**

**Scenario CTO-01-S1: Capability installed between plan and execution**
```
Given  Runner Setup creates a plan to install capability X at time T1
  And  capability X is installed by another process at time T2 (T2 > T1)
  And  Runner Setup reaches the effect boundary at time T3 (T3 > T2)
When   the effect-boundary recheck evaluates installed evidence
Then   capability X is classified as present
  And  the installer is not invoked
  And  the result is an already-present outcome
```

---

#### REQ-CTO-02: Capability removal between check and execution is handled gracefully
**Priority:** SHOULD

If a capability is removed between the initial evidence check and the effect-boundary recheck, the recheck SHALL detect the absence and allow the installer to proceed.

**Scenarios:**

**Scenario CTO-02-S1: Capability removed between checks**
```
Given  Runner Setup detects capability X as present during initial evaluation
  And  capability X is removed before the effect boundary
When   the effect-boundary recheck evaluates installed evidence
Then   capability X is classified as absent
  And  the installer is invoked normally
```

---

### 2.9 Missing/Invalid Executable Handling (MIS)

#### REQ-MIS-01: Missing executable triggers install
**Priority:** MUST

When the capability's expected executable is missing from PATH and no other strong evidence exists, Runner Setup SHALL classify the capability as absent and proceed with installation.

**Scenarios:**

**Scenario MIS-01-S1: Executable not in PATH**
```
Given  the capability's expected executable is not in any PATH directory
  And  no configured-command evidence exists
When   Runner Setup evaluates installed evidence
Then   the capability is classified as absent
```

---

#### REQ-MIS-02: Invalid executable triggers install
**Priority:** MUST

When the capability's expected executable exists but is not a regular file, is not executable, or does not resolve to the expected capability, Runner Setup SHALL classify the capability as absent and proceed with installation.

**Scenarios:**

**Scenario MIS-02-S1: Executable is a broken symlink**
```
Given  a symlink matching the capability name exists in PATH
  And  the symlink target does not exist
When   Runner Setup evaluates installed evidence
Then   the capability is classified as absent
```

**Scenario MIS-02-S2: Executable is a directory**
```
Given  a directory matching the capability name exists in PATH
When   Runner Setup evaluates installed evidence
Then   the capability is classified as absent
```

---

### 2.10 PATH and Configuration Variants (PCV)

#### REQ-PCV-01: PATH evidence uses correct separator
**Priority:** MUST

PATH evidence evaluation SHALL use the platform-appropriate PATH separator (colon on POSIX, semicolon on Windows). It SHALL NOT use a hardcoded separator.

**Scenarios:**

**Scenario PCV-01-S1: POSIX PATH splitting**
```
Given  PATH contains "/usr/local/bin:/usr/bin:/bin"
When   Runner Setup splits PATH for evidence evaluation
Then   three directories are evaluated
```

---

#### REQ-PCV-02: Executable permission is verified
**Priority:** MUST

PATH evidence evaluation SHALL verify that the file has execute permission, not merely that it exists. A file that exists but lacks execute permission SHALL NOT constitute installed evidence.

**Scenarios:**

**Scenario PCV-02-S1: Non-executable file in PATH**
```
Given  a regular file matching the capability name exists in PATH
  And  the file does not have execute permission
When   Runner Setup evaluates PATH evidence
Then   the file is not accepted as installed evidence
```

---

### 2.11 Cancellation Behavior (CAN)

#### REQ-CAN-01: Cancellation does not leave partial state
**Priority:** SHOULD

If Runner Setup is cancelled during an install operation, it SHOULD NOT leave the capability in a partially installed or corrupted state. The existing installer's atomicity properties are relied upon for this guarantee.

**Scenarios:**

**Scenario CAN-01-S1: Cancellation during download**
```
Given  Runner Setup is downloading the installer script
  And  the operation is cancelled
When   the cancellation completes
Then   no partial installer script is left at the install target
```

---

### 2.12 Multi-Package Isolation (MPI)

#### REQ-MPI-01: Package actions are independent
**Priority:** MUST

The installed-evidence evaluation and install decision for one capability SHALL NOT affect the evaluation or decision for another capability. A failure in one package's installer SHALL NOT prevent evaluation of other packages.

**Scenarios:**

**Scenario MPI-01-S1: One failure does not block others**
```
Given  Runner Setup is processing capabilities X and Y
  And  capability X's installer fails
When   Runner Setup evaluates capability Y
Then   capability Y's installed evidence is evaluated independently
  And  capability Y's installer is invoked if Y is absent
```

---

### 2.13 Rollback-Relevant Behavior (ROL)

#### REQ-ROL-01: Rollback preserves source and test integrity
**Priority:** MUST

Rollback of this change SHALL revert the OpenCode evidence/recheck behavior and dashboard result/rendering changes as one coherent source-and-test change through normal version-control history. Rollback SHALL NOT delete user files, stop external processes, modify upstream binaries, or use destructive Git operations without the permanent informed-confirmation flow.

**Scenarios:**

**Scenario ROL-01-S1: Rollback is a coherent revert**
```
Given  the change has been applied
When   rollback is initiated
Then   the source and test changes are reverted as one unit
  And  no schema, persisted data, or user configuration migration requires reversal
  And  external installer behavior resumes unchanged
```

**Scenario ROL-01-S2: Rollback preserves OpenSpec history**
```
Given  the change has been applied and OpenSpec history exists
When   rollback is initiated
Then   the OpenSpec history and recorded approval/decision evidence are preserved
```

---

### 2.14 Test Infrastructure (TST)

#### REQ-TST-01: Automated tests use deterministic seams
**Priority:** MUST

All automated tests SHALL use injected dependencies and fresh temporary HOME/XDG/PATH roots. Tests SHALL NOT read or write the user's real OpenCode configuration, execute the mutable upstream script, or invoke process-management commands.

**Scenarios:**

**Scenario TST-01-S1: Tests use temporary HOME**
```
Given  an automated test is executing
When   the test environment is inspected
Then   HOME, XDG_CONFIG_HOME, XDG_CACHE_HOME, and XDG_STATE_HOME point to temporary directories
  And  the real user home is not accessed
```

**Scenario TST-01-S2: Tests use injected PATH**
```
Given  an automated test is executing
When   the PATH is inspected
Then   PATH is controlled by the test harness
  And  only test-expected executables are in the PATH
```

---

#### REQ-TST-02: Tests do not access network
**Priority:** MUST

Automated tests SHALL NOT make network calls, fetch the mutable upstream script, or access external services.

**Scenarios:**

**Scenario TST-02-S1: No network in tests**
```
Given  an automated test is executing
When   the test environment has no network access
Then   all tests pass
```

---

#### REQ-TST-03: Tests do not manage processes
**Priority:** MUST

Automated tests SHALL NOT invoke process-management commands (pgrep, pkill, kill) or manage real processes.

**Scenarios:**

**Scenario TST-03-S1: No process management in tests**
```
Given  an automated test is executing
When   the test code is inspected
Then   no invocation of pgrep, pkill, or kill exists
```

---

#### REQ-TST-04: Disposable sandbox for manual verification
**Priority:** MUST

A disposable Linux sandbox or container SHALL be available for manual active-binary verification. The sandbox SHALL use a disposable HOME/XDG/PATH tree, seed only the published v0.9.0 binary, start only a harness-owned child process, and verify that the real user configuration and binary locations remain unchanged.

**Scenarios:**

**Scenario TST-04-S1: Sandbox does not affect real user state**
```
Given  the manual sandbox verification is running
When   the verification completes
Then   the real user's OpenCode configuration files are unchanged
  And  the real user's binary locations are unchanged
  And  only the harness-owned child PID was cleaned up
```

---

## 3. Open Questions

| ID | Question | Impact | Resolution Target |
|---|---|---|---|
| OQ-01 | What is the compatible result vocabulary for "already present; installer not run" (skipped, informational, or additive package outcome)? | Affects action-status semantics and downstream consumption | Design |
| OQ-02 | What is the authoritative supported evidence set and precedence for effective OpenCode command/configuration resolution, including project/user and JSON/JSONC? | Affects evidence detection completeness | Design |
| OQ-03 | What are the exact sanitization, redaction, line, and character bounds for one actionable cause? | Affects dashboard display contract | Design |
| OQ-04 | Is the bounded cause rendered inline or through an equally visible bounded details treatment? | Affects dashboard UX | Design |

### Resolved Open Questions (Final Reconciliation)

All four open questions are resolved by the final Design decisions. The resolutions below define the behavioral contract; implementation details remain in `design.md`.

| ID | Resolution | Design Decision |
|---|---|---|
| OQ-01 | **Outcome vocabulary:** Add an adapter-local outcome union `already-present | executed | failed | skipped` while preserving the existing public Core action status union (`executed | informational | skipped | failed`). The `already-present` outcome maps to public action status `skipped` with `packageOutcome: "already-present"` and is dependency-satisfying. An ordinary unsatisfied skip maps to public action status `skipped` with no `packageOutcome` and does not satisfy dependencies. The two are distinguishable by outcome type. | Decision 2 |
| OQ-02 | **Authoritative evidence precedence:** One shared adapter-owned local config-source/parser authority enumerates supported config layers (global JSON/JSONC, `OPENCODE_CONFIG`, project traversal, `.opencode`, `OPENCODE_CONFIG_DIR`, `OPENCODE_CONFIG_CONTENT`) with exact precedence. A broken higher-precedence config entry blocks lower config entries but cannot erase independent positive PATH or canonical executable evidence. Declaration-only configuration that does not resolve to a usable executable is insufficient for installed classification. | Decision 1 |
| OQ-03 | **Diagnostic bounds:** Apply the exact capture, control-character removal, secret/path redaction, meaningful-line selection, and deterministic truncation algorithm defined in the Design. Bounded `cause`: at most 2 selected lines joined by ` · `, at most 320 UTF-8 bytes. Enumerable `diagnostic.lines`: at most 6 lines, at most 240 Unicode scalars per line, at most 1,024 UTF-8 bytes aggregate. TUI `diagnostics`: at most 8 strings, at most 240 scalars each, at most 1,280 UTF-8 bytes aggregate. Raw captured diagnostics remain only in adapter-internal non-enumerable fields and never cross into dashboard state or logs. If all external text is removed by sanitation, the fallback is `<Stage> failed (exit N).` (or `<Stage> failed.` when no exit code). | Decision 4 |
| OQ-04 | **Dashboard treatment:** Render one inline, indented, bounded cause under the identified failed action in existing progress and completion views. No details panel, modal, expandable panel, new key binding, or new screen state is added. | Decision 5 |

**Status:** All open questions are resolved. No open questions remain.

---

## 4. Blockers

| ID | Blocker | Resolution |
|---|---|---|
| BLK-01 | Registry serialization is blocked on coordinator-owned creation/read of the new change's authoritative `state.yaml` and `events.yaml` pair | Coordinator action after this phase |
| BLK-02 | A true active-session forced reinstall remains dependent on a published upstream release containing the transactional activation behavior; current latest release v0.9.0 remains affected | Upstream dependency; excluded from this change scope |

---

## 5. Requirement and Scenario Counts

| Category | Count |
|---|---|
| Requirement groups | 14 |
| Total requirements | 34 |
| MUST requirements | 31 |
| SHOULD requirements | 3 |
| MAY requirements | 0 |
| Total scenarios | 51 |

> **Reconciliation note (final):** The initial Spec return/summary reported 22 requirements and 45 scenarios. The final Design audit independently parsed all `#### REQ-*` and `**Scenario *` headings, confirming 34 requirements and 51 scenarios. This correction aligns the summary metadata with the authoritative heading counts without modifying any normative content.

---

## 6. Behavioral Highlights

1. **Install-if-missing, not upgrade:** Runner Setup is idempotent capability assurance. Already-present capabilities are explicitly skipped; the installer is not invoked.
2. **Strong evidence required:** Installed evidence must be package-relevant, resolve to a usable executable, and be adapter-authoritative. Existence alone is insufficient.
3. **Immediate pre-install recheck:** The effect-boundary recheck catches stale plans and prevents unnecessary install attempts.
4. **Truthful failure preserved:** Genuine installer failures remain failed with original structured diagnostics. No hidden success behind stale targets.
5. **Bounded sanitized dashboard cause:** The dashboard displays an actionable cause with secrets, credentials, absolute paths, ANSI sequences, and unbounded output excluded/redacted.
6. **Package-agnostic behavior:** The same evidence, recheck, outcome, and failure rules apply across all supported OpenCode packages. No hardcoded error-string matching.
7. **No process management:** Runner Setup never kills, enumerates, or infers ownership from process names or command lines. Binary replacement is upstream-owned.
8. **Deterministic test seams:** All automated tests use injected paths, temporary HOME/XDG, no network, and no process management. Manual sandbox verification is separately identified.

---

## 7. Coverage Summary

| Capability | Requirements | Scenarios | Status |
|---|---|---|---|
| Installed Evidence Detection (EVD) | REQ-EVD-01 through REQ-EVD-04 | 8 | Covered |
| Pre-Install Recheck (RCK) | REQ-RCK-01, REQ-RCK-02 | 3 | Covered |
| Already-Present Outcome (APO) | REQ-APO-01, REQ-APO-02 | 3 | Covered |
| Failed Installer Handling (FAL) | REQ-FAL-01 through REQ-FAL-03 | 4 | Covered |
| Dashboard Diagnostics (DIA) | REQ-DIA-01 through REQ-DIA-03 | 6 | Covered |
| Package-Agnostic Behavior (PAG) | REQ-PAG-01, REQ-PAG-02 | 5 | Covered |
| Safety Constraints (SAF) | REQ-SAF-01 through REQ-SAF-05 | 6 | Covered |
| Concurrent/TOCTOU (CTO) | REQ-CTO-01, REQ-CTO-02 | 2 | Covered |
| Missing/Invalid Executable (MIS) | REQ-MIS-01, REQ-MIS-02 | 3 | Covered |
| PATH/Config Variants (PCV) | REQ-PCV-01, REQ-PCV-02 | 2 | Covered |
| Cancellation (CAN) | REQ-CAN-01 | 1 | Covered |
| Multi-Package Isolation (MPI) | REQ-MPI-01 | 1 | Covered |
| Rollback (ROL) | REQ-ROL-01 | 2 | Covered |
| Test Infrastructure (TST) | REQ-TST-01 through REQ-TST-04 | 5 | Covered |
| **Total** | **34** | **51** | **Covered** |

---

## 8. Registry Coordination

- **Ordered RegistryIntentV1 values:** `[]`
- **Reason:** This specialist is prohibited from creating or updating `state.yaml` / `events.yaml`. A valid digest-bound `RegistryIntentV1` cannot be constructed without the authoritative base pair. The coordinator must validate this artifact digest and construct the Spec completion intent atomically.
- **Coordinator action:** Update `state.yaml` phase to `spec`, status to `completed`, add `artifacts.spec: spec.md`, append provenance entry, and append `spec.completed` event to `events.yaml`.
