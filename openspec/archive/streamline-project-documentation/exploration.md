# Exploration: Streamline project documentation

## Goal

Define a durable, low-maintenance documentation system for Deck's users, contributors, maintainers, and AI agents; identify what should be rewritten, consolidated, removed, archived, or generated without changing product documentation during Exploration.

## Executive Summary

Deck's documentation is small in file count but fragmented in authority and lifecycle. The root README is materially stale, current behavior is documented partly in dated audits and a reconstructed roadmap, a large methodology inventory duplicates fast-moving TypeScript prompt sources, and no repository-level agent/contributor guide identifies authoritative files or safe verification commands. The best path is not to add more topical documents. It is to establish five maintained entry points, preserve OpenSpec as historical/requirements evidence, and delete or archive snapshot documents after extracting any still-valid guidance.

The recommended maintained set is:

1. `README.md` — user-facing overview, supported installation/use paths, current capabilities, and links.
2. `CONTRIBUTING.md` — human contributor setup, commands, change workflow, verification, generated-file rules, and release contribution boundaries.
3. `AGENTS.md` — compact repository map and authority/safety rules for AI agents, linking rather than duplicating contributor and architecture material.
4. `docs/architecture.md` — stable conceptual architecture and source-of-truth map, not an exhaustive implementation inventory.
5. `docs/maintainers/releasing.md` — maintained release procedure and descriptor links, replacing contradictory release guidance.

Keep `CHANGELOG.md` only as release history and keep `docs/release-descriptor.md` only if it is corrected to be a concise public/maintainer contract that links to code and promoted/archived specification evidence. Treat `openspec/specs/`, active changes, and archived changes as official requirements/history, not as navigation documentation.

## Current State and Evidence

### Documentation inventory by role

| Surface | Intended audience | Current condition | Authority / generation status | Recommendation |
|---|---|---|---|---|
| `README.md` | Users and first-time contributors | Stale version (`v0.0.4`), incomplete command list, outdated package tree, Spanish-only, and release caveats that no longer reflect the current release system | Handwritten; should derive volatile facts from package metadata/code rather than copy them | Rewrite |
| `CHANGELOG.md` | Users and release maintainers | Only `[Unreleased]`; wrong repository link; describes a release system but has no version history | Handwritten release record | Keep, repair, and define release ownership |
| `docs/tool-references.md` | Maintainers/agents | Contains machine-specific absolute paths and a point-in-time “verified on this machine” section | Handwritten snapshot; canonical upstream links are useful, local paths are not durable | Merge durable tool links into contributor/agent docs; delete source file unless tooling needs a dedicated compatibility matrix |
| `docs/prompt-methodology-modules.md` | Maintainers/agents | 546-line manual inventory with source line numbers, duplicate section numbering, stale references, encoding corruption, and a link to absent `docs/developer-team.md` | Handwritten duplicate of TypeScript content and tests | Replace with a short architecture overview and generated inventory/check if detailed output remains necessary |
| `docs/skills-integration-roadmap.md` | Historical maintainers | Explicitly reconstructed after work loss; mixes completed work, obsolete recovery instructions, future ideas, and durable safety policy | Historical snapshot, but two tests read it directly | Archive/delete only after moving the tested invariant to a canonical source/test fixture and updating tests |
| `docs/deuda-tecnica.md` | Historical maintainers | Dated audit with stale version and test/typecheck counts; some recommendations may already be resolved | Historical snapshot | Archive outside maintained docs or delete after checking open issues/OpenSpec; do not keep live |
| `docs/openspec-retrospective-audit-2026-06-12.md` | SDD maintainers | Dated audit whose recommendations are already represented in later OpenSpec changes/specs | Historical snapshot | Move to OpenSpec/archive only if lineage needs it; otherwise delete and rely on Git/OpenSpec history |
| `docs/release-descriptor.md` | Maintainers/integrators | Valuable contract, but links incorrectly use `../changes/...`, point to an active path that has moved to archive, and manually repeats a large schema already enforced in TypeScript/Zod | Handwritten contract derived from code/spec | Keep but shorten and correct; code/schema/fixture are authoritative |
| `.agents/skills/deck-release-publish/SKILL.md` | Project-local AI agents | Contradicts package metadata and scripts: references nonexistent `bump`, `typecheck`, and `generate:build-info` scripts; says all workspace versions should match though private packages remain `0.0.0`; fixture shape is obsolete | Handwritten operational agent instruction | Rewrite or retire in favor of `docs/maintainers/releasing.md` plus a thin skill wrapper |
| `.agents/skills/openspec-retrospective-audit/SKILL.md` | Project-local AI agents | Purposeful local workflow, but Spanish-only and date-bound metadata; duplicates many general OpenSpec rules | Handwritten project-local instruction | Keep only if actively used; shorten to triggers, evidence policy, and links to canonical registry/schema docs |
| `openspec/registry-schema.md` | SDD agents/maintainers | Canonical operational schema reference, tied to validator behavior | Handwritten/promoted contract backed by code | Keep as official reference; avoid repeating it elsewhere |
| `openspec/specs/*/spec.md` | Implementers/agents | Promoted capability requirements | Official OpenSpec source | Keep; link from architecture/agent docs when relevant |
| `openspec/changes/**` and `openspec/archive/**` | Change lifecycle and historical evidence | Large by design; unsuitable as user navigation | Official generated/phase-authored artifacts | Preserve under lifecycle rules; do not fold into general docs |
| `packages/core/src/skills/external/**` | Installed agent skill payloads | Markdown is runtime product input, not repository documentation | Handwritten bundled inputs; `content.generated.ts` is generated output | Preserve; document generation boundary, never edit generated bundle manually |
| `packages/core/src/teams/developer/*-content.ts`, `content-registry.ts`, instruction bundles | Runtime Developer Team | Actual canonical prompts, contracts, composition, and agent roster | Product source backed by tests | Treat as authority; docs should explain concepts and link to source, not mirror complete content |

