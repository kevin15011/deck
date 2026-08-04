import { prependOrchestratorInvariants, renderCompactOrchestratorInvariantsV1, type OrchestratorInvariantSurface, type InvariantVerificationResult } from "./orchestrator-invariants";

import { renderDeveloperTeamContextAuthorityGuidance } from "../../memory/adaptive-context-renderer";

import { deckInitSkillContent } from "../../skills/bootstrap/deck-init-content";
import { deckOnboardSkillContent } from "../../skills/bootstrap/deck-onboard-content";

/**
 * Runner-agnostic content registry for the Developer Team.
 *
 * Adapters call these functions to retrieve canonical agent and team
 * content without knowing the internal structure or branching logic.
 *
 * Two registry functions:
 *
 * 1. getAgentContent(agentId) → { agentBody, skillBody }
 *    Returns the body content for a known agent. All current Developer Team
 *    catalog agents have real content. Structured placeholders remain only
 *    as a defensive fallback for future catalog entries that have not been
 *    implemented yet.
 *
 * 2. getTeamSessionInstructions(teamId) → string | undefined
 *    Returns session-level instructions for a team. For the Developer Team,
 *    this is the orchestrator's full operating rules. Adapters map this to
 *    their runtime-specific session initialization mechanism.
 *
 * Design note: "session instructions" is preferred over "system prompt"
 * because "system prompt" is a runtime concept tied to specific AI platforms.
 * The content itself is runner-neutral — it describes team behavior, not
 * how a particular runner loads it.
 */

import { DEVELOPER_TEAM_AGENTS } from "./catalog";
import {
  ORCHESTRATOR_AGENT_BODY,
  ORCHESTRATOR_COMPACT_AGENT_BODY,
  ORCHESTRATOR_COMPACT_SKILL_BODY,
  ORCHESTRATOR_SKILL_BODY,
  getOrchestratorSystemPrompt,
} from "./orchestrator-content";
import { DEFAULT_ORCHESTRATOR_PERSONALITY, type OrchestratorPersonality } from "../../config/deck-config";
import { EXPLORER_AGENT_BODY, EXPLORER_COMPACT_AGENT_BODY, EXPLORER_COMPACT_SKILL_BODY, EXPLORER_SKILL_BODY } from "./explorer-content";
import { PROPOSAL_AGENT_BODY, PROPOSAL_COMPACT_AGENT_BODY, PROPOSAL_COMPACT_SKILL_BODY, PROPOSAL_SKILL_BODY } from "./proposal-content";
import { SPEC_AGENT_BODY, SPEC_COMPACT_AGENT_BODY, SPEC_COMPACT_SKILL_BODY, SPEC_SKILL_BODY } from "./spec-content";
import { DESIGN_AGENT_BODY, DESIGN_COMPACT_AGENT_BODY, DESIGN_COMPACT_SKILL_BODY, DESIGN_SKILL_BODY } from "./design-content";
import { TASK_AGENT_BODY, TASK_COMPACT_AGENT_BODY, TASK_COMPACT_SKILL_BODY, TASK_SKILL_BODY } from "./task-content";
import { APPLY_GENERAL_AGENT_BODY, APPLY_GENERAL_COMPACT_AGENT_BODY, APPLY_GENERAL_COMPACT_SKILL_BODY, APPLY_GENERAL_SKILL_BODY } from "./apply-general-content";
import { APPLY_BACKEND_AGENT_BODY, APPLY_BACKEND_COMPACT_AGENT_BODY, APPLY_BACKEND_COMPACT_SKILL_BODY, APPLY_BACKEND_SKILL_BODY } from "./apply-backend-content";
import { APPLY_FRONTEND_AGENT_BODY, APPLY_FRONTEND_COMPACT_AGENT_BODY, APPLY_FRONTEND_COMPACT_SKILL_BODY, APPLY_FRONTEND_SKILL_BODY } from "./apply-frontend-content";
import { VERIFY_AGENT_BODY, VERIFY_COMPACT_AGENT_BODY, VERIFY_COMPACT_SKILL_BODY, VERIFY_SKILL_BODY } from "./verify-content";
import { REVIEW_AGENT_BODY, REVIEW_COMPACT_AGENT_BODY, REVIEW_COMPACT_SKILL_BODY, REVIEW_SKILL_BODY } from "./review-content";
import { ARCHIVE_AGENT_BODY, ARCHIVE_COMPACT_AGENT_BODY, ARCHIVE_COMPACT_SKILL_BODY, ARCHIVE_SKILL_BODY } from "./archive-content";
import {
  DECK_INIT_COMPACT_AGENT_BODY,
  DECK_INIT_COMPACT_SKILL_BODY,
  DECK_ONBOARD_COMPACT_AGENT_BODY,
  DECK_ONBOARD_COMPACT_SKILL_BODY,
} from "./bootstrap-compact-content";
import {
  VISUAL_EXPLANATIONS_SKILL_FRAGMENT,
  VISUAL_EXPLANATIONS_AGENT_BODY,
  VISUAL_EXPLANATIONS_SKILL_BODY,
} from "./visual-explanations-content";
import type { CapabilityInstructionBundle } from "./instruction-bundles/index";
import {
  composeCapabilityInstructions,
  type CapabilityInstructionCompositionContext,
} from "./instruction-bundles/index";
import { getDeveloperTeamCatalog } from "./catalog";
import {
  ADAPTIVE_AGENT_CONTENT,
  ADAPTIVE_TEAM_RUNTIME_CONTRACT,
  getAdaptiveLeadSystemPrompt,
} from "./adaptive-team-content";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// Result type for error-returning operations
import {
  SKILL_DISCOVERY_AUTHORITY_BOUNDARY_V1,
  SPECIALIST_SKILL_DISCOVERY_CONTRACT_V1,
  renderSkillDiscoveryRuntimeContextV1,
} from "./skill-discovery-content";
import type { SkillDiscoveryRuntimeContextV1 } from "../../skill-discovery/contracts";
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

