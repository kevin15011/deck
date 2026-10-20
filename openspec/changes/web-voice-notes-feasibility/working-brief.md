# Web voice notes feasibility

Status: research only. No implementation, installation, audio capture or provider call authorized or performed. The user requested comparison of model-native audio with Whisper-style transcription, including capability-based availability.

## Recommendation

For spoken instructions to the Developer Team, start with transcription into an editable draft, then explicit ordinary message submission. This decouples microphone input from the Lead's audio modality and reuses existing queue, decision-target and admission semantics. Native audio remains a separate, capability-gated extension when the original sound matters. This is a recommendation, not an approved implementation plan.

The microphone requires browser capture support, user permission, a secure context and an available transcription backend. Native-audio submission additionally requires actual model audio-input support, verified runner transport and host support. A generic multimodal label or image capability is insufficient. Missing modality metadata must mean unknown, not enabled. Enforce capability on the host as well as in the UI.

## Current code evidence

Investigate task `task-5913e085-4348-4b61-92cf-ba90375b48fb`, attempt 6, inspected the current source and installed protocol types:

- `packages/core/src/session/driver.ts`: image-only structured attachments; no audio in the driver input/send contract.
- `packages/session-host/src/attachment-store.ts` and `web-service.ts`: bounded private image upload with format validation; audio is not currently accepted. A new temporary audio-upload/transcription surface would be required even when only text reaches the runner.
- `apps/web/src/main.tsx`: image picker/paste, no microphone capture. Recording previews also require deliberate CSP media handling.
- `packages/core/src/runner-adapter.ts` exposes optional `inputModalities`; Codex discovery populates it, but the host/Web do not currently use it as an audio capability gate. Missing metadata in other adapters needs explicit handling.
- Codex 0.162.1 schema evidence includes audio/localAudio input and audio modality metadata; current Deck encoding sends text/localImage only. No selected-model audio acceptance or format/size contract was runtime-tested.
- OpenCode installed SDK types expose audio modality/capability metadata and file parts; end-to-end provider delivery remains unverified. Claude's Deck encoder implements text/images; this study did not establish an audio transport contract and does not claim the underlying runner can never support it.

Schema presence is not runtime support. Realtime voice sessions are a different integration from attaching a voice note to an existing coding turn.

## Options and tradeoffs

| Path | Benefit | Cost or limitation |
|---|---|---|
| Local Whisper-compatible engine, such as whisper.cpp on the daemon host | Audio need not leave the user's infrastructure; text works with every current Lead | Model/runtime setup, memory and compute contention with runner work; actual Spanish/technical-term accuracy and latency need measurement |
| Hosted transcription backend | No local model management; independently replaceable transcription provider | Audio egress, network dependency, separate service credentials and billing; do not assume a runner subscription covers it |
| Native audio to the selected model | Can preserve audible information that text omits | Per-model/per-runner transport, format and authentication validation; larger attachment/recovery contract and no verified current Deck runtime path |

Whisper's local model ecosystem and the hosted `whisper-1` endpoint are distinct choices. Official OpenAI documentation currently recommends `gpt-transcribe` for new recorded-speech integrations. Its deprecation page schedules hosted `whisper-1` removal for February 26, 2027; that does not disable locally runnable Whisper weights or whisper.cpp.

## Proposed feasibility checks before choosing a backend

Compare the same short Spanish recordings with code identifiers, English technical names, pauses, silence and background noise. Measure transcript errors (especially negation, paths and identifiers), time to editable text, resource usage and operating cost. No claim that native multimodality or a particular transcriber is more accurate follows without this evaluation.

The browser flow should be record, stop, preview/transcribe, edit and explicitly send or discard. Preserve the originating session/draft during asynchronous transcription; never send to whichever session happens to be selected when it finishes. No decision resolves, dependent work starts or user authority is minted merely because audio was recorded or transcribed. Revalidate any targeted decision when the edited text is submitted/admitted. Define bounded duration/bytes, format negotiation, cancellation and temporary-file cleanup; avoid indefinite recording retention by default.

A phone connected remotely requires HTTPS for microphone capture; localhost is a secure-context exception on the local device, not a plain-HTTP LAN guarantee. Detect supported recording formats rather than assuming a single codec across Safari and Chromium. Local transcription means on the daemon host unless an explicitly different browser-based design is selected.

## Sources and limitations

Official sources retrieved during this study:

- [OpenAI file transcription](https://developers.openai.com/api/docs/guides/speech-to-text): recorded-speech API, model recommendation and transcription context.
- [OpenAI deprecations](https://developers.openai.com/api/docs/deprecations): hosted transcription retirement schedule.
- [whisper.cpp](https://github.com/ggml-org/whisper.cpp): local inference and Apple Silicon support.
- [MDN getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia): secure context and microphone permission requirements.

No microphone/browser compatibility spike, transcription benchmark, native audio provider test or pricing comparison was run. Final backend selection, retention policy and implementation scope remain open; no implementation is implied by this research.
