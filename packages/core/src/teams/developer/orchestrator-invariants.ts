/**
 * Orchestrator Invariants for the Deck Developer Team.
 *
 * Canonical invariant records extracted from orchestrator-content.ts.
 * These represent the non-negotiable behavioral rules that govern
 * the orchestrator's execution and must be preserved in all compositions.
 *
 * Three tiers:
 * - critical: session-breaking rules that MUST be enforced
 * - high: important rules that SHOULD be enforced
 * - standard: advisory rules
 *
 * Four surfaces:
 * - session: the system prompt at session startup
 * - agent: the agent body (written after runtime frontmatter)
 * - skill: the skill body (written after runtime frontmatter)
 * - manifest: the manifest output (composed through content registry)
 */



export type OrchestratorInvariantTier = "critical" | "high" | "standard";
export type OrchestratorInvariantSurface = "session" | "agent" | "skill" | "manifest";

export interface OrchestratorInvariant {
  /** Unique invariant identifier, e.g. INV-001 */
  id: string;
  /** Human-readable title */
  title: string;
  /** Priority tier: critical > high > standard */
  tier: OrchestratorInvariantTier;
  /** Which surfaces this invariant applies to */
  surfaces: readonly OrchestratorInvariantSurface[];
  /** Trace references to source sections in orchestrator-content.ts */
  sourceRefs: readonly string[];
  /** Condition under which this invariant applies */
  condition: string;
  /** The required action when the condition is met */
  requiredAction: string;
  /** Why this invariant exists */
  rationale: string;
  /** Consequence of violating this invariant */
  violationConsequence: string;
}

/**
 * Result type for invariant verification
 */
export interface InvariantVerificationResult {
  pass: boolean;
  missing: readonly string[];
}

// ---------------------------------------------------------------------------
// Critical-Tier Invariants (P0)
// ---------------------------------------------------------------------------

/**
 * INV-001: Execution Mode Gate
 *
 * Ask Automatic vs Interactive on first SDD run per session.
 * Cache the answer for the session.
 *
 * Source: orchestrator-content.ts, lines 161-168 (Execution Mode)
 * "On the first change request in a session, ask which execution mode..."
 */
export const INV_001_EXECUTION_MODE_GATE: OrchestratorInvariant = {
  id: "INV-001",
  title: "Execution Mode Gate",
  tier: "critical",
  surfaces: ["session", "agent", "skill", "manifest"],
  sourceRefs: [
    "orchestrator-content.ts:161-168 (Execution Mode section)",
  ],
  condition: "First change request in a session",
  requiredAction:
    "Ask user which execution mode they prefer: Automatic (run all phases back-to-back without pausing) or Interactive (default, pause after each phase). Cache the mode for the session.",
  rationale:
    "Without explicit user preference, the orchestrator assumes Interactive mode by default, which may cause unnecessary pauses during bulk execution. Asking upfront ensures alignment with user intent.",
  violationConsequence:
    "User experiences unexpected pauses or the orchestrator runs without confirmation when Automatic was preferred.",
};

/**
 * INV-002: Pure Delegator
 *
 * The orchestrator never executes specialized agent work itself.
 * It always delegates to the appropriate specialist agent.
 *
 * Source: orchestrator-content.ts, lines 64-79 (Your Identity: Pure Delegator)
 */
export const INV_002_PURE_DELEGATOR: OrchestratorInvariant = {
  id: "INV-002",
  title: "Pure Delegator",
  tier: "critical",
  surfaces: ["session", "agent", "skill", "manifest"],
  sourceRefs: [
    "orchestrator-content.ts:64-79 (Your Identity: Pure Delegator)",
  ],
  condition: "Any task that has a specialist agent capable of handling it",
  requiredAction:
    "Delegate the task to the appropriate specialist agent. Do not execute the work yourself.",
  rationale:
    "The orchestrator's role is coordination and synthesis, not implementation. Executing specialist work fills context with implementation details and blocks specialized agents from doing what they do best.",
  violationConsequence:
    "Orchestrator context inflates with implementation details, losing objectivity and coordination ability. Specialized agents are blocked from contributing.",
};

/**
 * INV-003: SDD Initialization Gate
 *
 * Check openspec/config.yaml initialized state before SDD work.
 * Delegate to deck-init when required.
 *
 * Source: orchestrator-content.ts, lines 133-144 (SDD Initialization Gate)
 */
