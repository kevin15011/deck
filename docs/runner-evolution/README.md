# Runner evolution record

This record tracks how far Deck's Codex, OpenCode, and Claude Code integrations have been investigated and tested. It does not pin runner versions or certify universal compatibility. The repository-local [deck-runner-evolution skill](../../.agents/skills/deck-runner-evolution/SKILL.md) maintains it.

Invoke the skill with a request such as: “Use deck-runner-evolution to review stable runner releases since our last complete reviews and identify changes Deck should adopt.” A review can target one runner or all three.

## Registry contract

`registry.json` uses `schema_version: 1` and runner IDs `codex`, `opencode`, and `claude-code`. Each runner contains:

- `last_complete_review`: null or `{ "version": "...", "review": "reviews/...md" }`. This is the investigation cursor, not a compatibility claim.
- `last_runtime_validation`: null or `{ "version": "...", "review": "reviews/...md" }`. The report names the exact successfully checked surfaces; this does not imply complete runner support.
- `reviews`: chronological entries `{ "id": "...", "date": "YYYY-MM-DD", "baseline": null, "target": "...", "status": "partial", "report": "reviews/...md" }`. Baseline may instead be an exact version; status is `partial` or `complete`. Complete means the declared release interval and Deck impacts were investigated, regardless of outstanding fixes.

All report paths are relative to this directory. Null means unknown, not unsupported. Advance the two cursors independently and retain prior entries. Reports must preserve unresolved actions so a later review can revisit them. Initial records deliberately contain no complete baseline; versions observed during development are insufficient to reconstruct a comprehensive historical review.

## Review report contract

Use a filename such as `YYYY-MM-DD-codex-VERSION.md`. Include:

1. Runner, stable channel, baseline, target, review date, and the exact release interval covered. For an initial review, explain how its finite starting range was selected.
2. Deck commit, branch, relevant uncommitted changes, operating system, and evidence limitations.
3. Releases investigated with exact versions, publication dates, source URLs, and retrieval dates; disclose missing intermediate releases or source gaps.
4. Findings connecting upstream evidence to current Deck paths/symbols, affected behavior, confidence, disposition, priority, and recommended checks. State why no action is needed where relevant.
5. Validation actually executed: command or action, runner version, platform, checked surfaces, result, and limits. Separate planned checks from completed ones.
6. Unresolved actions and links to implementation/OpenSpec records, plus whether each cursor can advance and why.

Research can complete without runtime validation. A runner version printed by a binary, installation in a sandbox, or passing mocked tests does not establish real installation/session compatibility.
