# Claude Lead YOLO parity

## Problem (confirmed, investigate 8f82b398)
A Claude Code Lead session created with YOLO still prompts for approvals.
- `crates/host/src/claude_approval.rs:339` auto-permits in-project reads (`workspace_read_permit`) only when the
  admitted session contract has `approvals == "relay"`; with `"yolo"` every Read falls through to a user decision.
- Bash (`workspace_bash`) and MCP (`mcp_permission`) relay requests (`crates/host/src/claude.rs` ~1352,
  `claude_bash.rs`) prompt whenever the bounded auto-approval classifier does not match, regardless of YOLO.
- Codex YOLO (`crates/host/src/native.rs` `permission_policy` ~208) runs with approval policy `never` and
  `danger-full-access` in trusted projects (not when trust == false): no prompts.
Result: Claude YOLO is stricter than relay for reads and never broader than relay. Not caused by 28cdd03c
(same branches at ec691f52); the Claude reuse key (`claude_reuse.rs:462`) omits the approval mode.

## Acceptance
1. Claude Lead, trusted project, admitted contract `approvals == "yolo"`: in-project reads, edits/writes, Bash and
   MCP permission requests are allowed without creating user decisions (Codex parity).
2. Protected destructive Git operations still go to user review in YOLO (e.g. `git reset --hard|--mixed|--soft`,
   `git clean -f*`, `git checkout -- <path>`, `git restore`, `git stash drop|clear`, `git rebase`, `git push --force*`,
   `git branch -D`). Reuse an existing protected-Git classifier if one exists; otherwise add a small, tested one.
3. Untrusted project (trust == false): YOLO does not broaden anything (same as relay behavior).
4. Relay ("Ask first") behavior is unchanged.
5. Existing authority checks stay first: running phase, not cancelled, project current, admitted contract
   generation/revision/grants match, request identity validity, capacity limits where they still apply.
6. The Claude reuse key includes the approval mode if any launch input depends on it, so a process launched under
   one mode is never reused under another with different bootstrap permissions.
7. Members (`claude_member.rs`) are out of scope unless they share the exact same code path; report if so.

## Verification
- Fake-SDK regression tests (`crates/host/src/claude_tests.rs` fixtures ~1595, `crates/host/tests/fake_claude_sdk.py`):
  YOLO trusted Read -> allow reply, zero decisions (must fail before the fix: red-first); YOLO non-classified Bash ->
  allowed; YOLO destructive git -> pending review; relay unchanged; untrusted YOLO -> review.
- Focused tests while iterating; full `cargo test --locked -p deck2` once at handoff (<= 5 min).
- Independent Quality review afterwards (protected risk: permission policy).

## User decision 2026-11-25 (supersedes Acceptance 2)
- The original session stopped working on this change; it is taken over from the agy-runner-parity session.
- Claude Lead YOLO must match Codex Lead YOLO exactly: in a trusted project with a writable role, every permission
  request (reads, edits/writes, Bash including protected destructive Git, MCP) is allowed without a user decision.
  There is no protected-Git exception in YOLO. Acceptance items 3-7 still apply (untrusted and relay unchanged,
  authority checks first, reuse key includes approval mode, members out of scope unless same path).
- The same rule is applied to the Antigravity Lead in openspec/changes/agy-runner-parity.
- Uncommitted edits left by the previous owner (claude.rs, claude_approval.rs, claude_bash.rs, claude_member.rs,
  claude_tests.rs, native.rs, tests/fake_claude_sdk.py) are unverified starting material.

## Release

Quality closed CLD-1. The combined suite passed 630 tests with 13 ignored. The published executable includes trusted writable Lead YOLO parity and duplicate SDK permission request rejection. Binary identity and activation status are recorded in [the combined release](../agy-runner-parity/brief.md#release).