export const INV_003_SDD_INITIALIZATION_GATE: OrchestratorInvariant = {
  id: "INV-003",
  title: "SDD Initialization Gate",
  tier: "critical",
  surfaces: ["session", "agent", "skill", "manifest"],
  sourceRefs: [
    "orchestrator-content.ts:133-144 (SDD Initialization Gate)",
  ],
  condition:
    "Before processing any SDD work, check whether the project has been initialized",
  requiredAction:
    "Read openspec/config.yaml and check the initialized field. If initialized: false or file does not exist, delegate to deck-init before any other work. Re-check the flag after deck-init completes.",
  rationale:
    "SDD assumes an initialized OpenSpec workspace. Running SDD on an uninitialized project causes artifacts to be placed incorrectly or fail silently.",
  violationConsequence:
    "SDD artifacts are written to incorrect locations or the initialization state becomes inconsistent.",
};

/**
 * INV-004: SDD Triage Gate
 *
 * Classify user request before asking execution mode.
 * Do not infer full SDD from keywords like "OpenSpec", "PRD", etc.
 *
 * Source: orchestrator-content.ts, lines 146-159 (SDD Triage Gate)
 */
export const INV_004_SDD_TRIAGE_GATE: OrchestratorInvariant = {
  id: "INV-004",
  title: "SDD Triage Gate",
  tier: "critical",
  surfaces: ["session", "agent", "skill", "manifest"],
  sourceRefs: [
    "orchestrator-content.ts:146-159 (SDD Triage Gate)",
  ],
  condition:
    "Before asking for execution mode, launching SDD phases, or taking/delegating any step that may modify code, configuration, prompts, OpenSpec artifacts, or project files",
  requiredAction:
    "Classify the request as Direct, Specialist(s), Recommend SDD, or Run SDD. Do not ask Automatic vs Interactive unless triage says Run SDD. Do not modify or delegate modifying work until this classification is made.",
  rationale:
    "SDD is a heavyweight pipeline. Running it for every request with certain keywords wastes resources and frustrates users with unnecessary ceremony. Using the smallest appropriate workflow keeps the team responsive. Additionally, bypassing triage and modifying files directly undermines workflow safety.",
  violationConsequence:
    "Users experience unnecessary SDD pipeline overhead for simple requests, or miss the full pipeline when it would benefit their work. The orchestrator may modify or delegate work without proper classification.",
};

/**
 * INV-005: Registry-Deferred Parallelism
 *
 * Parallel phase agents write artifacts only; orchestrator serializes
 * state.yaml/events.yaml updates.
 *
 * Source: orchestrator-content.ts, lines 181-182 (Artifact Store: parallel phase batching)
 */
export const INV_005_REGISTRY_DEFERRED_PARALLELISM: OrchestratorInvariant = {
  id: "INV-005",
  title: "Registry-Deferred Parallelism",
  tier: "critical",
  surfaces: ["session", "agent", "skill", "manifest"],
  sourceRefs: [
    "orchestrator-content.ts:181-182 (Artifact Store: parallel phase batching)",
  ],
  condition:
    "When launching parallel phase batches (Spec+Design or Verify+Review)",
  requiredAction:
    "Instruct each phase agent to run in registry-deferred mode: write only its phase artifact, report registry intent/status/event in the return contract, and do not write state.yaml or events.yaml. After all agents complete, serialize registry updates yourself.",
  rationale:
    "Concurrent writes to shared Spec Registry files cause race conditions. Registry-deferred mode prevents corruption while enabling parallelism.",
  violationConsequence:
    "Race conditions corrupt state.yaml/events.yaml, losing phase artifacts, provenance, or event history.",
};

/**
 * INV-006: SDD Explorer-First Flow
 *
 * When Run SDD is selected, Explorer must run first before Proposal.
 * The full SDD flow respects: Explorer → Proposal → Spec + Design → Tasks → Apply → Verify + Review → Archive.
 *
 * Source: orchestrator-content.ts, lines 118-131 (Dependency Graph)
 * Source: orchestrator-content.ts, lines 146-159 (SDD Triage Gate: Run SDD)
 */
export const INV_006_SDD_EXPLORER_FIRST_FLOW: OrchestratorInvariant = {
  id: "INV-006",
  title: "SDD Explorer-First Flow",
  tier: "critical",
  surfaces: ["session", "agent", "skill", "manifest"],
  sourceRefs: [
    "orchestrator-content.ts:118-131 (Dependency Graph)",
    "orchestrator-content.ts:146-159 (SDD Triage Gate: Run SDD)",
  ],
  condition: "When Run SDD is selected via triage",
  requiredAction:
    "Execute Explorer as the first phase before Proposal. The full SDD flow order must be: Explorer → Proposal → Spec + Design → Tasks → Apply → Verify + Review → Archive. Do not skip any phase.",
  rationale:
    "Without Explorer-first, Proposal lacks codebase context and generates lower-quality proposals. The exploration phase provides critical architectural and constraint information that informed Proposal decisions require.",
  violationConsequence:
    "Proposal operates without adequate codebase context, producing incomplete or misaligned change proposals that require later rework.",
};

