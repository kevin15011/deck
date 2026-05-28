# Exploration: Integrate gentle-ai Skills into deck

## Goal
Understand how deck currently installs skills and determine the best way to bring three specific gentle-ai skills (`judgment-day`, `cognitive-doc-design`, `comment-writer`) into deck while preserving the adapter-agnostic architecture.

## Current State

### How deck Installs Skills Today

Deck uses a **generative, adapter-agnostic pipeline** to install skills. Skills do not exist as static files inside the deck repository; they are synthesized at install-time by `@deck/core` and serialized to filesystem paths by runtime adapters (`adapter-opencode`, `adapter-pi`).

The pipeline is:

1. **Canonical Catalog** (`@deck/core/src/teams/developer/catalog.ts`)  
   `DEVELOPER_TEAM_AGENTS` defines 13 agents. Each entry has:
   - `id` / `name` — file-safe identifier (e.g. `deck-developer-explorer`)
   - `displayName` — human label
   - `description` — short description for frontmatter
   - `skillId` — mirrors `id` for deterministic pairing

2. **Content Registry** (`@deck/core/src/teams/developer/content-registry.ts`)  
   `REAL_CONTENT` maps each `agentId` to `{ agentBody, skillBody }`. The bodies are full prompt text imported from sibling files such as `explorer-content.ts`, `orchestrator-content.ts`, etc.

3. **Manifest Builder** (`@deck/core/src/teams/developer/manifest.ts`)  
   `buildDeveloperTeamManifest()` iterates `DEVELOPER_TEAM_AGENTS`, calls `getAgentContent(agentId)` to retrieve bodies, and produces a runner-neutral `DeveloperTeamManifest` with `agents[]` and `skills[]`.

4. **Adapter Install Plans**
   - **OpenCode** (`packages/adapter-opencode/src/developer-team-install.ts`): `buildOpenCodeDeveloperTeamInstallPlan()` creates an `OpenCodePlannedSkillFile[]` by mapping each agent to a path `.opencode/skills/{skillId}/SKILL.md`. The skill content is built with a small frontmatter (`description`) plus the `skillBody` from the content registry.
   - **Pi** (`packages/adapter-pi/src/developer-team-install.ts`): Same pattern but with `.pi/skills/{skillId}/SKILL.md`.

5. **Apply** — adapters write the planned files to disk, backing up and rolling back on failure.

**Key observation:** every skill in deck is tightly coupled to a Developer Team agent. There is no concept of a *standalone skill* that exists without an agent counterpart.

### gentle-ai Skill Locations

The three requested skills exist as static `SKILL.md` files inside the gentle-ai repository in **two locations**:

| Skill | `internal/assets/skills/` (built-in) | `skills/` (public/legacy) |
|---|---|---|
| `judgment-day` | ✅ `/home/kevinlb/gentle-ai/internal/assets/skills/judgment-day/SKILL.md` | ❌ absent |
| `cognitive-doc-design` | ✅ `/home/kevinlb/gentle-ai/internal/assets/skills/cognitive-doc-design/SKILL.md` | ✅ `/home/kevinlb/gentle-ai/skills/cognitive-doc-design/SKILL.md` |
| `comment-writer` | ✅ `/home/kevinlb/gentle-ai/internal/assets/skills/comment-writer/SKILL.md` | ✅ `/home/kevinlb/gentle-ai/skills/comment-writer/SKILL.md` |

**Frontmatter format (gentle-ai)**
All three files include a full YAML frontmatter block:
```yaml
---
name: <skill-name>
description: "..."
license: Apache-2.0
metadata:
  author: gentleman-programming
  version: "x.y"
---
```

This is richer than the minimal frontmatter deck currently generates (`description` only plus `disable-model-invocation: true` for OpenCode).

### gentle-ai Installation Mechanism

