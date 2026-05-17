# Pi Developer Team Agent Installation

Deck should install the Developer Team as one Pi bundle through an installer abstraction that can start with direct file installation and later move to a dedicated `deck-pi` package without changing the CLI flow.

Internally, the bundle contains agents and matching skills. The installer must not present those as separate user-facing install steps.

The long-term target is a Deck-owned Pi harness package. The short-term implementation may write agent files directly, but it must be designed as a replaceable backend, not as hard-coded CLI behavior.

## Decision

| Topic | Decision |
|---|---|
| Installation strategy | Use a `PiDeveloperTeamInstaller` abstraction. |
| Short-term backend | `direct-files`: Deck writes generated agent files into Pi locations. |
| Long-term backend | `deck-pi-package`: `pi install npm:deck-pi` owns Pi asset sync. |
| Source reuse | Copy the provisioner patterns, not the source runtime itself. |
| Source of truth | Deck owns Developer Team definitions, matching skills, and prompt sources. |
| User-facing unit | One `Developer Team` bundle, not separate agents/skills choices. |
| Safety model | Target: preflight → backup → apply → verify → rollback on failure. Current: plan → apply → verify (no backup/rollback). |

## Why not reuse the source runtime directly?

The source Pi runtime is built around its own Pi package, which owns SDD agents, identity profiles, support files, chains, and model assignments.

Deck has a different product-level roster:

- Orchestrator Agent
- Explorer Agent
- Proposal Agent
- Spec Agent
- Design Agent
- Task Agent
- General Apply Agent
- Backend Apply Agent
- Frontend Apply Agent
- Verify Agent
- Review Agent
- Archive Agent

Those agents and skills may reuse source content later, but they are not the same runtime package. Deck must avoid coupling its Developer Team to source runtime internals.

## Source findings to adopt

The source installer acts as a provisioner. It installs Pi/NPM packages and lets those packages own runtime behavior.

Useful patterns:

- Validate `pi` is available before install.
- Install runtime packages through `pi install npm:<package>`.
- Keep package installation separate from component injection.
- Backup before applying changes.
- Roll back when apply fails.
- Merge JSON idempotently instead of overwriting user config.
- Let package-owned init commands manage specialized schemas, for example Engram MCP initialization.

Relevant source references:

| Path | Finding |
|---|---|
| Source Pi adapter | Pi adapter emits package install commands and does not expose direct prompt/agent directories. |
| Source CLI run | Install pipeline runs adapter install commands, then applies supported components. |
| Source CLI sync | Pi sync only handles supported runtime components. |
| Source pipeline | Uses prepare/apply pipeline with backup and rollback behavior. |
| Source resolver | Validates Pi availability before install. |
| Source Pi docs | Documents the Pi package as owner of Pi assets, models, and session sync. |
| Source assets | No Pi-specific embedded assets; Pi assets live in Pi package land. |

## Pi runtime shape

The source runtime and `pi-subagents` indicate these Pi paths are relevant:

```txt
<project>/.pi/agents/*.md       # preferred project-local agents
<project>/.agents/*.md          # legacy project-local agents
<project>/.pi/chains/*.chain.md # project-local chains
<project>/.pi/skills/           # preferred project-local Deck skills
~/.pi/agent/agents/*.md         # legacy user agents
~/.agents/*.md                  # user agents
~/.pi/agent/chains/*.chain.md   # user chains
~/.pi/agent/settings.json       # user Pi settings and subagent overrides
~/.pi/npm/package.json          # Pi npm dependencies
~/.pi/agent/mcp.json            # MCP config, owned by package init commands
```

Project-local agents are preferred for Deck because they travel with the repository and avoid mutating global user agent directories.

Project-local skills follow the same principle.

### Discovery validation

Validated locally with `pi-subagents@0.24.3`:

- Project agent discovery works from `<project>/.pi/agents/*.md`.
- Arbitrary Deck-style names such as `deck-test` are discovered.
- Discovery does not require `sdd-*` filenames.
- A valid agent requires frontmatter with at least `name` and `description`.
- Markdown files ending in `.chain.md` are excluded from agent discovery and handled as chains.

