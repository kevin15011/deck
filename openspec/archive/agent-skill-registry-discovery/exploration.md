# Exploration: Agent Skill Registry Discovery

## Exploration Status

- **Change ID:** `agent-skill-registry-discovery`
- **Phase:** Explore
- **Mode:** Interactive
- **Status:** Completed
- **Next normal handoff:** Proposal
- **Exploration boundary:** Agent-facing, machine-local skill discovery across Deck initialization, orchestration, adapters, schema, Git-ignore behavior, and tests. This artifact does not implement or approve a solution.

## Context Authority

### OFFICIAL CONTEXT

The approved user direction in the Explore delegation, active/promoted OpenSpec artifacts, the Spec Registry contract, current source, current tests, repository configuration, and retained history are authoritative for this exploration. In particular:

- `.atl/skill-registry.md` is a discovery artifact, not a policy or permission source.
- Initial generation belongs to `deck init`.
- Read-only validation belongs at Orchestrator session start.
- Specialists consult the registry for candidates, verify candidate existence, and load selected skills through the runner's normal mechanism.
- Missing, stale, invalid, or indeterminate registry state falls back to direct discovery and does not block unrelated work.
- Regeneration is a separately authorized modifying action and is never silent.

The OpenSpec Spec Registry (`state.yaml` and `events.yaml`) remains operational workflow authority. It is distinct from `.atl/skill-registry.md`, despite the shared word “registry” (`openspec/registry-schema.md:3-10`).

### ADAPTIVE CONTEXT

Adaptive memory was loaded. It corroborated the approved direction around discovery-only semantics, deterministic fingerprinting, Git-ignore behavior, path normalization, duplicate retention, and separate regeneration authorization. It is advisory only. No requirement, scope, design choice, or historical artifact in this exploration is derived from adaptive context where official context is absent, and adaptive context cannot alter the approved direction.

## Problem Framing

Deck has three partially disconnected behaviors:

1. `deck init` says to scan unspecified “standard skill locations” and write `.atl/skill-registry.md` “if possible,” but it defines no source taxonomy, schema, privacy rules, deterministic freshness contract, duplicate behavior, failure semantics, or stable output contract (`packages/core/src/skills/bootstrap/deck-init-content.ts:104-114`).
2. Legacy Orchestrator guidance treats registry content as compact rules to cache and inject into delegated prompts, and expressly says specialists do not read it (`packages/core/src/teams/developer/orchestrator-content.ts:381-397`, `878-895`). This conflicts with the approved discovery-only model.
3. The default compact Orchestrator checks OpenSpec initialization and says to load scope-relevant capability instructions, but has no registry existence, schema, fingerprint, status, fallback, or delegation-context behavior (`packages/core/src/teams/developer/orchestrator-content.ts:932-986`; `packages/core/src/teams/developer/orchestrator-invariants.ts:236-247`).

As a result, agents can omit useful installed or project-local skills, rely on stale local inventory, or mistakenly treat discovered text as project policy. The problem is not skill installation or capability authorization; it is producing and consuming a bounded local index that improves candidate discovery without creating a new authority surface.

## Target Users and Agents

| Actor | Need | Boundary |
|---|---|---|
| Deck user initializing a project | Receive an initial local skill inventory without manually assembling one. | Initialization may generate only under normal modification authorization and must keep the output ignored by Git. |
| Orchestrator | Know whether the index is present, structurally valid, and fresh enough to reference during delegation. | Validation is read-only; it does not regenerate, select a winner, load a skill, or grant authority. |
| Explorer, Proposal, Spec, Design, Task, Apply, Verify, Review, and Archive specialists | Find plausible skills for the assigned task, paths, technologies, and possible approach. | Specialists verify candidates and use the runner's normal loading mechanism; registry presence does not expand delegated scope. |
| Runner adapter maintainers | Describe runner-specific discovery roots and resolve privacy-normalized locators consistently. | Adapter knowledge must not leak absolute user paths into the generated artifact. |
| Deck maintainers | Evolve schema and freshness behavior with deterministic tests. | Deck's bundled standalone catalog remains a separate distribution concern. |

## Current-State Evidence

### Initialization is prompt-directed and underspecified

