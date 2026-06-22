/**
 * Focused tests for Serena agent usage enforcement.
 * Verifies: session composition, non-apply scoping, no runtime selection wording.
 */
// @ts-expect-error - vitest types are available at runtime via bun
import { describe, test, expect } from "vitest";
import { buildSerenaInstructionBundle } from "./serena";
import { composeCapabilityInstructions, type CapabilityInstructionCompositionContext } from "./index";

describe("Serena session composition", () => {
  const bundle = buildSerenaInstructionBundle();

  // Finding 1: Session fragment reaches Orchestrator when composed with surface="session"
  test("session fragment included when surface=session", () => {
    const sessionContext: CapabilityInstructionCompositionContext = {
      surface: "session",
    };
    const result = composeCapabilityInstructions(
      "# Base Session",
      bundle,
      sessionContext,
    );
    // Should include delegation guidance
    expect(result).toContain("Serena Delegation Guidance");
    expect(result).toContain("Apply Delegation");
    expect(result).toContain("Non-Apply Delegation");
  });

  // Finding 2: No runtime selection wording like "if Serena is selected"
  test("session fragment does not contain forbidden runtime selection wording", () => {
    const sessionContext: CapabilityInstructionCompositionContext = {
      surface: "session",
    };
    const result = composeCapabilityInstructions(
      "# Base Session",
      bundle,
      sessionContext,
    );
    // Forbidden phrases
    expect(result).not.toContain("if Serena is selected");
    expect(result).not.toContain("with Serena selected");
    expect(result).not.toContain("when Serena is selected");
    // Spanish equivalents
    expect(result).not.toContain("si Serena está seleccionada");
    expect(result).not.toContain("cuando Serena esté seleccionada");
  });
});

describe("Serena non-apply skill scoping", () => {
  const bundle = buildSerenaInstructionBundle();

  // Finding 3: Non-apply skills receive read-only only, no write-capable guidance
  test("non-apply skill receives read-only only", () => {
    const skillContext: CapabilityInstructionCompositionContext = {
      surface: "skill",
      skillId: "deck-developer-explorer-skill",
    };
    const result = composeCapabilityInstructions(
      "# Explorer Skill",
      bundle,
      skillContext,
    );
    // Should contain read-only tools
    expect(result).toContain("find_symbol");
    expect(result).toContain("find_referencing_symbols");
    // Should NOT contain write-capable tool names
    expect(result).not.toContain("replace_symbol_body");
    expect(result).not.toContain("rename_symbol");
    expect(result).not.toContain("insert_after_symbol");
    expect(result).not.toContain("insert_before_symbol");
  });

  // Finding 4: Apply skills receive full (read-only + write-capable) guidance
  test("apply skill receives full guidance", () => {
    const skillContext: CapabilityInstructionCompositionContext = {
      surface: "skill",
      skillId: "deck-developer-apply-backend-skill",
    };
    const result = composeCapabilityInstructions(
      "# Apply Backend Skill",
      bundle,
      skillContext,
    );
    // Should contain both read-only AND write-capable tools
    expect(result).toContain("find_symbol");
    expect(result).toContain("replace_symbol_body");
    expect(result).toContain("rename_symbol");
    expect(result).toContain("insert_after_symbol");
    expect(result).toContain("insert_before_symbol");
  });
});

describe("Serena prompt growth", () => {
  const bundle = buildSerenaInstructionBundle();

  // Finding 5: Session fragment adds substantial but bounded content
  // Using a realistic base session size for measurement
  test("session fragment adds bounded content", () => {
    // Realistic base: orchestrator session ~2000 chars (100 lines x 20 chars)
    const baseSession = "# Orchestrator Session\n## Instructions\nDelegation rules here.\n".repeat(50);
    const baseLength = baseSession.length;

    const sessionContext: CapabilityInstructionCompositionContext = {
      surface: "session",
    };
    const withSerena = composeCapabilityInstructions(baseSession, bundle, sessionContext);
    const withLength = withSerena.length;

    // Fragment adds ~1360 chars - we verify it's bounded (not exploding)
    const addedLength = withLength - baseLength;
    // Upper bound: fragment shouldn't exceed 2000 chars
    expect(addedLength).toBeLessThan(2000);
  });
});