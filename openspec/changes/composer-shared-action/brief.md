# Shared composer action

Restore a single primary composer button in the same position for sending and stopping the current Lead turn. Follow the existing composer-stop browser scenario and keep drafts, attachments, queued messages, retry and session scoping intact. Preserve the existing sidebar effort. Verify idle, running, stopping and settled transitions through the normal browser UI.

Implemented and independently verified against packaged host cb0cff88b8c8ddeef412ec06bb2f8680cb3532cc28ae8c160f1a8bff76f21c9d. Chromium passed 13 scenarios in 19.7 seconds with the synthetic native edge, including cancellation during permission wait, retry and mobile Enter. Eight focused component and keyboard checks passed. The permission scenario awaits the asynchronously opened inspector before closing it. The delegated attempt produced no final report; verification used the source and package directly.
