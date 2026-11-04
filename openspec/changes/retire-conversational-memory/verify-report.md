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

## Final installed-selector correction

The installed read-only audit exposed missed native hook selectors and TOML
receipt ranges that included following comments. The follow-up now uses canonical
selected bytes and exact receipt path/selector/encoding. Duplicate/nested/overlapping
text ranges preserve the complete resource, including otherwise removable siblings.
Independent cleanup re-review passed 74 scenarios and 377 assertions.

On the settled follow-up candidate, Bun 1.4.0 Linux arm64 passed 4,421 tests across
475 files, zero failures/skips, 34.965 seconds including invocation/output drain.
Types, frozen install, 147 protected checks and residue audit passed. The only new
audit exception is an anchored line for the already reviewed retired-hook selector
loop; no active provider behavior or file-wide exemption is allowed.

Lead rebuilt/started the canonical canary and executed 14 isolated native scenarios.
All passed. The prepared harness initially expected busy deferral even where no
entry was eligible for a write. Lead corrected that fixture oracle: eligible writes
must defer; preserved-only plans report review-required with unchanged bytes. No
production source was changed for this correction. Evidence is retained in
/tmp/deck-retirement-final8, including lead-canary-results.json. The isolated
container is stopped, with evidence preserved.

Actual installed mutation admission was checked with a no-op effect and returned
runner-mutation-deferred. No installed cleanup executed. The source feature is
retired, but 37 previously matched installed file receipts, native Codex registrations,
and older unproven private directories are not claimed removed. A later cleanup
must recompute current ownership and idle/native references; directory names alone
are insufficient. Existing historical records and unrelated capabilities remain.
