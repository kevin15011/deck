# Cross workspace commit and release preparation

Status: verified and committed for release preparation, 2026-10-15. Lead owns this record.

## Authorized scope

The user requested red Remove session/project actions, commits for all accumulated work, and confirmation that distributed binaries do not depend on the Deck source checkout. Product version remains 0.10.0; upcoming changes are recorded under Unreleased. Version selection, main integration, tags, pushing and publication are outside this increment.

Runtime, UI and behavioral tests form one commit because queued prompts, Lead generations and session lifecycle controls must work together. Documentation, OpenSpec evidence and documentation-governance checks form a second commit. No history rewriting or generated-file hand edits.

## Cosmetic verification

The shared removal menu uses a theme-aware danger token, including hover. Eight real-host open-menu checks cover project/session menus at desktop dark/light and mobile 320 dark/390 light. Minimum measured foreground contrast is 6.03:1. Root inspected desktop and mobile captures. Evidence: `/tmp/deck-menu-danger-browser.log` and `/tmp/deck-menu-danger-*.png`.

## Repository independence

An isolated copy of the compiled Darwin arm64 executable ran from a temporary directory with a separate HOME and macOS sandbox denying all reads of the Deck checkout, inherited by children. A positive control failed to read checkout package.json with Operation not permitted. The compiled web/session smoke passed 67 checks, including embedded assets/schemas, daemon restart, queue/images, native resume and project/session lifecycle. The compiled Supermemory internal smoke passed health/profile/search/capture, safe authentication failure, credential-free MCP and loopback capture against a local mock provider under the same restriction. Dynamic-library inspection found only macOS system libraries.

Source audit confirms build-time generators produce embedded assets/managed skill content, and production helpers invoke the active executable. Development source fallbacks do not establish a production dependency. External runner CLIs, installed native memory plugins, Node where those plugins require it, and configured MCP executables/credentials remain legitimate prerequisites. Users still need access to their own project files; the excluded dependency is Deck's source repository.

Evidence is Darwin arm64 execution of the covered paths with fake runners/providers, not exhaustive execution of every command/platform. Preserve this distinction from four-target compilation. Initial logs: `/tmp/deck-portability-sandbox-smoke.log`, `/tmp/deck-portability-sandbox-memory.log`.

The final rebuilt artifact passed the same checkout-denied session/web67 and compiled memory checks, including a repeated positive denial control. SHA-256 of both installed executable and isolated copy: `978127fa90ed5075deb18640bb6f22a46ec9b28b45d97cb78804ce5ffb0c4b90`. Final logs: `/tmp/deck-release-prep-repo-denied-smoke.log` and `/tmp/deck-release-prep-repo-denied-memory.log`. The temporary memory fixture uses a fresh state directory per run; no user configuration or real provider was involved.

## Final gates and commits

Full repository suite: 6,693 passed, three optional tests skipped, zero failures, 44,952 assertions across 489 files (`/tmp/deck-release-prep-tests.log`). Skipped opt-ins are previous-version installer recovery, the generic real canary-install fixture and actual pinned RTK integration; this increment separately exercised real isolated canary compilation/installation. Canonical memory benchmark, compiled Supermemory verification, host build dry-run and TypeScript all pass (`/tmp/deck-release-prep-{memory-bench,supermemory,build,tsc}.log`). Release-descriptor and preparation-helper tests are included in the full suite. Diff and documentation/registry checks pass.

Runtime/UI/tests commit: `6aabf0bf553b9deda6b8c1f63dd7bbb8020a9f7b` (`feat(cross): complete persistent multi-runner workspace`). Documentation, changelog, OpenSpec and governance evidence are committed together separately. Independent bounded precommit review approved scope, credential-pattern scan, canonical generated schema provenance and atomic commit grouping; prior functional reviews remain authoritative. No version bump, tag, push or publication occurred.

The final canary is active after guarded idle restart PID28901→33615 at 2026-10-15T18:46:42.093Z. Status confirms web http://127.0.0.1:7421 and no running work/pending approvals. Reload the web for red removal actions. Next release work is choosing the version and integrating the reviewed source onto main through the normal release process.