Minimal tested agent shape:

```md
---
name: deck-test
description: Deck temporary test agent for Pi subagent discovery validation
tools: read
thinking: low
systemPromptMode: replace
inheritProjectContext: true
inheritSkills: false
---

You are a temporary Deck test agent used only to validate Pi subagent discovery.
```

Important parsed frontmatter fields include:

- `name`
- `description`
- `tools`
- `model`
- `fallbackModels`
- `thinking`
- `systemPromptMode`
- `inheritProjectContext`
- `inheritSkills`
- `defaultContext`
- `skills` or `skill`
- `extensions`
- `output`
- `defaultReads`
- `defaultProgress`
- `interactive`
- `maxSubagentDepth`

This makes the short-term `direct-files` backend viable for project-local Developer Team agents.

### Skill discovery validation

Validated locally with `pi-subagents@0.24.3`:

- Project skill discovery works from `<project>/.pi/skills`.
- Nested skills work with `<project>/.pi/skills/<skill-name>/SKILL.md`.
- A project-local skill named `deck-test` was discovered and resolved from `/home/kevinlb/deck/.pi/skills/deck-test/SKILL.md`.
- Skill frontmatter `description` is parsed for listings.
- Skill frontmatter is stripped from injected content.
- The resolved source is `project`.

Minimal tested skill shape:

```md
---
description: Deck temporary test skill for Pi skill discovery validation
---

# Deck Test Skill

This temporary skill validates project-local Pi skill discovery.
```

`pi-subagents` also searches:

```txt
<project>/.agents/skills
~/.pi/agent/skills
~/.agents/skills
package-declared `pi.skills` paths
paths listed in `.pi/settings.json` or `~/.pi/agent/settings.json` `skills`
```

For Deck, prefer `<project>/.pi/skills/<skill-name>/SKILL.md` so the Developer Team bundle stays project-local and versionable.

## Proposed install flow

```txt
1. Preflight
   ├─ detect pi binary
   ├─ detect Pi config directories
   ├─ validate Pi version compatibility
   └─ detect existing packages and existing Deck assets

2. Plan
   ├─ base Pi packages needed
   ├─ Developer Team bundle files or deck-pi package
   ├─ model assignment operations
   ├─ support files
   └─ validation checks

3. Backup
   ├─ ~/.pi/agent/settings.json
   ├─ ~/.pi/npm/package.json
   ├─ ~/.pi/agents/ when direct-files backend is used
   ├─ ~/.pi/chains/ when used
   └─ Deck-owned Pi config directories

4. Apply
   ├─ install required packages
   ├─ run package init commands when needed
   ├─ install Developer Team bundle
   ├─ write or merge model assignments
   └─ write support files

5. Verify
   ├─ pi list includes required packages
   ├─ Developer Team agents are discoverable
   ├─ internal Developer Team skills are discoverable
   ├─ model assignment config exists and is valid
   ├─ MCP/Engram setup exists if selected
   └─ no unrelated user config was overwritten

6. Rollback on failure
   └─ restore backed-up files in reverse order
```

## Required Pi packages

The Developer Team agent system depends on base Pi capabilities.

| Package | Purpose |
|---|---|
| `npm:pi-subagents` | Agent runner/discovery mechanism. |
| `npm:pi-mcp-adapter` | MCP bridge for Pi. |
| `npm:context-mode` | Pi-installable context-mode integration. |
| `npm:@dreki-gg/pi-context7` | Context7 integration for Pi. |

Potential future packages, pending validation:

| Package | Purpose |
|---|---|
| `npm:deck-pi` | Deck-owned Pi harness for Developer Team asset sync. |
| `npm:pi-intercom` | Parent-child communication if Deck agents require it. |
| `npm:@juicesharp/rpiv-ask-user-question` | User clarification from child agents if needed. |

External tools such as RTK, codebase-memory, and Engram remain canonical external tools. They should be detected by binary/configuration rather than invented as Pi packages.

## Installer abstraction

Deck should add a Pi-specific installer around a backend interface.

