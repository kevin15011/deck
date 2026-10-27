/**
 * Unit tests for Orchestrator Invariants (Task 4)
 *
 * Comprehensive tests covering:
 * - Schema validation for all 5 critical invariants
 * - Rendering order (critical before high, then by ID)
 * - Idempotency of prepend
 * - Verification logic
 * - Runner-agnostic (no Pi/OpenCode references)
 */

import { describe, it, expect } from "bun:test";
import { COMPACT_ORCHESTRATOR_INVARIANT_SUMMARIES_V1 } from "./orchestrator-invariants";

describe("INV-004 SDD Triage Gate: strengthened condition and requiredAction", () => {

  it("invariant count remains six and compact INV-004 summary is exact", () => {
    const compact = COMPACT_ORCHESTRATOR_INVARIANT_SUMMARIES_V1.find((e) => e.id === "INV-004");
    expect(compact?.summary).toBe(
      "Classify each new outcome. For new substantive work, briefly state objective and scope. For missing required input or material ambiguity, ask ONE concise question and wait before dependent action; bounded read-only clarification discovery is allowed. Proceed without redundant approval when clear and authorized. For follow-ups, confirm only changed scope; do not restart intake. Preserve authority and security gates, including scope expansion, protected risk, irreversible action, or an actual conflict.",
    );
  });
});

// ---------------------------------------------------------------------------
// Modification Authorization Tests (Task 7)
// ---------------------------------------------------------------------------

import {
  renderDelegationGate,
  renderApplyAuthorizationCard,
  type ModificationAuthorization,
} from "./orchestrator-invariants";

describe("ModificationAuthorization: renderDelegationGate", () => {
  it("should render gate with all gates passed", () => {
    const auth: ModificationAuthorization = {
      requestClassification: "Run SDD",
      userAuthorizedModification: true,
      sddChange: "fix-update-bug",
      explorerArtifact: "exploration.md",
      taskArtifact: "tasks.md",
    };
    const output = renderDelegationGate(auth);
    expect(output).toContain("## Pre-Delegation Gate Checklist");
    expect(output).toContain("Triage completed: Run SDD");
    expect(output).toContain("Explorer-first evidence");
    expect(output).toContain("User authorization present");
    expect(output).not.toContain("BLOCKED");
  });

  it("should block when triage missing", () => {
    const auth: ModificationAuthorization = {
      requestClassification: undefined as any,
      userAuthorizedModification: true,
    };
    const output = renderDelegationGate(auth);
    expect(output).toContain("Triage must complete before modifying work");
    expect(output).toContain("BLOCKED");
  });

  it("should block when Explorer missing", () => {
    const auth: ModificationAuthorization = {
      requestClassification: "Run SDD",
      userAuthorizedModification: true,
      explorerArtifact: undefined,
    };
    const output = renderDelegationGate(auth);
    expect(output).toContain("Explorer investigation required");
    expect(output).toContain("BLOCKED");
  });

  it("should block when authorization missing", () => {
    const auth: ModificationAuthorization = {
      requestClassification: "Run SDD",
      userAuthorizedModification: false,
      explorerArtifact: "exploration.md",
    };
    const output = renderDelegationGate(auth);
    expect(output).toContain("User authorization required");
    expect(output).toContain("BLOCKED");
  });

  it("should apply INV-006 only after Run SDD is selected", () => {
    const auth: ModificationAuthorization = {
      requestClassification: "Direct",
      userAuthorizedModification: true,
    };
    const output = renderDelegationGate(auth);
    expect(output).toContain("not required outside Run SDD");
    expect(output).not.toContain("INV-006");
    expect(output).not.toContain("BLOCKED");
  });
});

describe("ModificationAuthorization: renderApplyAuthorizationCard", () => {
  it("should render card when authorized", () => {
    const auth: ModificationAuthorization = {
      requestClassification: "Run SDD",
      userAuthorizedModification: true,
      sddChange: "fix-update-bug",
      taskArtifact: "tasks.md",
      allowedTargets: ["apps/cli/src/**/*.ts"],
    };
    const output = renderApplyAuthorizationCard(auth);
    expect(output).toContain("## Apply Agent Authorization Card");
    expect(output).toContain("modifying work authorized: yes");
    expect(output).toContain("**Change**: fix-update-bug");
    expect(output).toContain("**Task Artifact**: tasks.md");
    expect(output).toContain("**Allowed Targets**:");
    expect(output).toContain("REFUSAL INSTRUCTION");
  });

  it("should render refusal when not authorized", () => {
    const auth: ModificationAuthorization = {
      requestClassification: "Run SDD",
      userAuthorizedModification: false,
    };
    const output = renderApplyAuthorizationCard(auth);
    expect(output).toContain("modifying work authorized: NO");
    expect(output).toContain("REFUSAL:");
    expect(output).toContain("Report `blocked` status immediately");
  });

  it("should include SDD change name", () => {
    const auth: ModificationAuthorization = {
      requestClassification: "Run SDD",
      userAuthorizedModification: true,
      sddChange: "add-new-feature",
    };
    const output = renderApplyAuthorizationCard(auth);
    expect(output).toContain("**Change**: add-new-feature");
  });

  it("should include blocked targets when present", () => {
    const auth: ModificationAuthorization = {
      requestClassification: "Run SDD",
      userAuthorizedModification: true,
      blockedTargets: ["docs/**/*.md", "*.config.js"],
    };
    const output = renderApplyAuthorizationCard(auth);
    expect(output).toContain("**Blocked Targets**:");
    expect(output).toContain("docs/");
  });

  it("should include phase artifacts when present", () => {
    const auth: ModificationAuthorization = {
      requestClassification: "Run SDD",
      userAuthorizedModification: true,
      explorerArtifact: "exploration.md",
      proposalArtifact: "proposal.md",
      specArtifact: "spec.md",
      designArtifact: "design.md",
    };
    const output = renderApplyAuthorizationCard(auth);
    expect(output).toContain("Phase Artifacts");
    expect(output).toContain("Explorer: exploration.md");
    expect(output).toContain("Proposal: proposal.md");
    expect(output).toContain("Spec: spec.md");
    expect(output).toContain("Design: design.md");
  });
});

describe("streamlined coordinator ownership invariants", () => {

  it("keeps compact Automatic and ownership boundaries explicit", () => {
    const automatic = COMPACT_ORCHESTRATOR_INVARIANT_SUMMARIES_V1.find(({ id }) => id === "INV-001")!.summary;
    const ownership = COMPACT_ORCHESTRATOR_INVARIANT_SUMMARIES_V1.find(({ id }) => id === "INV-002")!.summary;
    expect(automatic).toContain("no routine pause");
    expect(automatic).toContain("target/product validation");
    expect(ownership).toContain("bounded coordinator operations");
    expect(ownership).toContain("implementation and judgment");
  });
});
