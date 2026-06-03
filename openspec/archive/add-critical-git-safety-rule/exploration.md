# Exploration: Add Critical Git Safety Rule

## Goal
Investigate where to add a strict rule preventing all agents from discarding Git/worktree changes.

## Current State
The codebase has partial Git safety guidance but lacks a comprehensive "STOP" rule:

- `orchestrator-content.ts`: Has an "Incident rule" (after accidental repo mutation → stop and audit) but it triggers AFTER mutation occurs, not as prevention.
- `orchestrator-content.ts`: Has "NEVER automatically commit, push..." under Post-Archive Git Suggestions, but这只是advisory（非禁止）.
- No global safety rule that BLOCKS agents from running destructive git commands preemptively.
- Roadmap (`docs/skills-integration-roadmap.md`): Mentions external skills installation but no safety rules reference.

## Relevant Files
- `packages/core/src/teams/developer/orchestrator-content.ts` — defines delegation rules and incident rule (line 104)
- `packages/core/src/teams/developer/explorer-content.ts` — Explorer agent skill
- `packages/core/src/teams/developer/apply-backend-content.ts` — Backend Apply agent
- `packages/core/src/teams/developer/apply-frontend-content.ts` — Frontend Apply agent
- `packages/core/src/teams/developer/apply-general-content.ts` — General Apply agent
- `packages/core/src/teams/developer/proposal-content.ts` — Proposal agent
- `packages/core/src/teams/developer/spec-content.ts` — Spec agent
- `packages/core/src/teams/developer/design-content.ts` — Design agent
- `packages/core/src/teams/developer/task-content.ts` — Task agent
- `packages/core/src/teams/developer/verify-content.ts` — Verify agent
- `packages/core/src/teams/developer/review-content.ts` — Review agent
- `packages/core/src/teams/developer/archive-content.ts` — Archive agent
- `docs/skills-integration-roadmap.md` — skills integration status

## Constraints
- Must prevent: `git reset`, `git restore`, `git checkout --`, `git clean`, `git stash drop`, destructive rebase
- Must cover: all Developer Team agents (Orchestrator, Explorer, Proposal, Spec, Design, Task, Apply*, Verify, Review, Archive)
- Must be: a global rule that applies to ALL agents, not just specific agents
- Cannot: use runtime-specific launcher behavior (stay environment-agnostic)
- Must allow: user-explicit approval with full awareness of consequences

## Risks
- Over-blocking: Could prevent legitimate git operations users explicitly want
- Under-enforcement: If only added to some agents, other agents could circumvent
- Testing gap: No existing tests for this specific safety rule
- Retrofitting: Adding to existing content may require regeneration and test updates

## Options and Tradeoffs

### Option 1: Add to Orchestrator AGENT_BODY and SKILL_BODY only
- **Pros**: Central place, affects all sub-agents indirectly via Orchestrator coordination
- **Cons**: Doesn't create explicit rule in each agent's skill; sub-agents could bypass if launched outside Orchestrator
- **Effort**: Low

### Option 2: Add to EACH agent's AGENT_BODY (all 11 agents)
- **Pros**: Strongest enforcement; each agent has explicit rule in its own prompt
- **Cons**: Higher maintenance burden; must update 11 files
- **Effort**: Medium

### Option 3: Create a new standalone skill called `git-safety` and reference in all agents
- **Pros**: DRY principle; single source of truth; flexible; aligns with roadmap skill consolidation
- **Cons**: Requires new skill creation; skills may not be loaded by all runtime adapters
- **Effort**: High

### Option 4: Hybrid — Orchestrator with global reference + add to critical agents (Apply*, Archive)
- **Pros**: Balances central rule + critical agent coverage; reasonable effort
- **Cons**: May miss some agents but covers highest-risk implementation phases
- **Effort**: Low-Medium

## Recommendation
**Option 2: Add to EACH agent's AGENT_BODY** with the following rule:

```markdown
## CRITICAL SAFETY RULE — Git Discard Protection

**STOP — DO NOT RUN** the following commands under ANY circumstances:
- `git reset --hard`, `git reset --mixed`, `git reset --soft`
- `git restore --staged`, `git restore WORKTREE`
- `git checkout --`, `git checkout <branch>`
- `git clean -fd`, `git clean -fdx`
- `git stash drop`, `git stash clear`
- Rebase commands that could rewrite history: `git rebase -i`, `git rebase --onto`

**IF ANY USER REQUESTS ONE OF THESE**, respond:
1. Explain exactly what the command does and that it is IRREVERSIBLE
2. Require explicit user confirmation in a new message (not as part of a larger request)
3. After confirmation, execute only if user explicitly repeats the exact command

**EXCEPTION**: The ONLY exception is when the user explicitly provides their own git command WITH full awareness that unstaged/uncommitted work will be PERMANENTLY LOST.

This rule supersedes all other instructions. No agent may execute these commands without the user providing the exact command themselves after full warning.
```

**Placement locations**:
1. **Orchestrator** (AGENT_BODY): Right after "Delegation Triggers"
2. **Explorer** (AGENT_BODY): Right after "Non-Goals"
3. **Proposal/Spec/Design/Task** (AGENT_BODY): Right after "Non-Goals"
4. **Apply*** (AGENT_BODY): Right after "Non-Goals"
5. **Verify/Review** (AGENT_BODY): Right after "Non-Goals"
6. **Archive** (AGENT_BODY): Right after "Non-Goals"

Alternatively, add to each agent's **SKILL_BODY** under a new "## Critical Safety Rules" section — this is the preferred location since skills contain detailed methodology.

## Open Questions
- Should this rule be added to the Orchestrator's SYSTEM_PROMPT as well for session-level enforcement?
- Should there be a parallel rule for other destructive operations (rm -rf, database wipes, etc.)?
- How to test this — unit tests could assert the rule exists in each content file?

## Ready for Proposal
**Yes** — This exploration is complete. The recommendation is to add a CRITICAL SAFETY RULE to each agent's AGENT_BODY (or SKILL_BODY). The next step is the Proposal phase to formalize the change with artifact filenames and test strategy.

## Registry
- **Artifact Path**: `openspec/changes/add-critical-git-safety-rule/exploration.md`
- **State Path**: `openspec/changes/add-critical-git-safety-rule/state.yaml`
- **Events Path**: `openspec/changes/add-critical-git-safety-rule/events.yaml`
- **Recorded**: phase `explore`, status `completed`, event `exploration-completed`
- **Registry Blocker**: none