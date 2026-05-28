# Exploration: Orchestrator Invariant Persistence

## Goal
Identify why critical orchestrator instructions (e.g., ask Automatic/Interactive before SDD, pure delegator identity) degrade or get lost during long sessions, and propose strategies to guarantee their persistence and priority.

## Current State

### How Instructions Flow Today

1. **Canonical source**: `packages/core/src/teams/developer/orchestrator-content.ts` defines `ORCHESTRATOR_SYSTEM_PROMPT` (~277 lines of markdown) — the orchestrator's full operating rules.
2. **Installation**: `deck init` writes this to `~/.config/opencode/prompts/deck-developer/deck-developer-orchestrator.md` (OpenCode prompt file) and `~/.config/opencode/skills/deck-developer-orchestrator/SKILL.md` (skill file).
3. **Session start**: OpenCode loads the prompt file as the system prompt for the orchestrator agent. The skill is auto-resolved and injected.
4. **Composition layers**:
   - `content-registry.ts` → `getTeamSessionInstructions()` → calls `getOrchestratorSystemPrompt(personality)` → appends context-authority guidance → appends capability instruction fragments (session surface).
   - `renderSddContextSections()` wraps content with `## OFFICIAL CONTEXT` / `## ADAPTIVE CONTEXT` sections.
5. **No mid-session refresh**: Instructions are loaded once at session start. There is no mechanism to re-inject, re-prioritize, or verify critical rules during the session.

### Key Files

- `packages/core/src/teams/developer/orchestrator-content.ts` — canonical orchestrator system prompt + personality variants
- `packages/core/src/teams/developer/content-registry.ts` — content registry, composition layers
- `packages/core/src/memory/adaptive-context-renderer.ts` — official vs adaptive context rendering
- `packages/core/src/teams/developer/instruction-bundles/index.ts` — capability instruction bundles
- `packages/adapter-opencode/src/developer-team-install.ts` — OpenCode install plan, prompt generation
- `packages/adapter-opencode/src/prompt-generation.ts` — prompt file builder
- `packages/sdd-runtime/src/orchestrator/orchestrator-pipeline.ts` — SDD runtime pipeline (audit/risk/quality/loop)

## Constraints

- **Runner-agnostic core**: Deck's core must not assume specific runner capabilities (e.g., dynamic system prompt injection).
- **Multiple runners**: OpenCode (prompt files), Pi (profile dirs), potentially others. Each has different session initialization mechanics.
- **Context window limits**: All LLM runners have finite context; as session grows, early instructions get diluted.
- **No runtime enforcement**: The "long-session rule" (~20 tool calls) is defined in text but has no programmatic enforcement.
- **Skill files are static**: Once written to disk, skills are not modified during a session.

## Diagnosis: Why Instructions Degrade

### Root Cause: Single-Load + Context Dilution

The orchestrator system prompt is loaded **once** at session start as a ~277-line markdown block. As the session progresses:

1. **Context inflation**: Each tool call, file read, and agent response adds to the context window.
2. **Attention dilution**: The model's attention mechanism weights all tokens; early instructions (system prompt) compete with recent conversation turns.
3. **No priority signaling**: All instructions in the system prompt are semantically equal — there's no structural marker that says "this rule is non-negotiable."
4. **No verification loop**: There's no mechanism that checks "did I follow my core rules?" before proceeding.

The user's scenario (orchestrator skipped Automatic/Interactive question, then claimed "context was too full") is consistent with this: the instruction exists in the system prompt but was effectively invisible after extensive exploration filled the context.

### Secondary Factor: Instruction Position

The "Execution Mode" section is at line ~161 of the system prompt — well past the identity/delegation sections. In a context-heavy session, mid-prompt instructions are more likely to be overlooked than top-prompt ones.

## Options and Tradeoffs

### 1. **Invariant Header + Mid-Session Re-injection**
Add a compact `## INVARIANT RULES` section at the very top of the system prompt (first 10-15 lines). Deck periodically re-injects this header during the session via a special command or tool call.

- **Pros**: Simple, runner-agnostic, leverages position primacy
- **Cons**: Requires runner support for mid-session injection; re-injection timing is heuristic
- **Effort**: Medium

### 2. **Pre-Action Self-Audit Gate**
Before each delegation decision or phase transition, the orchestrator runs a compact self-check: "Have I asked execution mode? Am I delegating vs doing inline?" This is enforced by the SDD pipeline's existing audit stage.

- **Pros**: Uses existing pipeline infrastructure; programmatic enforcement
- **Cons**: Adds latency per decision; relies on model compliance with self-audit
- **Effort**: Low-Medium

### 3. **Dedicated Invariant Store + Injection Bundle**
Create a new `invariant-rules` capability instruction package. Define a small set of non-negotiable rules in a separate file. Inject at the TOP of every prompt/skill/session surface. Optionally re-inject via a `deck refresh-invariants` command.

- **Pros**: Clean separation; versionable; testable; runner-agnostic
- **Cons**: New package to maintain; doesn't solve mid-session dilution alone
- **Effort**: Medium

