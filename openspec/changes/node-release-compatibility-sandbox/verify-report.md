# Verification report

## Result
Local verification passed with scope limits. Implementation is complete, but cross-platform release certification remains pending remote CI execution. No release was published.

## Automated evidence
- Initial harness/workflow RED: 4 failures and 1 missing-module error before implementation.
- Cancellation regression RED: 5 failures; corrected implementation passed the affected suites.
- Signing regression RED: 9 failures; corrected implementation passed on both Bun 1.3.12 and 1.3.14.
- Final focused command: `bun test scripts/verify-binary-compatibility.test.ts scripts/release-compatibility-workflow.test.ts tests/release-workflow.test.ts scripts/generate-runner-execution-assets.test.ts scripts/prepare-release.test.ts tests/documentation-governance.test.ts` — **94 passed, 0 failed, 1,053 assertions**.
- Strict standalone TypeScript check of the verifier and its two test files passed.
- Repository `bunx --no-install tsc --noEmit` in the existing checkout found 11 unresolved workspace imports in untouched tests. Repeated against a disposable copy of current source after `bun install --frozen-lockfile`, using pinned Bun 1.3.12: **passed, exit 0**. No dependency repair was made to the working checkout.
- A broad-suite attempt in a disposable copy exceeded the tool RPC timeout; no complete result was captured. It is **not** counted as a passing broad-suite run. The workflow retains its existing full-suite gate.
- `git diff --check` passed.
- `bun run apps/cli/src/main.tsx openspec validate --json --root . --change node-release-compatibility-sandbox` passed with zero errors and zero warnings.

## Real native acceptance
Executed the full sandbox with an isolated official `@oven/bun-darwin-aarch64@1.3.12` executable (npm package installed under the approved temporary directory with scripts disabled). Current source was built once, official Node archives downloaded and checked, and the same candidate executed for both cells.

| Host | Node | Standalone startup/identity | Generated hook fixture |
|---|---|---|---|
| macOS ARM64 | v20.20.2 | Passed | capture, recall, denial, invalid-input passed |
| macOS ARM64 | v24.21.0 | Passed | capture, recall, denial, invalid-input passed |

Candidate SHA-256: `87958cb329efb91dd474f33d44c40b202848d781c67d68454f2091165bbbe65a`.
Generated hook SHA-256: `66361f5f653ab4ea944e9c9f8b8428e2131a825eda913c3b5ae563e867498863`.
Build identity: version `0.4.0`, commit `fefa543f691f82e79cc13b1ca7e35d37cf386738`, target `darwin-arm64`, channel `dev`. Commit identifies the source base, not a clean-tree guarantee; the sandbox includes working-tree changes.

Local evidence (temporary, not portable release artifacts):
- `/var/folders/wc/6dz6dlhx2nq_mtnt7l2fd6680000gn/T/opencode/deck-compat-acceptance/macos-arm64-fixed.json`
- `/var/folders/wc/6dz6dlhx2nq_mtnt7l2fd6680000gn/T/opencode/deck-compat-acceptance/fresh-typecheck.jsonl`
- `/var/folders/wc/6dz6dlhx2nq_mtnt7l2fd6680000gn/T/opencode/deck-signature-diagnosis-Hzn6Tj/` — minimal failing and repaired signature controls.

## Remaining limits
All eight remote CI jobs still require execution; local ARM64 success is not evidence for macOS x64 or either Linux architecture. Older OS releases, arbitrary npm packages, external runner installation, Apple notarization, and real provider integrations are not certified. HOME/PATH isolation is not a security sandbox. The generated hook is a build-associated sidecar, not a test of installation/materialization from the binary.
