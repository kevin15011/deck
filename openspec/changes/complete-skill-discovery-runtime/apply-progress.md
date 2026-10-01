# Apply Progress: Complete Skill Discovery Runtime

## Current status

Implementation, canonical generation, isolated installed acceptance, and independent review are complete. Independent Quality returned **GO** with no remaining actionable findings.

## Implemented

- Logical YAML collection-depth parsing accepts ordinary nested metadata while retaining merge, tag, alias, duplicate-key, malformed-input, size, traversal, and depth protections.
- Isolated registry refresh coverage preserves prior registry and `.gitignore` bytes on failure.
- Additive runner-neutral task-scoped search, exact observation selection, private native preparation evidence, bounded matching, and load outcome contracts.
- SDD Runtime lifecycle host with session-generation isolation, immediate revalidation, one-use call correlation, retirement guards, and bounded state.
- The SDD Runtime package root exports the task discovery host used by the OpenCode plugin; the session factory remains internal. Both exact public-export oracles cover this additive boundary.
- Canonical OpenCode source plugin integration:
  - real default construction from trusted native `PluginInput`;
  - bounded `deck_skill_discovery` search/prepare/status tool;
  - authoritative bounded native inventory transport;
  - ordinary `skill({ name })` permission preservation;
  - before-hook readiness rendezvous and after/error terminal correlation using `metadata.dir`;
  - independent parent/child sessions and no candidate injection into delegation prompts.
- Production-ready registry preference:
  - canonical registry status is checked against a fresh current OpenCode discovery snapshot on every search;
  - ready registries supply validated records;
  - missing, stale, invalid, and indeterminate registries reuse the same bounded evaluation for direct fallback;
  - later searches obtain a fresh native inventory while each evaluation retains one coherent snapshot.
- OpenCode 1.18.31 compatibility:
  - public native-inventory methods are preferred and a bounded `_client.get({ url: "/skill" })` compatibility fallback is used only when they are absent;
  - SDK inventory envelopes require a non-array response with `ok: true`, a 2xx integer status, and no error;
  - skill content is never read during inventory discovery;
  - filesystem candidates reconcile to native exposure only by exact expected name and exact canonical `directory/SKILL.md` location.

## TDD and verification evidence

- Parser/runtime focused and affected suites: green throughout the final candidate.
- Final focused OpenCode skill suite: 23 passing tests.
- Full OpenCode reachability suite: 87 passing tests.
- Affected OpenCode adapter suites: 115 passing tests.
- Core discovery/runtime/registry plus SDD lifecycle suites: 58 passing tests.
- Canonical generator suite: 3 passing tests.
- Release-gate verification with pinned Bun 1.3.12 on `PATH` and a physical `TMPDIR`: full suite 4,959 passed, 2 skipped, 0 failed; release descriptor and helper 64 passed; deterministic memory benchmark 13/13; compiled runtime verification, host dry-run build, and typecheck passed.
- Independent retention probe: 100 session rotations plus 80 invalidations remained bounded at 64 active generations, 64 bindings, and 64 candidate-name entries, with zero pending calls/preparations.
- Independent freshness probes confirmed one native inventory request per search/evaluation, fresh later searches, and isolated concurrent parent/child snapshots.
- Independent SDK-envelope probes: 9 passing cases with zero content-property reads.
- Independent final review verdict: **GO**.
- `bunx --no-install tsc --noEmit`: passed.
- `git diff --check`: passed.
- Source CLI probe: `skill-registry discover --runner opencode` returned `outcome: complete`, `next_action: none`, and zero `unsafe_frontmatter` diagnostics.
- OpenSpec validation: zero errors and zero warnings.
- Canonical generation ran with verified Bun 1.3.12. All three generated assets matched independent in-memory builds, produced exactly one output each, and emitted zero diagnostics. The final OpenCode source digest is `1f0db38c1dbb497ef87d823af8ec3f8b24fe9bcaf52a7dad29919fb44f219097`.
- Isolated installed OpenCode 1.18.31 acceptance used temporary `HOME`, XDG, and project roots plus a deterministic provider bound only to `127.0.0.1`:
  - installed plugin bytes matched the canonical generated asset;
  - Lead independently searched, selected, prepared, natively loaded, and observed `loaded` for a project skill;
  - a delegated specialist independently did the same for a user skill in its own session;
  - no model-visible local path, external provider request, stderr output, or acceptance error was observed.

## Preserved boundaries

- Registry V1 and existing CLI discover response semantics remain compatible.
- At acceptance time, no live registry refresh, real user-home mutation, commit, push, release, or generated-file hand edit had occurred. Canary and OpenCode acceptance used isolated temporary roots.
- The unrelated `.serena/project.yml` modification was preserved untouched.
- CLI-side OpenCode loading remains honestly unsupported outside the native plugin execution boundary.
- Pi and Codex native-loading parity is not claimed; their generated-asset parity is not runtime acceptance.

## Result

REQ-001 through REQ-010 are satisfied for the approved OpenCode-first scope. The change is complete and review-approved.

## Residual risks

- The low-level OpenCode inventory compatibility fallback is version-sensitive; live acceptance establishes OpenCode 1.18.31.
- Immediate revalidation narrows but cannot eliminate the final filesystem check-to-native-load replacement window.
- This review alone does not authorize release publication; the separately requested release preparation and tag have their own gates.
