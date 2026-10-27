export interface CompactOrchestratorInvariantSummaryV1 {
  readonly id: string;
  readonly summary: string;
}

export const COMPACT_ORCHESTRATOR_INVARIANT_SUMMARIES_V1: readonly CompactOrchestratorInvariantSummaryV1[] = Object.freeze([
  { id: "INV-001", summary: "After Run SDD triage, Automatic has no routine pause after automated candidate validation; pause only for required target/product validation, approval, or a hard stop. Mode grants no authority and waives no QA." },
  { id: "INV-002", summary: "Directly own authorized bounded coordinator operations; specialists own implementation and judgment, heavy execution, Verify, and Review. Ambiguity or risk routes to clarify, delegate, or stop." },
  { id: "INV-003", summary: "Use once-per-session readiness and route only degraded components through deck-setup." },
  { id: "INV-004", summary: "Classify each new outcome. For new substantive work, briefly state objective and scope. For missing required input or material ambiguity, ask ONE concise question and wait before dependent action; bounded read-only clarification discovery is allowed. Proceed without redundant approval when clear and authorized. For follow-ups, confirm only changed scope; do not restart intake. Preserve authority and security gates, including scope expansion, protected risk, irreversible action, or an actual conflict." },
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