// Error type for content registry operations
export interface AgentContentError {
  agentId: string;
  message: string;
  suggestions: string[];
  fallbackAvailable: boolean;
}

export type AgentContent = {
  /** Body for the agent definition file (after runtime frontmatter) */
  agentBody: string;
  /** Body for the skill definition file (after runtime frontmatter) */
  skillBody: string;
};

export type DeveloperTeamPromptProfileV1 = "legacy" | "compact";

export type ContentRegistryOptions = {
  /** Optional capability instruction bundle to compose into agent/skill/session content */
  capabilityInstructions?: CapabilityInstructionBundle;
  /** Optional orchestrator personality for session prompt selection */
  personality?: OrchestratorPersonality;
  /** Static prompt profile. Compact is the production default. */
  promptProfile?: DeveloperTeamPromptProfileV1;
  /** Active runner context supplied by the materializer; no runner is inferred. */
  skillDiscoveryRuntimeContext?: SkillDiscoveryRuntimeContextV1;
};

/** Options for getAgentContentResult */
export type ContentRegistryResultOptions = {
  /** Optional capability instruction bundle to compose into agent/skill/session content */
  capabilityInstructions?: CapabilityInstructionBundle;
  /** When true, returns fallback content for catalog agents without real content */
  fallback?: boolean;
  /** Optional orchestrator personality (affects session prompt, not agent content) */
  personality?: OrchestratorPersonality;
  /** Static prompt profile. Compact is the production default. */
  promptProfile?: DeveloperTeamPromptProfileV1;
};

// ---------------------------------------------------------------------------
// Internal: content map for agents with real (non-placeholder) content
// ---------------------------------------------------------------------------

