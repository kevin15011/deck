import type {
  CapabilityInstructionBundle,
  CapabilityInstructionFragment,
} from "./index";

/**
 * Canonical instruction content for the codebase-memory package.
 *
 * Sources:
 * - https://github.com/DeusData/codebase-memory-mcp
 * - Claude Code hook intercepts Grep/Glob and injects search_graph results as additionalContext
 *
 * Provides 14 MCP tools for structural code discovery and graph-augmented search.
 */
export function buildCodebaseMemoryInstructionBundle(): CapabilityInstructionBundle {
  const fragments: CapabilityInstructionFragment[] = [
    {
      packageId: "codebase-memory",
      surface: "agent",
      markdown: `## Codebase Memory Package

Use the codebase knowledge graph for structural code queries. Triggers on: explore the codebase, understand the architecture, what functions exist, show me the structure, who calls this function, what does X call, trace the call chain, find callers of, show dependencies, impact analysis, dead code, unused functions, high fan-out, refactor candidates, code quality audit, graph query syntax, Cypher query examples, edge types, how to use search_graph.

### Tool Priority Order

1. **\`search_graph\`** — find functions, classes, routes, variables by pattern
2. **\`trace_path\`** — trace who calls a function or what it calls
3. **\`get_code_snippet\`** — read specific function/class source code
4. **\`query_graph\`** — run Cypher queries for complex multi-hop patterns

### Additional Tools

- **\`get_architecture\`** — high-level project summary: packages, services, dependencies, and project structure
- **\`search_code\`** — graph-augmented code search. Finds text patterns via grep, then enriches results with the knowledge graph: deduplicates matches into containing functions, ranks by structural importance (definitions first, popular functions next, tests last). Modes: compact (default, signatures only — token efficient), full (with source), files (just file paths). Use path_filter regex to scope results.
- **\`detect_changes\`** — detect code changes and their impact
- **\`get_graph_schema\`** — get the schema of the knowledge graph (node labels, edge types)
- **\`manage_adr\`** — create or update Architecture Decision Records
- **\`ingest_traces\`** — ingest runtime traces to enhance the knowledge graph
- **\`index_repository\`** — index a repository into the knowledge graph. Special mode 'cross-repo-intelligence': skip extraction, only match Routes/Channels across projects to create CROSS_HTTP_CALLS/CROSS_ASYNC_CALLS/CROSS_CHANNEL edges.
- **\`list_projects\`** — list all indexed projects
- **\`delete_project\`** — delete a project from the index
- **\`index_status\`** — get the indexing status of a project

### Claude Code Hook Behavior

Claude Code hook intercepts \`Grep\`/\`Glob\` calls and injects \`search_graph\` results as \`additionalContext\`.

### Graph Node Labels

Project, Package, Folder, File, Module, Class, Function, Method, Interface, Enum, Type, Route, Resource

### Graph Edge Types

CONTAINS_PACKAGE, CONTAINS_FOLDER, CONTAINS_FILE, DEFINES, DEFINES_METHOD, IMPORTS, CALLS, HTTP_CALLS, ASYNC_CALLS, IMPLEMENTS, HANDLES, USAGE, CONFIGURES, WRITES, MEMBER_OF, TESTS, USES_TYPE, FILE_CHANGES_WITH

### Fallback

Use grep/glob/file-search only for non-code files (Dockerfiles, shell scripts, configs) or when graph results are insufficient. Prefer MCP graph tools over grep/glob for code discovery.`,
    },
    {
      packageId: "codebase-memory",
      surface: "skill",
      markdown: `## Codebase Memory Package

When performing structural code queries, prefer graph-based tools over grep:

### Tool Priority

1. **\`search_graph\`** — find functions, classes, routes, variables by pattern
2. **\`trace_path\`** — trace who calls a function or what it calls (modes: calls, data_flow, cross_service)
3. **\`get_code_snippet\`** — read specific function/class source code
4. **\`query_graph\`** — run Cypher queries for complex multi-hop patterns, aggregations, and cross-service analysis

### Architecture & Discovery

- **\`get_architecture\`** — high-level project summary: packages, services, dependencies, and project structure
- **\`search_code\`** — graph-augmented grep with modes: compact (signatures only), full (with source), files (just paths)
- **\`detect_changes\`** — detect code changes and their impact
- **\`get_graph_schema\`** — get node labels and edge types for Cypher queries

### ADR Management

- **\`manage_adr\`** — create or update Architecture Decision Records

### Traces & Indexing

- **\`ingest_traces\`** — ingest runtime traces to enhance the knowledge graph
- **\`index_repository\`** — index a repository. Modes: full, moderate, fast, cross-repo-intelligence
- **\`list_projects\`** — list all indexed projects
- **\`delete_project\`** — delete a project from the index
- **\`index_status\`** — get the indexing status of a project

### Graph Schema Reference

**Node Labels:** Project, Package, Folder, File, Module, Class, Function, Method, Interface, Enum, Type, Route, Resource

**Edge Types:** CONTAINS_PACKAGE, CONTAINS_FOLDER, CONTAINS_FILE, DEFINES, DEFINES_METHOD, IMPORTS, CALLS, HTTP_CALLS, ASYNC_CALLS, IMPLEMENTS, HANDLES, USAGE, CONFIGURES, WRITES, MEMBER_OF, TESTS, USES_TYPE, FILE_CHANGES_WITH

### Claude Code Hook

Claude Code hook intercepts \`Grep\`/\`Glob\` and injects \`search_graph\` results as additionalContext.

### Fallback Order

Fall back to file search only for non-code/config files or when graph is insufficient. Use grep/glob only for string literals, error messages, config values, or non-code files.`,
    },
  ];

  return { instructions: Object.freeze(fragments) };
}