# Host-local dictation and dedicated settings

## Authorized outcome

Implement speech-to-text for the Web UI composer, exclusively on the computer running Deck. Users explicitly download and select models from Web UI settings. No automatic model downloads, cloud provider, silent fallback, or browser-native recognition backend. The agreed research context maps the three choices to multilingual Whisper small, large-v3-turbo Q5 and large-v3-turbo Q8; exact artifacts and runtime must be pinned during design.

Replace the settings popup with a dedicated extensible settings view. Preserve existing settings functionality and navigation back to the session. Users decide how much hardware resource to dedicate; describe tradeoffs without promising unmeasured accuracy or RAM requirements.

## Visual agreement

Preserve Deck's existing dark palette, typography and dense developer-tool identity. Use a structured settings navigation and content region on desktop, responsive navigation on mobile, accessible labeled model selection and explicit download controls with progress/status. Existing baseline-ui craft governs spacing and hierarchy; frontend-ui-engineering governs implementation; GSAP conventions govern transitions, reduced motion and cleanup. This is a settings layout expansion, not a platform visual redesign.

## Behavioral boundaries

- Record, stop and cancel; final transcription enters the editable session draft, never auto-sends.
- Preserve typed edits and reject stale callbacks after navigation/cancellation.
- Audio processing stays on the Deck host; remote mobile capture requires secure authenticated transport.
- Model acquisition is explicit, bounded and verified before use. Expose download failure/cancellation and installed state accurately.
- Load the chosen model only when needed and release resources appropriately; browsing settings must not load inference models.
- Runtime delivery, supported platforms, codec handling, model integrity, concurrency and persistence require an implementation-ready design against repository composition.
- No user model downloads, paid services, commits, deployment or daemon restart are implied by implementation work.

## Status and verification

User approved implementation scope after documentary research. Architecture design is complete on task-2b7431e7-82dc-4857-be08-0d54f2e04cfd. Lead owns this artifact. Research report: /private/tmp/deck-stt-dictation-research-2026-11-07.md. No actual Deck accuracy or hardware benchmark has been performed.

Verify download lifecycle, authenticated transport, resource limits, cancellation, model selection, draft preservation and browser desktop/mobile navigation. Use real runtime evidence where feasible and clearly separate mocks from actual transcription. Run affected tests during implementation, final repository gates and independent review proportionate to native process/download and audio boundaries.

## Implementation decisions

Architecture handoff: `/private/tmp/deck-dictation-design-2026-11-07.md`, architect attempt 2 (240322/240323). Use its pinned model catalog as a starting point, verifying metadata before implementation. Three multilingual choices: small Q5_1, large-v3-turbo Q5_0 and Q8_0.

- Initial native runtime is a detected compatible host-installed whisper-cli, with clear missing-engine instructions. Never execute Homebrew, compile dependencies, download runtimes automatically, or publish binaries. Linux managed acquisition can be implemented only after verified distribution/extraction evidence; an external compatible runtime is a valid explicit path. Model downloads remain fully Web UI managed on all supported hosts.
- Existing authenticated paired devices may explicitly manage these host-wide resources, consistent with settings authority. Never accept executable paths, model paths or arbitrary URLs from the browser.
- One child transcription process at a time, on-demand; one model download at a time. Release child resources after completion/cancel/timeout. Account for work in daemon admission/drain/idle/restart.
- Strengthen the proposed model reconciliation: matching size alone does not prove an existing model is verified. Validate digest before trusting it, cache only with reliable identity/invalidation, and reject symlinks/unsafe state paths.
- Use bounded PCM/WAV capture and strict decoding with no implicit ffmpeg dependency. Bound pre-resampling browser buffers as well as HTTP payload, duration, output and child lifetime.
- On backgrounding/interruption stop microphone capture and expose an interrupted state; do not initiate transcription automatically. Session navigation cancels pending capture/results in v1. Final insertion must preserve selected and concurrently typed text; no deletion disguised as insertion.
- Settings is a dedicated navigable view, not a popup; preserve appearance, notification, install and restart controls. Honest labels describe model sizes/resource tradeoffs without unmeasured quality claims.
- Mock engine/browser tests establish lifecycle only, not real transcription accuracy. Real model acquisition on this host remains a user UI action; report unperformed real checks explicitly.

## Implementation candidate under review

Owner task-85b52aad-3949-4c2e-b94a-c37d1c98274e attempt 1 (242443/242444), handoff `/private/tmp/deck-dictation-handoff.md`. Independent review task-e231af57-b4fc-434a-85c0-ab78c40b8791 is active. Reported final gate: 4,725 passed, zero failed, one skipped; TypeScript and Chromium desktop/mobile fixture flow passed. Lead inspected mobile Settings screenshot and checked candidate inventory.

