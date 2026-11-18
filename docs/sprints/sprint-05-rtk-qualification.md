# RTK snapshot-read qualification for S5b

Status: bounded fixture qualification accepted at 125672. Production admission, native tool delivery and browser updating remain outstanding. This does not complete S5b.

Apply Fast task `task-2520df14-53e4-4451-ad58-073aefcb9083`, attempt 2 (125315/125316), supplies `target/rtk-qualification/qualify2.py` and `handoff.json`. Attempt-1 scripts/results are preserved under `attempt1/`. Lead read the harness and full handoff, matched both real archives/executables and 17 captured upstream source files, then independently replayed copied inputs in `target/lead-rtk-qualification/` in **2.122 s**. Owner evidence was unchanged.

| Regular Linux x86-64 musl version | Archive bytes / SHA-256 | Executable bytes / SHA-256 |
|---|---|---|
| 0.50.0 | 4,857,739 / `bc2b8902b0d9c796c82ef45f16ae2307e17757afeca5ee156235a3dc7bda5f89` | 11,040,640 / `23433a2a50bdeb12199cadd4b94b639238d6c38529fcba1c30c9295db5fa9517` |
| 1.2.0 | 7,111,018 / `70fee7b4a548c43dde94c77e2335550981b0bc2fb013691d8c8109b5bd0eda37` | 16,364,216 / `8a64af588cabed12eca467d407e3d63c05b3a9b7afc308c2dda75489f7270dfb` |

Official acquisition uses the exact tags and `rtk-x86_64-unknown-linux-musl.tar.gz` assets from `github.com/rtk-ai/rtk/releases/download/`. Verified archives contain only expected regular entries. ELF format and static dependencies were inspected before execution. These upstream hashes establish integrity, not an independent signature or trust in every future release.

## Operation and fault evidence

The fixed operation is `rtk read --level minimal snapshot.rs` on an already-authorized, owned snapshot. Both versions transformed the same 1,647-byte fixture to 134 bytes, retaining the function signature, loop and addition. This intentionally comment-heavy fixture demonstrates the operation; its reduction is not a representative performance or token-saving promise. Lead's first/repeat observations were 0.121/0.030 s for 0.50.0 and 0.128/0.029 s for 1.2.0. Native model latency was not measured here.

The harness returns the original snapshot bytes and digest after missing/invalid executable, nonzero exit, invalid UTF-8, stdout/stderr cap, timeout or injected sandbox failure. It does not reuse partial output or reread a changing project file. Cancellation after a fake child produced output returns no successful result. These fault cases exercise the supervising boundary; they do not claim every failure occurred inside a real RTK binary.

Both versions preserve the inherited HOME, use private XDG/config/data/cache/temp directories, explicitly disable telemetry and retain separate tracking databases. Version 0.50.0 also created a private hook-warning marker; no hook was installed. The outside-sentinel write was denied and its content remained unchanged. Landlock bounds writes, not reads or network access. Process groups were terminated and child leaders reaped; observations do not exhaustively prove every possible descendant was gone.

## Production handoff

Use this as evidence for an **optional lossy view**, retaining an exact-source operation and the original admitted snapshot. Production Rust code must independently enforce admission, artifact identity, fixed arguments, bounded IO, cancellation, process settlement and private state. Do not copy this fixture supervisor as a generic process framework. Return useful diagnostics without exposing original private content in logs.

The [S5 brief](../../openspec/changes/sprint-05-capabilities-tools/working-brief.md) still requires a real reviewed browser update between two qualified versions, pinned versions for already-admitted work, native tool qualification, corrupt/offline/interrupted update handling and respect for external ownership. No helper was globally installed or activated by this qualification.

## Exact notice material

Apply Fast's same task, attempt 3 (135065/135066), is integrated at 135832. Its `target/rtk-qualification/notices/catalog.json` has SHA-256 `55e234610b7c041af39b5d7d86256bf410f35490d2cc9d51970c6e72278a33f4` and records exact source/tag/member, bytes, full digest and retrieval/verification time. Lead independently rematched both archives/executables/member lists, all four stored notice files and archive-to-file equality. Evidence: `target/lead-rtk-qualification/notices-review.json`.

| Notice | Source / bytes / SHA-256 |
|---|---|
| 0.50.0 LICENSE | Exact-tag source, absent from binary archive; 10,767 / `4044ade9c21d8b084d3d16a03375cf3b7e166b946a327bb37a3fbbdb53287cfd` |
| 1.2.0 LICENSE | Verified archive and matching exact-tag source; 10,756 / `33f694a31d9f9df3e292a9413a3cdb0113fa72698e2c719f657ff6b53165dcc4` |
| 1.2.0 LICENSE-ENGINE | Verified archive; 4,273 / `4e3d24d5ae066274a03b82b400b31ad057628c40911cd08aa5a19ff31787dc98` |

Preserve both 1.2.0 notices and make their complete contents available during reviewed installation and alongside the owned artifact. The regular artifact must not be described as uniformly Apache-only. Exact-tag root `NOTICE` probes returned 404 for both versions; root `LICENSE-ENGINE` probes also returned 404, while the verified 1.2.0 archive contains it. These narrow observations do not establish absence elsewhere or exhaustive third-party notice completeness. Original archive acquisition times are unknown and remain distinct from re-verification time. This is local catalog preparation, without a broader legal eligibility opinion or production activation claim.
