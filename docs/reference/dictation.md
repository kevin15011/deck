# Host-local dictation

Open **Settings → Dictation**, explicitly download a model, and choose **Use**.
The host also needs a compatible `whisper-cli` from whisper.cpp on its PATH.
Deck checks the CLI flags it needs. It does not install the engine or run a package
manager. On macOS, users can install `whisper-cpp` through Homebrew themselves.
A host administrator can set `DECK_WHISPER_CLI` to an executable path before
starting the daemon; browser requests cannot supply executable or model paths.

Capture requires a secure browser context: loopback on the host, or authenticated
HTTPS access for another device. Deck allows the microphone only for its own
origin. Capture uses an AudioWorklet and converts audio to 16 kHz mono PCM WAV;
no browser speech-recognition service or ffmpeg is used.

**Start dictation**, **Stop**, and **Cancel** belong to the composer. Stop releases
the microphone before converting and uploading audio. The host runs one native
transcription at a time, then releases the process. Results enter the current
draft without deleting selected or concurrently typed text. Sending remains an
explicit composer action. Leaving the session, opening another view, hiding the
page, or cancelling discards pending dictation. There is no automatic send or
background transcription.

Recordings stop at five minutes or 16 million raw samples, whichever comes first.
At the capture limit, the microphone stops and the bounded recording is retained
for explicit Transcribe or Cancel. The warning uses the effective sample-rate
limit (about 167 seconds at 96 kHz). Navigation or interruption still cancels
pending dictation without uploading it. Audio uploads are
limited to 10 MiB. Native work has a duration-based timeout (one to ten minutes),
a 1 MiB combined diagnostic-output limit and a monitored 1 MiB JSON-output limit.
Long browser conversions yield between audio blocks and remain cancellable.
Silence is filtered before upload, but this does not guarantee rejection of all
non-speech or Whisper hallucinations.

Saved Small or Turbo Q8 selections become unselected. Choose Turbo Q5 explicitly;
Deck does not download a replacement or automatically remove retired model files.

Models and settings are host-wide, shared by authenticated paired devices. Only
an explicit download action fetches model data. Downloads are streamed, checked
against exact byte counts and SHA-256 digests, and installed atomically. Existing
models are rehashed at startup and when their filesystem identity changes. Audio
and JSON outputs use private temporary files and are removed after native work;
stale files from interrupted runs are cleaned at startup. Audio and transcripts
are never logged by the dictation service.

The multilingual Turbo Q5 artifact is pinned to `ggerganov/whisper.cpp` revision
`5359861c739e955e79d9a303bcbc70fb988958b1`:

| Model | Download bytes | SHA-256 |
| --- | ---: | --- |
| Large v3 Turbo Q5_0 | 574041195 | `394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2` |

Metadata was checked against the [pinned model tree](https://huggingface.co/ggerganov/whisper.cpp/tree/5359861c739e955e79d9a303bcbc70fb988958b1)
on 2026-11-07 without downloading weights. File size does not predict inference
memory. Deck has not benchmarked Spanish accuracy,
latency, or inference memory. Each request pays model loading costs; no inference
process stays resident when idle. Physical iOS/Safari capture still needs device
validation. Browser acceptance uses a generated tone and a fixture native CLI;
it proves the lifecycle and draft behavior, not speech-recognition accuracy.

Settings also contains Appearance, Notifications, and App sections. Theme, font,
notification, install, and restart controls retain their effects. Mobile Settings
has its own section list and Back navigation.