> **Current stage (2025-05)**: The implementation uses direct `buildDeveloperTeamInstallPlan` / `applyDeveloperTeamInstall` / `verifyDeveloperTeamInstall` functions in `packages/adapter-pi/src/developer-team-install.ts`. This is the `direct-files` backend without backup or rollback. The full interface below is the target architecture, not the current state. Do not implement the full interface until backup/rollback requirements are confirmed and prioritized.

Target interface:

```ts
type PiDeveloperTeamInstaller = {
  buildPlan(input: PiDeveloperTeamInstallInput): PiDeveloperTeamInstallPlan;
  backup(plan: PiDeveloperTeamInstallPlan): Promise<PiDeveloperTeamBackup>;
  apply(plan: PiDeveloperTeamInstallPlan): Promise<PiDeveloperTeamApplyResult>;
  verify(plan: PiDeveloperTeamInstallPlan): Promise<PiDeveloperTeamVerifyResult>;
  rollback(backup: PiDeveloperTeamBackup): Promise<void>;
};

type PiAgentInstallBackend = "direct-files" | "deck-pi-package";
```

The CLI should not care which backend is used.

## Backend A: direct files

This is the fastest implementation path.

Deck generates or copies the Developer Team bundle to project-local Pi locations. The first implementation writes agent files directly to the project-local Pi agent directory. It must also support matching skill files internally under `<project>/.pi/skills/<skill-name>/SKILL.md`.

Expected shape:

```txt
<project>/.pi/agents/deck-developer-orchestrator.md
<project>/.pi/agents/deck-developer-explorer.md
<project>/.pi/agents/deck-developer-proposal.md
<project>/.pi/agents/deck-developer-spec.md
<project>/.pi/agents/deck-developer-design.md
<project>/.pi/agents/deck-developer-task.md
<project>/.pi/agents/deck-developer-apply-general.md
<project>/.pi/agents/deck-developer-apply-backend.md
<project>/.pi/agents/deck-developer-apply-frontend.md
<project>/.pi/agents/deck-developer-verify.md
<project>/.pi/agents/deck-developer-review.md
<project>/.pi/agents/deck-developer-archive.md
```

Expected internal skill shape:

```txt
<project>/.pi/skills/deck-developer-orchestrator/SKILL.md
<project>/.pi/skills/deck-developer-explorer/SKILL.md
<project>/.pi/skills/deck-developer-proposal/SKILL.md
<project>/.pi/skills/deck-developer-spec/SKILL.md
<project>/.pi/skills/deck-developer-design/SKILL.md
<project>/.pi/skills/deck-developer-task/SKILL.md
<project>/.pi/skills/deck-developer-apply-general/SKILL.md
<project>/.pi/skills/deck-developer-apply-backend/SKILL.md
<project>/.pi/skills/deck-developer-apply-frontend/SKILL.md
<project>/.pi/skills/deck-developer-verify/SKILL.md
<project>/.pi/skills/deck-developer-review/SKILL.md
<project>/.pi/skills/deck-developer-archive/SKILL.md
```

Benefits:

- Fast to build.
- Easy to inspect.
- No package publishing needed.
- Project-local and shareable through Git.

Costs:

- Deck CLI owns file synchronization.
- Higher risk of format drift with Pi.
- Must avoid conflicts with other project-local agents that use the same names.

Use this only behind the installer abstraction.

## Backend B: `deck-pi` package

This is the preferred long-term architecture.

Deck installs:

```txt
pi install npm:deck-pi
```

Then `deck-pi` owns Pi runtime sync:

```txt
<project>/.pi/agents/deck-developer-*.md      # Developer Team agents (broad deck-* for future teams)
<project>/.pi/skills/deck-developer-*/SKILL.md # Developer Team skills (broad deck-* for future teams)
<project>/.pi/chains/deck-developer-*.chain.md # Developer Team chains (broad deck-* for future teams)
<project>/.pi/deck/support/
<project>/.pi/deck/models.json
```

Benefits:

- Aligns with the source Pi architecture.
- Pi package owns Pi-specific behavior.
- Reduces Deck CLI's direct coupling to Pi internals.
- Easier versioning and upgrades.

Costs:

- Requires package design and publishing.
- Adds another artifact to maintain.
- Needs clear coexistence rules with the source Pi package.

## Developer Team agent and skill definitions

Agent and skill implementation is not part of this document. It is defined in `docs/developer-team.md` and must be implemented later by reviewing source agent and skill definitions one by one.

The install system must support the confirmed agent/skill pairs:

| File ID | Display name | Matching skill |
|---|---|---|
| `deck-developer-orchestrator` | Orchestrator Agent | `deck-developer-orchestrator` |
| `deck-developer-explorer` | Explorer Agent | `deck-developer-explorer` |
| `deck-developer-proposal` | Proposal Agent | `deck-developer-proposal` |
| `deck-developer-spec` | Spec Agent | `deck-developer-spec` |
| `deck-developer-design` | Design Agent | `deck-developer-design` |
| `deck-developer-task` | Task Agent | `deck-developer-task` |
| `deck-developer-apply-general` | General Apply Agent | `deck-developer-apply-general` |
| `deck-developer-apply-backend` | Backend Apply Agent | `deck-developer-apply-backend` |
| `deck-developer-apply-frontend` | Frontend Apply Agent | `deck-developer-apply-frontend` |
| `deck-developer-verify` | Verify Agent | `deck-developer-verify` |
| `deck-developer-review` | Review Agent | `deck-developer-review` |
| `deck-developer-archive` | Archive Agent | `deck-developer-archive` |

Agent prompts should be thin wrappers that point to their matching skill. Skills own detailed methodology.

## Skill injection and project AI notes

Pi installation must not hard-code every stack-specific rule into every agent.

Required behavior:

- Base prompts must contain a clear place for `## Project Standards (auto-resolved)`.
- Matching skills must also define how injected standards are applied for their phase.
- Orchestrator must resolve relevant skills by stack, changed paths, and task context.
- Orchestrator must retrieve project AI notes relevant to the user request or changed files (planned Phase 5 feature, path TBD).
- Retrieved notes must be injected under `## Project Context (auto-retrieved)`.

This keeps agent roles stable while allowing stack-aware behavior.

## Model assignments

The source runtime stores Pi model assignments under a runtime-owned path.

Deck should not blindly write that schema without validation.

Recommended staged approach:

1. Detect whether a Deck-owned model assignment file already exists.
2. For direct-files backend, write a Deck-owned config path such as `.pi/deck/models.json` if Pi can consume it, or defer model assignment to manual setup until schema is confirmed.
3. For `deck-pi-package`, let `deck-pi` own the model assignment schema and any Pi-native model UI.

Suggested model tiers:

| Agent | Suggested model tier |
|---|---|
| Orchestrator Agent | Strong reasoning |
| Explorer Agent | Efficient code-reading model |
| Proposal Agent | Strong reasoning |
| Spec Agent | Structured writing model |
| Design Agent | Strong architecture model |
| Apply Agents | Strong coding model |
| Verify Agent | Reliable validation model |
| Review Agent | Strong fresh-context review model |
| Archive Agent | Cheap structured summarization model |

## Validation checklist

Before considering Pi Developer Team installation successful, Deck must verify:

- `pi` is available.
- Required packages are installed.
- Developer Team agent files or package are present.
- Internal Developer Team skill files or package assets are present.
- Agent discovery works with Deck names.
- Project-local `<project>/.pi/agents/deck-developer-*.md` files are preferred over global user agent directories (broad `deck-*` pattern reserved for future Deck teams).
- No user-edited unrelated files were overwritten.
- Model assignment strategy is either configured or explicitly marked as manual/pending.
- MCP setup is valid when memory/MCP tools are selected.
- Project AI notes retrieval is planned for Phase 5 (exact path and schema pending).

## Open questions before implementation