- The retained init requirement says `deck-init` should build `.atl/skill-registry.md` by scanning standard skill locations, but discoverability is optional on some setups (`openspec/changes/archive/2026-05-25-deck-init-onboard-system/spec.md:49-55`).
- Current `deck-init` instructions repeat the intent but only name user-level agent-specific directories and project-level `.skills/` or runner-vendor directories. They do not define an executable generator, schema, fingerprint, or validation behavior (`packages/core/src/skills/bootstrap/deck-init-content.ts:104-114`).
- `deck-init` returns immediately when `openspec/config.yaml` already has `initialized: true`, before the skill-registry step (`packages/core/src/skills/bootstrap/deck-init-content.ts:24-37`). Existing initialized projects therefore have no defined migration path through the current instructions.
- This repository is initialized (`openspec/config.yaml:1-10`) but has no `.atl/skill-registry.md` in the working tree. The absence is consistent with earlier retained exploration (`openspec/archive/streamline-project-documentation/exploration.md:55`).

### Compact and legacy Orchestrator behavior diverge

- Legacy content says to cache “compact rules,” match them by path/task context, and inject them as `Project Standards`; specialists are prohibited from reading the registry (`packages/core/src/teams/developer/orchestrator-content.ts:381-397`, `878-895`). This creates unintended rule-injection, trust, and precedence semantics.
- Compact content validates initialization and requires the matching role skill plus scope-relevant capability instructions, but it does not mention `.atl/skill-registry.md`, schema validation, freshness, or fallback (`packages/core/src/teams/developer/orchestrator-content.ts:942-945`, `983-985`, `1046-1054`).
- Compact invariant `PERMANENT-SKILLS` requires role and relevant capability skill loading but does not define how candidates are discovered (`packages/core/src/teams/developer/orchestrator-invariants.ts:236-247`).

### Installed roots and ownership differ by adapter

- OpenCode plans Developer Team and standalone skills under a user configuration root, defaulting to `~/.config/opencode/skills` (`packages/adapter-opencode/src/developer-team-install.ts:527-554`, `596-611`).
- Pi plans skills under the project root at `.pi/skills`, including separate bootstrap-skill handling (`packages/adapter-pi/src/developer-team-install.ts:528-535`, `580-614`).
- Standalone package materialization preserves `SKILL.md` plus auxiliary package files, but OpenCode and Pi calculate different relative and absolute targets (`packages/adapter-opencode/src/developer-team-install.ts:214-234`; `packages/adapter-pi/src/developer-team-install.ts:162-183`).
- This repository also has project-local skills under `.agents/skills/`, including one skill with structured frontmatter and one legacy Markdown-only skill (`.agents/skills/openspec-retrospective-audit/SKILL.md:1-10`; `.agents/skills/deck-release-publish/SKILL.md:1-10`). A registry parser must tolerate supported legacy metadata without pretending missing fields exist.

### Deck's standalone catalog is not the project registry

- `STANDALONE_SKILLS` is a fixed Deck distribution catalog of `{ skillId, sourcePath }` records (`packages/core/src/skills/external/index.ts:44-79`).
- `getStandaloneSkill` resolves only catalog members from generated binary bundles or Deck's development source tree; it is used by installation/launch flows, not as a machine-local inventory of every available skill (`packages/core/src/skills/external/index.ts:120-205`).
- The project registry may observe Deck-materialized skills in normal runner roots, but it must not redefine, replace, or become the authority for `STANDALONE_SKILLS`.

### Git behavior is broader than the preferred generated-file rule

- This repository currently ignores the entire `.atl/` directory (`.gitignore:1-4`). That broader existing rule already covers `/.atl/skill-registry.md`.
- The approved portable recommendation is the narrower root-anchored `/.atl/skill-registry.md` unless an existing broader rule already covers the file. Generation must verify coverage rather than add duplicate ignore lines.

### Tests do not cover the intended behavior

- Bootstrap tests validate only the two bootstrap skill records, safe relative paths, and YAML frontmatter. They do not execute registry discovery or generation (`packages/core/src/skills/bootstrap/index.test.ts:11-53`).
- Current adapter tests assert bootstrap-skill installation membership, not project-registry generation or consumption (`packages/adapter-opencode/src/developer-team-install.test.ts:546`; `packages/adapter-pi/src/developer-team-install.test.ts:129-131`).
- Legacy Orchestrator tests only assert that the phrase `Skill Resolution` exists; they do not enforce discovery-only semantics, delegation context, freshness, or fallback (`packages/core/src/teams/developer/orchestrator-content.test.ts:337-339`; `packages/adapter-pi/src/orchestrator-prompt.test.ts:143-145`).
- No current product test references `.atl/skill-registry.md` or validates generation, schema, privacy normalization, duplicate retention, freshness, consumption, or failure behavior.