### Claims validated against code and metadata

- Root `package.json` reports version `0.2.1`, while `README.md` reports `v0.0.4` (`package.json:3`, `README.md:7`). Version text should be removed from README or generated during release.
- The CLI supports `deck`, `doctor`, `version`, `upgrade`/`update`, `rollback`, `openspec validate`, and `pi developer`; README omits `version`, `update`, `rollback`, and OpenSpec validation (`apps/cli/src/main.tsx:21-160`, `apps/cli/src/cli-args.ts:90-252`).
- The repository now includes `packages/sdd-runtime`, `adapter-engram`, and `adapter-supermemory`; README's architecture and tree omit them (`package.json:16-19`, package manifests, `README.md:98-158`).
- The Developer Team has 12 real content entries, composed centrally with invariants, context authority, language policy, and capability instructions (`packages/core/src/teams/developer/content-registry.ts:106-204,309-446,557-580`). A manually maintained module-by-module mirror is therefore high-churn duplication.
- `docs/prompt-methodology-modules.md:540` references missing `docs/developer-team.md`; historical OpenSpec artifacts also assume it exists. New documentation must not recreate two overlapping methodology inventories.
- `docs/skills-integration-roadmap.md` cannot be deleted immediately because `packages/core/src/teams/developer/git-safety.test.ts:143` and `no-op-skill-absence.test.ts:16` depend on it. This is accidental coupling between historical prose and product tests.
- Root scripts are only `deck`, `build`, `build:dry-run`, `deck:run`, and `test` (`package.json:6-12`). Project release skill instructions for `bun run typecheck`, `generate:build-info`, and bump scripts are not executable as written.
- Workspace packages intentionally remain private at `0.0.0`; root package version is operational release authority (`package.json:2-4`, `apps/cli/package.json:2-4`, `packages/*/package.json`). Documentation should explicitly distinguish product version from private workspace package versions.
- `docs/release-descriptor.md:7,144` links to `../changes/add-self-update-system/spec.md`, which resolves outside `openspec/` and the change is archived. The runtime schema and fixture live at `apps/cli/src/upgrade-command/release-descriptor.ts` and `apps/cli/src/upgrade-command/__fixtures__/release-fixture.json`.
- `CHANGELOG.md:61` still links to `gentleman-programming/deck`, while README installation/repository links use `kevin15011/deck`. Canonical repository ownership must be decided once and reused from release configuration rather than scattered prose.
- `.atl/skill-registry.md` is absent. Project-specific skill discovery must not claim such a registry exists; project-local skills currently live under `.agents/skills/`.

## Recommended Target Documentation Architecture

