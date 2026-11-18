# Sprint 1 candidate evidence

Status: reviewed WSL recovery candidate `46277cab…` is now installed, replacing React candidate `f4ff02f0…`. The actual Windows browser delivery gap remains open as S1-Q07; S1-Q08 remains resolved. Earlier checks remain valid for their tested boundaries, not the unobserved Windows browser authentication. See the latest [implementation brief](../../openspec/changes/sprint-01-deck2/working-brief.md).

## Candidate and ownership

Apply Deep task `task-181d5e85-7817-4dbd-bc81-849132576baf`, attempt 1, report events 77119/77120, produced the new repository's manifests, native/shared/browser crates, packaging scripts, assets and tests. Lead owns documentation and integration. Existing Deck source and native runner profiles are outside the implementation ownership.

First implementation identity: `unborn-head:implementation-sha256:024eb5b49d6f86937c736c00d7198b09a7817ae5eaea17a5ddd42f085500f6c1`. The preserved [input manifest](../../target/evidence/attempt-01/candidate.json) enumerates 24 paths and their SHA-256 values, excluding Lead-owned documentation and build outputs. Lead independently recomputed every listed file hash, confirmed there were no additional implementation inputs in the declared scope, and matched the packaged artifacts:

- `dist/deck2`: `3ba779bb9c45bf0461df2dbd682477b319cc8b344efc1e92b58d713a27965b4c`.
- Browser Wasm: `d0e8ada6685ccb613abf8d0218baf6d8a16fb4452afa2e90bf5c38e516fb16dc`.

There is no Git HEAD yet; these are explicit input/artifact identities, not a Git-tree claim. Evidence files under ignored `target/` are local development artifacts and may be removed by cleaning build output.

## Reported verification and Lead checks

| Evidence | Result and scope |
|---|---|
| Rust format, Clippy and workspace tests | Owner reports formatting/Clippy pass and 12 contract tests, including authentication/origin, deduplication/conflict, native restrictions, uncertain delivery and storage faults. |
| Native/Wasm packaging | Owner reports successful build in 13.47 seconds. Lead matched the binary/Wasm hashes and executed packaged `--help` successfully. |
| Browser/native exercise | Owner reports 16 checks, including a real file read, tab closure/reconnect, cancellation, dark/light/mobile states, keyboard/reduced motion, draft retention and API mismatch. Lead read the resulting receipts and inspected the desktop screenshot against the repository reference. |
| Launcher | Owner reports real launcher HTTP/auth flow with an owned browser-opener fake, exclusive state lock and private launcher permissions. |
| Independent implementation review | Quality attempt 6 requires changes S1-Q01–S1-Q06. Two existing compiled admission tests passed independently; ten filesystem-dependent tests could not run in the reviewer's read-only environment. |

Preserved first-candidate local evidence: [verification.json](../../target/evidence/attempt-01/verification.json), [browser results](../../target/evidence/attempt-01/browser-evidence/result.json), [desktop capture](../../target/evidence/attempt-01/browser-evidence/desktop-dark-result.png), [mobile capture](../../target/evidence/attempt-01/browser-evidence/mobile-dark-result.png), [launcher evidence](../../target/evidence/attempt-01/launcher-evidence.json). Later build output must not be mistaken for these reviewed bytes. Commands are documented in the [README](../../README.md).

## Exact supported boundary

The candidate uses Rust/Cargo 1.92.0, Leptos 0.8.14 and wasm-bindgen 0.2.108, with Cargo.lock. Native evidence uses Linux Codex 0.166.0 app-server over stdio and Chromium 156. The native mode uses an ephemeral thread, local environment, `:read-only` permissions and approval policy `never`. Effective restricted features are checked, inherited MCP servers receive explicit thread-scoped disables and a paginated runtime inventory must show disabled servers with no exposed tools before dispatch.

The owner reports an owned sentinel MCP probe and a denied filesystem-write probe. Lead source review confirms the effective-config, permission acknowledgment and MCP inventory checks; independent review must test their sufficiency, not infer enforcement from instruction text alone. Native configuration/authentication remain runner-owned. Read-only does not mean project-only read confidentiality or absence of all native cache/auth writes.

Commands create ephemeral native threads; up to eight recent Deck-owned recorded exchanges are supplied as bounded historical user context. This is not native-history import or implicit native continuation. Streamed text reaches the UI through authoritative snapshot polling every 500 ms. Reported single-run timing was approximately 1.11 seconds for native preparation and 5.30 seconds from acceptance to first output; this is not a benchmark distribution or zero-overhead claim.

