# Tasks: Support macOS SSH Alias Project Identity

## 1. Red tests

- [x] 1.1 Add unit coverage for a Darwin account query and exact `work` alias deriving `sm_project_v1_comodin_software_espritec_theme` without a trusted-home test bypass.
- [x] 1.2 Add adversarial tests for environment isolation, executable safety, timeout/output bounds, malformed and duplicate records/fields, UID mismatch, relative homes, and unsupported platforms.
- [x] 1.3 Add focused managed-launch/runtime coverage proving successful identity enables scoped runtime setup and failed identity causes no provider effect.

## 2. Implementation

- [x] 2.1 Add a narrowly injectable Darwin account lookup to the canonical project identity module.
- [x] 2.2 Validate the fixed executable, effective UID, child process constraints, structural account response, and canonical home directory.
- [x] 2.3 Reuse the existing protected SSH descriptor/parser and preserve Linux and literal-remote behavior.

## 3. Compiled proof

- [x] 3.1 Extend the compiled Supermemory verification path to exercise Darwin alias identity without modifying developer Git or SSH configuration.
- [x] 3.2 Verify standalone-binary behavior under hostile ambient environment values.

## 4. Verification

- [x] 4.1 Run focused canonical identity, managed launch, runtime host, and compiled verification tests.
- [x] 4.2 Run TypeScript and OpenSpec validation.
- [x] 4.3 Perform independent security-boundary review and resolve confirmed findings.
