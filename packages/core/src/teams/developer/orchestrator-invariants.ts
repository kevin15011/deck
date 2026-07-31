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
 * "When Run SDD is selected, use Automatic mode unless the user explicitly requested phase-by-phase interaction..."
 */
export const INV_001_EXECUTION_MODE_GATE: OrchestratorInvariant = {
  id: "INV-001",
  title: "Execution Mode Gate",
  tier: "critical",
  surfaces: ["session", "agent", "skill", "manifest"],
  sourceRefs: [
    "orchestrator-content.ts (Execution Mode section)",
  ],
  condition: "Run SDD selected after triage for the first change request in a session",
  requiredAction:
    "Ask which execution mode the user prefers and cache it for the session. Automatic has no routine phase-by-phase or functional-acceptance pause and continues after automated candidate validation; pause only for genuinely required target/product validation or an existing approval or hard stop. Interactive retains phase decisions. Execution mode never grants authority or waives safety or independent QA.",
  rationale:
    "Mode selection follows triage and controls communication cadence without becoming an authority, acceptance, or quality bypass.",
  violationConsequence:
    "The workflow pauses unnecessarily, advances without a required decision, or misrepresents mode as authorization or quality evidence.",
};;

/**
 * INV-002: Coordinator Ownership
 *
 * The Orchestrator directly performs bounded, mechanical, deterministic, and
 * authorized coordination while specialists retain implementation, protected
 * judgment, and independent Verify and Review work.
 *
 * Source: orchestrator-content.ts (Coordinator Ownership Boundary)
 */
export const INV_002_COORDINATOR_OWNERSHIP: OrchestratorInvariant = {
  id: "INV-002",
  title: "Coordinator Ownership",
  tier: "critical",
  surfaces: ["session", "agent", "skill", "manifest"],
  sourceRefs: [
    "orchestrator-content.ts (Coordinator Ownership section)",
  ],
  condition: "Any coordinator operation or specialist-owned work",
  requiredAction:
    "Own work directly only when it is bounded, mechanical, deterministic, authorized, non-destructive, and requires no specialist implementation or judgment. Direct examples are bounded git status/diff/log inspection, exact staging and commit, deterministic artifact, digest, count, and existence checks, centralized intent reconciliation, synthesis, and resolved-decision recording. Delegate behavior changes, specialist artifacts, broad or build execution, protected-risk, architecture, migration, security, data-loss, or public-API judgment, Verify, and Review to the appropriate specialist. Ambiguity, risk, or scope uncertainty requires clarification, delegation, or stop. Ownership never widens authority.",
  rationale:
    "Qualitative ownership keeps mechanical coordination efficient while preserving specialist implementation, protected judgment, and independent quality roles.",
  violationConsequence:
    "The coordinator either adds avoidable delegation overhead or crosses implementation, judgment, authority, or independent-QA boundaries.",
};;

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
    "orchestrator-content.ts (SDD Triage Gate / User Phase Communication)",
  ],
  condition:
    "For each new desired outcome before asking for execution mode or launching SDD phases; in-scope conversational deltas reuse the existing classification",
  requiredAction:
    "For each new desired outcome, classify the request as exactly one of Direct, Specialist(s), Recommend SDD, or Run SDD and record a concise reason before modifying work. Use bounded read-only discovery when needed. If the user's instruction already makes the intended reversible change clear, begin without a separate restatement-confirmation ceremony; the instruction is the modification request within its stated scope. Restate and ask only when ambiguity would materially change the product, scope, protected risk, or irreversible effect.\n\nA follow-up such as \"move this up\", \"make it smaller\", \"try the other layout\", or \"fix that failure\" continues the same working outcome when it stays within the authorized goal, targets, risk, and reversibility. Preserve the current candidate and decisions, route only the delta, mint any required internal one-use authorization without asking the user again, and rerun only evidence invalidated by that delta. There is no arbitrary revision-cycle limit. Re-triage or ask the user only for a real product decision, meaningful scope expansion, protected risk, irreversible action, or actual write/authority conflict. User acceptance guides the product loop but never substitutes for proportionate engineering QA.",
  rationale:
    "Classification selects proportional process without turning clear user instructions or normal product iteration into repeated confirmation gates. Material ambiguity and protected or irreversible effects still require an explicit decision.",
  violationConsequence:
    "The team either applies disproportionate process and makes the user manage routine iteration, or changes material product scope or protected behavior without the required decision.",
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
    "When launching parallel phase batches (Spec+Design or in-stage independent checks)",
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
 * The full SDD flow respects: Explorer → Proposal → Spec + Design → Tasks → Apply → targeted → affected_area → Review → broad → Archive.
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
  condition: "For post-Explore Run SDD work after Run SDD is selected via triage",
  requiredAction:
    "Execute Explorer as the first phase before Proposal for Run SDD. Direct and Specialist work must not require Explorer. Recommend SDD is advisory and must not pause progress; the Orchestrator selects Run SDD when current evidence requires it. The full SDD flow order must be: Explorer → Proposal → Spec + Design → Tasks → Apply → targeted → affected_area → Review → broad → Archive. Do not skip any required phase.",
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
  INV_002_COORDINATOR_OWNERSHIP,
  INV_003_SDD_INITIALIZATION_GATE,
  INV_004_SDD_TRIAGE_GATE,
  INV_005_REGISTRY_DEFERRED_PARALLELISM,
  INV_006_SDD_EXPLORER_FIRST_FLOW,
];

