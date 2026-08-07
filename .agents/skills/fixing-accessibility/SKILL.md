---
name: fixing-accessibility
description: Audit and fix HTML accessibility issues including ARIA labels, keyboard navigation, focus management, color contrast, and form errors. Use when adding interactive controls, forms, dialogs, or reviewing WCAG compliance.
---

# fixing-accessibility

Fix accessibility issues.

## how to use

- `/fixing-accessibility`
  Apply these constraints to any UI work in this conversation.

- `/fixing-accessibility <file>`
  Review the file against all rules below and report:
  - violations (quote the exact line or snippet)
  - why it matters (one short sentence)
  - a concrete fix (code-level suggestion)

Do not rewrite large parts of the UI. Prefer minimal, targeted fixes.

## when to apply

Reference these guidelines when:
- adding or changing buttons, links, inputs, menus, dialogs, tabs, dropdowns
- building forms, validation, error states, helper text
- implementing keyboard shortcuts or custom interactions
- working on focus states, focus trapping, or modal behavior
- rendering icon-only controls
- adding hover-only interactions or hidden content

## rule categories by priority

| priority | category | impact |
|----------|----------|--------|
| 1 | accessible names | critical |
| 2 | keyboard access | critical |
| 3 | focus and dialogs | critical |
| 4 | semantics | high |
| 5 | forms and errors | high |
| 6 | announcements | medium-high |
| 7 | contrast and states | medium |
| 8 | media and motion | low-medium |
| 9 | tool boundaries | critical |

## quick reference

### 1. accessible names (critical)

- every interactive control must have an accessible name
- icon-only buttons must have aria-label or aria-labelledby
- every input, select, and textarea must be labeled
- links must have meaningful text (no “click here”)
- decorative icons must be aria-hidden

### 2. keyboard access (critical)

- do not use div or span as buttons without full keyboard support
- all interactive elements must be reachable by Tab
- focus must be visible for keyboard users
- do not use tabindex greater than 0
- Escape must close dialogs or overlays when applicable

### 3. focus and dialogs (critical)

- modals must trap focus while open
- restore focus to the trigger on close
- set initial focus inside dialogs
- opening a dialog should not scroll the page unexpectedly

### 4. semantics (high)

- prefer native elements (button, a, input) over role-based hacks
- if a role is used, required aria attributes must be present
- lists must use ul or ol with li
- do not skip heading levels
- tables must use th for headers when applicable

### 5. forms and errors (high)

- errors must be linked to fields using aria-describedby
- required fields must be announced
- invalid fields must set aria-invalid
- helper text must be associated with inputs
- disabled submit actions must explain why

### 6. announcements (medium-high)

- critical form errors should use aria-live
- loading states should use aria-busy or status text
- toasts must not be the only way to convey critical information
- expandable controls must use aria-expanded and aria-controls

### 7. contrast and states (medium)

- ensure sufficient contrast for text and icons
- hover-only interactions must have keyboard equivalents
- disabled states must not rely on color alone
- do not remove focus outlines without a visible replacement

### 8. media and motion (low-medium)

- images must have correct alt text (meaningful or empty)
- videos with speech should provide captions when relevant
- respect prefers-reduced-motion for non-essential motion
- avoid autoplaying media with sound

### 9. tool boundaries (critical)

- prefer minimal changes, do not refactor unrelated code
- do not add aria when native semantics already solve the problem
- do not migrate UI libraries unless requested

## common fixes

```html
<!-- icon-only button: add aria-label -->
<!-- before --> <button><svg>...</svg></button>
<!-- after -->  <button aria-label="Close"><svg aria-hidden="true">...</svg></button>

<!-- div as button: use native element -->
<!-- before --> <div onclick="save()">Save</div>
<!-- after -->  <button onclick="save()">Save</button>

<!-- form error: link with aria-describedby -->
<!-- before --> <input id="email" /> <span>Invalid email</span>
<!-- after -->  <input id="email" aria-describedby="email-err" aria-invalid="true" /> <span id="email-err">Invalid email</span>
```

## review guidance

- fix critical issues first (names, keyboard, focus, tool boundaries)
- prefer native HTML before adding aria
- quote the exact snippet, state the failure, propose a small fix
- for complex widgets (menu, dialog, combobox), prefer established accessible primitives over custom behavior

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