```text
README.md                         # Users: what Deck is, install, first run, support matrix, links
CONTRIBUTING.md                   # Contributors: setup, commands, tests, SDD workflow, generated files
AGENTS.md                         # AI agents: compact map, authority order, boundaries, verification links
CHANGELOG.md                      # Release history only
docs/
  architecture.md                # Stable concepts, package boundaries, materialization/update flow
  maintainers/
    releasing.md                 # Release checklist, version authority, descriptor workflow, rollback
  reference/
    release-descriptor.md        # Optional concise external contract; code/schema/fixture remain canonical
openspec/
  registry-schema.md             # Canonical SDD registry contract
  specs/                          # Promoted capability requirements
  changes/ and archive/           # Lifecycle artifacts/history, not general docs navigation
packages/core/src/skills/external/ # Runtime documentation payload inputs; generated bundle excluded
```

### Progressive disclosure and audience boundaries

- **README** answers “what is Deck, can I use it, and what do I run first?” It links to contributor, architecture, release, and OpenSpec material rather than embedding them.
- **CONTRIBUTING** answers “how do I change Deck safely?” It owns local setup, command matrix, test scope, branch/PR expectations, OpenSpec usage, and generated-file rules.
- **AGENTS** answers “where is authority and what must an agent not guess or edit?” It should be short enough to load every session and link to `CONTRIBUTING.md`, architecture, registry schema, and package-level source.
- **Architecture** documents stable boundaries and data/control flows, not every agent rule, tool, or source line.
- **Maintainer release guide** owns the operational release sequence; the local release skill should delegate to it rather than copy commands.
- **Reference docs** exist only for stable public contracts that cannot be understood conveniently from types/code. They name the authoritative implementation and test fixture.

## Source-of-Truth and Maintenance Rules

1. **Volatile facts are derived, not copied.** Product version comes from root `package.json`/generated build info; CLI commands come from `cli-args.ts`; agent roster/content comes from catalog/content registry; release schema comes from Zod types and fixture.
2. **One owner per concept.** README owns user onboarding, CONTRIBUTING owns contributor commands, AGENTS owns agent navigation, architecture owns boundaries, release guide owns release operations, OpenSpec owns requirements/change history.
3. **No live status in durable docs.** Test counts, local binary paths, active roadmap phases, “current known baseline,” and dated audit results belong in issues, OpenSpec artifacts, or generated reports.
4. **Generated boundaries are explicit.** `packages/core/src/skills/external/content.generated.ts` and build-info outputs must be regenerated from their inputs; do not edit them manually. Bundled skill Markdown is product input and must not be mistaken for contributor docs.
5. **Link-check and command-check critical paths.** CI or a focused test should verify local Markdown links, documented root scripts, required top-level docs, and generated-output freshness. Avoid tests that assert historical prose sentences.
6. **Archive decisions, not clutter.** Accepted architecture decisions belong in promoted specs or focused ADRs only when the rationale is not already preserved by OpenSpec. Dated audits/roadmaps should not remain in the maintained docs tree after their actions are resolved.
7. **English is the maintained project-doc language.** This aligns agent artifacts and cross-contributor accessibility. User-facing localization can be introduced separately rather than mixing languages within canonical docs.
8. **Every maintained doc states audience and authority.** A short header should say whether the file is normative, explanatory, generated, or historical and name its owner/source.

## Keep / Rewrite / Merge / Delete-or-Archive Plan

### Keep

- `openspec/config.yaml`, `openspec/registry-schema.md`, and `openspec/specs/**` as official SDD context.
- `openspec/changes/**` and `openspec/archive/**` under lifecycle retention, not as general documentation.
- `packages/core/src/skills/external/**` as distributable runtime inputs and their generated bundle pipeline.
- `CHANGELOG.md`, after correcting repository links and defining release automation/ownership.
- `docs/release-descriptor.md`, only after correcting links, reconciling field names with code, and reducing duplicated schema prose.
- `.agents/skills/openspec-retrospective-audit/SKILL.md` if the audit remains an active local workflow; otherwise archive with project-local tooling history.

### Rewrite / Create

