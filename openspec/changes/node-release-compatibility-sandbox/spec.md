# Requirements

## Local development
The command MUST use current source, including tracked modifications and eligible untracked source, rather than only committed HEAD. It MUST generate/build within a disposable copy and MUST NOT overwrite the checkout, installed Deck, shell profiles, or global Node. Node 20 and 24 MUST be provisioned inside the disposable root, with downloaded archives checked against official SHA-256 metadata. Provisioning requires network; deterministic tests and subsequent smoke execution MUST NOT require external services.

Given a supported native host and build prerequisites, when the developer runs the sandbox command, then the same candidate MUST be checked under both actual Node majors and produce explicit per-case evidence.

## Artifact checks
Given an existing candidate archive, when verification runs, then it MUST execute that archive outside the source workspace, validate native target and expected build identity, and record its digest. It MUST distinguish standalone startup without Node from selected Node-dependent integration checks. Crashes, wrong versions, missing checks, and timeouts MUST fail closed.

## Publication
Given Linux/macOS x64/arm64 candidate archives, when a release workflow runs, then all eight target/Node cells MUST pass before either stable or draft publication. Build success on a foreign architecture MUST NOT count as execution evidence. PR/manual verification MUST NOT publish. The archives published MUST be those verified, without rebuilding them afterward.

## Safety and coverage
Smoke commands MUST use disposable HOME/XDG/cache paths, bounded subprocess execution, and no inherited credentials. Cleanup MUST be limited to owned disposable paths. Reports MUST state that offline fixture coverage does not certify arbitrary upstream npm installations or all OS versions.
