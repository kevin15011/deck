---
name: git-workflow-and-versioning
description: Structures git workflow practices. Use when making any code change. Use when committing, branching, resolving conflicts, or when you need to organize work across multiple parallel streams.
---

# Git Workflow and Versioning

## Overview

Git is your safety net. Treat commits as save points, branches as sandboxes, and history as documentation. With AI agents generating code at high speed, disciplined version control is the mechanism that keeps changes manageable, reviewable, and reversible.

## When to Use

Always. Every code change flows through git.

## Core Principles

### Trunk-Based Development (Recommended)

Keep `main` always deployable. Work in short-lived feature branches that merge back within 1-3 days. Long-lived development branches are hidden costs — they diverge, create merge conflicts, and delay integration. DORA research consistently shows trunk-based development correlates with high-performing engineering teams.

```
main ──●──●──●──●──●──●──●──●──●──  (always deployable)
        ╲      ╱  ╲    ╱
         ●──●─╱    ●──╱    ← short-lived feature branches (1-3 days)
```

This is the recommended default. Teams using gitflow or long-lived branches can adapt the principles (atomic commits, small changes, descriptive messages) to their branching model — the commit discipline matters more than the specific branching strategy.

- **Dev branches are costs.** Every day a branch lives, it accumulates merge risk.
- **Release branches are acceptable.** When you need to stabilize a release while main moves forward.
- **Feature flags > long branches.** Prefer deploying incomplete work behind flags rather than keeping it on a branch for weeks.

### 1. Commit Early, Commit Often

Each successful increment gets its own commit. Don't accumulate large uncommitted changes.

```
Work pattern:
  Implement slice → Test → Verify → Commit → Next slice

Not this:
  Implement everything → Hope it works → Giant commit
```

Commits are save points. If the next change breaks something, you can revert to the last known-good state instantly.

### 2. Atomic Commits

Each commit does one logical thing:

```
# Good: Each commit is self-contained
git log --oneline
a1b2c3d Add task creation endpoint with validation
d4e5f6g Add task creation form component
h7i8j9k Connect form to API and add loading state
m1n2o3p Add task creation tests (unit + integration)

# Bad: Everything mixed together
git log --oneline
x1y2z3a Add task feature, fix sidebar, update deps, refactor utils
```

### 3. Descriptive Messages

Commit messages explain the *why*, not just the *what*:

```
# Good: Explains intent
feat: add email validation to registration endpoint

Prevents invalid email formats from reaching the database.
Uses Zod schema validation at the route handler level,
consistent with existing validation patterns in auth.ts.

# Bad: Describes what's obvious from the diff
update auth.ts
```

**Format:**
```
<type>: <short description>

<optional body explaining why, not what>
```

**Types:**
- `feat` — New feature
- `fix` — Bug fix
- `refactor` — Code change that neither fixes a bug nor adds a feature
- `test` — Adding or updating tests
- `docs` — Documentation only
- `chore` — Tooling, dependencies, config

### 4. Keep Concerns Separate

Don't combine formatting changes with behavior changes. Don't combine refactors with features. Each type of change should be a separate commit — and ideally a separate PR:

```
# Good: Separate concerns
git commit -m "refactor: extract validation logic to shared utility"
git commit -m "feat: add phone number validation to registration"

# Bad: Mixed concerns
git commit -m "refactor validation and add phone number field"
```

**Separate refactoring from feature work.** A refactoring change and a feature change are two different changes — submit them separately. This makes each change easier to review, revert, and understand in history. Small cleanups (renaming a variable) can be included in a feature commit at reviewer discretion.

### 5. Size Your Changes

Target ~100 lines per commit/PR. Changes over ~1000 lines should be split. See the splitting strategies in `code-review-and-quality` for how to break down large changes.

```
~100 lines  → Easy to review, easy to revert
~300 lines  → Acceptable for a single logical change
~1000 lines → Split into smaller changes
```

## Branching Strategy

### Feature Branches

