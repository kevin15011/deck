# Agent questions (structured user questions from the Lead and subagents)

## Intent and acceptance

When an agent needs a decision it asks the user structured questions. The web UI shows a bar above the chat input ("The Lead has N questions"); clicking it opens a panel with one tab per question, shows the runner's suggestions, always allows a free-text answer, and sends only when every question is answered (or the whole set is dismissed). Works for Claude Code, Codex and OpenCode through one runner-neutral contract. Question types: single choice, multiple choice, free text, secret free text (masked, never persisted).

## Contract (public, shared by core, session-host, drivers and web)

Question: `{ id: string; header?: string; prompt: string; options: { label: string; description?: string }[]; multiple: boolean; allowOther: boolean; secret: boolean }`. Empty `options` means free text. Bounds: <=8 questions, <=12 options, header <=120, prompt <=2000, label <=200, description <=1000 chars. Runners without ids (Claude, OpenCode) get `q1..qn` by index.

Events (ledger, replayable): `question.requested` data `{ questionId, taskId, tool?, questions: Question[] }`; `question.resolved` data `{ questionId, outcome: "answered" | "dismissed" | "cancelled", by }`. Answers are NEVER written to events or the ledger (secret answers exist only in memory on the way to the runner).

Commands: `question.answer { questionId, answers: Record<questionId_of_each_question, string[]> }`; `question.dismiss { questionId }`. Validation at the broker: every question answered, each value list non-empty, values <=4000 chars, single-choice has exactly one value, a value must equal an option label unless `allowOther` or the question has no options. Invalid -> command rejected `question-answers-invalid`, question stays pending.

Driver contract: `DriverHostIo.question(req: { questionId, questions }): Promise<{ outcome: "answered"; answers: Record<string, string[]> } | { outcome: "dismissed" | "cancelled" }>`.

Lifecycle: no timeout while the task is alive. Cancelled (outcome `cancelled`) on task end, interrupt, release, stop, daemon restart (recovery) and shutdown. First valid answer wins; pending questions are rebuilt from the ledger on reattach. `leadActivity.pendingQuestions` is reported next to `pendingApprovals`; the Lead progress shows "Waiting for your answer".

## Runner mappings (verified against installed Claude 2.1.301, Codex 0.162.1, OpenCode 1.19.1)

- Claude: AskUserQuestion reaches `deck_approve` as `tool_name: "AskUserQuestion"`, `input.questions: [{question, header, options:[{label,description}], multiSelect}]`. Route it to the question broker instead of the approval broker. Answer: `{behavior:"allow", updatedInput:{...input, answers:{"<question text>": "<labels joined by ', '>"}}}`; free text is sent verbatim as the string. Dismissed/cancelled: `{behavior:"deny", message:"The user dismissed the question."}`. Limitation: with approvals `runner-default` (`--dangerously-skip-permissions`) Claude does not expose AskUserQuestion at all.
- Codex: server request `item/tool/requestUserInput` params `{ itemId, questions:[{id, header, question, options:[{label,description}]|null, isOther, isSecret}], isBlocking }`; reply `{ answers: { [id]: { answers: string[] } } }`. The tool is gated behind the under-development feature `default_mode_request_user_input` (off by default): the driver must enable it at launch.
- OpenCode: SSE event `question.asked` data `{id, sessionID, questions:[{question, header, options:[{label,description}], multiple?, custom?}], tool}`; reply `POST /question/{id}/reply {answers: string[][]}` (one list per question, in order); dismiss `POST /question/{id}/reject`; `GET /question` lists pending ones (replay on startup like permissions). Use the v1 API (not question.v2.*).

## Routing

Lead owns this brief and the contract. Investigate (read-only) verified the Claude behaviour empirically and mapped the integration points. Phase A (one owner): core contract + QuestionBroker + session-manager/daemon/ledger/recovery wiring + FakeDriver support, tree green. Phase B (parallel, disjoint files): OpenCode driver, Codex driver, Claude bridge routing, web UI. Phase C: independent Quality review across layers. Real-runner validation happens in the canary.