## Confirmed Constraints

1. The registry is primarily agent-facing and optimized for compact agent search.
2. It is discovery-only. It grants no permission, trust, precedence, policy, execution authority, or modification authority.
3. `deck init` generates the initial file.
4. The file is machine-local and Git-ignored because skill availability can differ by user, machine, and runner.
5. The Orchestrator validates existence, schema, and freshness read-only at session start.
6. Every delegation receives compact Skill Discovery Context containing registry path, current status, and an instruction to consult it.
7. Specialists consult before substantial work, identify candidates relevant to the project, task, target paths, technologies, and possible solution, verify each selected candidate exists, and load it through the runner's normal skill mechanism.
8. Missing, stale, invalid, or indeterminate registry state falls back to direct discovery and does not block unrelated work.
9. Regeneration is never silent and always requires applicable modification authorization.
10. Freshness should use deterministic fingerprint comparison. `generated_at` is informational and is not a hard TTL.
11. Duplicate skill identifiers/names are recorded as separate candidates without declaring a winner or precedence.
12. Absolute and identifying local paths are excluded or privacy-normalized.
13. The generated format uses structured frontmatter plus compact searchable Markdown.
14. Git-ignore behavior prefers `/.atl/skill-registry.md`, unless an existing broader rule already covers it.
15. Historical OpenSpec artifacts are preserved. This change adds new lifecycle artifacts rather than rewriting retained history.

## Source Taxonomy

The schema should classify observed candidates by source category rather than flattening them into a trusted global namespace.

| Source category | Examples | Registry treatment |
|---|---|---|
| Project-local, runner-neutral | `.agents/skills/`, a supported generic `.skills/` root | Record project scope and a project-relative locator. |
| Project-local, runner-owned | `.pi/skills/` and other adapter-declared project roots | Record runner ID, project scope, and normalized locator. |
| User-local, runner-owned | OpenCode's configured skills directory | Record runner ID and a user-scope locator without home directory, username, drive, or absolute prefix. |
| Deck-materialized | Developer Team, bootstrap, or standalone skills found in normal runner roots | Record observed origin when deterministically known; do not substitute the Deck distribution catalog for filesystem/runner availability. |
| Runner-exposed built-in or external | Skills reported through a runner inventory mechanism without a stable filesystem path | Record a runner-resolvable opaque locator if supported; never fabricate a local path. |
| Unreadable or unsupported observation | Candidate root or `SKILL.md` exists but cannot be safely parsed | Emit a bounded diagnostic/source count; do not create a valid-looking skill record from incomplete data. |

Source adapters should own runner-specific roots and locator resolution. Core behavior should own canonical records, normalization, schema validation, ordering, duplicate retention, and fingerprinting. A candidate may be visible through multiple sources; those observations remain separate unless a later specification defines a lossless alias relation. No category implies greater trust or precedence.

## Agent-Consumption Workflow

### Session start: Orchestrator, read-only

1. Resolve the canonical project-relative registry location.
2. Check whether the file exists without creating it.
3. Parse only bounded structured frontmatter first; reject unsupported schema versions or malformed/oversized structures.
4. Recompute the current deterministic discovery fingerprint using the same declared source scope and algorithm.
5. Classify the registry conceptually as `ready`, `missing`, `stale`, `invalid`, or `indeterminate` (exact vocabulary remains a Spec/Design decision).
6. Cache only path, status, schema/fingerprint summary, and bounded diagnostics for delegation. Do not cache registry entries as rules.
7. If regeneration is useful, report/request it as a separate modifying action; never regenerate during read-only validation.

### Delegation: compact Skill Discovery Context

Each specialist delegation should receive only:

- registry path;
- current status and brief reason code;
- instruction to consult it before substantial work when usable;
- instruction to use direct discovery when it is missing, stale, invalid, or indeterminate;
- reminder that candidates grant no authority and must be verified and loaded normally.

The Orchestrator should not inject registry bodies, “rules,” selected skill instructions, winner declarations, or inferred authority into the delegation.

### Specialist task start