### 4. **Runner-Level System Prompt Pinning**
For runners that support it (e.g., OpenCode's prompt files), mark certain sections as "pinned" — always included in every turn's context regardless of window size.

- **Pros**: Strongest guarantee; runner handles it natively
- **Cons**: Runner-specific; not all runners support this; requires upstream changes
- **Effort**: High

### 5. **Compact Invariant Card + Periodic Reminder**
Extract the top 5-7 invariant rules into a ~50-line "invariant card." Append it to every sub-agent prompt. The orchestrator re-states it after every N delegations.

- **Pros**: Very simple; works with any runner; low effort
- **Cons**: Adds token cost per agent launch; still relies on model compliance
- **Effort**: Low

### 6. **Hybrid: Invariant Store + Self-Audit + Position Primacy** (Recommended)
Combine options 1, 2, and 3:
- Create `invariant-rules` package with ~7 non-negotiable rules
- Place them at the TOP of the system prompt (first 10 lines)
- Wire into existing SDD self-audit stage as mandatory checks
- Add a `deck refresh-invariants` CLI command for manual re-injection

- **Pros**: Defense in depth; works across runners; leverages existing infrastructure
- **Cons**: More moving parts; requires changes in core + adapters + pipeline
- **Effort**: Medium-High

## Recommended Invariants (Initial Prioritized List)

| Priority | Invariant | Current Location in Prompt | Risk if Lost |
|----------|-----------|---------------------------|--------------|
| P0 | **Pure Delegator Identity** — never execute tasks inline when a specialist exists | Line 41-79 | Orchestrator becomes mega-agent, context inflates |
| P0 | **SDD Triage Gate** — classify before acting; don't ask mode until triage says Run SDD | Line 146-159 | Skips triage, runs SDD for trivial requests |
| P0 | **Execution Mode Gate** — ask Automatic/Interactive on first change request when triage = Run SDD | Line 161-168 | User loses control over phase pacing |
| P1 | **4-File Rule** — delegate exploration when 4+ files needed | Line 99 | Context inflation from broad exploration |
| P1 | **Long-Session Rule** — pause after ~20 tool calls without delegation | Line 103 | Silent context degradation |
| P1 | **SDD Initialization Gate** — check `initialized` flag before any SDD work | Line 133-144 | Runs SDD on uninitialized project |
| P2 | **PR Rule** — fresh review before commit/push/PR | Line 101 | Unreviewed code reaches main |
| P2 | **Registry Serialization** — orchestrator serializes parallel phase registry writes | Line 181-183 | Spec Registry corruption |
| P2 | **Never mutate Git automatically** — Git suggestions are advisory only | Line 219-223 | Accidental commits/pushes |

## Recommendation

### Architecture: Hybrid Approach (Option 6)

**Where to store invariants**: New file `packages/core/src/teams/developer/invariant-rules.ts` — exports a compact markdown block of P0+P1 rules (~50 lines).

**How to inject**:
1. **System prompt top**: Prepend invariant rules as the FIRST section of `ORCHESTRATOR_SYSTEM_PROMPT` (before "Team Roster").
2. **Skill file**: Include as a dedicated `## Invariant Rules` section near the top.
3. **Capability bundle**: Register as a new `invariant-rules` package in `instruction-bundles/` for consistent composition across surfaces.

**How to refresh**:
1. **Self-audit gate**: Extend the existing SDD pipeline audit stage to check invariant compliance before phase transitions.
2. **Manual refresh**: Add `deck refresh-invariants` command that re-injects the invariant card into the current session (runner-specific implementation).
3. **Long-session trigger**: When the long-session rule fires, the orchestrator should explicitly re-state invariants before delegating.

**How to verify**:
1. Add unit tests that verify invariant rules appear in generated prompt/skill files.
2. Add an integration test that checks the invariant section is the first content block.
3. Add a `deck verify` check that validates invariant rules are present in installed files.

### Product: Invariant Rules as a First-Class Concept

Treat invariant rules as a product feature, not just a prompt engineering detail:
- Document them in user-facing docs as "Deck's Non-Negotiable Rules"
- Allow users to view them via `deck show invariants`
- Allow users to add project-specific invariants via `.deck/invariants.md`

## Open Questions

1. **How many invariants is too many?** If the invariant section grows beyond ~15 rules, it loses its "compact, always-visible" property. Need a governance process.
2. **Should invariants be configurable?** Some teams may want to relax certain rules (e.g., allow inline implementation for solo devs). Or should they be truly non-negotiable?
3. **Runner support for re-injection**: Which runners support mid-session prompt modification? OpenCode? Pi? This determines the feasibility of automatic refresh.
4. **Token cost**: Adding invariant re-injection to every sub-agent prompt adds ~50 tokens per launch. Is this acceptable?
5. **Self-audit reliability**: Can we trust the model to honestly self-audit, or do we need external verification?

## SDD Recommendation

**Yes, this should go through SDD.** The change touches:
- Core package (new invariant-rules module)
- Orchestrator content (prompt restructuring)
- Instruction bundles (new package registration)
- SDD pipeline (self-audit extension)
- Potentially adapters (refresh mechanism)
- User-facing CLI (new commands)

This is a cross-cutting change with multiple affected files and design decisions (how many invariants, configurability, runner support). It warrants Proposal → Spec/Design → Tasks → Apply → Verify/Review → Archive.

## Registry

- **Artifact Path**: `openspec/changes/orchestrator-invariant-persistence/exploration.md`
- **State Path**: `openspec/changes/orchetrator-invariant-persistence/state.yaml`
- **Events Path**: `openspec/changes/orchestrator-invariant-persistence/events.yaml`
- **Recorded**: phase `explore`, status `completed`, event `exploration-complete`
- **Registry Blocker**: none
