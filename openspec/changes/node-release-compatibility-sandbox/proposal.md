# Current-source release compatibility sandbox

## Intent
Provide a development command that builds the current working source in a disposable environment, provisions Node 20 and 24 locally to that environment, and catches binary compatibility failures before publication on Linux and macOS.

## Scope
- Isolated native-host build and smoke harness, with an existing-archive verification mode for CI.
- Native Linux/macOS x64/arm64 execution with Node 20 and 24.
- Publication depends on verification of the exact candidate archives; PR/manual runs never publish.
- Deterministic harness/workflow tests and contributor/release instructions.

## Non-goals and risks
No personal Deck replacement, global Node installation, runner installation, remote provider calls, or release publication during development. HOME/PATH isolation is not an OS security boundary. Offline checks cannot certify all third-party npm packages. Native hosted ARM runners may depend on repository availability. Existing provider-runtime gates remain intact.

## Rollback
Revert the new sandbox command and compatibility workflow wiring together in a normal follow-up change. Do not silently bypass a failing release gate or modify historical OpenSpec changes.