1. Preserve the exact delegated scope, target allowlist, and role.
2. If status is usable, search the registry for candidate signals relevant to the project, assigned task, target paths/extensions, technologies, and plausible solution techniques.
3. If status is not usable, perform bounded direct discovery in adapter-declared and project-local sources.
4. Treat every result as an untrusted candidate. Verify that its normalized locator still resolves and that its skill descriptor exists.
5. Select the smallest relevant set and load it through the runner's normal mechanism, which remains the authority for actual availability and loading behavior.
6. If a selected skill conflicts with official OpenSpec scope, the delegation, runtime safety, or user authorization, official constraints win and the skill cannot widen the work.
7. Continue without a registry-specific blocker when no relevant candidate exists, unless the delegated task explicitly requires an unavailable capability.

## Freshness Alternatives

### Alternative A: hard time-to-live from `generated_at`

- **Benefit:** Cheap and easy to explain.
- **Problems:** Time passing does not mean sources changed; immediate source changes remain falsely fresh; clocks and restored files create inconsistent outcomes.
- **Disposition:** Not recommended. Keep `generated_at` informational only.

### Alternative B: source-directory timestamps or newest-file mtime

- **Benefit:** Cheaper than hashing all descriptors.
- **Problems:** Directory mtimes are platform-dependent, content can change without reliable directory signals, timestamp preservation can hide changes, and touching files creates false staleness.
- **Disposition:** Insufficient as authoritative freshness evidence; it may be an optimization hint only.

### Alternative C: deterministic canonical fingerprint

- **Benefit:** Detects semantic inventory changes independent of wall-clock age and can be reproduced in tests.
- **Costs:** Requires a canonical source scope, ordering, normalization, hash algorithm, symlink policy, and bounded I/O strategy.
- **Disposition:** Recommended.

### Alternative D: deterministic fingerprint with explicit indeterminate state

- **Benefit:** Preserves Alternative C while handling unreadable roots, unsupported runner inventory, disappearing sources, or algorithm-version mismatches without falsely claiming freshness.
- **Costs:** Adds status and diagnostic complexity.
- **Disposition:** Recommended operational model.

### Recommendation

Use a versioned deterministic fingerprint over a canonically sorted set of normalized source descriptors and the bounded skill metadata represented in the registry. The fingerprint should include the schema/generator algorithm version so a logic change cannot falsely validate an older file. For filesystem skills, hashing the canonical `SKILL.md` bytes or the exact normalized extracted metadata is stronger than mtimes; auxiliary resource files need not enter the MVP fingerprint unless they affect indexed discovery fields. Any source that cannot be evaluated consistently should produce `indeterminate`, not `ready`.

Freshness comparison and file regeneration remain separate operations. Authorized regeneration should write a complete candidate file, validate it, and replace the prior file atomically; on failure, the last valid registry should remain intact and be reported as stale or indeterminate rather than replaced by a partial file.

## Schema Considerations

The exact schema is a later Spec/Design decision, but the format needs enough structure to support deterministic validation without turning Markdown into an authority channel.

### Structured frontmatter concepts

- schema identifier and schema version;
- generator identity and fingerprint algorithm/version;
- deterministic fingerprint value;
- informational `generated_at` timestamp;
- normalized project/runner source-scope declaration used to compute freshness;
- candidate/source counts and bounded diagnostics summary;
- privacy-normalization policy version;
- optional truncation/completeness marker, which must prevent a truncated registry from being classified as fully ready.

### Compact Markdown record concepts

- declared skill name/ID and description;
- source category, runner association, and scope (`project`, `user`, or runner-exposed);
- privacy-normalized locator such as `project:.agents/skills/example/SKILL.md` or an opaque runner locator;
- only declared or deterministically derived task, technology, and path signals;
- availability/parse diagnostic at generation time;
- stable per-observation identity so duplicate names remain separately addressable.

Records should be canonically ordered for stable diffs and fingerprints. Unknown metadata remains unknown; generation must not invent tags, supported technologies, permissions, or trust levels. Searchable excerpts should be bounded and should not copy full skill instructions into the registry.

### Duplicate behavior

- Preserve every valid observation.
- Grouping by shared declared name may aid search, but grouping must not collapse records.
- Do not mark “primary,” “winner,” “shadowed,” “trusted,” or “preferred.”
- A specialist verifies and chooses a candidate in its current delegated context; the runner's normal loader resolves actual loadability.

## Privacy, Security, Trust, and Performance Risks