export interface CompactOrchestratorInvariantSummaryV1 {
  readonly id: string;
  readonly summary: string;
}

export const COMPACT_ORCHESTRATOR_INVARIANT_SUMMARIES_V1: readonly CompactOrchestratorInvariantSummaryV1[] = Object.freeze([
  { id: "INV-001", summary: "After Run SDD triage, Automatic has no routine pause after automated candidate validation; pause only for required target/product validation, approval, or a hard stop. Mode grants no authority and waives no QA." },
  { id: "INV-002", summary: "Directly own authorized bounded coordinator operations; specialists own implementation and judgment, heavy execution, Verify, and Review. Ambiguity or risk routes to clarify, delegate, or stop." },
  { id: "INV-003", summary: "Verify OpenSpec initialization before SDD and route initialization through deck-init." },
  { id: "INV-004", summary: "Classify each new outcome, start clear reversible work without a separate confirmation ceremony, and treat in-scope feedback as a delta on the same candidate. Ask again only for material ambiguity, scope expansion, protected risk, irreversible action, or an actual conflict." },
  { id: "INV-005", summary: "Specialists return RegistryIntentV1 values; the central coordinator serializes shared registry writes." },
  { id: "INV-006", summary: "Preserve Explore -> Proposal -> Spec + Design -> Tasks -> Apply -> targeted -> affected_area -> Review -> broad -> Archive." },
  { id: "PERMANENT-AUTHORITY", summary: "Runtime authorization and exact Git safety gates precede every modifying effect; prompt text never grants authority." },
  { id: "PERMANENT-QUALITY", summary: "Verify is independent from Apply, Review is independent from both, and required freshness cannot be waived." },
  { id: "PERMANENT-HARD-STOP", summary: "Honor protected-risk, Full-SDD, registry, replay, repair-governance, and excluded-WIP hard stops." },
  { id: "PERMANENT-SKILLS", summary: "Load the matching role skill and only scope-relevant capability instructions before delegation." },
].map((entry) => Object.freeze(entry)));;

export function renderCompactOrchestratorInvariantsV1(): string {
  return [
    "## Compact Orchestrator Invariants",
    "",
    ...COMPACT_ORCHESTRATOR_INVARIANT_SUMMARIES_V1.map((entry) => `- **${entry.id}**: ${entry.summary}`),
  ].join("\n");
}

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

// ---------------------------------------------------------------------------
// Modification Authorization (for pre-delegation gates)
// ---------------------------------------------------------------------------

/**
 * Classification of a user request after triage.
 */
export type RequestClassification = "Direct" | "Specialist(s)" | "Recommend SDD" | "Run SDD";

/**
 * Authorization record for modifying work.
 *
 * Used by the orchestrator to verify that modifying work (Apply, file writes,
 * etc.) is properly authorized before delegation to specialist agents.
 */
export type ModificationAuthorization = {
  /** Classification from triage */
  requestClassification: RequestClassification;
  /** Whether user has explicitly authorized modifying work */
  userAuthorizedModification: boolean;
  /** SDD change name (when requestClassification is Run SDD) */
  sddChange?: string;
  /** Path to explorer artifact if explorer was run */
  explorerArtifact?: string;
  /** Path to proposal artifact if proposal was created */
  proposalArtifact?: string;
  /** Path to spec artifact */
  specArtifact?: string;
  /** Path to design artifact */
  designArtifact?: string;
  /** Path to task artifact (authorizes specific work scope) */
  taskArtifact?: string;
  /** Explicitly allowed file targets (from task artifact) */
  allowedTargets?: readonly string[];
  /** Explicitly blocked file targets */
  blockedTargets?: readonly string[];
};

