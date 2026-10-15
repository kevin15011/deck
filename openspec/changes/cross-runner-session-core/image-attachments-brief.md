# Clipboard image attachments

## User outcome and scope

The user requests pasting multiple images into a message, small removable thumbnails above the composer, short image references in conversation, and an image viewer with zoom. Images must reach the Lead as usable visual input and remain usable with the durable prompt queue. Browser Windows to Deck in WSL, Linux and macOS are in scope. Existing dark/light themes and compact workspace composition remain authoritative.

Capture image bytes from a user-initiated browser paste event. The clipboard belongs to the browser's operating system, not the daemon's system. Transfer bytes through the authenticated web service and store session-owned files on the daemon side; do not invoke operating-system clipboard tools or translate client filesystem paths. Ordinary text paste must remain intact. Add a file-picker fallback if needed for mobile/browser clipboard limitations.

## Decisions and boundaries

Use opaque attachment identifiers in commands and structured public metadata in queued and delivered messages. Never expose local storage paths or inline image bytes through event logs, normal chat text or public attachment metadata. Keep any native runner filesystem paths private to the host/adapter. Prefer verified native image input over assuming the model can inspect a text path. An image-only message is valid; text-only compatibility remains unchanged.

Use managed session attachment storage rather than disposable operating-system temporary files. Accepted queue/history references must survive daemon restart and browser reload. Cancellation must not delete another message's image. Bound image count, file size, aggregate message size and upload resource use. Authenticate image reads/uploads, validate formats and reject client-supplied paths, unsupported content and cross-session identifiers. Exact transport/storage lifecycle and native driver shapes are being verified before implementation.

Draft images remain session-local and visible until durable prompt acceptance. Failed uploads or sends preserve the draft; late responses must not alter a different session or newly edited draft. The UI must distinguish uploading, failed, queued and actually delivered attachments. Preview URLs must be cleaned up. The modal must support keyboard close, focus restoration, zoom controls and small viewports.

## Visual agreement and ownership

Preserve the accepted minimal dark-default/light-optional interface, typography, density, SVG icon language and existing composer. Place a compact thumbnail strip immediately above the input, with remove controls per image. Render short image labels/previews in queued and sent messages, opening a shared zoomable viewer. No unrelated layout, palette or sidebar redesign. The UI owner applies frontend-ui-engineering and fixing-accessibility responsibilities within this existing direction; no additional general aesthetic is introduced.

Lead owns OpenSpec and integration/activation. Existing host owner owns storage, web transport, commands/events and queue integration. Existing UI owner owns draft capture, previews, chat/queue rendering and browser evidence. Focused investigation owns runner protocol evidence; implementation ownership will be assigned after the shared contract. Independent Quality reviews attachment access, resource bounds, queue durability and native dispatch. No provider inference or user configuration mutation is required.

## Platform evidence