| Risk | Impact | Exploration recommendation |
|---|---|---|
| Absolute path or username leakage | Local identities and filesystem layout become visible to agents, logs, or accidental copies. | Store scope tokens and normalized relative/opaque locators; reject absolute paths after generation and validation. |
| Prompt injection through skill text or registry Markdown | A discovered candidate could masquerade as policy or instruct the Orchestrator before normal loading controls. | Parse bounded metadata as data, never inject registry bodies/rules, and repeat the no-authority boundary in delegation context. |
| Duplicate-name spoofing | A local skill could appear to replace a known skill. | Preserve all observations without precedence and require source verification plus normal runner loading. |
| Symlink/path traversal | Scanning could escape approved roots or expose arbitrary files. | Canonicalize roots, define a no-escape symlink policy, validate locators, and never execute discovered files. |
| Oversized or malformed descriptors | Startup latency, memory pressure, or parser denial of service. | Bound file size, candidate count, diagnostic count, excerpt size, and parse depth; classify incomplete evaluation explicitly. |
| Expensive session-start hashing | Slow Orchestrator startup on machines with many skills. | Hash only represented descriptor inputs, use deterministic bounded scans, and consider a safe metadata cache only as an optimization that cannot create false freshness. |
| Partial or torn regeneration | A valid prior registry is replaced by invalid output. | Validate a temporary complete file and atomically replace only after success. |
| Registry mistaken for Spec Registry | Agents may treat local discovery data as lifecycle authority. | Use distinct schema names and explicit authority text; never store SDD state or permissions in the skill registry. |
| Stale registry trusted after source removal | Specialist attempts to load unavailable or changed skill. | Require existence/resolution verification immediately before loading. |
| Silent project modification | Read-only session startup unexpectedly changes local files or `.gitignore`. | Separate validation from authorized generation/regeneration and report the requested modification explicitly. |

## Git Behavior

1. The generated file is machine-local and must remain untracked.
2. Before writing, generation should determine whether Git ignore rules already cover the exact root file.
3. If no broader rule covers it, prefer adding the root-anchored `/.atl/skill-registry.md` rule under applicable modification authorization.
4. If a broader rule such as this repository's `.atl/` already covers it, do not add a redundant line.
5. If ignore coverage cannot be established or an ignore edit is not authorized, do not silently create a potentially trackable registry; report the condition and retain direct-discovery fallback.
6. Generation must not stage, commit, untrack, reset, restore, clean, or otherwise mutate Git state.
7. Validation should recognize a tracked registry as a privacy/trust warning requiring an explicit remediation decision; it should not silently remove or untrack it.

## Fallback and Failure Semantics

| Condition | Read-only status | Agent behavior | Modifying behavior |
|---|---|---|---|
| File absent | Missing | Direct discovery; unrelated work continues. | Offer/request separately authorized generation. |
| Unsupported schema or malformed frontmatter | Invalid | Ignore registry records and use direct discovery. | Preserve file until an authorized regeneration/remediation action. |
| Fingerprint differs | Stale | Use direct discovery; do not rely on stale entries without re-verification. | Offer/request separately authorized regeneration. |
| Sources cannot be fully evaluated | Indeterminate | Direct discovery in available sources; surface bounded warning. | Regenerate only when authorized and source evaluation can produce a valid result. |
| Valid schema and matching fingerprint | Ready | Consult for candidates, verify, then load normally. | No write. |
| Authorized generation fails | Previous status retained or missing | Direct discovery; unrelated work continues. | Preserve last valid file; report failure and no successful regeneration. |
| Duplicate names | Ready with separate records | Consider each candidate by locator/source; no winner. | Preserve duplicates. |
| Candidate disappears after validation | Candidate unavailable | Continue candidate search/direct discovery; block only if task explicitly requires it. | No implicit registry rewrite. |

Registry failure must not convert optional skill discovery into a general SDD hard stop. Existing runtime, authorization, Git-safety, capability, or explicit task requirements remain independently enforceable.

## Benefits

- Improves recall of relevant local and installed skills without expanding prompts with every skill body.
- Accommodates machine-, user-, project-, and runner-specific availability.
- Gives specialists task/path/technology-oriented discovery while preserving normal skill verification and loading.
- Makes stale inventory detectable without arbitrary time expiry.
- Removes conflicting legacy rule-injection semantics.
- Keeps Deck distribution metadata, project discovery, OpenSpec authority, and runner loading as separate responsibilities.
- Enables deterministic tests for generation, privacy, freshness, fallback, and adapter parity.

## MVP Boundary

