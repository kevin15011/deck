# Supermemory MCP Validation Report

## Scope

Task 1 validation for `add-supermemory-mcp-memory-provider`: identify real Supermemory MCP tool names, parameters, authentication behavior, connectivity/health behavior, metadata filter support, and container behavior before downstream adapter work relies on provisional names.

## Environment

- Date: 2026-05-19
- Official SDK package checked: `supermemory` (`npm view supermemory`), version observed `4.21.1`.
- Official MCP endpoint advertised by the SDK README and validated at runtime: `https://supermemory-new.stlmcp.com` with MCP client name `supermemory-mcp`.
- Server initialized successfully over streamable HTTP and reported:
  - `serverInfo.name`: `supermemory_api`
  - `serverInfo.version`: `4.24.0`
  - `protocolVersion`: `2025-06-18`
  - `capabilities`: `tools`, `logging`
- Pi global MCP config validation completed for `~/.pi/agent/mcp.json`:
  - File exists, is valid JSON, and has restrictive `0600` permissions.
  - `mcpServers.supermemory` exists.
  - Configured URL is `https://supermemory-new.stlmcp.com`.
  - Header `x-supermemory-api-key` is present and non-empty.
  - The token/header value was not printed, copied into this report, or persisted in repository files.
- Project Deck config validation completed for `.deck/config.json`:
  - Active provider is `supermemory`.
  - No secret-like keys are present.
  - No Supermemory API key/token is stored in Deck config.

## Validated MCP Transport and Tools

The real remote Supermemory MCP server does **not** expose provider-specific tools named `context`, `recall`, or `memory`.

Validated `tools/list` result:

| MCP tool | Required parameters | Optional parameters | Purpose |
|---|---|---|---|
| `execute` | `code` | `intent` | Runs TypeScript/JavaScript against an initialized Supermemory SDK client. This is the operational API bridge. |
| `search_docs` | `query`, `language` | `detail` | Searches SDK documentation. `language` enum: `http`, `python`, `go`, `typescript`, `javascript`, `terraform`, `ruby`, `java`, `kotlin`. `detail` enum: `default`, `verbose`. |

### `execute` input schema

```json
{
  "type": "object",
  "properties": {
    "code": { "type": "string" },
    "intent": { "type": "string" }
  },
  "required": ["code"]
}
```

The `execute` tool requires code defining `async function run(client) { ... }`; the MCP server injects an initialized Supermemory SDK client into that function.

## Authentication and Credential Behavior

Validated behavior:

- The MCP install config advertised by the official SDK README uses HTTP transport and header `x-supermemory-api-key`.
- `initialize` and `tools/list` succeeded without an API key, so they verify MCP server connectivity but not provider availability.
- Calling `execute` without a key failed before API execution with:
  - `Failed to initialize client: The SUPERMEMORY_API_KEY environment variable is missing or empty; either provide it, or instantiate the Supermemory client with an apiKey option, like new Supermemory({ apiKey: 'My API Key' }).`
- Calling `execute` with a deliberately invalid placeholder header value initialized the client but the API request failed with:
  - `Error: 401 {"error":"Unauthorized"}`
- Calling `initialize` with the configured Pi MCP header returned HTTP 200 and an MCP session id.
- Calling `tools/list` with the configured Pi MCP header returned HTTP 200 and the validated tools `execute` and `search_docs`.
- Calling `execute` with the configured Pi MCP header completed an authenticated read-only probe using:

```ts
async function run(client) {
  return await client.search.memories({
    q: 'deck health check',
    containerTag: 'u:kevin',
    limit: 1,
    searchMode: 'memories'
  });
}
```

Implications:

- Deck/Pi must configure the Supermemory MCP connection with `x-supermemory-api-key` or an equivalent MCP-client secret mechanism that results in `SUPERMEMORY_API_KEY` for the server-side SDK client.
- `.deck/config.json` must not contain the token.
- Runtime health must include both MCP connectivity and an authenticated no-write API probe; connectivity alone is insufficient.
- Task 1 authenticated read-only runtime validation is complete for the configured local Pi MCP credential path without exposing the credential.

## Connectivity / Health Check Method

Validated connectivity and availability checks:

1. `POST /` JSON-RPC `initialize` with `Accept: application/json, text/event-stream` returns server info and an `mcp-session-id`.
2. `POST /` JSON-RPC `tools/list` with the session id returns the validated tool list.
3. `POST /` JSON-RPC `tools/call` for `execute` succeeds for a read-only `client.search.memories` probe when the configured `x-supermemory-api-key` header is present.

Recommended provider availability check after credentials are configured:

1. Initialize MCP session.
2. List tools and require `execute` to exist.
3. Call `execute` with a read-only, low-impact SDK operation using the configured scope, for example:

```ts
async function run(client) {
  return await client.search.memories({
    q: 'deck health check',
    containerTag: '<scoped container tag>',
    limit: 1,
    searchMode: 'memories'
  });
}
```

This authenticated read-only probe was completed successfully for the configured local Pi MCP credential path using container tag `u:kevin`.

## Advertised Supermemory SDK Operations Through `execute`

The MCP server instructions advertise using the injected SDK client for these operations:

- Add document: `client.add({ content, containerTag })`
- Search documents: `client.search.documents({ q, containerTag, limit, rerank, filters })`
- Search memories: `client.search.memories({ q, containerTag, searchMode, limit, filters })`
- List documents: `client.documents.list({ page, limit, sort, order, filters })`
- Get/delete document: `client.documents.get(id)`, `client.documents.delete(id)`
- Batch add documents: `client.documents.batchAdd({ documents, containerTag })`
- Upload file: `client.documents.uploadFile({ file, containerTag, mimeType })`
- Update memory: `client.memories.updateMemory({ containerTag, id, newContent })`
- Forget memory: `client.memories.forget({ containerTag, id })`
- Get user profile: `client.profile({ containerTag, q })`

These operations are invoked through the single MCP `execute` tool, not through separate MCP tools.

## Metadata Filter Behavior

The MCP server instructions advertise metadata filters on:

- `documents.list`
- `search.documents`
- `search.memories`

Advertised filter shape:

```ts
filters: {
  AND: [
    { key: 'author', value: 'Alice', filterType: 'metadata' },
    { key: 'score', value: '80', numericOperator: '>', filterType: 'numeric' }
  ]
}
```

Advertised filter fields:

- `key`: metadata key
- `value`: metadata/numeric/array target value
- `filterType`: `metadata` | `numeric` | `array_contains`
- `numericOperator`: supported for numeric filters (example: `>`)
- `negate`: optional boolean to invert the filter
- Boolean composition shown: `AND`; instructions describe `AND/OR`, but exact `OR` shape was not validated.

Remaining validation gap: authenticated metadata filter execution, exact `OR` shape, supported numeric operators, and behavior for Deck-specific metadata fields were not exercised by the read-only Task 1 health probe.

## Container Behavior

The MCP server instructions advertise `containerTag` as the scoping mechanism for Supermemory API operations:

- `client.add({ content, containerTag })`
- `client.search.documents({ q, containerTag, ... })`
- `client.search.memories({ q, containerTag, ... })`
- `client.documents.batchAdd({ documents, containerTag })`
- `client.documents.uploadFile({ file, containerTag, ... })`
- `client.memories.updateMemory({ containerTag, id, newContent })`
- `client.memories.forget({ containerTag, id })`
- `client.profile({ containerTag, q })`

The authenticated read-only probe successfully used `containerTag: 'u:kevin'` with `client.search.memories`. No server-side container-tag length or character constraints were exposed by MCP validation. Deck should enforce its own governance policy (`<=100` chars and `[A-Za-z0-9_:-]`) before passing tags to Supermemory.

Remaining validation gap: creating/searching controlled test memories across multiple scoped containers and confirming container isolation were not performed as part of the read-only Task 1 probe.

## Deviations From PRD Assumptions

| PRD/provisional assumption | Validated result | Impact |
|---|---|---|
| MCP tools named `context`, `recall`, and `memory` | Not present in `tools/list` | Adapter must not bind to these names. |
| Provider-specific MCP tools for context/search/write | Single generic `execute` tool plus `search_docs` | Adapter instructions/tool bindings must use `execute` and generate SDK-client code snippets. |
| Health can be a simple MCP server check | `initialize`/`tools/list` work without auth; API availability requires authenticated `execute` | Health diagnostics need separate MCP connectivity and credential/API probe states. |
| Metadata/container support can be assumed from PRD | MCP instructions advertise filters and `containerTag`; authenticated read-only `search.memories` with a scoped container tag succeeded | Task 8 can rely on `execute` plus scoped read-only health checks, but should keep advanced metadata/filter/container-isolation behavior guarded by diagnostics until separately validated. |

## Remaining Follow-Up Validation Items

Task 1 authenticated runtime validation is complete for the configured local Pi MCP credential path. The following deeper behavioral checks remain outside this read-only validation pass and should only be run with approved test-only content/scopes:

- Actual metadata filter execution, especially `OR` shape and Deck-specific fields.
- Real `containerTag` isolation behavior across test containers.
- Safe write/update/forget behavior using test-only content in a test-only container.

No Supermemory token was printed or persisted in this report, OpenSpec artifacts, project files, or `.deck/config.json`.