const REAL_CONTENT: Record<string, { agentBody: string; skillBody: string }> = {
  ...ADAPTIVE_AGENT_CONTENT,
  "deck-developer-orchestrator": {
    agentBody: ORCHESTRATOR_AGENT_BODY,
    // Visual explanations are composed into the Orchestrator skill only.
    // Proposal, Spec, Design, and Task agents do not receive this content
    // by default (REQ-VISUAL-002, REQ-TEAMINSTALL-002).
    skillBody: `${ORCHESTRATOR_SKILL_BODY.trimEnd()}\n\n${VISUAL_EXPLANATIONS_SKILL_FRAGMENT}\n`,
  },
  "deck-developer-explorer": {
    agentBody: EXPLORER_AGENT_BODY,
    skillBody: EXPLORER_SKILL_BODY,
  },
  "deck-developer-proposal": {
    agentBody: PROPOSAL_AGENT_BODY,
    skillBody: PROPOSAL_SKILL_BODY,
  },
  "deck-developer-spec": {
    agentBody: SPEC_AGENT_BODY,
    skillBody: SPEC_SKILL_BODY,
  },
  "deck-developer-design": {
    agentBody: DESIGN_AGENT_BODY,
    skillBody: DESIGN_SKILL_BODY,
  },
  "deck-developer-task": {
    agentBody: TASK_AGENT_BODY,
    skillBody: TASK_SKILL_BODY,
  },
  "deck-developer-apply-general": {
    agentBody: APPLY_GENERAL_AGENT_BODY,
    skillBody: APPLY_GENERAL_SKILL_BODY,
  },
  "deck-developer-apply-backend": {
    agentBody: APPLY_BACKEND_AGENT_BODY,
    skillBody: APPLY_BACKEND_SKILL_BODY,
  },
  "deck-developer-apply-frontend": {
    agentBody: APPLY_FRONTEND_AGENT_BODY,
    skillBody: APPLY_FRONTEND_SKILL_BODY,
  },
  "deck-developer-verify": {
    agentBody: VERIFY_AGENT_BODY,
    skillBody: VERIFY_SKILL_BODY,
  },
  "deck-developer-review": {
    agentBody: REVIEW_AGENT_BODY,
    skillBody: REVIEW_SKILL_BODY,
  },
  "deck-developer-archive": {
    agentBody: ARCHIVE_AGENT_BODY,
    skillBody: ARCHIVE_SKILL_BODY,
  },
  "deck-init": {
    agentBody: extractBody(deckInitSkillContent),
    skillBody: deckInitSkillContent,
  },
  "deck-onboard": {
    agentBody: extractBody(deckOnboardSkillContent),
    skillBody: deckOnboardSkillContent,
  },
};

const COMPACT_CONTENT: Readonly<Record<string, AgentContent>> = Object.freeze({
  ...ADAPTIVE_AGENT_CONTENT,
  "deck-developer-orchestrator": Object.freeze({
    agentBody: ORCHESTRATOR_COMPACT_AGENT_BODY,
    skillBody: `${ORCHESTRATOR_COMPACT_SKILL_BODY.trimEnd()}\n\n${VISUAL_EXPLANATIONS_SKILL_FRAGMENT}\n`,
  }),
  "deck-developer-explorer": Object.freeze({ agentBody: EXPLORER_COMPACT_AGENT_BODY, skillBody: EXPLORER_COMPACT_SKILL_BODY }),
  "deck-developer-proposal": Object.freeze({ agentBody: PROPOSAL_COMPACT_AGENT_BODY, skillBody: PROPOSAL_COMPACT_SKILL_BODY }),
  "deck-developer-spec": Object.freeze({ agentBody: SPEC_COMPACT_AGENT_BODY, skillBody: SPEC_COMPACT_SKILL_BODY }),
  "deck-developer-design": Object.freeze({ agentBody: DESIGN_COMPACT_AGENT_BODY, skillBody: DESIGN_COMPACT_SKILL_BODY }),
  "deck-developer-task": Object.freeze({ agentBody: TASK_COMPACT_AGENT_BODY, skillBody: TASK_COMPACT_SKILL_BODY }),
  "deck-developer-apply-general": Object.freeze({ agentBody: APPLY_GENERAL_COMPACT_AGENT_BODY, skillBody: APPLY_GENERAL_COMPACT_SKILL_BODY }),
  "deck-developer-apply-backend": Object.freeze({ agentBody: APPLY_BACKEND_COMPACT_AGENT_BODY, skillBody: APPLY_BACKEND_COMPACT_SKILL_BODY }),
  "deck-developer-apply-frontend": Object.freeze({ agentBody: APPLY_FRONTEND_COMPACT_AGENT_BODY, skillBody: APPLY_FRONTEND_COMPACT_SKILL_BODY }),
  "deck-developer-verify": Object.freeze({ agentBody: VERIFY_COMPACT_AGENT_BODY, skillBody: VERIFY_COMPACT_SKILL_BODY }),
  "deck-developer-review": Object.freeze({ agentBody: REVIEW_COMPACT_AGENT_BODY, skillBody: REVIEW_COMPACT_SKILL_BODY }),
  "deck-developer-archive": Object.freeze({ agentBody: ARCHIVE_COMPACT_AGENT_BODY, skillBody: ARCHIVE_COMPACT_SKILL_BODY }),
  "deck-init": Object.freeze({ agentBody: DECK_INIT_COMPACT_AGENT_BODY, skillBody: DECK_INIT_COMPACT_SKILL_BODY }),
  "deck-onboard": Object.freeze({ agentBody: DECK_ONBOARD_COMPACT_AGENT_BODY, skillBody: DECK_ONBOARD_COMPACT_SKILL_BODY }),
});

