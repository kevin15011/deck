> Preserved historical report. Current official spec/design/tasks and source take precedence. Original source: /tmp/deck-parity-delta/report.md

# Bounded role-policy and Claude parity delta

Status: implementation candidate, not full S1/S2/S3/S8 or native readiness acceptance. Same owner; accepted RQ1/2/3 code retained. No OpenSpec edits, commits, installs in user roots, or model-backed probes. Fixtures install only into temporary roots. Adaptive context was not loaded (disabled). Skill discovery context absent/indeterminate; used exposed apply-deep and Git workflow guidance. Current source/OpenSpec outrank prior reports.

## Implemented

- Canonical core ROLE_TOOL_POLICY: two read-only roles, read built-ins, explicit capability query operations, MCP deny default. Core keeps web operations semantic; adapters translate them to exact provider tool identities. Claude preserves RQ1's enabled-only managed Codebase query names as well as native plugin identities. No read-only retired Context Mode/Serena grants.
- Claude generation no longer declares a static web-search server. Native launch and session composition use resolveWebSearchLaunch over the same route selector. Native fallback is passed through --mcp-config; secrets remain process environment values. Disabled/native routes do not read native fallback credentials.
- Native plugin servers remain native. Claude denies only a paired Codebase plugin override. Retired/static-search generations and unpaired bindings fail closed. A verified plugin requires explicit native role selection. The session override reader is renamed throughout production and fixtures; unlisted IDs are rejected, not silently deleted/filtered.
- Core bounded typed overlay owns delegation, task roster, continuity, decision, image and memory guidance. Unknown kinds and member use of Lead-only kinds fail; role/safety/capability/project/readiness markers and the actual repair directive are forbidden. Host continuity/images/notices use the renderer; Claude validates final appended text. Capability roster includes binding identity and continuation/new-task distinction. Existing non-Claude role-body path remains a dependency noted below.
- Parity shape/allowlist/guard implements protected-field comparisons, unused exceptions, override necessity existence, temporary entry expiry and read-only builtin/default-deny checks. The temporary global-memory entry retains the approved owner and 2026-11-23 review date. Unequal readiness digests fail with coordination-proof-unavailable: digests alone do not prove the required typed additional-participant projection.
- Claude plan fixture independently parses actual native and session launch arguments and the installed generation. It checks Lead/Quality under relay/yolo and detects context7 denial, missing agent selection, and skip flags in relay. Separate dynamic web-route tests compare real native plan against production session resolver.
- OpenCode native review-role entries get default-deny tools/permissions and exact read allows; obsolete Serena policy helpers removed. Codex review TOMLs gain read-only sandbox. Both session drivers reject review roles before I/O because their native selection/MCP enforcement is still unverified. Pi catalog, role identities and generated tool-policy bundles consume core policy; assets regenerated only with the canonical generator, whose input digest now includes core policy.

## Input bounds

Overlay: 32 sections; 128 KiB final UTF-8 output and per-section input bytes; 4096 visited nodes; depth 16; arrays at most 512. Validation precedes roster truncation. Roster output at most 20 entries and bounded/redacted individual strings. Tests cover multibyte overflow, excessive sections/collections/depth, forbidden content beyond the displayed summary, unknown kinds and Lead-only restrictions. Existing preparation bounds/effect authority are unchanged.

## Exact remaining coverage