Retrieved 2026-10-15 from MDN: [Clipboard API](https://developer.mozilla.org/en-US/docs/Web/API/Clipboard_API) identifies the clipboard with the operating system hosting the browser; [DataTransferItem.getAsFile](https://developer.mozilla.org/en-US/docs/Web/API/DataTransferItem/getAsFile) exposes file items from transfer events. Microsoft [WSL networking](https://learn.microsoft.com/en-us/windows/wsl/networking) documents Windows browser access to Linux applications through localhost. These establish the architecture, not a claim of manual Windows/WSL testing on this macOS machine. Native clipboard/browser availability will be reported honestly alongside automated byte-transfer and browser-event coverage.

## Accepted integration contract

- `POST /api/sessions/:id/attachments?name=<optional bounded display name>` accepts raw image bytes with an exact supported Content-Type. Return `{ok:true,data:{attachment:{attachmentId,mimeType,name,sizeBytes,width,height}}}` after private file/metadata persistence.
- `GET /api/sessions/:id/attachments/:attachmentId` serves authenticated, session-owned image bytes with no-store and nosniff. No filesystem paths are accepted or returned. CSP permits local blob previews while retaining existing restrictions.
- `prompt.send` adds optional ordered `attachmentIds`; public `prompt.queued`, queue snapshots and delivered user `message.completed` carry the corresponding public descriptors. Empty text is accepted only with attachments. Deduplication includes exact text and ordered identifiers. IDs must be unique and belong to the selected session.
- Limits: eight images per message, 5 MiB per file, 20 MiB aggregate per message; PNG, JPEG and WebP; maximum 16,384 pixels per axis and 40 megapixels. Validate format signatures/structure and dimensions on the server, rather than trusting names/MIME. Retain the existing command JSON limit separately from the larger image-upload body allowance.
- Store immutable files and private metadata under session-owned opaque IDs. Accepted references are retained with history, including terminal/cancelled prompts. Unreferenced staging is bounded to 32 items/100 MiB per session and lazily expires after 24 hours. Cleanup must consult durable references and serialize against acceptance. Removing a draft drops its local reference; there is no public deletion API in this increment.
- `DriverTaskInput.images` and optional `DriverTaskHandle.send` images use private descriptors `{path,mimeType,name}`. Claude receives native base64 image blocks, Codex receives localImage input, and OpenCode receives native file parts with bounded data URLs. First, resumed and subsequent turns must preserve exact attachment order without inheriting previous-turn images. Add a concise inspection instruction in private runner context. Missing files or native/model rejection fail visibly rather than claiming successful image inspection.

Installed Codex schema evidence is `/tmp/deck-image-input-protocol/v2/TurnStartParams.json`; Claude's [streaming input documentation](https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode) confirms image content blocks; installed OpenCode 1.18.31 schema and file-part conversion were inspected locally. These verify native protocol shapes, not a real-provider vision result or compatibility with every model.

## Status

Contract approved for implementation. Host/core, UI and native adapter owners are implementing in parallel. No image capability is activated yet. Prior queued-message activation remains current.

## Acceptance scenarios

- Given a Windows browser connected to a WSL daemon, when the user pastes two image files and sends them with text, then the browser uploads bytes, the queued record binds two opaque identities, and the selected native driver receives two image inputs in the same order. No Windows path or browser blob URL is sent to the runner.
- Given an active Lead and a queued image message, when the browser reloads or the daemon restarts safely, then the queued attachment references and authenticated previews remain available. Cancelling that pending message does not delete an image referenced by earlier history.
- Given an upload or send is pending, when the user switches sessions, removes an image or adds another draft image, then late responses affect only the captured session and draft identities. Failed submission preserves the relevant draft; successful acceptance clears only its submitted images.
- Given a short image reference in delivered chat, when it is activated by keyboard or touch, then a fitted preview opens with bounded zoom, Escape dismissal and focus restoration, without expanding the underlying document viewport.

## Verification checkpoints

Native adapter candidate passes 161 tests/626 assertions with structured input, fresh/resumed/follow-up order and no attachment inheritance; source confirms Claude input uses a raw supervised stdin pipe, not the 1 MiB control-message channel. Root compiled smoke now checks actual image uploads, authenticated byte reads, native Claude image block digests, queued metadata, cancellation retention and restart. It fails against the previous installed binary at missing upload support, as expected. Initial host tests pass image-only/queued dispatch, native continuation, cross-session rejection, retention/restart and missing-file admission failure. Independent review is correcting contradictory WebP dimensions and bounding concurrent upload bodies; these are not yet final activation evidence.

## Clipboard image attachments — complete and activated (2026-10-15)

The composer accepts pasted image files and multi-file selection, with session-local removable thumbnails, upload/error/retry feedback, image-only messages and draft-safe submission. Queued and delivered messages show compact image references opening a keyboard-accessible fitted/zoomable viewer. The host stores immutable session-owned attachments behind authenticated upload/read routes; accepted queue/history references survive cancellation and restart. Claude, Codex and OpenCode receive native structured images. Ordered private file references let the Lead work with/delegate the current images, while public events mask managed paths and image payloads. See `image-attachments-brief.md` and XR-15.

Limits: eight PNG/JPEG/static WebP images, 5 MiB/file, 20 MiB/message, 16,384 pixels/axis and 40 MP. Staging is limited to 32 files/100 MiB/session, with 24-hour lazy expiry only for unreferenced uploads. Eight concurrent upload bodies are admitted with bounded buffers and abort/deadline release. Format checks reject contradictory encoded dimensions and unsupported animated WebP. Referenced history files are retained. Browser clipboard bytes cross HTTP, so Windows client paths and OS clipboard utilities are unnecessary for WSL.

Verification: Root integrated host/core/three adapters/CLI/schema suite722/3,941 (`/tmp/deck-images-integrated.log`); UI/assets/docs75/1,062 (`/tmp/deck-images-web-checks.log`); final TypeScript, canonical schema generation and four-target compilation pass. The final private-context-only delta passes focused1/17 and independent re-review. Actual-browser image6, existing queue6 and workspace17 pass (`/tmp/deck-web-images-{browser,queue,workspace}.log`); desktop dark and mobile320/390 dark/light captures were inspected. Independent Quality approved host/native/UI and the real daemon forwarding correction; its28/165 plus final1/17 overlap owner/root suites and are not additive coverage. Installed compiled smoke51 passes (`/tmp/deck-images-installed-smoke.log`), proving actual authenticated uploads/reads, two Claude native image block digests, queued references, cancellation retention, cross-session rejection and daemon restart persistence.

Installed payload `81f097966a10735694cbe01ed051466ab0fa5cccb3dffe4a575b5ab41f77df18` is active after guarded idle restart PID89639→99820 at2026-10-15T17:20:33.870Z. Status confirms no running work/pending approvals; web http://127.0.0.1:7421. Reload the web for the new controls. No user configuration, commit or publication was changed.

Evidence limits: browser tests use File/ClipboardEvent payloads and real file-picker interaction on this macOS environment, not a manual Windows/WSL OS-clipboard exercise. Native protocols are verified with isolated fake runners, including the compiled supervised Claude boundary, without real provider inference. Selected models must support images; actual OpenCode server body-limit/provider vision behavior was not independently exercised. Native rejection remains a visible failed turn.
