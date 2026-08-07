---
name: shipping-and-launch
description: Prepares production launches. Use when preparing to deploy to production. Use when you need a pre-launch checklist, when setting up monitoring, when planning a staged rollout, or when you need a rollback strategy.
---

# Shipping and Launch

## Overview

Ship with confidence. The goal is not just to deploy — it's to deploy safely, with monitoring in place, a rollback plan ready, and a clear understanding of what success looks like. Every launch should be reversible, observable, and incremental.

## When to Use

- Deploying a feature to production for the first time
- Releasing a significant change to users
- Migrating data or infrastructure
- Opening a beta or early access program
- Any deployment that carries risk (all of them)

## The Pre-Launch Checklist

### Code Quality

- [ ] All tests pass (unit, integration, e2e)
- [ ] Build succeeds with no warnings
- [ ] Lint and type checking pass
- [ ] Code reviewed and approved
- [ ] No TODO comments that should be resolved before launch
- [ ] No `console.log` debugging statements in production code
- [ ] Error handling covers expected failure modes

### Security

- [ ] No secrets in code or version control
- [ ] `npm audit` shows no critical or high vulnerabilities
- [ ] Input validation on all user-facing endpoints
- [ ] Authentication and authorization checks in place
- [ ] Security headers configured (CSP, HSTS, etc.)
- [ ] Rate limiting on authentication endpoints
- [ ] CORS configured to specific origins (not wildcard)

### Performance

- [ ] Core Web Vitals within "Good" thresholds
- [ ] No N+1 queries in critical paths
- [ ] Images optimized (compression, responsive sizes, lazy loading)
- [ ] Bundle size within budget
- [ ] Database queries have appropriate indexes
- [ ] Caching configured for static assets and repeated queries

### Accessibility

- [ ] Keyboard navigation works for all interactive elements
- [ ] Screen reader can convey page content and structure
- [ ] Color contrast meets WCAG 2.1 AA (4.5:1 for text)
- [ ] Focus management correct for modals and dynamic content
- [ ] Error messages are descriptive and associated with form fields
- [ ] No accessibility warnings in axe-core or Lighthouse

### Infrastructure

- [ ] Environment variables set in production
- [ ] Database migrations applied (or ready to apply)
- [ ] DNS and SSL configured
- [ ] CDN configured for static assets
- [ ] Logging and error reporting configured
- [ ] Health check endpoint exists and responds

### Documentation

- [ ] README updated with any new setup requirements
- [ ] API documentation current
- [ ] ADRs written for any architectural decisions
- [ ] Changelog updated
- [ ] User-facing documentation updated (if applicable)

## Feature Flag Strategy

Ship behind feature flags to decouple deployment from release:

```typescript
// Feature flag check
const flags = await getFeatureFlags(userId);

if (flags.taskSharing) {
  // New feature: task sharing
  return <TaskSharingPanel task={task} />;
}

// Default: existing behavior
return null;
```

**Feature flag lifecycle:**

```
1. DEPLOY with flag OFF     → Code is in production but inactive
2. ENABLE for team/beta     → Internal testing in production environment
3. GRADUAL ROLLOUT          → 5% → 25% → 50% → 100% of users
4. MONITOR at each stage    → Watch error rates, performance, user feedback
5. CLEAN UP                 → Remove flag and dead code path after full rollout
```

**Rules:**
- Every feature flag has an owner and an expiration date
- Clean up flags within 2 weeks of full rollout
- Don't nest feature flags (creates exponential combinations)
- Test both flag states (on and off) in CI

## Staged Rollout

### The Rollout Sequence

```
1. DEPLOY to staging
   └── Full test suite in staging environment
   └── Manual smoke test of critical flows

2. DEPLOY to production (feature flag OFF)
   └── Verify deployment succeeded (health check)
   └── Check error monitoring (no new errors)

3. ENABLE for team (flag ON for internal users)
   └── Team uses the feature in production
   └── 24-hour monitoring window

4. CANARY rollout (flag ON for 5% of users)
   └── Monitor error rates, latency, user behavior
   └── Compare metrics: canary vs. baseline
   └── 24-48 hour monitoring window
   └── Advance only if all thresholds pass (see table below)

5. GRADUAL increase (25% -> 50% -> 100%)
   └── Same monitoring at each step
   └── Ability to roll back to previous percentage at any point

6. FULL rollout (flag ON for all users)
   └── Monitor for 1 week
   └── Clean up feature flag
```

### Rollout Decision Thresholds

Use these thresholds to decide whether to advance, hold, or roll back at each stage:

| Metric | Advance (green) | Hold and investigate (yellow) | Roll back (red) |
|--------|-----------------|-------------------------------|-----------------|
| Error rate | Within 10% of baseline | 10-100% above baseline | >2x baseline |
| P95 latency | Within 20% of baseline | 20-50% above baseline | >50% above baseline |
| Client JS errors | No new error types | New errors at <0.1% of sessions | New errors at >0.1% of sessions |
| Business metrics | Neutral or positive | Decline <5% (may be noise) | Decline >5% |

### When to Roll Back

Roll back immediately if:
- Error rate increases by more than 2x baseline
- P95 latency increases by more than 50%
- User-reported issues spike
- Data integrity issues detected
- Security vulnerability discovered

## Monitoring and Observability

### What to Monitor

```
Application metrics:
├── Error rate (total and by endpoint)
├── Response time (p50, p95, p99)
├── Request volume
├── Active users
└── Key business metrics (conversion, engagement)

Infrastructure metrics:
├── CPU and memory utilization
├── Database connection pool usage
├── Disk space
├── Network latency
└── Queue depth (if applicable)

Client metrics:
├── Core Web Vitals (LCP, INP, CLS)
├── JavaScript errors
├── API error rates from client perspective
└── Page load time
```

### Error Reporting

```typescript
// Set up error boundary with reporting
class ErrorBoundary extends React.Component {
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Report to error tracking service
    reportError(error, {
      componentStack: info.componentStack,
      userId: getCurrentUser()?.id,
      page: window.location.pathname,
    });
  }

  render() {
    if (this.state.hasError) {
      return <ErrorFallback onRetry={() => this.setState({ hasError: false })} />;
    }
    return this.props.children;
  }
}

// Server-side error reporting
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  reportError(err, {
    method: req.method,
    url: req.url,
    userId: req.user?.id,
  });

  // Don't expose internals to users
  res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' },
  });
});
```

### Post-Launch Verification

In the first hour after launch:

```
1. Check health endpoint returns 200
2. Check error monitoring dashboard (no new error types)
3. Check latency dashboard (no regression)
4. Test the critical user flow manually
5. Verify logs are flowing and readable
6. Confirm rollback mechanism works (dry run if possible)
```

## Rollback Strategy

Every deployment needs a rollback plan before it happens:

```markdown
## Rollback Plan for [Feature/Release]

### Trigger Conditions
- Error rate > 2x baseline
- P95 latency > [X]ms
- User reports of [specific issue]

### Rollback Steps
1. Disable feature flag (if applicable)
   OR
1. Deploy previous version: `git revert <commit> && git push`
2. Verify rollback: health check, error monitoring
3. Communicate: notify team of rollback

### Database Considerations
- Migration [X] has a rollback: `npx prisma migrate rollback`
- Data inserted by new feature: [preserved / cleaned up]

### Time to Rollback
- Feature flag: < 1 minute
- Redeploy previous version: < 5 minutes
- Database rollback: < 15 minutes
```
## See Also

- For security pre-launch checks, see `references/security-checklist.md`
- For performance pre-launch checklist, see `references/performance-checklist.md`
- For accessibility verification before launch, see `references/accessibility-checklist.md`

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "It works in staging, it'll work in production" | Production has different data, traffic patterns, and edge cases. Monitor after deploy. |
| "We don't need feature flags for this" | Every feature benefits from a kill switch. Even "simple" changes can break things. |
| "Monitoring is overhead" | Not having monitoring means you discover problems from user complaints instead of dashboards. |
| "We'll add monitoring later" | Add it before launch. You can't debug what you can't see. |
| "Rolling back is admitting failure" | Rolling back is responsible engineering. Shipping a broken feature is the failure. |

## Red Flags

- Deploying without a rollback plan
- No monitoring or error reporting in production
- Big-bang releases (everything at once, no staging)
- Feature flags with no expiration or owner
- No one monitoring the deploy for the first hour
- Production environment configuration done by memory, not code
- "It's Friday afternoon, let's ship it"

## Verification

Before deploying:

- [ ] Pre-launch checklist completed (all sections green)
- [ ] Feature flag configured (if applicable)
- [ ] Rollback plan documented
- [ ] Monitoring dashboards set up
- [ ] Team notified of deployment

After deploying:

- [ ] Health check returns 200
- [ ] Error rate is normal
- [ ] Latency is normal
- [ ] Critical user flow works
- [ ] Logs are flowing
- [ ] Rollback tested or verified ready

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