- Rewrite `README.md` around user outcomes, supported install paths, quick start, command summary, runner support, troubleshooting, and links. Remove hard-coded current version and exhaustive feature-version claims.
- Create `CONTRIBUTING.md` with exact existing commands and scoped verification practices.
- Create root `AGENTS.md` with authority hierarchy, repository map, generated files, SDD rules, safety constraints, and evidence links. It must not duplicate phase-agent prompts.
- Create `docs/architecture.md` by merging only durable concepts from README and prompt methodology documentation.
- Create `docs/maintainers/releasing.md`; reconcile it with `.github/workflows/release.yml`, scripts, root versioning, update/rollback behavior, and the release descriptor contract.
- Rewrite `.agents/skills/deck-release-publish/SKILL.md` as a thin trigger/checklist that references the maintainer guide and exact existing scripts.

### Merge, then remove

- Merge durable upstream tool links from `docs/tool-references.md` into `CONTRIBUTING.md`/`AGENTS.md`; remove machine-specific verification paths and then delete the file.
- Merge stable architecture and composition concepts from `docs/prompt-methodology-modules.md` into `docs/architecture.md`; replace detailed inventory with generated output or source links, then delete the file.
- Extract any unresolved actionable work from `docs/deuda-tecnica.md` into issues/new OpenSpec changes, then remove it from maintained docs.

### Delete or archive

- `docs/openspec-retrospective-audit-2026-06-12.md` — historical report already reflected in OpenSpec follow-ups; preserve through Git or move under the relevant OpenSpec archive only if a direct lineage link is required.
- `docs/skills-integration-roadmap.md` — historical reconstructed roadmap. Before removal, decouple `git-safety.test.ts` and `no-op-skill-absence.test.ts` from prose and point invariants at canonical TypeScript/spec evidence.
- Stale or duplicated documentation references inside active docs, including the absent `docs/developer-team.md` link.
- Do not delete bundled external skill documentation, test fixtures, promoted specs, or archived change artifacts merely because they are Markdown; they are product inputs or official evidence.

## Options and Tradeoffs

1. **Minimal curated documentation system (recommended)** — five maintained entry points plus narrow references and OpenSpec history.
   - Pros: clear audiences; low duplication; durable agent context; easy ownership; lowest long-term maintenance.
   - Cons: requires deleting familiar snapshot docs and migrating two tests away from prose; some detailed inventories become source/generated views.
   - Effort: Medium.

2. **Refresh every existing document in place** — update README and all six current docs while adding agent guidance.
   - Pros: least deletion; preserves current navigation and narrative history.
   - Cons: perpetuates overlapping authority, dated status docs, line-number drift, and high recurring maintenance; conflicts with user intent.
   - Effort: High initially and ongoing.

3. **Generate a comprehensive documentation portal from code/OpenSpec** — build scripts/site from metadata, prompts, registry, and schemas.
   - Pros: strong freshness for inventories; searchable output.
   - Cons: new toolchain and generated surface are disproportionate for the repository; prose intent still needs curation; higher operational cost.
   - Effort: High.

## Concrete File-Level Impact for Proposal/Design

| Path | Expected action | Key dependency/risk |
|---|---|---|
| `README.md` | Rewrite | Validate install URLs, runner support, and CLI commands against code/release workflow |
| `CONTRIBUTING.md` | Add | Must use actual scripts; distinguish focused tests from broad gates |
| `AGENTS.md` | Add | Keep compact; no phase-contract duplication; state `.atl/skill-registry.md` is absent |
| `CHANGELOG.md` | Repair/normalize | Canonical repository URL and release-history policy must be settled |
| `docs/architecture.md` | Add | Derive package map and composition from code; avoid source line numbers |
| `docs/maintainers/releasing.md` | Add | Validate against `.github/workflows/release.yml`, `scripts/prepare-release.ts`, `scripts/generate-build-info.ts`, update/rollback code |
| `docs/release-descriptor.md` or `docs/reference/release-descriptor.md` | Shorten/move | Correct links and preserve inbound references from CHANGELOG/OpenSpec |
| `docs/tool-references.md` | Merge/delete | Preserve canonical upstream names only if still configured/supported |
| `docs/prompt-methodology-modules.md` | Merge/delete | Detailed facts should come from registry/catalog/tests or generated inventory |
| `docs/skills-integration-roadmap.md` | Archive/delete | Update two tests before removal; preserve Git safety invariant elsewhere |
| `docs/deuda-tecnica.md` | Archive/delete | Confirm unresolved items have owners before removal |
| `docs/openspec-retrospective-audit-2026-06-12.md` | Archive/delete | Preserve any required OpenSpec lineage links |
| `.agents/skills/deck-release-publish/SKILL.md` | Rewrite/thin | Current commands and version policy are inaccurate |
| `.agents/skills/openspec-retrospective-audit/SKILL.md` | Keep/shorten or archive | Decide whether local audit remains supported |
| `packages/core/src/teams/developer/git-safety.test.ts` | Update in Apply | Remove dependency on historical roadmap prose without weakening safety coverage |
| `packages/core/src/teams/developer/no-op-skill-absence.test.ts` | Update in Apply | Replace roadmap rationale dependency with canonical code/spec source |
| documentation checks/tests | Add narrowly | Link validity, command/script consistency, required docs, generated freshness |

