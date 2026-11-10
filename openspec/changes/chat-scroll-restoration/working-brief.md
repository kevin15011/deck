# Chat scroll restoration

## Intent and authority
User reports that after reaching the bottom, switching chats restores an incorrect upper position. Fix persistent per-chat scroll behavior in the existing /home/kevin15011/deck worktree. Codex installer recovery continues independently; do not change its implementation or original driver/startup edits.

## Acceptance
- Reproduce the reported switch-away-and-return behavior before fixing it.
- Returning to a chat last viewed at the bottom restores and follows its current tail, including asynchronous history hydration and message/layout growth.
- A chat deliberately left above the bottom retains its reading anchor independently of other chats.
- Rapid switches and stale asynchronous callbacks cannot overwrite another chat's state. Explicit reply/deep-link navigation remains intentional.
- Verify actual browser behavior for chat switching, workspace/tab transitions, keyboard input and reduced motion, plus focused regressions.
- Any motion uses GSAP per project policy; do not animate restoration when immediate positioning avoids visible jumps.
- Run typecheck and coordinate full-suite verification with concurrent installer work; do not publish.

## Initial evidence and status
Graph generation 2026-08-20 fast has no web scroll symbols and exact candidate paths are not tracked, requiring source fallback. Literal search identifies main.tsx chat navigation anchors and following state, workspace.tsx per-session positions, view-motion.ts DOM-keyed scroll restoration, and progressive-transcript.tsx history anchoring. No root cause established yet. Implementation delegated; Lead owns OpenSpec writing.

## Handoff review
Apply task task-1d56b610-b75d-435c-88ba-68e00e63c1e3 attempt1 reproduced the stale-anchor switch-return failure in Chromium. Candidate clears old anchors when following tail, restores latest per-chat observations (including no anchor), ignores unavailable geometry/stale callbacks and excludes the owned conversation scroller from panel offset restoration. Lead reviewed source diff and /tmp/deck-chat-scroll-browser/browser.json with seven passing scenarios, and independently ran navigation.test.ts:23 passed,0 failed. Apply reports33 focused tests and tsc passing. Broader navigation browser harness failed on Close origin pointer interception after eight checkpoints; acceptance remains pending. Same owner attempt2 must diagnose/resolve it and verify browser history/secondary closing without masking overlay defects. Combined full gate waits for concurrent installer candidate to settle. No publication.

## Scoped verification accepted
Attempt2 fixed the additional manual-upward-scroll/reflow race with Chromium red/green evidence. Eight scroll cases,18 broader navigation checkpoints, secondary navigation at320/390/1280px,33 focused tests and typecheck passed. Lead reviewed the followup and verified all215 web input hashes against /tmp/deck-chat-scroll-browser/web-inputs.sha256. Close-origin pointer overlap and installation-return focus defects also reproduce on baseline; ordinary keyboard navigation was exercised without forced clicks. These baseline limitations remain disclosed, outside this scroll fix. Scoped change accepted; combined full gate started by Lead after implementations/browser checks finished, session94987, log /tmp/deck-combined-final-suite.log. No commit/publication.

Combined quiet normal-storage full gate exited1 after240s with318/523 files completed; no complete assertion summary. This repeats the timeout without concurrent browser/edit work. Investigation task task-423eb0da-d5d4-4ff5-a746-f2bebbfafb2a attempt2 now measures representative sync-heavy tests to isolate the cause. Global acceptance remains pending; no budget extension, exclusion or quarantine applied.

Final combined verification subsequently completed524/524 files in190.85s with justified tmpfs storage after the separately documented model-integrity fix:4788pass1fail. Remaining unchanged OpenCode legacy-upgrade test exceeded5s under suite load and passed isolated. Scroll-specific implementation/browser/typecheck evidence is accepted; no green full-suite or published-release claim. Changes remain in the requested existing worktree.
