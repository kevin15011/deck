# Exploration record

## Scope

This artifact records the production path and causal evidence used by the
`auto-bootstrap-serena-prerequisites` change. It was added on 2026-08-04 to
repair the previously missing mandatory exploration registry entry; it does
not claim that an exploration artifact existed before that date.

## Production trace

The Serena path for either supported runner is:

`explicit TUI selection -> runner action -> runner adapter -> Core Serena bootstrap -> readiness evidence -> immediate revalidation -> runner MCP writer`

Core owns authorization, the Deck-owned root, prerequisite acquisition,
process execution, readiness, and safe outcomes. Each runner owns only native
action/result projection and its MCP configuration writer. Tests replace every
external effect; only the user may exercise the live installer through
`bun run deck:run`.

## Live evidence and causal corrections

1. The first OpenCode reinstall failed because the default adapter composition
   did not supply the Deck-owned Serena root or readiness revalidator. Injected
   tests supplied both, so the production wiring gap was initially hidden.
2. After that repair, the next reinstall created the Deck-owned Serena
   directories but produced neither `<root>/uv/uv` nor `<root>/bin/serena`.
   This located the failure after root preparation and before prerequisite
   readiness.
3. The production fetcher began at the required official URL while setting
   `redirect: "error"`. The official latest-installer flow redirects to its
   release asset, making the original exact-URL/no-redirect combination
   inoperable.
4. The adapter retained a typed safe failure code, but the rendered diagnostic
   collapsed it to a generic line, making live failures unnecessarily opaque.
5. The next live retry exposed `evidence/redirect-rejected`, proving that the
   first redirect repair still coupled correctness to an incomplete inventory
   of current CDN hosts/paths. That inventory was false precision: the exact
   official endpoint already controls the bytes or redirect it returns.
6. The following retry completed `uv` and Serena installation but exposed
   `post-install/serena-unusable`. Filesystem evidence showed the expected
   `bin/serena` entry was a symlink created by `uv tool install`, with its real
   executable target contained under `uv-tools/serena-agent/bin/serena`. Core
   had rejected every symlink before applying its containment checks.
7. After Serena reuse completed, OpenCode still reported that the bare
   executable `serena` was unavailable. Read-only inspection of the active
   OpenCode configuration confirmed that its Serena command had never been
   replaced with the validated absolute executable. The adapter correctly
   projected reuse as `status: skipped` plus the identified raw outcome
   `already-present`, but the TUI production bridge overwrote every skipped
   Serena result as `cancelled`. The shared action runner therefore suppressed
   the following MCP action even though the same adapter held valid readiness.

## Resulting boundaries

- Keep current-operation explicit authorization and the exact initial official
  endpoint.
- Follow at most five server-provided HTTPS redirects without credentials or
  custom ports; reject malformed, insecure, or excess redirects without making
  volatile CDN names part of Deck's product contract.
- Keep one timeout, one response-size limit, omitted credentials, fixed child
  commands/environments, Deck-owned storage, and post-install readiness gates.
- Surface only bounded safe stage/code diagnostics; never surface raw remote or
  child-process output, tokens, or private paths.
- Preserve partial state for an idempotent user retry; never delete user state
  as automatic failure cleanup.
- Accept the normal `uv`-managed Serena symlink only when its canonical regular
  executable target remains inside the same owned root, and bind link plus
  target identity into readiness/revalidation evidence.
- Keep OpenCode Serena installation/reuse and MCP configuration on the same
  runner-adapter instance, and preserve its identified outcome projection:
  `already-present` means reusable readiness, never cancellation.

Implementation and verification details are maintained in
`apply-progress.md`.