- S1 partial: generalized NativeRoleDescriptor across all adapters and Codex bootstrap split remain. Typed independently derived readiness coordination/full-byte projections are not implemented; row 12 is reserved and cannot waive this missing evidence. The core overlay exists, but not every legacy host string and non-Claude role path has been migrated. Guard rows for unsupported/headless transport are metadata, not completed per-runner proof.
- S2 partial: Claude policy and Pi policy are implemented. OpenCode native materialization is statically checked; no new live MCP-denial probe was authorized/run. OpenCode session still selects default agent (S5), so Quality/Investigate sessions are unavailable. Codex session review roles are unavailable. Codex native per-role deny-by-default for arbitrary user/project MCP remains unresolved; read-only filesystem sandbox does not prove it. Native Codex role publication still exists and must not be represented as S2 acceptance or safe MCP read-only enforcement.
- S3 partial: Claude native selection, paired overrides, route-free plugin, shared web route, native SessionStart and appended-overlay checks are covered. Existing preparation authority remains limited to authenticated session Setup. Native invocation identity, live skill/tool consumption, full memory parity, native model/default parity and complete lifecycle/readiness projections remain outstanding. The generation descriptor still uses the accepted nativeSkills plus role-binding structure, not the generalized S1 contract.
- S8 partial: assignedRoleId already uses catalog membership. Claude gets overlay-only content; session-service still calls getAgentContent for Codex/OpenCode until their verified native role selection exists. Removing those bytes now would launch without the intended role; this delta does not claim the no-role-rendering guard passes globally.
- R1/R2/R3/R4/R5 full native identity/catalog/cache/lifecycle work remains; this delta does not change that acceptance. S4/S5/S6/S7 are not closed. No memory redesign.

## Observable compatibility point for Lead

An enabled Claude Codebase binding that cannot be paired now fails launch with claude-mcp-override-unpaired. This follows the explicit S3 unpaired-override requirement; the readiness evaluator itself still reports optional degradation. Existing Web readiness UI can therefore say ready while the later real Claude launch is fenced. This is concrete evidence of the remaining integration mismatch between native-first paired override rules and the prior optional-omission path; do not claim seamless optional-failure UX is complete.

## Graph evidence

Verify tier. list_projects confirmed deck root. New role/overlay query returned zero rows (complete response), not an absence claim. Policy query returned 8 stale symbols. Coverage checked 14 exact source paths plus core/session scope: modern paths not_tracked, old install paths metadata_changed; generation 2026-08-20T17:25:00Z. Current exact source reads and targeted literal searches supplied fallback. No reindex or graph writes. No exhaustive structural claims.

## Verification

Final focused evidence:

- `/tmp/deck-parity-final-focused.log`: 201 pass, 0 fail, 2745 assertions across 19 files. Includes accepted Setup/continuation paths, managed query permissions, native/session search and launch parity, overlay/guard policy, Web readiness integration, native Claude install/credential cases, Pi generator/model preservation, and release-transport timeout recheck.
- `/tmp/deck-parity-final-targeted.log`: 3 pass, 0 fail, 27 assertions. Exact affected TUI static-search and OpenCode read-only materialization expectations; 115 unrelated tests filtered.
- `/tmp/deck-parity-final-core.log`: 4 pass, 0 fail, 20 assertions after adding the real-date expiry check and conservative coordination refusal.
- `bunx tsc --noEmit`: exit 0; `/tmp/deck-parity-final-tsc.log` empty. `git diff --check`: exit 0; `/tmp/deck-parity-diff-check.log` empty.
- `bun run test:changed`: exit 1, 7271 pass / 3 skip / 22 fail, 68760 assertions over 582 files; `/tmp/deck-parity-changed.log`. This diagnostic run overlapped identified fixes and Pi regeneration; it is NOT a clean frozen-candidate acceptance. All named failing areas were covered by the final scoped checks above. The nested `(fail) value` emitted by scripts/test.int.test.ts was an intentional subprocess failure fixture, not a further candidate failure. No broad rerun or test:full was run.
- Pi bundles regenerated with `bun run scripts/generate-pi-extension-assets.ts`; log `/tmp/deck-parity-pi-generate.log`. A local Claude plugin validation test ran without a model call; this is not live model/tool-consumption proof.

`source-manifest.json` records hashes for the 45 paths touched in this continuation. It is current-byte evidence, not an exclusive patch attribution; several paths contain earlier accepted work. Source was not isolated from all external editors. OpenSpec and the unrelated web-terminal brief were not edited by this continuation.

Recommended integration status: retain as a partial functional candidate, with scoped evidence above. Do not close S1/S2/S3/S8 or native-readiness parity wholesale. Native Codex MCP enforcement and non-Claude native role selection are actual remaining implementation/safety gaps, not normalized parity success.