```
main (always deployable)
  │
  ├── feature/task-creation    ← One feature per branch
  ├── feature/user-settings    ← Parallel work
  └── fix/duplicate-tasks      ← Bug fixes
```

- Branch from `main` (or the team's default branch)
- Keep branches short-lived (merge within 1-3 days) — long-lived branches are hidden costs
- Delete branches after merge
- Prefer feature flags over long-lived branches for incomplete features

### Branch Naming

```
feature/<short-description>   → feature/task-creation
fix/<short-description>       → fix/duplicate-tasks
chore/<short-description>     → chore/update-deps
refactor/<short-description>  → refactor/auth-module
```

## Working with Worktrees

For parallel AI agent work, use git worktrees to run multiple branches simultaneously:

```bash
# Create a worktree for a feature branch
git worktree add ../project-feature-a feature/task-creation
git worktree add ../project-feature-b feature/user-settings

# Each worktree is a separate directory with its own branch
# Agents can work in parallel without interfering
ls ../
  project/              ← main branch
  project-feature-a/    ← task-creation branch
  project-feature-b/    ← user-settings branch

# When done, merge and clean up
git worktree remove ../project-feature-a
```

Benefits:
- Multiple agents can work on different features simultaneously
- No branch switching needed (each directory has its own branch)
- If one experiment fails, delete the worktree — nothing is lost
- Changes are isolated until explicitly merged

## The Save Point Pattern

```
Agent starts work
    │
    ├── Makes a change
    │   ├── Test passes? → Commit → Continue
    │   └── Test fails? → Revert to last commit → Investigate
    │
    ├── Makes another change
    │   ├── Test passes? → Commit → Continue
    │   └── Test fails? → Revert to last commit → Investigate
    │
    └── Feature complete → All commits form a clean history
```

This pattern means you never lose more than one increment of work. If an agent goes off the rails, `git reset --hard HEAD` takes you back to the last successful state.

## Change Summaries

After any modification, provide a structured summary. This makes review easier, documents scope discipline, and surfaces unintended changes:

```
CHANGES MADE:
- src/routes/tasks.ts: Added validation middleware to POST endpoint
- src/lib/validation.ts: Added TaskCreateSchema using Zod

THINGS I DIDN'T TOUCH (intentionally):
- src/routes/auth.ts: Has similar validation gap but out of scope
- src/middleware/error.ts: Error format could be improved (separate task)

POTENTIAL CONCERNS:
- The Zod schema is strict — rejects extra fields. Confirm this is desired.
- Added zod as a dependency (72KB gzipped) — already in package.json
```

This pattern catches wrong assumptions early and gives reviewers a clear map of the change. The "DIDN'T TOUCH" section is especially important — it shows you exercised scope discipline and didn't go on an unsolicited renovation.

## Pre-Commit Hygiene

Before every commit:

```bash
# 1. Check what you're about to commit
git diff --staged

# 2. Ensure no secrets
git diff --staged | grep -i "password\|secret\|api_key\|token"

# 3. Run tests
npm test

# 4. Run linting
npm run lint

# 5. Run type checking
npx tsc --noEmit
```

Automate this with git hooks:

```json
// package.json (using lint-staged + husky)
{
  "lint-staged": {
    "*.{ts,tsx}": ["eslint --fix", "prettier --write"],
    "*.{json,md}": ["prettier --write"]
  }
}
```

## Handling Generated Files

- **Commit generated files** only if the project expects them (e.g., `package-lock.json`, Prisma migrations)
- **Don't commit** build output (`dist/`, `.next/`), environment files (`.env`), or IDE config (`.vscode/settings.json` unless shared)
- **Have a `.gitignore`** that covers: `node_modules/`, `dist/`, `.env`, `.env.local`, `*.pem`

## Using Git for Debugging

```bash
# Find which commit introduced a bug
git bisect start
git bisect bad HEAD
git bisect good <known-good-commit>
# Git checkouts midpoints; run your test at each to narrow down

# View what changed recently
git log --oneline -20
git diff HEAD~5..HEAD -- src/

# Find who last changed a specific line
git blame src/services/task.ts

# Search commit messages for a keyword
git log --grep="validation" --oneline
```

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "I'll commit when the feature is done" | One giant commit is impossible to review, debug, or revert. Commit each slice. |
| "The message doesn't matter" | Messages are documentation. Future you (and future agents) will need to understand what changed and why. |
| "I'll squash it all later" | Squashing destroys the development narrative. Prefer clean incremental commits from the start. |
| "Branches add overhead" | Short-lived branches are free and prevent conflicting work from colliding. Long-lived branches are the problem — merge within 1-3 days. |
| "I'll split this change later" | Large changes are harder to review, riskier to deploy, and harder to revert. Split before submitting, not after. |
| "I don't need a .gitignore" | Until `.env` with production secrets gets committed. Set it up immediately. |

## Red Flags

- Large uncommitted changes accumulating
- Commit messages like "fix", "update", "misc"
- Formatting changes mixed with behavior changes
- No `.gitignore` in the project
- Committing `node_modules/`, `.env`, or build artifacts
- Long-lived branches that diverge significantly from main
- Force-pushing to shared branches

## Verification

For every commit:

- [ ] Commit does one logical thing
- [ ] Message explains the why, follows type conventions
- [ ] Tests pass before committing
- [ ] No secrets in the diff
- [ ] No formatting-only changes mixed with behavior changes
- [ ] `.gitignore` covers standard exclusions

## Package Instructions (configured)

These instructions are enabled by the runner's native package instruction system.

## Codebase Memory Package

When performing structural code queries, prefer graph-based tools over grep:

### Tool Priority

1. **`search_graph`** — find functions, classes, routes, variables by pattern
2. **`trace_path`** — trace who calls a function or what it calls (modes: calls, data_flow, cross_service)
3. **`get_code_snippet`** — read specific function/class source code
4. **`query_graph`** — run Cypher queries for complex multi-hop patterns, aggregations, and cross-service analysis

### Architecture & Discovery

- **`get_architecture`** — high-level project summary: packages, services, dependencies, and project structure
- **`search_code`** — graph-augmented grep with modes: compact (signatures only), full (with source), files (just paths)
- **`detect_changes`** — detect code changes and their impact
- **`get_graph_schema`** — get node labels and edge types for Cypher queries

### ADR Management

- **`manage_adr`** — create or update Architecture Decision Records

### Traces & Indexing

- **`ingest_traces`** — ingest runtime traces to enhance the knowledge graph
- **`index_repository`** — index a repository. Modes: full, moderate, fast, cross-repo-intelligence
- **`list_projects`** — list all indexed projects
- **`delete_project`** — delete a project from the index
- **`index_status`** — get the indexing status of a project

### Graph Schema Reference

**Node Labels:** Project, Package, Folder, File, Module, Class, Function, Method, Interface, Enum, Type, Route, Resource

**Edge Types:** CONTAINS_PACKAGE, CONTAINS_FOLDER, CONTAINS_FILE, DEFINES, DEFINES_METHOD, IMPORTS, CALLS, HTTP_CALLS, ASYNC_CALLS, IMPLEMENTS, HANDLES, USAGE, CONFIGURES, WRITES, MEMBER_OF, TESTS, USES_TYPE, FILE_CHANGES_WITH

### Codex Tool Routing

Codex does not assume automatic search interception; call the configured codebase-memory MCP tools directly.

### Fallback Order

Fall back to file search only for non-code/config files or when graph is insufficient. Use grep/glob only for string literals, error messages, config values, or non-code files.

## Context Mode Package

Context-mode tools for large-output commands, parallel execution, and think-in-code processing.

### All Tools

- **`ctx_batch_execute`** — execute multiple commands in one call, auto-index all output, and search with multiple queries. Use concurrency 4-8 for I/O-bound batches, 1 for CPU-bound.
- **`ctx_execute`** — execute code in a sandboxed subprocess. Use for API calls, test runners, git queries, and data processing.
- **`ctx_execute_file`** — read a file and process it without loading contents into context. Use for log files, data files (CSV, JSON, XML), large source files for analysis.
- **`ctx_index`** — index documentation or knowledge content into a searchable BM25 knowledge base.
- **`ctx_search`** — search indexed content. Requires prior indexing via ctx_batch_execute, ctx_index, or ctx_fetch_and_index.
- **`ctx_fetch_and_index`** — fetches URL content, converts HTML to markdown, indexes into searchable knowledge base. Batch with concurrency 4-8 for parallel fetch.
- **`ctx_stats`** — context consumption statistics for the current session.
- **`ctx_doctor`** — diagnose context-mode installation.
- **`ctx_upgrade`** — upgrade context-mode to the latest version.
- **`ctx_purge`** — permanently delete indexed content. DESTRUCTIVE — cannot be undone.

### Tool Priority

0.MEMORY → 1.GATHER → 2.FOLLOW-UP → 3.PROCESSING → 4.WEB → 5.INDEX

### Think in Code Paradigm

Write JavaScript/TypeScript that processes FILE_CONTENT and prints only the answer. Don't manually analyze output — program the analysis. Use only Node.js built-ins (fs, path, child_process). Always wrap in try/catch. Handle null/undefined. Works on both Node.js and Bun.

### Parallel I/O Batches

For I/O-bound batches (network, gh, curl, multi-repo git reads), pass concurrency 4-8. For CPU-bound (npm test, build, lint) or stateful commands (ports, locks), keep concurrency 1.

### Output Rule

Write artifacts to FILES — never inline. Output to context only via console.log.

### Session Continuity

Skills and roles persist across the session. Search memory on resume.

### Codex Command Routing

**BLOCKED:** curl/wget, Inline HTTP (fetch, requests.get, etc.), direct web fetch outside configured context-mode MCP tools

**REDIRECTED:** Bash (>20 lines) → ctx_batch_execute/ctx_execute; Read (for analysis) → ctx_execute_file; grep/search (large results) → ctx_search after indexing

### Subagent Routing

Auto-injected.

## RTK CLI Proxy Package

Token-optimized CLI proxy. Automatic via Bash hook when installed; fallback instructions for manual use.

### Installation

- **`rtk init -g`** — install global Bash hook for automatic command interception
- Codex uses explicit RTK commands; no runner-specific RTK installer flag is assumed.

### Commands

- **Git:** `rtk git status`, `rtk git log`, `rtk git diff`, `rtk git push` (compact output)
- **Tests:** `rtk npm test`, `rtk cargo test`, `rtk pytest` (failures-only mode)
- **Docker:** `rtk docker ps`, `rtk docker logs <container>` (deduplicated)
- **Files:** `rtk ls`, `rtk read <file>`, `rtk grep <pattern>` (token-optimized)

### Analytics

- **`rtk gain`** — show token savings statistics
- **`rtk discover`** — find missed opportunities for token optimization

### Hook Bypass

Runner-native file and search tools do not pass through the Bash hook; use explicit RTK shell commands when filtering is required.

Adaptive memory is provided by the runner's configured memory system. The active provider injects its tool instructions into agent prompts.

### Automatic Scoping

Memories are scoped automatically without manual prefixes:

- **User scope**: Derived from your Supermemory token/API key. No userId needed.
- **Project scope**: Derived from x-sm-project header in MCP config. No manual scoping.

Save memories as plain content. Scoping is automatic.

### When to Save (proactive)

Save immediately after: architecture/design decisions, bug fixes (include root cause), non-obvious discoveries, configuration changes, established patterns, user preferences, gotchas or edge cases.

### Save Format

- **What**: One sentence — what was done
- **Why**: What motivated it (user request, bug, performance, etc.)
- **Where**: Files or paths affected (omit if none)
- **Learned**: Gotchas and edge cases (omit if none)

### When to Search

Reactive: "remember", "recall", "what did we do", "how did we solve", or references to past work. Proactive: when starting work that may overlap with past sessions.

### Session Close

Before ending: summarize goal, instructions, discoveries, accomplished items, next steps, and relevant files.

### Authority Rule

**OPENSPEC IS OFFICIAL CONTEXT — ADAPTIVE MEMORY IS ADVISORY.**

OpenSpec artifacts and Spec Registry are ALWAYS authoritative. Adaptive memory is advisory — it must never override official specifications.

### Fail-Open

If memory operations error or tools are unavailable: continue working normally. Never block agent work or surface errors to the user for memory issues.

### Provider: Supermemory

When the configured memory provider is "supermemory", use these MCP tools:

- `memory` (action: "save", content: "...") — commit a memory
- `memory` (action: "forget", content: "...") — remove a memory
- `recall` (query: "...", includeProfile?: boolean) — retrieve relevant memories

The Supermemory MCP server exposes these tools natively. Do not call raw MCP tools directly — use the tool names shown above.

Scoping is automatic: user from token, project from x-sm-project header. No manual containerTag required.

### Decision Examples

1. **Architecture decision made**
   - *Trigger*: Team chooses Zustand over Redux for state management
   - *Suggested topic key*: architecture/state-management
   - *Example content*: **What**: Chose Zustand over Redux. **Why**: Redux boilerplate too heavy for our use case. **Where**: src/store/.

2. **User preference correction**
   - *Trigger*: User corrects naming style assumption
   - *Suggested topic key*: preference/kevin
   - *Example content*: **What**: User prefers kebab-case CSS classes. **Where**: src/components/.

3. **Non-obvious discovery**
   - *Trigger*: Subtle memory leak found in useEffect cleanup
   - *Suggested topic key*: discovery/react-hooks-cleanup
   - *Example content*: **What**: useEffect without cleanup retains stale closures. **Where**: src/hooks/useAudioPlayer.ts.

4. **Bug fix with root cause**
   - *Trigger*: Fixed N+1 query in UserList
   - *Suggested topic key*: bugfix/n-plus-one-user-list
   - *Example content*: **What**: Fixed by eager-loading organization. **Where**: src/models/User.ts.

5. **Session-close summary**
   - *Trigger*: Ending session after implementation work
   - *Suggested topic key*: session/2026-05-23-deck-refactor
   - *Example content*: **Goal**: Refactor skills for parallel execution. **Accomplished**: Tasks 1-2.

### Suggested Topic Keys

| Work Type | Topic Key Pattern | Example |
|---|---|---|
| Architecture | architecture/<component-name> | architecture/auth-model |
| Bugfix | bugfix/<issue-description> | bugfix/null-pointer-list |
| Performance | performance/<area> | performance/user-list-query |
| Config | config/<what-changed> | config/database-url |
| Preference | preference/<user-name> | preference/kevin |
| Pattern | pattern/<pattern-name> | pattern/naming-convention |
| Discovery | discovery/<what-found> | discovery/react-hooks-cleanup |
| Session | session/<date>- <context> | session/2026-05-23-deck-refactor |
| Team | team/<topic> | team/onboarding-docs |
| Security | security/<concern> | security/api-key-storage |

### Save Trigger Matrix

| Lifecycle Moment | Save Action | Topic Key | Content Focus |
|---|---|---|---|
| Architecture decision made | Save immediately | architecture/<component> | What was decided, why |
| Bug fix completed | Save immediately | bugfix/<issue> | What was fixed, root cause |
| User preference learned | Save immediately | preference/<user> | What the preference is |
| Session close | Save before ending | session/<date>- <context> | Goal, discoveries, next steps |
| Non-obvious discovery | Save immediately | discovery/<what-found> | What was found, context |
| Configuration change | Save immediately | config/<what-changed> | What changed, why |
| Pattern established | Save immediately | pattern/<pattern-name> | What pattern, where |

### Provider: Engram

When the configured memory provider is "engram", use Engram's documented tool interface. The Engram adapter injects its specific instructions; follow those instead of these generic ones.