## First-candidate acceptance gaps

Independent review covered local authentication, native restrictions, durable admission/reconnect, cancellation/settlement, recovery/state compatibility and the packaged entry point. The incompatible-state concern is now a confirmed source/SQL counterexample, recorded as S1-Q01 below. Runtime confirmation of lifecycle/browser repairs remains required.

The UI is recognizable against repository reference captures, but no fresh old-source runtime capture or agreed comparison tolerance was established. The reference branding, supported transcript formatting and equivalent responsive states need an explicit fidelity disposition before final acceptance. Unsupported later-sprint controls must not be added merely to mimic a screenshot. Exact native modes beyond the selected version, cross-runner operation and helper/update management remain later roadmap work.

## Quality attempt 6: required corrections

Report events 79351/79352 apply to the unchanged first candidate. Lead reviewed the full report, recomputed all 24 source hashes and independently repeated the bounded in-memory SQLite and JSON-size counterexamples. The reviewer did not modify files or independently rerun real native/browser acceptance. Its source-confirmed lifecycle and browser concerns are not presented as already reproduced end-to-end failures.

| Finding | Review severity | Required correction and acceptance | Status |
|---|---|---|---|
| S1-Q01 | High | Check existing schema compatibility without writes; distinguish missing from corrupt/unreadable metadata. Unsupported/corrupt state must be rejected without changes to contents, schema or journal configuration. The first candidate's initialization SQL added receipts/diagnostics to a schema-999 database. | Resolved in candidate 2 |
| S1-Q02 | Medium | Bound output and lifetime of version probes; terminate and reap owned processes/descendants after timeout or flooding, before any dispatch. The first candidate timed out an unowned `output()` future. | Resolved in candidate 2 |
| S1-Q03 | Medium | Preserve partially consumed native framing across cancellation. A split notification followed by cancellation and valid interruption settlement must not become a false malformed-message/uncertain result. | Resolved in candidate 2 |
| S1-Q04 | Medium | Align encoded HTTP and prompt limits; distinguish definitive pre-admission rejection from uncertain delivery. An escape-heavy draft must remain editable and resubmittable without browser-storage deletion. Lead's original counterexample encoded to 22,086 request bytes and exceeded the old 20 KiB limit. | Resolved in candidate 2 |
| S1-Q05 | Medium | Keep stable command keys and reactive field updates. Streaming revisions must preserve expanded details and keyboard focus on Cancel until a user action or settlement changes the control. | Resolved in candidate 2 |
| S1-Q06 | Medium | Reuse the established logo and safely format common assistant Markdown. Compare public equivalent heading/emphasis/list/code fixtures at desktop/mobile sizes in both themes, recording accepted differences without redesign or future controls. | Resolved within accepted S1 scope |

The same Apply Deep task implemented all six corrections and focused regressions. Quality retained independent review ownership. Because its native read-only mode prevented filesystem-based execution, Lead independently executed the repaired-state/process/browser checks in an owned writable test area without broadening reviewer restrictions. Final source/evidence review and explicit finding resolutions, rather than integration alone, support closure below.

## Second candidate and independent execution

Apply Deep attempt 2 (81330/81331) supplied candidate `unborn-head:implementation-sha256:0431b00d78436ec8a566b8ace4e82bd010b3cc23fa24c693b72ab38532c4ae68`. Lead recomputed all 29 input hashes and the manifest digest using SHA-256 of the sorted compact JSON input map. Verified artifact hashes follow:

- `dist/deck2`: `12b92d1890d1b37ba0fe6b7d06a90f9abf6c190cee1b1476b82caf1979a8a040`.
- Browser Wasm: `eabd2f6f1e7458018e6504e55b76a2bf88f5e5e95787799c80fd3a641859cbe4`.

The owner reports final formatting, Clippy, native/Wasm build and all checks passing; the packaged build took 22.277 seconds. The [preserved attempt-2 evidence](../../target/evidence/attempt-02/verification.json) separates each finding's source changes, regression oracle and red/green observations. Lead independently performed the following against the same candidate, without altering implementation inputs:

