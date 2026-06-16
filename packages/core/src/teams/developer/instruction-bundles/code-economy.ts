/**
 * Code Economy Instruction Bundle — runner-neutral code economy policy.
 *
 * This bundle injects critical judgment about code necessity into Task, Apply,
 * and Review agents. It is designed to be opt-in (default: false) and
 * runner-agnostic.
 *
 * Philosophy:
 * - Budgets (LOC/files) are advisory signals, not hard caps.
 * - Quality, security, tests, accessibility, and completeness override LOC reduction.
 * - Decision ladder before adding code.
 * - Anti-subimplementation guardrails.
 */

import type {
  CapabilityInstructionBundle,
  CapabilityInstructionFragment,
} from "./index.js";

/**
 * Target agents for code-economy injection.
 */
const TARGET_AGENT_IDS = [
  "deck-developer-task",
  "deck-developer-apply-general",
  "deck-developer-apply-backend",
  "deck-developer-apply-frontend",
  "deck-developer-review",
] as const;

/**
 * Target skill IDs for code-economy injection.
 */
const TARGET_SKILL_IDS = [
  "deck-developer-task-skill",
  "deck-developer-apply-general-skill",
  "deck-developer-apply-backend-skill",
  "deck-developer-apply-frontend-skill",
  "deck-developer-review-skill",
] as const;

/**
 * Build the code economy instruction bundle.
 *
 * Returns fragments for both "agent" and "skill" surfaces targeting
 * the appropriate agents and skills.
 */
export function buildCodeEconomyInstructionBundle(): CapabilityInstructionBundle {
  const agentFragment: CapabilityInstructionFragment = {
    packageId: "code-economy",
    surface: "agent",
    markdown: getAgentContent(),
    agentIds: TARGET_AGENT_IDS,
  };

  const skillFragment: CapabilityInstructionFragment = {
    packageId: "code-economy",
    surface: "skill",
    markdown: getSkillContent(),
    skillIds: TARGET_SKILL_IDS,
  };

  return {
    instructions: [agentFragment, skillFragment],
  };
}

/**
 * Get the agent-surface content for code economy.
 */
function getAgentContent(): string {
  return `## Code Economy (configured)

> This agent operates with code economy guidance enabled. Budgets (LOC/files) are advisory signals — never gates or blockers.

### Decision Ladder Before Adding Code

Before writing any new code, consider in order:

1. **Does the stdlib or platform already cover this?**
2. **Is there a native feature in the framework or project?**
3. **Is there an existing dependency that safely handles this?**
4. **Can this be solved with a direct, localized solution?**
5. Only then write minimal, testable, maintainable code.

### Anti-Overengineering Rules

- **Avoid**: unrequested abstractions, avoidable new dependencies, "just-in-case" boilerplate, futuristic wrappers, fragmentation to appear smaller.
- **Prefer**: deleting over adding, reusing existing patterns, localized changes, clear names, sufficient tests.
- **No-negotiables**: Requirements, security, input validation, trust boundary validation, data security, error handling, accessibility, completeness, tests, maintainability, and explicit user-requested behavior **always override** LOC reduction.

### Budget Advisory

- **LOC/files trigger justification, not blocking.** High volume, 4+ files, new dependencies, new abstractions, security/data/API boundary changes, or complex features may warrant a brief explanation in the artifact.
- **Budgets are advisory**: they inform Review, not gate implementation.
- **No hard LOC cap, no hard file cap, no diff size gate.**`;

}

/**
 * Get the skill-surface content for code economy.
 */
function getSkillContent(): string {
  return `## Code Economy Self-Check (configured)

> This skill operates with code economy guidance enabled. Budgets (LOC/files) are advisory signals — never gates or blockers.

### Decision Ladder Before Adding Code

Before writing any new code, consider in order:

1. **Does the stdlib or platform already cover this?**
2. **Is there a native feature in the framework or project?**
3. **Is there an existing dependency that safely handles this?**
4. **Can this be solved with a direct, localized solution?**
5. Only then write minimal, testable, maintainable code.

### Anti-Overengineering Rules

- **Avoid**: unrequested abstractions, avoidable new dependencies, "just-in-case" boilerplate, futuristic wrappers, fragmentation to appear smaller.
- **Prefer**: deleting over adding, reusing existing patterns, localized changes, clear names, sufficient tests.

### No-Negotiables (Override LOC Reduction)

The following **always override** any code economy pressure:

- **Requirements**: Spec/Design requirements must be met.
- **Security**: Input validation, auth, secrets, injection prevention, trust boundaries.
- **Data Security**: Sensitive data handling, encryption, access control.
- **Error Handling**: Graceful degradation, informative errors.
- **Accessibility**: ARIA, keyboard navigation, screen reader support.
- **Completeness**: Full implementation of specified behavior.
- **Tests**: Sufficient test coverage.
- **Maintainability**: Clear code that others can understand and modify.
- **User-Requested Behavior**: Features explicitly requested by the user.

If a concise solution would omit any of these, choose the complete solution and document the override.

### Budget Advisory

- **Advisory budget signal**: When estimated changes exceed 400 lines, touch 4+ files, add new dependencies, create new abstractions, or modify security/data/API boundaries, note this in the artifact with brief justification.
- **Budgets are advisory**: they inform Review, not block implementation.
- **No hard LOC cap**: Do not implement hard runtime gates for LOC, file count, or diff size.
- **Quality override**: If quality/security/completeness/tests/accessibility require more lines, add them and note "Quality override used" in the artifact.`;
}