/**
 * Render a delegation gate for pre-delegation checklist.
 *
 * Returns a compact block that can be injected into orchestrator prompts
 * to verify triage, Explorer-first, and authorization before modifying delegation.
 */
export function renderDelegationGate(auth: ModificationAuthorization): string {
  const lines: string[] = [
    "## Pre-Delegation Gate Checklist",
    "",
    "Before delegating any modifying work, verify:",
  ];

  // INV-004: Triage check
  if (auth.requestClassification) {
    lines.push(`- [x] Triage completed: ${auth.requestClassification}`);
  } else {
    lines.push("- [ ] Triage must complete before modifying work (INV-004)");
  }

  // INV-006 applies only after Run SDD is selected.
  const explorerRequired = auth.requestClassification === "Run SDD";
  if (!explorerRequired) {
    lines.push("- [x] Explorer-first evidence: not required outside Run SDD");
  } else if (auth.explorerArtifact) {
    lines.push(`- [x] Explorer-first evidence: ${auth.explorerArtifact}`);
  } else {
    lines.push("- [ ] Explorer investigation required before modifying work (INV-006)");
  }

  // Authorization check
  if (auth.userAuthorizedModification) {
    lines.push(`- [x] User authorization present`);
    if (auth.sddChange) {
      lines.push(`- [x] SDD Change: ${auth.sddChange}`);
    }
    if (auth.taskArtifact) {
      lines.push(`- [x] Task artifact: ${auth.taskArtifact}`);
    }
  } else {
    lines.push("- [ ] User authorization required for modifying work");
  }

  // If not all gates passed, add blocking message
  const allPassed = auth.requestClassification && (!explorerRequired || auth.explorerArtifact) && auth.userAuthorizedModification;
  if (!allPassed) {
    lines.push("");
    lines.push("**BLOCKED**: Cannot proceed with modifying delegation until all gates are cleared.");
    lines.push("Report `blocked` status with the missing gate to the user.");
  }

  return lines.join("\n");
}

/**
 * Render an apply-agent authorization card.
 *
 * Returns a compact authorization artifact to inject into apply-agent
 * prompts, including change name, task IDs, allowed file scope, and
 * refusal instruction.
 */
export function renderApplyAuthorizationCard(auth: ModificationAuthorization): string {
  const lines: string[] = [
    "## Apply Agent Authorization Card",
    "",
  ];

  // Authorization statement
  if (auth.userAuthorizedModification) {
    lines.push("**modifying work authorized: yes**");
  } else {
    lines.push("**modifying work authorized: NO**");
    lines.push("");
    lines.push("REFUSAL: This agent must refuse to perform any file modifications.");
    lines.push("Report `blocked` status immediately without making any changes.");
    return lines.join("\n");
  }

  // Change context
  if (auth.sddChange) {
    lines.push(`**Change**: ${auth.sddChange}`);
  }

  // Task context
  if (auth.taskArtifact) {
    lines.push(`**Task Artifact**: ${auth.taskArtifact}`);
  }

  // File scope
  if (auth.allowedTargets && auth.allowedTargets.length > 0) {
    lines.push(`**Allowed Targets**: ${auth.allowedTargets.join(", ")}`);
  }

  if (auth.blockedTargets && auth.blockedTargets.length > 0) {
    lines.push(`**Blocked Targets**: ${auth.blockedTargets.join(", ")}`);
  }

  // Phase artifacts for reference
  const artifacts: string[] = [];
  if (auth.explorerArtifact) artifacts.push(`Explorer: ${auth.explorerArtifact}`);
  if (auth.proposalArtifact) artifacts.push(`Proposal: ${auth.proposalArtifact}`);
  if (auth.specArtifact) artifacts.push(`Spec: ${auth.specArtifact}`);
  if (auth.designArtifact) artifacts.push(`Design: ${auth.designArtifact}`);

  if (artifacts.length > 0) {
    lines.push("");
    lines.push("**Phase Artifacts**:");
    for (const a of artifacts) {
      lines.push(`- ${a}`);
    }
  }

  // Refusal instruction - defense in depth
  lines.push("");
  lines.push("---");
  lines.push("**REFUSAL INSTRUCTION**: If any of the above authorization is missing,");
  lines.push("do NOT proceed with file modifications. Report `blocked` immediately.");

  return lines.join("\n");
}
