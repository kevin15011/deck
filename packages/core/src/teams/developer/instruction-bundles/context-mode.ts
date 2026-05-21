import type {
  CapabilityInstructionBundle,
  CapabilityInstructionFragment,
} from "./index";

/**
 * Canonical instruction content for the context-mode package.
 *
 * Source: https://github.com/mksglu/context-mode (configs/claude-code/CLAUDE.md)
 *
 * Context mode tools for large-output commands, parallel execution,
 * and think-in-code processing.
 */
export function buildContextModeInstructionBundle(): CapabilityInstructionBundle {
  const fragments: CapabilityInstructionFragment[] = [
    {
      packageId: "context-mode",
      surface: "agent",
      markdown: `## Context Mode Package

Context-mode tools for large-output commands, parallel execution, and think-in-code processing.

### All Tools

- **\`ctx_batch_execute\`** — execute multiple commands in one call, auto-index all output, and search with multiple queries. Returns search results directly — no follow-up calls needed. Use concurrency 4-8 for I/O-bound batches (network, gh, curl, multi-repo git reads). Keep concurrency 1 for CPU-bound work (npm test, build, lint).
- **\`ctx_execute\`** — execute code in a sandboxed subprocess. Use for API calls (gh, curl, aws), test runners (npm test, pytest), git queries (git log, git diff), data processing, and any CLI command that may produce large output.
- **\`ctx_execute_file\`** — read a file and process it without loading contents into context. Use for log files, data files (CSV, JSON, XML), large source files for analysis, and any file where you need to extract specific information rather than read the entire content.
- **\`ctx_index\`** — index documentation or knowledge content into a searchable BM25 knowledge base. Chunks markdown by headings (keeping code blocks intact) and stores in ephemeral FTS5 database.
- **\`ctx_search\`** — search indexed content. Requires prior indexing via ctx_batch_execute, ctx_index, or ctx_fetch_and_index. Pass ALL search questions as queries array in ONE call. File-backed sources are auto-refreshed when the source file changes.
- **\`ctx_fetch_and_index\`** — fetches URL content, converts HTML to markdown, indexes into searchable knowledge base, and returns a ~3KB preview. Batch shape: array of {url, source?} entries. Use concurrency 4-8 for parallel fetch. Content-type aware: HTML is converted to markdown, JSON is chunked by key paths, plain text is indexed directly.
- **\`ctx_stats\`** — returns context consumption statistics for the current session. Shows total bytes returned to context, breakdown by tool, call counts, estimated token usage, and context savings ratio.
- **\`ctx_doctor\`** — diagnose context-mode installation. Runs all checks server-side and returns a plain-text status report with [OK]/[FAIL]/[WARN] prefixes.
- **\`ctx_upgrade\`** — upgrade context-mode to the latest version. Returns a shell command to execute.
- **\`ctx_purge\`** — permanently delete indexed content. DESTRUCTIVE — cannot be undone. Scope: sessionId (deletes only that session's events + per-session FTS5 chunks) or scope: "project" (wipes the entire project: FTS5 knowledge base, every session DB row, events markdown, AND resets the stats file).

### Tool Priority

0.MEMORY → 1.GATHER → 2.FOLLOW-UP → 3.PROCESSING → 4.WEB → 5.INDEX

### Think in Code Paradigm

When you need to analyze, count, filter, compare, or process data — write code that does the work and console.log() only the answer. Do NOT read raw data into context to process mentally. Program the analysis, don't compute it in your reasoning. Write robust, pure JavaScript (no npm dependencies). Use only Node.js built-ins (fs, path, child_process). Always wrap in try/catch. Handle null/undefined. Works on both Node.js and Bun.

### Parallel I/O Batches

For I/O-bound batches (network calls, slow API queries, multi-URL fetches), ALWAYS pass concurrency 4-8 — speeds up by 3-5x on real workloads. Use concurrency 4-8 for: gh API calls, curl/web fetches, multi-region cloud queries, multi-repo git reads, dig/DNS, docker inspect. Keep concurrency 1 for: npm test, build, lint, image processing (CPU-bound), or commands sharing state (ports, lock files, same-repo writes).

### Output Rule

Write artifacts to FILES — never inline. Output to context only via console.log.

### Session Continuity

Skills, roles, or decisions set earlier in conversation are still active. Do not discard or contradict them. Search memory on resume.

### Claude Code Hook Commands

**BLOCKED commands (never run):**
- curl/wget
- Inline HTTP (fetch, requests.get, etc.)
- WebFetch

**REDIRECTED commands:**
- Bash (>20 lines output) → use ctx_batch_execute or ctx_execute
- Read (for analysis) → use ctx_execute_file for large files
- grep/search (large results) → use ctx_search after indexing

### Subagent Routing

Auto-injected.`,
    },
    {
      packageId: "context-mode",
      surface: "skill",
      markdown: `## Context Mode Package

Context-mode tools for large-output commands, parallel execution, and think-in-code processing.

### All Tools

- **\`ctx_batch_execute\`** — execute multiple commands in one call, auto-index all output, and search with multiple queries. Use concurrency 4-8 for I/O-bound batches, 1 for CPU-bound.
- **\`ctx_execute\`** — execute code in a sandboxed subprocess. Use for API calls, test runners, git queries, and data processing.
- **\`ctx_execute_file\`** — read a file and process it without loading contents into context. Use for log files, data files (CSV, JSON, XML), large source files for analysis.
- **\`ctx_index\`** — index documentation or knowledge content into a searchable BM25 knowledge base.
- **\`ctx_search\`** — search indexed content. Requires prior indexing via ctx_batch_execute, ctx_index, or ctx_fetch_and_index.
- **\`ctx_fetch_and_index\`** — fetches URL content, converts HTML to markdown, indexes into searchable knowledge base. Batch with concurrency 4-8 for parallel fetch.
- **\`ctx_stats\`** — context consumption statistics for the current session.
- **\`ctx_doctor\`** — diagnose context-mode installation.
- **\`ctx_upgrade\`** — upgrade context-mode to the latest version.
- **\`ctx_purge\`** — permanently delete indexed content. DESTRUCTIVE — cannot be undone.

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

### Claude Code Hook Commands

**BLOCKED:** curl/wget, Inline HTTP (fetch, requests.get, etc.), WebFetch

**REDIRECTED:** Bash (>20 lines) → ctx_batch_execute/ctx_execute; Read (for analysis) → ctx_execute_file; grep/search (large results) → ctx_search after indexing

### Subagent Routing

Auto-injected.`,
    },
  ];

  return { instructions: Object.freeze(fragments) };
}