const CONTEXT_AUTHORITY_GUIDANCE = renderDeveloperTeamContextAuthorityGuidance();

export interface PromptRuntimeControlMappingV1 {
  readonly ruleId: string;
  readonly runtimeControl: string;
  readonly evidence: string;
  readonly promptTreatment: "runtime-condensed" | "retained-defense-in-depth";
  readonly runtimeActive: boolean;
}

export const PROMPT_RUNTIME_CONTROL_MAP_V1: readonly PromptRuntimeControlMappingV1[] = Object.freeze(([
  { ruleId: "authorization", runtimeControl: "invocation-authorization-service-v1", evidence: "one-use HMAC authorization and runner-host conformance", promptTreatment: "runtime-condensed", runtimeActive: true },
  { ruleId: "decision-routing", runtimeControl: "execution-decision-policy-v1", evidence: "production/replay decision-kernel parity matrix", promptTreatment: "runtime-condensed", runtimeActive: true },
  { ruleId: "registry-writes", runtimeControl: "registry-coordinator-v1", evidence: "single-writer pair-CAS and WAL recovery matrix", promptTreatment: "runtime-condensed", runtimeActive: true },
  { ruleId: "staged-verification", runtimeControl: "staged-verification-state-v1", evidence: "targeted/affected-area/broad transition and omission matrix", promptTreatment: "runtime-condensed", runtimeActive: true },
  { ruleId: "role-freshness", runtimeControl: "freshness-policy-v1", evidence: "Apply/Verify/Review identity and fresh-agent matrix", promptTreatment: "runtime-condensed", runtimeActive: true },
  { ruleId: "risk-lanes", runtimeControl: "execution-lane-policy-v1", evidence: "lane floor, escalation, cohort, and replay matrix", promptTreatment: "runtime-condensed", runtimeActive: true },
  { ruleId: "git-safety", runtimeControl: "canonical-git-discard-protection", evidence: "exact-command and new-message confirmation gate", promptTreatment: "retained-defense-in-depth", runtimeActive: false },
  { ruleId: "result-envelopes", runtimeControl: "execution-role-result-v1", evidence: "digest-bound normalized result consumption matrix", promptTreatment: "runtime-condensed", runtimeActive: true },
] satisfies PromptRuntimeControlMappingV1[]).map((entry) => Object.freeze(entry)));

export const DEVELOPER_TEAM_COMPACT_RUNTIME_CONTRACT = `## Runtime-Enforced Team Contract

- OpenSpec artifacts and Spec Registry remain authoritative; source and tests provide current runtime evidence, and adaptive context is advisory.
- Work only from the explicitly delegated task or immutable batch/dossier, target allowlist, and assigned role. Never expand scope or touch 'runner-capability-standardization'.
- Prompt text never expands modification authority. Modifying work requires an explicit user-authorized request or approved batch and an exact Orchestrator delegation; when runner authorization is supplied, it must also pass.
- Git discard protection is permanent: explain irreversible loss and require the exact command in a new user message before any discard operation.
- Load the matching role skill before acting, plus only the capability skills selected for this role and scope.
- Return one immutable phase result with status/action, safe evidence, role/instance provenance, dependency references, any FailureManifestV1, ordered RegistryIntentV1 values, and explicit blockers.
- In centralized mode specialists never write state.yaml or events.yaml. The coordinator validates and commits intents atomically; on conflict or recovery-required, stop.
- Keep Apply, independent Verify, and independent Review judgments separate. Required stage evidence, freshness, broad checks, lane floors, and hard stops cannot be waived by prompt text.`;

