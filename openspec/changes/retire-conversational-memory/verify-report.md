# Retirement verification

Source and isolated installation verification passed on 2026-11-04. Installed
user-state removal remains pending its exact ownership and active-use audit.

- Pinned Bun 1.4.0 Linux arm64: frozen install and workspace types passed;
  full suite passed 4,357 tests across 475 files, zero failures/skips, 33.662s
  including invocation/output drain within the unchanged 120s limit.
- Canonical schema, Pi and runner execution generators were byte-identical;
  residue audit, binary build and 33 protected filesystem checks passed.
- Independent reviews resolved TUI, search credential forwarding, receipt-only
  cleanup, Codex repeated hook/MCP installs and Pi legacy guard migration.
- Lead built/started the canonical canary in an unmounted disposable container.
  Its inert historical hook returned {}. Ten real temporary installation scenarios
  passed: full/content-only Codex matching/customized/unreceipted entries across
  repeated installs and leases, plus native config cleanup for all four runners
  with real idle admission. Customized/unknown entries survived; busy mutation
  deferred. This is not an authenticated model-backed native conversation.
- The prepared harness initially used an invalid dedicated data-root basename.
  Lead corrected only its temporary fixture path to data/deck, then reran it.
- A stale test expecting shape-based removal was corrected to the approved
  exact-ownership requirement. Production hashes stayed unchanged. Prior failed
  and interrupted gates remain diagnostic history, not passing acceptance.

Primary evidence: /tmp/deck-retirement-final5b/handoff.md and results.json;
/tmp/deck-retirement-mcp-handoff.md; /tmp/deck-retirement-repairs-handoff.md;
/tmp/deck-cli-retirement-handoff.md. Lead canary results are retained in container
/tmp/deck-retirement-lead-canary-BzXMOl/results.json and copied beside the evidence.

Current OpenSpec native readiness requirements now refer to optional capability
independence rather than the retired subsystem. Historical records are preserved;
this retirement supersedes their conversational-memory implementation directives.
No account data or credentials were erased. No real installed cleanup has yet run.