## Constraints

- Exploration may write only this artifact and registry files; product documentation remains unchanged.
- Repository code, tests, package metadata, OpenSpec artifacts, and current docs are official evidence; adaptive memory is advisory.
- `.atl/skill-registry.md` is absent and must not be presented as available project authority.
- Existing user work must be preserved. No destructive Git operation is needed.
- OpenSpec artifacts and bundled skill Markdown have retention/product roles distinct from general documentation.
- Tests currently couple product invariants to `docs/skills-integration-roadmap.md`; deletion must be sequenced after test/source migration.

## Risks

- **Over-deletion:** historical prose may contain the only rationale for a still-active invariant. Mitigate with reference search and extract unresolved decisions before deletion.
- **Authority inversion:** a new AGENTS file could duplicate or contradict runtime agent prompts. Keep it navigational and link to `content-registry.ts`, promoted specs, and contributor docs.
- **Generated/manual confusion:** editing generated bundles or build info would create drift. Document input/output ownership and add freshness checks.
- **Broken historical links:** moving/deleting docs can invalidate OpenSpec references. Historical artifacts should remain immutable; provide compatibility stubs only when links are actively consumed, otherwise accept Git history and avoid mass-rewriting archives.
- **Release ownership ambiguity:** `kevin15011/deck` and `gentleman-programming/deck` both appear. Proposal must identify canonical upstream from code/workflow/remote before normalizing links.
- **Command drift:** contributor and release docs can become stale unless checks validate documented scripts and command parsing.
- **Scope expansion:** retroactively cleaning all OpenSpec history is not documentation streamlining and should remain out of scope.

## Open Questions

1. Which GitHub repository is canonical for installation, changelog comparisons, release API calls, and fixtures: `kevin15011/deck` or `gentleman-programming/deck`? Code/workflow/remote must decide, not documentation preference.
2. Is `docs/release-descriptor.md` an external compatibility contract worth retaining, or can maintainers rely on TypeScript schema + fixture + promoted spec? Recommendation: retain a concise reference because release producers consume it.
3. Should project-local retrospective audit remain a supported skill? If yes, keep a thin English instruction; if no, archive it with the dated report.
4. Where should unresolved technical-debt items be tracked after deleting the dated audit: GitHub issues or new OpenSpec changes? They should not move into durable architecture docs.
5. Should the detailed Developer Team inventory be generated as a developer command/CI artifact, or is source navigation sufficient? Start with source links; add generation only if recurring user need is demonstrated.

## Recommendation

Proceed with the minimal curated system. Rewrite the README first conceptually but implement in a dependency-safe order: establish authority/ownership, add contributor and agent entry points, add stable architecture/release docs, migrate tests away from historical prose, then delete or archive snapshots and run focused link/command checks. Do not build a documentation site or regenerate exhaustive prompt inventories in this change.

## Actionable Diagnosis

**Yes.** Documentation drift is caused less by missing prose than by duplicated volatile facts, unclear audience/authority boundaries, and snapshot documents treated as maintained references. The next phase should propose a five-entry-point system with explicit deletion/migration sequencing.

## Suggested Lifecycle Outcome

**propose**

## Ready for Proposal

**Yes.** Scope and target architecture are sufficiently concrete. Proposal should preserve the minimal system, explicitly sequence roadmap-test decoupling before deletion, and leave broad OpenSpec historical cleanup out of scope.

## Registry

- **Artifact Path**: `openspec/changes/streamline-project-documentation/exploration.md`
- **State Path**: `openspec/changes/streamline-project-documentation/state.yaml`
- **Events Path**: `openspec/changes/streamline-project-documentation/events.yaml`
- **Recorded**: phase `explore`, status `completed`, event `explore.completed`
- **Registry Blocker**: none
