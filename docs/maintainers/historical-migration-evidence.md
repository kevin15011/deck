# Historical manual-tool fixtures

The historical migration workflow is an optional manual diagnostic, not an
automatic release prerequisite. Its completeness checks qualify diagnostic
evidence only; a failed or incomplete diagnostic does not block a release.

The published matrix retains every release/runner row. The selected phase for
0.0.1 and 0.0.2 on Pi and OpenCode uses `manual-external-tool-fixture-v1`.
Those published catalogs have no Serena entry and classify Codebase Memory as
external. Pi reports `success: true, status: manual`; OpenCode reports failure
with manual installation guidance. Neither outcome is an acquisition effect.

The harness verifies the original core/catalog/installer SHA-256 inputs and
executes the original Codebase installer with a rejecting process seam. It then
provisions independent operator prerequisites in the marked fixture HOME:

- UV 0.9.5 archive and executable, checked against retained SHA-256 pins.
- Serena Agent 1.3.0 with Python 3.13.7. UV first generates a transitive
  requirements inventory with hashes, then installs it with `--require-hashes`.
  The requirements input/output, installed version and executable identity are
  retained. This is newly acquired fixture evidence, not a previously verified
  transitive lock or an effect of the old Deck installer.
- Codebase Memory 0.11.0 through the existing pinned archive/binary verifier,
  independently exposed as a shared prerequisite.

Both commands must execute successfully. Operator configuration uses Pi's
`mcpServers` command/args format or OpenCode's `mcp` local command array. The
configuration, source-format reference and tool artifacts are labeled
`historicalDeckInstallEffect: false`. The original installer file snapshot is
captured before operator configuration; the two sources of effects remain
separate. No historical installer source is rewritten. The operator evidence also
retains its configuration preimage. Before replacement review, migration verifies
the original captured configuration, exact native path, pinned artifacts and lock,
then reconstructs the operator postimage from that original plus only the two
manual tool entries. The reviewed migration preimage is this validated postimage;
`historical-files.json` remains unchanged. Other edits cannot become review inputs.

Before migration, the harness checks exact tool, requirements and configuration
preimages. Migration uses the normal candidate cleanup/sync/admission path.
External executables must survive unchanged without acquiring Deck ownership.
Complete diagnostic evidence requires both capability-specific artifact checks and candidate
admission, in addition to the existing complete base/selected inventory, search,
RTK, preservation/recovery and source verification gates. Missing or fabricated
manual evidence cannot waive a row. Commands must match the exact executable and
arguments: Serena requires `start-mcp-server`; Codebase Memory takes no arguments.
Extra or swapped argv entries, altered historical success/manual outcomes and a
UV digest differing from the acquisition pin all fail diagnostic qualification.

Run the existing `Historical retirement diagnostic` workflow for Linux x64 with
Bun 1.4.0. Its selected invocation is:

```sh
bun run scripts/verify-retirement-published-matrix.ts --install-dependencies --live-search --allow-incomplete --runner=pi --selected-variants --output=/tmp/retirement-selected-pi
```

Use a fresh output directory; successful effects must not be replayed. Repeat
with `--runner=opencode`, then require complete base and selected evidence using
`verify-retirement-publication-evidence.ts`. The workflow retains manual
provenance and requirements inventories even when qualification fails.

Source contract tests do not prove upstream acquisition, live search or the
heavy Linux migration matrix. Those checks remain pending until that workflow
executes successfully on the pinned runtime. The manual model grants no product
repair authority and does not change installation ownership policy.