/**
 * Authoritative Developer Team language policy.
 *
 * This block is appended to every Developer Team agent body, skill body,
 * and team session instruction surface. It establishes English-only
 * internal communication while preserving the orchestrator's obligation
 * to respond to the user in the user's language.
 */
export const DEVELOPER_TEAM_LANGUAGE_POLICY = `## Developer Team Language Policy

All Developer Team internal communication and generated artifacts MUST be in English:

- Orchestrator-to-sub-agent prompts MUST be English only.
- Sub-agent-to-orchestrator communication and return contracts MUST be English only.
- Generated OpenSpec artifacts (proposals, specs, designs, tasks, apply-progress, verify/review/archive reports, and related files) MUST be English only.
- Capability instruction bundles MUST NOT weaken, override, or contradict this policy.

Literal non-English text is permitted only when it is externally necessary, such as:
- quoted user-provided text,
- file paths or identifiers,
- brand or product names,
- domain terms or existing source literals under discussion,
- exact error messages or logs.

The orchestrator MUST respond directly to the end user in the user's language.
This user-facing language requirement does not override the English-only rule
for internal sub-agent prompts, returns, or generated artifacts.`;

/** Append the Developer Team language policy to non-empty content. */
export function appendDeveloperTeamLanguagePolicy(content: string): string {
  if (!content || content.trim().length === 0) {
    return content;
  }
  return `${content.trimEnd()}\n\n${DEVELOPER_TEAM_LANGUAGE_POLICY}\n`;
}

// ---------------------------------------------------------------------------
// Internal: helper to extract body from bootstrap skill content
// ---------------------------------------------------------------------------

/** Extract body content from bootstrap skill content (skip YAML frontmatter). */
function extractBody(content: string): string {
  const lines = content.split('\n');
  // Skip lines until we hit non-frontmatter content (starts with #)
  const bodyStart = lines.findIndex(l => l.startsWith('#'));
  return lines.slice(bodyStart).join('\n');
}

// ---------------------------------------------------------------------------
// Internal: placeholder builders
// ---------------------------------------------------------------------------

function buildPlaceholderAgentBody(displayName: string, description: string): string {
  return [
    `# ${displayName}`,
    "",
    `> ${description}`,
    "",
    "## Project Standards (auto-resolved)",
    "",
    "<!-- Orchestrator will inject stack-specific rules at runtime. -->",
    "",
    "## Instructions",
    "",
    `<!-- Placeholder: ${displayName} prompt implementation pending review of source methodology. -->`,
    "",
  ].join("\n");
}

function buildPlaceholderSkillBody(displayName: string, description: string): string {
  return [
    `# ${displayName} Skill`,
    "",
    `> ${description}`,
    "",
    `<!-- Placeholder: ${displayName} skill implementation pending review of source methodology. -->`,
    "",
    "## Instructions",
    "",
    "<!-- Placeholder: detailed skill methodology will be adapted from the matching source skill. -->",
    "",
  ].join("\n");
}

function appendContextAuthorityGuidance(content: string): string {
  return `${content.trimEnd()}\n\n${CONTEXT_AUTHORITY_GUIDANCE}\n`;
}

function withContextAuthorityGuidance(content: AgentContent): AgentContent {
  return {
    agentBody: appendContextAuthorityGuidance(content.agentBody),
    skillBody: appendContextAuthorityGuidance(content.skillBody),
  };
}

function withDeveloperTeamLanguagePolicy(content: AgentContent): AgentContent {
  return {
    agentBody: appendDeveloperTeamLanguagePolicy(content.agentBody),
    skillBody: appendDeveloperTeamLanguagePolicy(content.skillBody),
  };
}

/**
 * Prepend orchestrator invariants to agent content.
 * Only applies to orchestrator agent surfaces.
 *
 * @param content - Agent content with authority already applied
 * @param agentId - Target agent ID
 * @returns Content with invariants prepended for orchestrator agent only
 */
/**
 * Compose the shared discovery contract only into non-Orchestrator Developer
 * Team surfaces. Registry records and descriptions are never passed here.
 */