The minimum viable change should include:

1. A versioned structured-frontmatter plus compact-Markdown registry format.
2. A deterministic, privacy-normalizing discovery model with explicit duplicate retention.
3. Adapter-declared source roots/resolvers for Deck's currently supported runner skill installations plus supported project-local roots.
4. Initial authorized generation from `deck init`, including ignore-coverage verification.
5. Read-only Orchestrator session-start validation with explicit status and deterministic fingerprint comparison.
6. Compact Skill Discovery Context on every specialist delegation.
7. Specialist guidance to consult, verify, select minimally, and load through normal runner mechanisms.
8. Direct-discovery fallback for missing, stale, invalid, and indeterminate states.
9. Separate authorized regeneration with complete-file validation and safe replacement.
10. Focused unit and integration tests for schema, normalization, duplicates, roots, freshness, fallback, generation, consumption, and Git-ignore coverage.

## Not Doing

- Defining skill permissions, trust scores, policy, or execution authority.
- Selecting a global winner or precedence rule for duplicate skill names.
- Automatically loading every discovered skill.
- Injecting registry content as project rules or `Project Standards`.
- Replacing `STANDALONE_SKILLS`, runner catalogs, or normal runner loading APIs.
- Installing, upgrading, deleting, or synchronizing skills.
- Syncing `.atl/skill-registry.md` across machines or committing it to Git.
- Silent startup regeneration, file watchers, background daemons, or TTL-only refresh.
- Building a human-facing skill marketplace, dashboard, recommendation ranking engine, or telemetry service.
- Inferring permissions, technologies, path applicability, or trust from arbitrary prose with an LLM during deterministic generation.
- Rewriting retained OpenSpec history.

## Assumptions

1. Current supported runner adapters can expose or encode the skill roots they materialize, even though those roots differ.
2. A runner's normal skill-loading mechanism can address candidates by the normalized/resolved identity supplied after verification.
3. Skill descriptors are Markdown files commonly named `SKILL.md`; supported legacy files may omit structured frontmatter.
4. Project-local and user-local discovery can be bounded sufficiently for session-start validation.
5. The user who authorizes `deck init` authorizes initial registry generation and any required narrowly scoped ignore entry, but later regeneration still requires a distinct applicable modifying authorization.
6. Direct discovery already exists at the runner/agent level as the fail-open path, although Deck does not currently normalize it into one core contract.
7. Registry usefulness does not require copying full skill instructions or auxiliary files into the index.

## Open Decisions for Proposal/Spec/Design

1. **Exact schema:** What are the schema ID, field names, supported-version policy, and canonical status/reason-code vocabulary?
2. **Source contract:** Which project-local and user-local roots are supported in MVP, and how do adapters declare roots or opaque runner inventories without core runner assumptions?
3. **Legacy descriptors:** What minimum fields make a Markdown-only skill discoverable, and how are missing descriptions represented without nondeterministic inference?
4. **Fingerprint inputs:** Hash canonical `SKILL.md` bytes, normalized extracted metadata, or both; how are opaque runner inventories represented?
5. **Symlinks and aliases:** Are in-root symlinks allowed, and how are the same physical descriptor observed from multiple roots represented?
6. **Bounds:** Maximum descriptor size, candidate count, diagnostic count, excerpt length, and startup I/O budget.
7. **Existing initialized projects:** What explicit authorized action creates the first registry when current `deck init` would return `already-initialized`?
8. **Regeneration UX:** Which Deck surface requests and records regeneration authorization without making refresh command-only or silent?
9. **Partial-source semantics:** Whether one unreadable optional root yields `indeterminate`, a warning-bearing usable state, or a source-scoped mixed status.
10. **Declared search signals:** Which structured metadata can represent task, technology, and path relevance, and what deterministic fallback is used when skills declare only name/description?
11. **Tracked-file detection:** Exact warning/remediation behavior if a registry is already tracked or ignore coverage changes after generation.
12. **Revalidation cadence:** Session start is required; whether long sessions need another read-only check before later delegations remains open.

These decisions are consequential but do not block Proposal. Proposal should preserve them rather than silently selecting implementation details.

## Likely File-Impact Areas

These are investigation targets, not an approved edit list.

