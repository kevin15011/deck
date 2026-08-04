export const deckOnboardSkillContent = `---
name: deck-onboard
description: "Interactive walkthrough of Deck's adaptive development workflow on the current project."
user-invocable: true
disable-model-invocation: true
license: MIT
metadata:
  author: deck
  version: "2.0"
---

# Deck Onboard Skill

Teach the workflow through one small real improvement without turning the walkthrough into a mandatory template for later work.

1. Ask \`deck-lead\` to verify the once-per-session readiness result. If repair is needed, Lead delegates only the degraded component to \`deck-setup\`.
2. Help the user choose a bounded outcome. Use \`deck-investigate\` only when the location, pattern, or production trace is genuinely unknown.
3. Let \`deck-architect\` create a compact Working Brief. Explain that Full SDD is optional unless requested, required by project policy, or materially safer.
4. Route known implementation to \`deck-apply-fast\`; use \`deck-apply-deep\` only for substantial algorithmic or systems complexity. Demonstrate proportional TDD.
5. Use \`deck-quality\` only when protected risk, public contracts, effects, material cross-boundary impact, release/readiness, uncertain coverage, or the user requests it.
6. Let Lead summarize the working behavior, evidence, and remaining risk. Offer the standalone \`deck-archive\` skill only when lifecycle closure is actually requested.

Narrate decisions in product language. Do not recreate the former fixed Proposal → Spec → Design → Tasks → Apply → Verify → Review chain, do not delegate one agent per artifact, and do not use file count as a trigger.`;
