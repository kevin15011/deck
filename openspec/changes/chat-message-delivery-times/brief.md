# Lead message delivery times and Thinking feedback

Show the local time of each Codex Lead message, using its first nonempty text delta. Streamed chunks from one item share one timestamp. Keep copy and read-receipt behavior, including Unicode offsets. In existing conversations, reconstruct times only where the ordered ledger matches the saved text. Keep the existing receipt timestamp as fallback. Animate the live Thinking indicator and honor reduced motion.

The reported turn contained six messages across 25 minutes. The working tree updates native receipt capture, historical recovery, and transcript presentation. Verification uses the historical turn in an isolated database, a Unicode boundary fixture, and the packaged browser flow with a synthetic Codex runner.

Verified and published the release candidate with SHA-256 7643f979d992fb21104499cd15fe24f1f6d1f09c4d3c623035915204b4029c1d. The focused Rust harness passed two tests including reproduction on the reported turn. The embedded UI passed all ten browser checks in 19.4 seconds, including native multi-item streaming, reload and reduced-motion feedback.

Follow-up: only show live Lead activity for a running receipt. Hold the synthetic runner before native acknowledgment to verify that preparation and Thinking cannot appear together, then release the same turn to verify the animated running state. Stale attention badges are being addressed independently in Deck task 73dece6f-dbac-4450-864c-6d082f6c1976. Package both changes after integration.

Per-message copy: bind the header copy action to the first native message and place a copy action next to each subsequent timestamp. Exclude only the host-inserted blank line at an item boundary. The browser regression checks both clipboard results and existing keyboard, accessibility, streaming and legacy behavior. The sidebar warning fix was integrated after a focused rerun (six tests).

Active Lead progress uses the running receipt phase. Earlier text may remain visible while tools execute. The focused regression reproduced the former text-dependent state and now passes for both an empty transcript and an earlier progress message.
Frontend typecheck, asset build, and six sidebar-state tests passed. Release publication pending: the full Rust suite failed the contracts test for an incompatible native version (Completed instead of Failed), reproduced in isolation.