Implemented boundaries: external compatible whisper-cli on all hosts, no runtime acquisition API; explicit verified model downloads; on-demand child process; timing-only telemetry (no measured RSS). Browser recordings are capped at five minutes or sixteen million raw samples and interruption currently cancels/discards. This capture-limit behavior is included in review. No real Whisper model/engine transcription, physical iOS/Safari or native Linux execution has been verified; mocks prove lifecycle only. No commit or installed-build acceptance.

## Review corrections

Independent review attempt 1 (243992/243993) found: production listener body ceiling below valid dictation size; capture limit discards recorded audio, including before the warning at high sample rates; language validation coerces arrays and persists an invalid type. Lead confirmed source and requires repair.

Supersedes the capture-limit discard decision above: reaching the bounded duration/sample limit must stop the microphone and retain the bounded recording for explicit Transcribe or Cancel, never upload automatically. Warn based on the effective sample-rate-dependent limit. Explicit cancel/navigation remains cancellation. Align production listener and endpoint limits without relaxing existing image/JSON endpoint limits. Language values must be strings in the allowed enum before any persistence.

## Accepted source candidate

Implementation attempt 2 (245501/245502) and independent review attempt 2
(246448/246449) resolve all three review defects. Lead matched all 29 source/test
hashes to `/private/tmp/deck-dictation-repair-files.json` and independently ran
`TMPDIR=/private/tmp /private/tmp/deck-ma31-tools-jiqq8d0o/bun test packages/session-host/src/dictation/web.test.ts`:
3 passed, zero failed, 1.038 seconds, including the production listener accepting
7,040,044-byte audio and rejecting oversized bodies. Review independently probed
capture/worklet/language behavior; its listener evidence was reused due to its
sandbox restriction, now supplemented by this Lead execution.

Final unchanged implementation gate: 4,730 passed, zero failed, one skipped in
72.31 seconds; TypeScript passed. Browser desktop/mobile fixture checks passed.
Evidence: `/private/tmp/deck-dictation-repair-handoff.md`. The historical candidate
section above records the superseded initial attempt, not current acceptance.
Capture limits now retain audio for explicit Transcribe/Cancel; cancellation and
navigation discard it. No automatic upload/send is introduced.

Source review is accepted. Real Whisper transcription accuracy, physical
Safari/iOS and native Linux execution, and installed-build acceptance remain
unverified. No model/runtime acquisition, commit, deployment or daemon restart
was performed for this acceptance.

## User field feedback — 2026-11-07

User reports successful operation with all three downloaded models on the installed
canary: Small produced poor transcription; Q5 produced good transcription and
good perceived speed; Q8 produced incorrect text, possibly interpreted as another
language by the user. Screenshot shows the draft result, not original audio,
selected language or detected-language metadata. This is qualitative user evidence,
not a controlled accuracy/latency benchmark. Historical statements above that no
real inference had been tried are superseded by this user report, not by an
independently reproduced inference test. Read-only language/argument diagnosis is
in progress; no automatic settings/model change is authorized by this feedback.

## Revised scope — single-model release preparation

User now requests only Turbo Q5, removal of Q8 and Small, commits and preparation
for the next release. This supersedes the three-model product requirement. Keep
explicit download and draft-only dictation. Remove unused model choices throughout
contracts/UI/catalog/docs/tests and safely handle saved selections of retired IDs.
Remove only exact verified retired Deck model files on this host; preserve Q5 and
unknown or modified files. No automatic model download. Prepare conventional
commits and release evidence. Tags, pushes and publication require a subsequent
explicit user confirmation under the repository release skill. Lead owns OpenSpec.

## Pre-release UI correction — pending implementation

User requests removal of the persistent successful-dictation banner above the
composer (`Dictation added to your draft.` and its settings link). Successful
transcription should insert the draft and return to idle without a visible success
alert. Preserve accessible announcement where useful, actionable errors, recording/
processing controls and retained-audio Transcribe/Cancel. Verify repeated dictation,
send/reset and mobile layout without residual banner, following existing GSAP and
reduced-motion conventions. This correction is required before commits/release.
The active implementation attempt could not accept a continuation while running;
Lead must pass this requirement to the same owner when that attempt returns.

## Release preparation checkpoint

Attempt 5 (250705/250706) prepared Turbo Q5-only source and version 0.15.0,
with authenticated deletion of the exact verified retired host models while
preserving Q5/settings. Release acceptance remains blocked: incomplete full-suite
run at the 120-second budget with shutdown EPERM, and checkout-independent compiled
smoke reconnect failure. The success-banner correction was delivered to the same
owner in attempt 6 together with bounded diagnosis of those failures. No commits,
tags, push or publication yet. Evidence: /private/tmp/deck-dictation-single-model-handoff.md.