1. Can Deck install agents into a deeper Deck-owned namespace under `.pi/agents/`, or should it keep flat `deck-developer-*.md` files (with `deck-*` reserved for future teams)?
2. What model assignment schema can Deck safely write for Pi?
3. Should `deck-pi` coexist with the source Pi package, depend on it, or replace it?
4. Which Pi companion packages are truly required for Deck agents beyond `pi-subagents`?
5. How should Deck validate that an installed agent is executable through Pi, not merely discoverable through `pi-subagents` internals?

## Next implementation step

Do not implement prompt installation yet.

Pi agent and skill discovery are validated. The current implementation installs the Developer Team bundle through direct plan/apply/verify functions using the `direct-files` backend.

Next, add backup/rollback safety around the current direct-files backend before replacing placeholder prompts/skills with real source-derived content. Keep the fuller `PiDeveloperTeamInstaller` abstraction and `deck-pi-package` backend as follow-up architecture steps.

## Pi session launcher

The Pi session launcher allows starting a Pi interactive session pre-shaped for a Deck team without using slash commands inside Pi.

### Usage

```bash
# Start a new Developer Team session
deck pi developer

# Continue the most recent Developer Team session
deck pi developer --continue

# Open Pi's native resume picker within the Developer Team session dir/profile
deck pi developer --resume

# --continue and --resume are mutually exclusive; use one or the other.
```

### How it works

1. CLI parses `deck pi <team>` subcommands via `parseArgs()`.
2. `runPiLaunch()` checks that the `pi` binary is available.
3. `materializeTeamProfile()` generates team profile artifacts under `.deck/pi/profiles/<team>/`.
4. `buildPiTeamLaunchPlan()` builds the Pi command, args, env, and cwd.
5. The CLI spawns Pi with the launch plan, inheriting stdio for interactive use.

### Session isolation

Team sessions are stored under `.deck/pi/sessions/<team>/` rather than the default Pi session location. This keeps Deck team sessions separate from normal `pi` sessions.

```txt
<project>/.deck/
  pi/
    sessions/
      developer-team/    # Developer Team session data
    profiles/
      developer-team/
        system-prompt.md  # Generated system prompt for the team
```

### Architecture decisions

- **Source of truth stays environment-agnostic**: The launch plan builder uses the canonical `DeveloperTeamAgent[]` catalog rather than duplicating team details.
- **"Pi Developer Team" is not a separate conceptual team**: The launcher is a convenience wrapper around the same team definition used by the TUI installer.
- **Profile artifacts are generated, not source**: `system-prompt.md` is materialized from the team catalog at launch time, not checked into the repo.
- **No Pi config/auth mutation**: The launcher only reads Pi availability and spawns a child process. It does not modify `~/.pi/` or project `.pi/` settings.
- **Launcher vs installer vs custom package**: The installer (`developer-team-install`) writes agent/skill files to `.pi/`. The launcher (`pi-team-launch` + `pi-launch-command`) starts a session. A future `deck-pi` package would own both.

### Legacy file migration note

Pre-team-scoped versions of Deck (before the `deck-developer-*` ID refactor) installed files under short IDs:

```txt
<project>/.pi/agents/deck-orchestrator.md
<project>/.pi/skills/deck-orchestrator/SKILL.md
```

If these files remain from a previous installation, they will be visible to Pi alongside the new `deck-developer-*` files. This is non-breaking (Pi discovers both), but may cause confusion. To clean up, manually remove the old files:

```sh
rm .pi/agents/deck-orchestrator.md .pi/agents/deck-explorer.md ...
rm -rf .pi/skills/deck-orchestrator .pi/skills/deck-explorer ...
```

The installer does not perform destructive cleanup of existing files. A future version may add a migration step that renames old files to their canonical `deck-developer-*` names when safe.

### Module structure

| Module | Package | Purpose |
|---|---|---|
| `pi-team-launch` | adapter-pi | Builds command/args/env/cwd for Pi team session |
| `pi-team-profile` | adapter-pi | Generates and materializes team profile artifacts |
| `cli-args` | cli | Parses `deck pi <team> [--continue \| --resume]` arguments |
| `pi-launch-command` | cli | Orchestrates Pi launch: validates pi, materializes profile, spawns |