function withSpecialistSkillDiscoveryContract(
  content: AgentContent,
  agentId: string,
): AgentContent {
  const isDeveloperTeamSpecialist =
    agentId !== "deck-lead" &&
    DEVELOPER_TEAM_AGENTS.some((agent) => agent.id === agentId);
  if (!isDeveloperTeamSpecialist || content.agentBody.includes(SPECIALIST_SKILL_DISCOVERY_CONTRACT_V1)) {
    return content;
  }

  const appendContract = (surface: string): string =>
    `${surface.trimEnd()}\n\n${SPECIALIST_SKILL_DISCOVERY_CONTRACT_V1}\n`;
  return {
    agentBody: appendContract(content.agentBody),
    skillBody: appendContract(content.skillBody),
  };
}

function withOrchestratorInvariants(
  content: AgentContent,
  agentId: string,
): AgentContent {
  // Only inject invariants into orchestrator agent
  if (agentId !== "deck-developer-orchestrator") {
    return content;
  }

  return {
    agentBody: prependOrchestratorInvariants(content.agentBody, "agent"),
    skillBody: prependOrchestratorInvariants(content.skillBody, "skill"),
  };
}

function withCompactRuntimeContract(content: AgentContent, agentId: string): AgentContent {
  if (DEVELOPER_TEAM_AGENTS.some((agent) => agent.id === agentId)) {
    return {
      agentBody: `${ADAPTIVE_TEAM_RUNTIME_CONTRACT}\n\n${content.agentBody.trimStart()}`,
      skillBody: `## Team Contract Reference\n\nThe agent-level Adaptive Developer Team Contract remains binding for this skill.\n\n${content.skillBody.trimStart()}`,
    };
  }
  const orchestratorInvariants = agentId === "deck-developer-orchestrator"
    ? `${renderCompactOrchestratorInvariantsV1()}\n\n`
    : "";
  const prefix = `${orchestratorInvariants}${DEVELOPER_TEAM_COMPACT_RUNTIME_CONTRACT}`;
  return {
    agentBody: `${prefix}\n\n${content.agentBody.trimStart()}`,
    skillBody: `## Runtime Contract Reference\n\nThe agent-level Runtime-Enforced Team Contract remains binding for this skill.\n\n${content.skillBody.trimStart()}`,
  };
}

function appendCapabilityInstructions(
  baseContent: string,
  bundle: CapabilityInstructionBundle | undefined,
  context: CapabilityInstructionCompositionContext,
): string {
  return composeCapabilityInstructions(baseContent, bundle, context);
}

/**
 * Applies composition layers to agent content in the correct order:
 * 1. context-authority guidance (already applied via withAuthority)
 * 2. sub-agent personality fragment (non-orchestrator agents only)
 * 3. capability instruction fragments (if bundle provided)
 */
function applyAgentContentComposition(
  withLanguagePolicy: AgentContent,
  agentId: string,
  bundle: CapabilityInstructionBundle | undefined,
): AgentContent {
  // Capability instructions are the final composition layer after
  // orchestrator invariants, base content, context-authority guidance,
  // and the Developer Team language policy have been applied.
  if (!bundle) {
    return withLanguagePolicy;
  }
  return {
    agentBody: appendCapabilityInstructions(
      withLanguagePolicy.agentBody,
      bundle,
      { surface: "agent", agentId },
    ),
    skillBody: appendCapabilityInstructions(
      withLanguagePolicy.skillBody,
      bundle,
      { surface: "skill", skillId: `${agentId}-skill` },
    ),
  };
}

// ---------------------------------------------------------------------------
// Registry: agent content
// ---------------------------------------------------------------------------

/**
 * Returns the agent body and skill body content for a known agent.
 *
 * For all agents in the Developer Team catalog, returns their detailed prompts.
 * For unknown agent IDs not in the catalog, returns a structured placeholder.
 *
 * When options.capabilityInstructions is provided, package instruction fragments
 * are composed into both agentBody and skillBody after context-authority guidance.
 *
 * Returns undefined for agent IDs not in the Developer Team catalog.
 *
 * @deprecated Use getAgentContentResult() instead. This wrapper will be removed
 *             in a future release.
 */
export function getAgentContent(
  agentId: string,
  options?: ContentRegistryOptions,
): AgentContent | undefined {
  const result = getAgentContentResult(agentId, options);
  if (result.ok) {
    return result.value;
  }
  // Legacy behavior: returns undefined for unknown agents
  return undefined;
}

