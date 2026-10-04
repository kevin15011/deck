# Pi cumulative completion recaps

## Authorized outcome
The user accepted cumulative summaries in actual background-completion replies. While the user is away, the latest completion reply should preserve the essential earlier answer/recommendation and previously completed results from the same conversation block, not only the newest result. No inspector, new shortcuts, unread UI/read receipts, full-answer replay, timer reminders or artificial model turns.

## Acceptance
- An actual new background outcome can produce one concise final reply containing the new result, earlier completed results in the same block, and the essential prior Lead answer/recommendation when relevant. Use the user's language and natural headings; do not turn every ordinary reply into a rigid template.
- A genuine new user message closes the previous block. This is a conversation boundary, NOT proof of reading. Native outcome wakes, ephemeral task boards, extension-origin messages, tool results and other synthetic events must not reset the block.
- Runtime support must preserve/reconstruct enough bounded, session-owned context for the recap, including across supported reload/restore paths. Distinguish recommendations, validated outcomes and pending/blocked work; do not promote suggestions into authorization or treat untrusted child reports as verified results.
- Later summaries must not recursively grow by copying earlier cumulative summaries. Avoid double-counting outcomes/attempts and repeating full responses. Bound retained context and represent any necessary truncation honestly.
- No extra wake, timer, unsolicited turn or new provider call is created solely to repeat a recap. Existing admission/deduplication, review/resolve, retries and lifecycle ownership remain intact.
- Preserve answer-last ordering: required tools, checks, OpenSpec writes and task resolution precede the final user-facing answer; then yield. Do not wait for still-running agents merely to build a recap. A later outcome is a separate continuation.
- Pi-only implementation and native materialization. No Core/other-runner changes, personal installation/configuration, live provider/network tests, commits or destructive Git operations.

## Scope and ownership
One Apply Deep owner traces and implements the complete vertical slice with proportional offline/native tests. Lead owns OpenSpec and final integration. The cancelled investigation `ef6c3ecd-568e-478c-9707-fc9afee6b0d8` remains settled; do not resume it or investigate missing transcripts (the user confirmed ordinary scrolling). In-flight clarification is a separate desired feature and is NOT part of this authorized recap slice.

This supersedes the blanket prohibition on carrying earlier answer content forward only to allow concise cumulative recaps on genuine result-driven continuations. Full verbatim replay, read-acknowledgement proposals and periodic reminders remain excluded.

## Relevant trace and risks
Current production surfaces: `packages/adapter-pi/src/pi-extensions/subagents/{extension,jobs,task-board,storage}.ts` and `packages/adapter-pi/src/pi-team-profile.ts`. Existing native scheduling and offline PTY tests cover result admission and duplicate-synthesis boundaries. Profile and task-board already instruct answer-last ordering. Generated extension bundles must come from `scripts/generate-pi-extension-assets.ts`.

Main risks: confusing synthetic messages with user input, stale session/attempt results, premature completion claims, recursive context growth, transcript data becoming instructions, extra notifications, and dropping the original recommendation after context changes. Runtime provenance/persistence changes warrant focused independent boundary review once the candidate is ready; this is not a blanket full-repository QA requirement.

## Result and verification
Completed in the repository after focused independent review and repair. The first candidate had three confirmed boundary gaps; `review.md` preserves those findings and the repair disposition.

- Native genuine-user provenance and durable original-answer references establish conversation blocks. Synthetic messages do not reset them. Branch-local task/attempt membership is separate from the session-wide execution journal.
- Original answers and Lead outcome resolutions supply bounded, nonrecursive recap data. Pending/blocked work remains explicit; previous recommendations are data, not authorization. Unfinished admitted outcomes survive reload for recap eligibility without adding a recap scheduler.
- Added `recap.ts`, unit/native/repair regressions, extension hooks and generated-profile/task-board guidance. Regenerated Pi bundles via the canonical script. No new UI, shortcuts, reminders or recap-only provider calls.
- Lead verification: 51 focused checks passed, then the full Pi adapter plus generator suite passed: **1,022 tests, 0 failures, 4,394 assertions across 83 files** on Bun 1.3.12. Root TypeScript and whitespace checks passed. See `review.md` for exact evidence and limits.
- The registry-consumption assertion now preserves the exact canonical Core prefix while permitting the separately authorized Pi-only continuation suffix; Core production content is unchanged by this recap slice.

## Status and limits
Completed; normal build and installation remain required to activate repository changes in the user's Pi. No personal Deck installation/configuration was changed. The separately requested local Neon Grid theme is unrelated and was not modified by this slice. Native tests use offline scripted providers; runtime provenance and bounded data are verified, while recap wording and answer-last compliance remain model guidance. In-flight child clarifications remain desired but are not implemented here.