| Independent Lead command | Result | Wall time |
|---|---|---|
| `source scripts/env.sh` then `cargo test --locked --workspace` | 17 contract tests, one transport-framing test and one Markdown security test passed. Includes real owned filesystem/process checks that Quality could not execute. | 6.364 s |
| Node `scripts/browser-regressions.cjs` using the recorded Playwright installation | Packaged HTTP/Wasm with fake native boundary: escaped requests, rejection correction, unknown-delivery identity retention, live focus/details stability, safe formatting and responsive fixtures passed. | 8.262 s |
| Node `scripts/browser-acceptance.cjs` using the recorded Playwright installation | Actual Codex read, tab closure/reconnect, one recorded first command, native cancellation, auth, draft and API/connection/browser checks passed. | 15.397 s |

Exact commands, logs and post-run identities are in [Lead's check summary](../../target/lead-verification-a2/summary.json); [browser regression evidence](../../target/lead-verification-a2/browser-regressions/result.json) and [real native/browser evidence](../../target/lead-verification-a2/browser-native/result.json) are separate. The real read produced one observed local tool call and a completed receipt; the second turn settled cancelled. Observed native preparation was 1,222 ms and acceptance-to-first-output was 4,964 ms for this run. These are single-run observations, not performance guarantees.

S1-Q01 through S1-Q05 have source corrections plus independently re-executed meaningful regressions. S1-Q06 restores the exact brand vector and safe common Markdown semantics. Lead inspected dark desktop and light mobile captures against the same public fixture rendered by the original brand/Markdown/CSS components, with revision and source hashes recorded in [reference provenance](../../target/evidence/attempt-02/reference-fixture/provenance.json). Equivalent theme/viewport captures are available for both themes. The bounded S1 visual disposition accepts common formatting and recognizable workspace hierarchy; the code-copy toolbar, additional GFM formatting and external-link navigation fidelity remain tracked in S8. This does not accept removal of those features or claim pixel-perfect/full-workspace parity.

Quality attempt 7 subsequently passed final source/evidence review and recommended resolving all six findings. Lead supplied the independent executable evidence without granting the reviewer mutation permissions. No existing Deck or native runner configuration was changed.

## Final acceptance and local command installation

Quality attempt 7, events 83028/83029, passed the exact second candidate with no new material findings and sufficient bounded support for all nine Sprint 1 scenarios. It independently reran the compiled Markdown-security, authentication/origin and invalid/API-admission tests plus packaged help, and reviewed Lead's separate writable/native/browser execution evidence. Lead recomputed all 29 source hashes, the input-map digest and both packaged hashes again before acceptance. Formal integration event 83177 resolves S1-Q01–S1-Q06 on the implementation task with per-finding reasons and evidence references.

The accepted binary was copied exclusively to `/home/kevin15011/.local/bin/deck2`, already on this machine's PATH. No existing command was replaced. The installed bytes match SHA-256 `12b92d1890d1b37ba0fe6b7d06a90f9abf6c190cee1b1476b82caf1979a8a040`; `deck2 --version` returned `deck2 0.1.0`, and `deck2 --help` passed. [Local installation evidence](../../target/deck2-install-evidence.json) records the exact path, hash and method. This is a stable local copy, not a symlink that automatically changes on each rebuild or a published release.

Sprint acceptance remains limited to the supported read-only development journey: Linux, Codex 0.166.0 and Chromium; ephemeral native threads with bounded Deck history; 500 ms snapshot polling; no project-only read-confidentiality guarantee. Native-owned auth/cache/provider activity remains possible. Cross-runner delegation, write approvals, web installation/update management and remaining S8 fidelity are later work, not implied by this acceptance.

## React replacement candidate — review pending

Apply Deep attempt 4 (86956/86957) supplies candidate `unborn-head:implementation-sha256:f4ff02f0e70f4e4d06e0056154559e7ce66b1f9c51cd13773002abd916abb02b`. Lead recomputed all 64 input hashes, matched the input-map digest and the complete non-ignored implementation scope, and matched every packaged asset in the [owner summary](../../target/react-verification/summary.json). `dist/deck2` is SHA-256 `e9220d8eeb2d6d6cbd25147bec75dfa924212abb8e41056e5ff7ae791589aec0`; the installed copy remains the earlier `12b92d18…` binary. The complete [handoff](../../target/react-verification/handoff.md) distinguishes final-candidate checks from predecessor reuse.

The native host remains Rust; a single static React/TypeScript/GSAP frontend replaces the active Leptos/Wasm source/build. Dependencies are locked: Bun 1.4.0, React 19.2.8, GSAP 3.15.0, react-markdown 10.1.0 and remark-gfm 4.0.1. Build assets include local fonts and licenses. The packaged runtime needs no JavaScript server or CDN. Host admission diagnostics now distinguish missing session, wrong host, wrong origin and cross-site requests without logging credentials. A missing-cookie page disables sending, preserves draft/uncertain identity and suspends forbidden polling; CLI reopening or the explicit private `--print-url` fallback supplies a new one-use capability.

The owner's 19 Rust tests, two TypeScript contract tests, formatting/static/build, launch/auth, browser and motion checks and bounded real Codex read/reconnect/cancellation are recorded with their candidate bindings. Lead independently verified the final production delta from the fully tested predecessor: only removal of initial navigation autofocus; the other changed input extends the clipboard regression. Reversing that exact source delta in memory matches the predecessor hash. Final affected browser/build/visual checks were rerun by the owner; unchanged host/native evidence is reused with those limits.

Lead independently ran the exact packaged candidate's `node scripts/auth-launch-regressions.cjs` (pass, 8.100 s) and `node scripts/motion-regressions.cjs` (pass, 6.395 s). These exercise the real CLI/opener handoff with a controlled desktop opener and fake native boundary, bare-link refusal, new-link recovery, draft/pending identity retention, one-use credentials, negative Host/Origin/fetch-site checks, keyboard/tab/disclosure reversals, live reduced motion and resize-safe cancellation. Source hashes remained unchanged. Logs and copied results are in [Lead's check record](../../target/lead-react-checks/summary.json). Owner logs remain separate; the shared latest auth/motion result paths now contain these independent runs.