gentle-ai uses `agentbuilder.Install()` (`internal/agentbuilder/installer.go`). It receives a `GeneratedAgent` and a slice of `AdapterInfo` structs (each pairing an `AgentID` with a `SkillsDir`). It copies the same `SKILL.md` content into every adapter’s skills directory with rollback on failure. This is a **multi-target copy** model, not a generative model.

## Relevant Files

- `/home/kevinlb/deck/packages/core/src/teams/developer/catalog.ts` — canonical agent definitions (`DEVELOPER_TEAM_AGENTS`).
- `/home/kevinlb/deck/packages/core/src/teams/developer/content-registry.ts` — maps agent IDs to prompt bodies.
- `/home/kevinlb/deck/packages/core/src/teams/developer/manifest.ts` — builds runner-neutral manifest.
- `/home/kevinlb/deck/packages/adapter-opencode/src/developer-team-install.ts` — OpenCode adapter install plan & apply.
- `/home/kevinlb/deck/packages/adapter-pi/src/developer-team-install.ts` — Pi adapter install plan & apply.
- `/home/kevinlb/gentle-ai/internal/assets/skills/judgment-day/SKILL.md` — target skill 1.
- `/home/kevinlb/gentle-ai/internal/assets/skills/cognitive-doc-design/SKILL.md` — target skill 2.
- `/home/kevinlb/gentle-ai/internal/assets/skills/comment-writer/SKILL.md` — target skill 3.
- `/home/kevinlb/gentle-ai/internal/agentbuilder/installer.go` — gentle-ai’s multi-target skill installer.

## Constraints

1. **Agent-skill coupling.** Deck’s current catalog assumes every skill has a matching agent. Standalone skills break this invariant.
2. **Front mismatch.** gentle-ai skills carry their own full frontmatter. Deck’s adapters generate a minimal frontmatter and append a `skillBody`. Copying gentle-ai skills verbatim means skipping deck’s frontmatter generator for those entries.
3. **Adapter parity.** Any change must be implemented in both `adapter-opencode` and `adapter-pi` to keep feature parity.
4. **Runner neutrality.** `@deck/core` must remain runtime-agnostic; filesystem paths belong in adapters only.
5. **No gentle-ai runtime dependency.** Deck should not depend on gentle-ai as a build-time or runtime package (different language stacks: TypeScript vs Go).

## Risks

- **Divergence.** If we copy the SKILL.md contents into deck, future updates in gentle-ai will not automatically propagate.
- **Frontmatter collision.** If an adapter adds its own frontmatter on top of gentle-ai’s existing frontmatter, the resulting file will be malformed.
- **Scope creep.** Adding a standalone-skill abstraction to core may invite more ad-hoc skills, complicating the manifest.
- **Test surface.** Both adapters have extensive unit tests around install plans; adding a new skill category will require new test cases.

## Options and Tradeoffs

### Option A — Copy gentle-ai SKILL.md files into deck as static assets

Create a new directory in `@deck/core` (e.g. `src/skills/external/`) and copy the three `SKILL.md` files there. Add a TypeScript index that exports them as strings. Modify the adapters to iterate over an "additional skills" list and write them verbatim.

- **Pros:**
  - Simplest to understand and implement.
  - No runtime file-reading complexity.
  - Works with the existing adapter file-writing infrastructure.
- **Cons:**
  - Content duplication between repositories.
  - Manual step to keep in sync with gentle-ai updates.
  - Requires a new "raw file" mode in adapters (skip frontmatter generation).
- **Effort:** Low–Medium.

### Option B — Extend `@deck/core` with a Standalone Skill Catalog

Introduce a new registry abstraction (e.g. `StandaloneSkillCatalog`) separate from `DEVELOPER_TEAM_AGENTS`. Each entry carries `skillId`, `name`, `description`, and a `content` resolver. The manifest builder merges standalone skills into the `skills[]` array. Adapters receive them alongside agent-linked skills and write them using a new `buildRawSkillFileContent()` path that copies content without adding frontmatter.

- **Pros:**
  - Preserves the canonical-core + adapter-serialization architecture perfectly.
  - Extensible: future standalone skills (gentle-ai or otherwise) slot in naturally.
  - Adapters remain symmetric and agnostic to the skill source.
