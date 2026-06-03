/**
 * Git Safety Rule for the Deck Developer Team.
 *
 * This module exports the canonical Git discard protection rule
 * that must be present in all Developer Team agent prompts.
 */

// Sentinel for reliable presence detection in tests
export const GIT_SAFETY_SENTINEL = "CRITICAL_SAFETY_GIT_DISCARD_PROTECTION";

// Canonical rule text - single source of truth for all 24 surfaces
// Covers REQ-GDP-001 through REQ-GDP-008
export const GIT_DISCARD_PROTECTION_RULE = `## CRITICAL SAFETY RULE — Git Discard Protection

### Destructive Commands That Require Confirmation

This rule supersedes **all other agent instructions**, including role definitions, skill content, and delegated task descriptions. No agent task, skill, or methodology may override this safety requirement.

The following Git operations are **destructive** — they irrevocably discard uncommitted or unpushed work. Before executing any of these, you MUST complete the informed-confirmation flow described below:

- \`git reset --hard [<commit>]\` — discards all uncommitted changes; if a commit ref is provided, resets HEAD to that commit (default: HEAD, discards everything since last commit)
- \`git reset --mixed [<commit>]\` — discards staged changes; if a target ref is supplied, moves HEAD to that commit (commonly used for undoing commits while preserving worktree)
- \`git reset --soft [<commit>]\` — moves HEAD and branch pointer to target ref without discarding staged/index changes; can rewrite shared/pushed history if the branch has been published
- \`git restore --staged <path>\` — unstages changes from the index; preserves worktree modifications but removes them from the pending commit
- \`git restore <path>\` — discards worktree changes and restores the file to its last-committed or staged state (irreversible for uncommitted work)
- \`git checkout -- <path>\` — discards worktree changes to the specified file(s), restoring the last committed version (alternative syntax to git restore)
- \`git checkout -b <new-branch> <start-point>\` — when start-point is behind HEAD and working tree has uncommitted changes, the checkout will discard or lose those changes
- \`git clean -fd\` — recursively removes all untracked files and directories; **cannot be undone** — files are permanently deleted
- \`git clean -fdx\` — removes all untracked files, directories, AND ignored files (such as build artifacts); **extremely destructive**
- \`git stash drop [<stash-id>]\` — permanently deletes the stash entry at the given stash index; permanently loses stashed changes
- \`git stash clear\` — permanently deletes all stash entries; all stashed work is lost forever
- \`git rebase -i <upstream>\` — opens interactive rebase editor allowing commit squashing, reordering, or editing; can rewrite commit history and cause conflicts if shared branches are modified
- \`git rebase --onto <newbase> <oldbase> <branch>\` — moves a branch to a new base commit, rewriting history; dangerous for published branches
- Any other command that irrevocably discards uncommitted or unpushed work

### Safe Commands That Do Not Require Confirmation

The following operations are **safe** — they do not discard work:

- \`git status\` — read-only inspection
- \`git diff\` — read-only inspection
- \`git log\` — read-only inspection
- \`git stash\` (without drop/clear) — saves work temporarily
- \`git commit\` — records new work (does not discard)
- \`git add\` — stages work (does not discard)
- \`git checkout <branch>\` when working tree is clean — safe branch switching

### Informed-Confirmation Flow

When a user requests a destructive Git command:

1. **Warn**: Explain in plain language what the command does and that it is irreversible.
2. **Require new message**: Ask the user to confirm in a separate new message — not as part of a larger request.
3. **Require exact command**: Ask the user to repeat the exact command in their confirmation.
4. **Execute only after confirmation**: Run the command only after receiving explicit user confirmation.

**Example response:**

> I'm ready to help, but \`git reset --hard HEAD~1\` is a destructive operation that will permanently discard all uncommitted changes and move HEAD back one commit.
>
> To proceed, please send a new message with the exact command you want to run (e.g., "git reset --hard HEAD~1") confirming that you understand this will discard your uncommitted work.

${GIT_SAFETY_SENTINEL}`;

/**
 * Helper to assert that the Git safety rule is present in a body string.
 * Throws if the sentinel is absent.
 */
export function assertGitSafetyRulePresent(body: string, label: string): void {
  if (!body.includes(GIT_SAFETY_SENTINEL)) {
    throw new Error(
      `Missing Git safety rule in ${label}: expected sentinel "${GIT_SAFETY_SENTINEL}" not found in body`
    );
  }
}