/**
 * Returns the agent body and skill body content for a known agent.
 *
 * Uses a Result type to distinguish between successful retrieval and error cases.
 * For agents with real content in REAL_CONTENT, returns ok: true with content.
 * For unknown agents, returns ok: false with suggestions and fallback availability.
 *
 * When options.capabilityInstructions is provided, package instruction fragments
 * are composed into both agentBody and skillBody after context-authority guidance.
 *
 * When options.fallback is true and the agentId exists in the catalog but has no
 * real content, returns generic fallback content instead of an error.
 */
export function getAgentContentResult(
  agentId: string,
  options?: ContentRegistryResultOptions,
): Result<AgentContent, AgentContentError> {
  const promptProfile = options?.promptProfile ?? "compact";
  const compact = promptProfile === "compact" ? COMPACT_CONTENT[agentId] : undefined;
  const real = compact ?? REAL_CONTENT[agentId];
  if (real) {
    // Apply composition order: (1) invariant block, (2) existing orchestrator content, (3) context-authority guidance, (4) shared specialist discovery contract, (5) language policy, (6) capability instructions
    const withInvariants = compact
      ? withCompactRuntimeContract(real, agentId)
      : withOrchestratorInvariants(real, agentId);
    const withAuthority = withContextAuthorityGuidance(withInvariants);
    const withDiscovery = withSpecialistSkillDiscoveryContract(withAuthority, agentId);
    const withLanguagePolicy = withDeveloperTeamLanguagePolicy(withDiscovery);
    const composed = applyAgentContentComposition(
      withLanguagePolicy,
      agentId,
      options?.capabilityInstructions,
    );
    return { ok: true, value: composed };
  }

  // Not in REAL_CONTENT - check catalog
  const catalog = getDeveloperTeamCatalog();
  const catalogAgent = catalog.find((a) => a.id === agentId);
  const allAgentIds = catalog.map((a) => a.id);

  // Determine fallback content if requested
  if (options?.fallback) {
    if (catalogAgent) {
      // Agent exists in catalog but has no real content — fallback is appropriate
      const fallbackContent = getUnknownAgentContent(agentId, []);
      // Apply same composition order as real content
      const withInvariants = withOrchestratorInvariants(fallbackContent, agentId);
      const withAuthority = withContextAuthorityGuidance(withInvariants);
      const withDiscovery = withSpecialistSkillDiscoveryContract(withAuthority, agentId);
      const withLanguagePolicy = withDeveloperTeamLanguagePolicy(withDiscovery);
      const composed = applyAgentContentComposition(
        withLanguagePolicy,
        agentId,
        options?.capabilityInstructions,
      );
      return { ok: true, value: composed };
    }
    // Agent is NOT in catalog — cannot provide fallback, return error
    // Fallback is only for known catalog agents that lack real content
  }

  // Not found - generate error with suggestions
  const suggestions = findSimilarAgentIds(agentId, allAgentIds);

  if (catalogAgent) {
    // Agent is in catalog but has no real content
    return {
      ok: false,
      error: {
        agentId,
        message: `Agent "${agentId}" not found in content registry`,
        suggestions,
        fallbackAvailable: true,
      },
    };
  }

  // Unknown agent - not in catalog at all
  return {
    ok: false,
    error: {
      agentId,
      message: `Agent "${agentId}" not found in content registry`,
      suggestions,
      fallbackAvailable: false,
    },
  };
}

/**
 * Generates suggestions for unknown agent IDs using Levenshtein distance and prefix matching.
 *
 * Ranking: prefix matches first (score 0), then Levenshtein distance ascending.
 * Limited to maximum 3 suggestions.
 */
function findSimilarAgentIds(query: string, candidates: string[]): string[] {
  const suggestions: Array<{ id: string; score: number }> = [];

  for (const id of candidates) {
    // Prefix match has highest priority (score 0)
    if (id.startsWith(query) || query.startsWith(id)) {
      suggestions.push({ id, score: 0 });
    } else {
      // Levenshtein distance
      const dist = levenshteinDistance(query, id);
      if (dist <= 3) {
        suggestions.push({ id, score: dist });
      }
    }
  }

  // Sort by score, then limit to 3
  return suggestions
    .sort((a, b) => a.score - b.score)
    .slice(0, 3)
    .map((s) => s.id);
}

