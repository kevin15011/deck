export const deckArchiveSkillContent = `---
name: deck-archive
description: "Close an approved OpenSpec change and preserve traceability without creating a dedicated Archive agent."
user-invocable: false
disable-model-invocation: true
license: MIT
metadata:
  author: deck
  version: "2.0"
  delegate_only: true
---

# Deck Archive Skill

This is a Lead-owned lifecycle skill, not an agent. Run it only when the user requests closure or the selected Full SDD lifecycle is ready to close.

- Confirm implementation and required verification evidence belong to the current candidate.
- Preserve state/events history and use the repository's normal OpenSpec archive operation.
- Do not archive a partial, blocked, failed, or ambiguously accepted outcome.
- Do not mutate Git, commit, push, release, or discard work unless separately requested and authorized.
- Return the archived change path, final status, verification summary, and any remaining advisory note.`;