## Final source review

Quality attempt 3 (253740/253741) recommends source acceptance for Turbo Q5-only
selection, safe retired-ID handling and removal of the visible success banner.
Lead matched the current source inventory to the two implementation handoffs.
Independent persistence probes passed; matching browser/affected/types/build
evidence remains valid. Accept source scope, not release qualification. Version
0.15.0 and changelog are prepared. Full-suite deadline and complete compiled
checkout-independent reconnect smoke remain open; implementation owner attempt 7
is pursuing isolated qualification using accessible existing Docker. No commits,
tags, push or publication have been performed.

## Release gate status after bounded profiling

Attempt 7 (254885/254886) passed all 67 compiled Linux arm64 smoke checks in an
isolated container with no mounts/checkout. Attempt 8 (256815/256816) introduced
a two-file Pi plan-scoped receipt-hash correction, with 47 planner tests and
12 recovery tests passing plus types. It is under independent review. The full
120-second canonical suite remains failing on candidate and unchanged HEAD in
available environments; no policy exception or release readiness is asserted.
Do not continue blind retries or widen optimization scope. Evidence:
/private/tmp/deck-dictation-gate-profile-handoff.md. Commits remain pending required
gates; no tag/push/publication authorized.

## Authorized diagnostic timing run

User explicitly requested temporarily omitting the global suite deadline to measure
completion time and assess the limit. Same implementation owner will run the full
selection with four workers and unchanged individual timeouts/assertions. Only a
disposable diagnostic global-deadline override is authorized; no permanent policy
change or publication is implied. Record complete results, slow files and total
wall time, including preparation/output drain, before recommending a new budget.

## Measured unrestricted diagnostic result

Attempt 9 (258780/258781) completed all 517 files in 163.397 seconds with
4,730 passed, 3 failed and 1 skipped. Only the global cutoff was bypassed in
a disposable harness; canonical policy/source remained unchanged. Two recovery
cases exceeded 15 seconds and a Claude install case exceeded 5 seconds. Recovery
also emitted sysctl process-identity errors whose cause is not established.
Increasing only the global budget would not yield a passing suite. One failing
observation is insufficient to set a reliable replacement threshold. Evidence:
/private/tmp/deck-dictation-unlimited-timing-handoff.md. No release/commit gate
exception or permanent policy adjustment follows from this diagnostic permission.

## Authorized continuation after timing analysis

User requests proceeding with Lead judgment. Diagnose and repair the three
individual failures before selecting a new global budget. Preserve recovery
assertions and process-identity safety; distinguish product errors from test load.
Use complete diagnostic measurements to justify any eventual budget proposal,
not a blanket increase to mask failures. Continue toward reviewed commits and
release preparation; tag/push/publication remain separately gated.

## Successful diagnostic and deadline proposal

Attempt 10 (260481/260482) completed all 517 files: 4,733 passed, zero failed,
one skipped, 160.602 seconds. Two intentional ten-attempt global recovery cases
now allow 30 seconds; one multi-install Claude case allows 15 seconds. Assertions
and production checks are unchanged. Native sysctl SIGTERM evidence coincides
with test-deadline cleanup; no production identity relaxation was introduced.
Independent review is pending. Lead proposes a 240-second hard global bound,
retaining four workers, full output drain, process-group cleanup and 2-second
file warnings. This is practical headroom over observed160-163s, not a percentile
guarantee. Policy implementation and canonical run follow acceptance; no release
readiness yet. Evidence: /private/tmp/deck-dictation-timeout-repair-handoff.md.

## Global deadline decision

Quality attempt 5 (261399/261400) accepts the narrow fixture deadline changes and
the practical 240-second proposal. Under the user's proceed-with-judgment scope,
Lead adopts a 240-second hard global budget with unchanged four-worker scheduling,
2-second diagnostic warnings, output drain and process-group termination. Same
owner implements canonical configuration/current guidance and runs the enforced
full suite before commits. Historical diagnostic policy evidence remains intact.

## Final canonical gate acceptance

Lead reviewed the attempt-11 policy diff, full-suite log and metadata, and matched all eleven recorded current input hashes. The canonical 240-second supervised run completed 517/517 files: 4,733 passed, zero failed, one skipped, in 163.47 seconds. Types, Darwin build and local draft descriptor passed. Linux real process termination and output-drain checks passed; the macOS termination probe remains unqualified due to EPERM. Earlier product and Pi source reviews remain applicable.

The user-authorized commits may now proceed in four groups: dictation/settings (including this working brief), Pi receipts, test deadlines, and 0.15.0 release metadata. Publication remains pending explicit confirmation. The final release must rebuild from the committed revision; the host-only draft is not a published four-platform descriptor.