| Area | Likely responsibility |
|---|---|
| `packages/core/src/skills/bootstrap/deck-init-content.ts` | Replace the underspecified generation prompt with the approved initialization and failure contract. |
| A focused core skill-discovery/schema module | Canonical records, parsing, privacy normalization, fingerprinting, duplicate retention, statuses, and rendering. Exact path remains a Design decision. |
| `packages/core/src/teams/developer/orchestrator-content.ts` | Remove legacy rule-injection semantics and add compact validation/delegation/specialist discovery guidance across active prompt profiles. |
| `packages/core/src/teams/developer/orchestrator-invariants.ts` and/or content composition | Persist the no-authority, read-only validation, delegation-context, and fallback invariants in compact surfaces. |
| `packages/sdd-runtime/src/orchestrator/` | Potential home for read-only session validation/status projection if runtime orchestration owns the effect boundary. |
| `packages/adapter-opencode/src/` | OpenCode configured skill-root discovery/resolution, generation integration, and focused tests. |
| `packages/adapter-pi/src/` | Pi project-root discovery/resolution, generation integration, and focused tests. |
| `packages/core/src/skills/external/index.ts` | Preserve explicit separation from `STANDALONE_SKILLS`; direct modification may be unnecessary unless origin metadata is required. |
| Git-ignore inspection/generation utility and fixtures | Detect broader existing coverage and add only the narrow root rule when authorized and needed. |
| Bootstrap, core, adapter, Orchestrator, and integration tests | Prove schema, deterministic output, privacy, duplicates, freshness, fallback, no silent writes, and delegation behavior. |
| Consumer project `.atl/skill-registry.md` | Generated machine-local output, not a committed repository source file. |

## Dependencies

- Retained `deck-init` discoverability intent: `openspec/changes/archive/2026-05-25-deck-init-onboard-system/spec.md:49-55`.
- Current initialization contract and early-exit behavior: `packages/core/src/skills/bootstrap/deck-init-content.ts:24-37`, `104-114`.
- OpenSpec initialization/config authority: `openspec/config.yaml`.
- Spec Registry authority and artifact/event rules: `openspec/registry-schema.md`.
- Compact Orchestrator and invariant composition: `packages/core/src/teams/developer/orchestrator-content.ts:932-1059`; `packages/core/src/teams/developer/orchestrator-invariants.ts:236-255`.
- Legacy skill-resolution behavior to supersede: `packages/core/src/teams/developer/orchestrator-content.ts:381-397`, `878-895`.
- OpenCode and Pi installation-root behavior: `packages/adapter-opencode/src/developer-team-install.ts`; `packages/adapter-pi/src/developer-team-install.ts`.
- Deck distribution catalog boundary: `packages/core/src/skills/external/index.ts:44-79`, `120-224`.
- Current Git-ignore coverage: `.gitignore:1-4`.
- Runner-native skill loading and the user/delegation modification-authorization gates remain external preconditions to this discovery artifact.

## Recommendation

Proceed to Proposal with a discovery-index architecture that separates five concerns:

1. adapters enumerate/resolve runner-specific sources;
2. core canonicalizes metadata, privacy-normalized locators, duplicates, schema, rendering, and deterministic fingerprints;
3. `deck init` performs only explicitly authorized initial generation and ignore setup;
4. the Orchestrator performs read-only session validation and passes compact discovery context;
5. specialists choose and verify candidates, then use normal runner loading.

The Proposal should make the no-authority boundary and direct-discovery fallback first-class acceptance constraints, explicitly retire legacy rule-injection semantics, and carry all open decisions above into Spec/Design rather than fixing them in prose prematurely.

## Confidence

- **Overall confidence:** High (0.90).
- **High-confidence facts:** Current init text is underspecified; initialized projects early-exit before the registry step; compact Orchestrator lacks registry validation; legacy content injects cached rules; adapter roots differ; `STANDALONE_SKILLS` is separate; existing tests do not cover the desired lifecycle; current broad `.atl/` ignore covers the proposed file.
- **Medium-confidence areas:** Exact runner inventory APIs, the best fingerprint input granularity, partial-source status semantics, and bounded performance thresholds require Spec/Design and focused prototypes/tests.

## Blockers

- **Product/technical blockers to Proposal:** None.
- **Registry persistence blocker for this phase return:** The new change directory had no authoritative `state.yaml`/`events.yaml` base pair, and this delegation expressly prohibited creating either file. A valid `RegistryIntentV1` requires both base document digests. The central coordinator must bootstrap/read the authoritative pair and construct or rebase the Explore completion intent; this specialist must not invent base digests or write shared registry YAML.
