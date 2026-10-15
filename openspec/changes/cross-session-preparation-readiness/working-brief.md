# Repair cross-session preparation readiness

## Intent and acceptance

Prepare the user's existing Claude cross session successfully without sending a model prompt, weakening native executable verification, or editing SSH/credential settings. Preserve diagnostic causes safely so preparation failures are actionable.

User clarification: sessions in projects without Git identity must also work. The user explicitly selected the account-global untagged mode over a shared named `default` container. Do not send an invented repository identity. Failures of secret stores or unsafe overrides must not be masked as missing Git identity.

## Evidence and decisions

- Live session `20261015T203210-f1052c` failed in `preparing-tools` with generic `preparation-tools-failed`.
- Claude's ordinary tool resolver selects global Codebase Memory 0.10.8, while managed cross readiness verifies pinned 0.11.0 bytes and protocol. The selected global binary fails the size/digest gate before spawn. An owned 0.11.0 artifact already exists. Prefer the verified owned native artifact at the cross-session seam; retain integrity gates and ordinary static-runner behavior.
- Native memory independently reports `native-memory-scope-unavailable`. The trusted SSH alias config maps `HostName ssh.github.com` with `HostKeyAlias github.com`; the canonical parser rejects the latter. Installed OpenSSH ssh_config(5) documents its host-key lookup namespace semantics. Allow only the complete literal canonical namespace `github.com`, case insensitive, while preserving independent hostname and file trust checks. Arbitrary aliases remain rejected.
- Preparation currently discards known tools and memory reason codes. Preserve only explicit bounded known codes; unknown errors and secrets retain generic fallbacks.
- Graph project deck generation 2026-08-20T17:25:00Z is stale/untracked for this area; targeted current source and hermetic tests are authoritative evidence.

## Global-mode design and acceptance

Pinned Claude, Codex and OpenCode plugins generate path-based container tags when the environment override is absent. Claude hosted MCP omission also selects activeSpace. Therefore omission alone is insufficient. Keep canonical sessions unchanged and introduce an explicit global descriptor for safely established identity absence (ordinary non-Git directory or verified Git repository without origin); malformed/unsafe identity stays invalid.

For global mode, use the explicit default protected credential and a session-owned loopback transport. Bind 127.0.0.1 at an ephemeral port with a random path and ephemeral child bearer. Keep the real key in the host. Forward only reviewed API paths to a fixed HTTPS upstream without redirects; bound bodies, responses, concurrency and timeouts. Remove protocol-level container selectors and the known generated `metadata.originalContainerTags`, never arbitrary content. Native plugins and their verified files remain unchanged.

Standing profiles require a labeled container. Map query-bearing profile calls to actual untagged search and return those results with empty standing-profile collections; requests without a query return no invented profile facts. Expose a local Claude MCP facade only for implemented search/add/document-list operations; do not forward hosted MCP activeSpace or container-management operations. Advertise only supported operations. Untagged writes and account-global search are the intended semantics, not an isolated container named default.

Release the transport with the existing child-tool binding, including error and cancellation paths. Global driver validators require the explicit mode and forbid a project scope. Remove inherited project tags from the global child environment. Preserve static standalone launch behavior and canonical cross-session alias/credential behavior.

Verification must cover actual outbound request bodies through a hermetic upstream, child/host token separation, unsafe identity/default-store rejection, canonical behavior, all three launch validators, no provider I/O during preparation, and resource cleanup. No real provider writes or model prompts are needed.

Primary API evidence: [official API reference](https://github.com/supermemoryai/supermemory/blob/main/skills/supermemory/references/api-reference.md), retrieved 2026-10-15, describes document tags/search container filters as optional. Installed pinned plugin source establishes the fallback and transport behavior. This is not a full runner-version certification.

## Progress

- Existing-session repair passed independent review: core aliases 27 tests, Claude adapter 29 tests, session manager 135 tests. Canary built and daemon gracefully reloaded. Latest live readiness for the user's session is `ready`; no model prompt sent. An earlier preparation attempt was cancelled before the subsequent ready result.
- Global mode is implemented across native preparation, session-owned transport, all three drivers, and the host prompt. Canonical-first resolution preserves existing Git sessions; only proven absence selects global mode. Independent source review has no remaining blocking findings.
- Focused verification: transport 11 tests / 73 assertions; scope 14 tests; native preparation 21 tests; shared services and cleanup 22 tests; Claude adapter 29 tests; initial driver/native suite 73 tests. The broad preparation/session-host batch passed 178 tests with one completion-batch timing failure under investigation. No real provider writes or model prompts were sent.
- Read-only production preparation with existing installations and credentials accepted an ordinary non-Git temporary directory for Claude, Codex, and OpenCode with explicit global mode and no project identity. Installed Claude API helpers against a synthetic upstream emitted search and write requests without container selectors, using separate child and upstream credentials.
- Final TypeScript check reports only the unrelated pre-existing error in untracked `apps/cli/src/pi-client-proof.ts:187`; the changed feature has no reported type errors. Canary build/install succeeded and the daemon was safely restarted while idle. Stable `deck` was not overwritten.
- Verification limits: global recall is account-wide search, with no container-based standing profile; real provider persistence and native automatic capture were not exercised.
- The completion-batch timeout was reproduced against exact HEAD session-manager source (only import locators rewritten in an isolated fixture), confirming it predates these edits. All 200 delegations were accepted; completion waiting timed out in both versions. Evidence: `/tmp/deck-session-batch-baseline.log`.
- After the global-mode canary reload, the existing canonical session was prepared again successfully: preparation `4f768f4a-b002-476a-b1ce-e784645fc2f4`, status `ready`, checked at `2026-10-15T20:51:06.412Z`.
- Final static-launch regression verification passed all 11 Codex and 6 Claude tests. Independent Quality review reports no blocking findings. Implementation and canary delivery are complete within the stated verification limits.
- Preserve prior global-install and degraded-model-discovery fixes plus unrelated Pi proof work.