// ---------------------------------------------------------------------------
// Canonical Exports
// ---------------------------------------------------------------------------

/**
 * All orchestrator invariants ordered by tier (critical first, then high, then standard),
 * then by ID within each tier.
 */
export const ORCHESTRATOR_INVARIANTS: readonly OrchestratorInvariant[] = [
  INV_001_EXECUTION_MODE_GATE,
  INV_002_PURE_DELEGATOR,
  INV_003_SDD_INITIALIZATION_GATE,
  INV_004_SDD_TRIAGE_GATE,
  INV_005_REGISTRY_DEFERRED_PARALLELISM,
  INV_006_SDD_EXPLORER_FIRST_FLOW,
];

// ---------------------------------------------------------------------------
// Rendering Helpers
// ---------------------------------------------------------------------------

/**
 * Render orchestrator invariants into markdown.
 *
 * @param options.surface - Target surface (session, agent, skill, manifest)
 * @param options.tierMin - Minimum tier to include (default: "critical")
 */
export function renderOrchestratorInvariants(options: {
  surface: OrchestratorInvariantSurface;
  tierMin?: OrchestratorInvariantTier;
}): string {
  const { surface, tierMin = "critical" } = options;

  // Filter by surface and tier
  const tierOrder: OrchestratorInvariantTier[] = ["critical", "high", "standard"];
  const minTierIndex = tierOrder.indexOf(tierMin);

  const filtered = ORCHESTRATOR_INVARIANTS.filter((inv) => {
    const invTierIndex = tierOrder.indexOf(inv.tier);
    const matchesSurface = inv.surfaces.includes(surface);
    const meetsTier = invTierIndex >= minTierIndex;
    return matchesSurface && meetsTier;
  });

  // Sort by tier, then by ID
  filtered.sort((a, b) => {
    const tierDiff = tierOrder.indexOf(a.tier) - tierOrder.indexOf(b.tier);
    if (tierDiff !== 0) return tierDiff;
    return a.id.localeCompare(b.id);
  });

  if (filtered.length === 0) {
    return "";
  }

  const lines = ["## Orchestrator Invariants", ""];

  for (const inv of filtered) {
    lines.push(`### ${inv.id}: ${inv.title}`);
    lines.push("");
    lines.push(`**Condition**: ${inv.condition}`);
    lines.push("");
    lines.push(`**Required Action**: ${inv.requiredAction}`);
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Prepend orchestrator invariants to existing content.
 * Idempotent: if content already contains the section, does not prepend again.
 *
 * @param content - Existing content to prepend invariants to
 * @param surface - Target surface
 */
export function prependOrchestratorInvariants(
  content: string,
  surface: OrchestratorInvariantSurface
): string {
  // Idempotency check
  if (content.includes("## Orchestrator Invariants")) {
    return content;
  }

  const invariantBlock = renderOrchestratorInvariants({ surface });
  if (!invariantBlock) {
    return content;
  }

  return `${invariantBlock}\n\n${content}`;
}

/**
 * Verify that all critical-tier invariants targeting a surface are present.
 *
 * @param content - Composed output to verify
 * @param options.surface - Target surface to check
 * @returns Result with pass status and list of missing invariant IDs
 */
export function verifyOrchestratorInvariantPresence(
  content: string,
  options: { surface: OrchestratorInvariantSurface }
): InvariantVerificationResult {
  const { surface } = options;
  const missing: string[] = [];

  // Check for section header (exactly once)
  const headerMatches = content.match(/^## Orchestrator Invariants$/m);
  if (!headerMatches || headerMatches.length !== 1) {
    return {
      pass: false,
      missing: ORCHESTRATOR_INVARIANTS.map((inv) => inv.id),
    };
  }

  // Check each critical invariant targeting the surface
  for (const inv of ORCHESTRATOR_INVARIANTS) {
    if (inv.tier !== "critical") continue;
    if (!inv.surfaces.includes(surface)) continue;

    // Match by ID in content (normalized search)
    const idPattern = new RegExp(`\\b${inv.id}\\b`);
    if (!idPattern.test(content)) {
      missing.push(inv.id);
    }
  }

  return {
    pass: missing.length === 0,
    missing,
  };
}