- **Cons:**
  - Touches core catalog, manifest, and both adapters — broader surface area.
  - Need to distinguish "generated skills" (deck frontmatter + body) from "raw skills" (verbatim copy) in the install plan types.
- **Effort:** Medium.

### Option C — Add the three skills as pseudo-agents in the Developer Team catalog

Create agent entries in `DEVELOPER_TEAM_AGENTS` with IDs like `gentle-ai-judgment-day`, reuse the content registry to store their `skillBody` (the full gentle-ai SKILL.md text), and let adapters generate them exactly like existing skills.

- **Pros:**
  - Minimal adapter changes; reuses every existing code path.
- **Cons:**
  - Abusive: these are not Developer Team agents. They would generate empty or nonsensical agent definition files.
  - Pollutes the agent catalog with non-agent entities.
  - Loses gentle-ai’s full frontmatter because deck would overwrite it with its minimal frontmatter.
- **Effort:** Low.
- **Verdict:** **Rejected** — breaks domain semantics.

### Option D — Runtime symlink or external file reference

Have the adapters accept a new option `externalSkillPaths` that points to the gentle-ai repository on disk. At install time, adapters symlink or copy from those paths.

- **Pros:**
  - No duplication; always uses latest gentle-ai files.
- **Cons:**
  - Violates runner neutrality: core or adapters would need to know about gentle-ai filesystem layout.
  - Brittle: breaks if gentle-ai repo is moved or absent.
  - Does not work in CI or distributed installs.
- **Effort:** Low.
- **Verdict:** **Rejected** — violates adapter-agnostic constraint.

## Recommendation

**Adopt Option B (Standalone Skill Catalog) with Option A asset strategy as the concrete data source.**

Specifically:

1. **In `@deck/core`**:
   - Create `src/skills/external/` (or `src/skills/standalone/`).
   - Copy the three `SKILL.md` files from gentle-ai into this directory.
   - Add an index file (`index.ts`) that exports a `StandaloneSkill[]` array. Each entry contains `skillId`, `name`, `description`, and the full file content read at build time (or via a resolver function).
   - Modify `buildDeveloperTeamManifest` (or create `buildFullInstallManifest`) to accept and merge standalone skills into the `skills[]` array, marking them with a `kind: "raw"` flag.

2. **In adapters** (`adapter-opencode` and `adapter-pi`):
   - Extend the install plan types so `skills[]` can hold both:
     - *Generated skills* — current behavior: adapter adds frontmatter + body.
     - *Raw skills* — adapter writes the provided content verbatim (preserving gentle-ai frontmatter).
   - During `apply`, branch on `kind` to decide whether to call `buildSkillFileContent()` or write the raw content directly.

3. **For frontmatter preservation:**
   - Because gentle-ai skills already contain `name`, `description`, `license`, and `metadata`, they should be treated as **opaque blobs** by adapters. No extra frontmatter should be prepended.

This keeps `@deck/core` as the authority on *what* to install, adapters as the authority on *where* and *how* to install it, and introduces no runtime dependency on gentle-ai.

## Open Questions

1. Should deck maintain its own copies of the SKILL.md files, or should the build process copy them from gentle-ai automatically (e.g. a `scripts/sync-gentle-ai-skills.ts`)?
2. Do we want to install these three skills **by default** for every deck project, or make them opt-in via a config flag in `.deck/config.json`?
3. Should the standalone skill registry live in `@deck/core` (shared) or in each adapter (duplicated)? The principle of canonical definitions suggests `@deck/core`.

## Ready for Proposal

Yes. The next step is a formal Proposal that:
- Chooses the exact package paths (`packages/core/src/skills/external/` vs `packages/core/src/skills/gentle-ai/`).
- Decides whether to auto-sync from gentle-ai or vendor the files.
- Specifies the type changes in the manifest and adapter install plans.
- Estimates test coverage additions.