Lead inspected dark desktop conversation/reference and empty views, light desktop disconnection and light mobile conversation. The 40 captures and [provenance](../../target/react-visual/provenance.json) use equivalent public fixtures, viewports and themes. All original-source provenance hashes still matched. The comparison uses original CSS/brand/Markdown with a manually bounded original-shell projection, not the whole original app. It supports restored typography/composer/presentation within S1 but does not establish full original-app or pixel equivalence. No visual finding is closed by screenshot count alone.

S1-Q07/S1-Q08 remain open pending the same Quality owner's independent source/evidence review and Lead disposition. The old binary failed the bare-link polling oracle and the replacement passes it; this still does not prove the user's exact original launch path. No installed-binary replacement or live-host restart has occurred.

## Final React disposition and installation

Quality attempt 8 (88906/88907) supports resolving S1-Q07 for implemented recovery and reports no additional material security/architecture issue. It required a specific follow-up for S1-Q08: verify that the composer is visible/reachable after a completed conversation and submit another prompt at desktop dark 1440×1000 and mobile light 390×844. Its claimed missing composer was not confirmed by Lead's direct reinspection of the two cited PNGs, which visibly contain the composer; the 150 ms capture-script wait alone is not proof of reachability.

Lead independently executed the requested packaged HTTP/browser check with the existing deterministic fake native process, isolated project/state and the public Markdown fixture. In both viewport/theme combinations, after completion and reload, the textarea was visible, in the viewport, free of hidden/inert/zero-opacity ancestors and the hit-test target at its center. It accepted click/focus and a follow-up draft, and sending produced exactly one additional completed receipt with the intended prompt. There were no page errors. Screenshots before editing, with the follow-up draft and after completion are in [the independent composer evidence](../../target/lead-composer-checks/result.json); its script/log are adjacent. Lead inspected both follow-up-draft screenshots. All 64 input and artifact hashes remained unchanged. No missing-composer defect or capture-timing cause was established, and no implementation change was needed. The script recorded 4,893.928 seconds elapsed; this is retained as observed and is not a responsiveness benchmark.

Lead adopted the bounded review and completed the requested evidence, closing S1-Q07/S1-Q08 on both implementation/review task records in integration event 89214. This is Lead's explicit disposition after conditional review, not a claim that the reviewer executed the additional browser check or gave a later unconditional pass. Visual acceptance remains bounded to the S1 presentation; the reconstructed reference does not prove full original-app equivalence.

The accepted `dist/deck2` bytes (`e9220d8eeb2d6d6cbd25147bec75dfa924212abb8e41056e5ff7ae791589aec0`) replaced `/home/kevin15011/.local/bin/deck2` atomically after checking the exact old hash. The earlier executable is preserved under `target/installed-backups/`; [installation evidence](../../target/deck2-react-install-evidence.json) records both hashes and the backup path. Version/help execution passed and installed `open --help` exposes `--print-url`. No live host, default state, native profile or existing Deck installation was stopped or changed. Already running processes retain their prior executable; the user must stop/restart an old host to serve the new UI from that state directory.