/**
 * Standard Levenshtein distance implementation.
 * Returns the minimum number of single-character edits needed to transform a into b.
 */
function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1,
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

/**
 * Returns generic fallback content for an unknown agent.
 * Used when options.fallback is true but the agent has no real content.
 */
export function getUnknownAgentContent(agentId: string, _suggestions: string[]): AgentContent {
  return {
    agentBody: [
      `# Unknown Agent: ${agentId}`,
      "",
      `> This agent is not recognized by the Developer Team content registry.`,
      "",
      "## Context",
      "",
      "This agent ID is not registered with real content. The Orchestrator should",
      "either route to a known agent or report this as an unresolved agent reference.",
      "",
      "## Project Standards (auto-resolved)",
      "",
      "<!-- Orchestrator will inject stack-specific rules at runtime. -->",
      "",
      "## Instructions",
      "",
      "Contact the Developer Team maintainers to register content for this agent.",
      "",
    ].join("\n"),
    skillBody: [
      `# Unknown Agent Skill: ${agentId}`,
      "",
      `> This skill is not recognized by the Developer Team content registry.`,
      "",
      "## Instructions",
      "",
      "Contact the Developer Team maintainers to register content for this skill.",
      "",
    ].join("\n"),
  };
}

// ---------------------------------------------------------------------------
// Registry: team session instructions
// ---------------------------------------------------------------------------

/**
 * Returns session-level instructions for a team.
 *
 * For the Developer Team, this is the orchestrator's full operating rules
 * covering delegation, dependency graph, apply routing, artifact store,
 * and project AI notes.
 *
 * Adapters map this to their runtime-specific session initialization mechanism.
 *
 * When options.capabilityInstructions is provided, matching session-surface
 * fragments are appended after context-authority guidance.
 *
 * Returns undefined for unknown team IDs.
 */
/**
 * Add the optional runtime context without duplicating the fixed authority
 * boundary if a later orchestrator surface already carries it.
 */
function appendSkillDiscoveryRuntimeContext(
  baseContent: string,
  context: SkillDiscoveryRuntimeContextV1,
): string {
  const rendered = renderSkillDiscoveryRuntimeContextV1(context);
  const contextWithoutDuplicateBoundary = baseContent.includes(SKILL_DISCOVERY_AUTHORITY_BOUNDARY_V1)
    ? rendered.replace(`\n\n${SKILL_DISCOVERY_AUTHORITY_BOUNDARY_V1}`, "")
    : rendered;
  return `${baseContent.trimEnd()}\n\n${contextWithoutDuplicateBoundary}\n`;
}

export function getTeamSessionInstructions(
  teamId: string,
  options?: ContentRegistryOptions,
): string | undefined {
  if (teamId === "developer-team") {
    const personality = options?.personality ?? DEFAULT_ORCHESTRATOR_PERSONALITY;
    const promptProfile = options?.promptProfile ?? "compact";
    const orchestratorPrompt = promptProfile === "compact"
      ? getAdaptiveLeadSystemPrompt(personality)
      : getOrchestratorSystemPrompt(personality, promptProfile);

    // Compose order: (1) invariant block, (2) existing orchestrator content, (3) context-authority guidance, (4) language policy, (5) optional active-runner discovery context, (6) capability instructions
    const withInvariants = promptProfile === "compact"
      ? `${ADAPTIVE_TEAM_RUNTIME_CONTRACT}\n\n${orchestratorPrompt}`
      : prependOrchestratorInvariants(orchestratorPrompt, "session");
    const base = appendContextAuthorityGuidance(withInvariants);
    const baseWithLanguagePolicy = appendDeveloperTeamLanguagePolicy(base);
    const withSkillDiscoveryRuntimeContext = options?.skillDiscoveryRuntimeContext
      ? appendSkillDiscoveryRuntimeContext(baseWithLanguagePolicy, options.skillDiscoveryRuntimeContext)
      : baseWithLanguagePolicy;
    if (!options?.capabilityInstructions) {
      return withSkillDiscoveryRuntimeContext;
    }
    return appendCapabilityInstructions(
      withSkillDiscoveryRuntimeContext,
      options.capabilityInstructions,
      { surface: "session" },
    );
  }

  return undefined;
}
