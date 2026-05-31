import { describe, expect, test } from "bun:test";
import { buildSerenaInstructionBundle, getSerenaToolPolicy } from "./serena";
import type { CapabilityInstructionSurface } from "./index";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Policy-enabled tools: 11 total (6 read-only + 5 write-capable)
const POLICY_ENABLED_TOOLS = [
  "find_symbol",
  "find_referencing_symbols",
  "find_implementations",
  "find_declaration",
  "get_symbols_overview",
  "get_diagnostics_for_file",
  "replace_symbol_body",
  "rename_symbol",
  "insert_after_symbol",
  "insert_before_symbol",
  "safe_delete_symbol",
];

// Tools excluded by policy but present in documentation
const EXCLUDED_BY_POLICY_TOOLS = [
  "activate_project",
  "get_current_config",
  "initial_instructions",
  "onboarding",
];

const DISABLED_TOOLS = [
  "search_for_pattern",
  "replace_content",
  "read_file",
  "list_dir",
  "find_file",
  "create_text_file",
  "execute_shell_command",
  "write_memory",
  "read_memory",
  "list_memories",
  "edit_memory",
  "delete_memory",
  "rename_memory",
];

// REQ-SAE-006: Tools for apply agents (7 of 11 enabled)
const SYMBOLIC_EDITING_TOOLS = [
  "find_symbol",
  "find_referencing_symbols",
  "replace_symbol_body",
  "rename_symbol",
  "get_diagnostics_for_file",
  "insert_after_symbol",
  "insert_before_symbol",
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("buildSerenaInstructionBundle", () => {
  const bundle = buildSerenaInstructionBundle();

  // REQ-SIB-001: Builder returns bundle with 4 fragments (agent + skill-readonly + skill-full + session)
  test("returns bundle with 4 fragments", () => {
    expect(bundle.instructions).toHaveLength(4);
  });

  // REQ-SIB-002: All fragments have packageId: "serena"
  test("all fragments have packageId: serena", () => {
    for (const fragment of bundle.instructions) {
      expect(fragment.packageId).toBe("serena");
    }
  });

  // Surfaces are "agent" and "skill"
  test("surfaces are agent and skill", () => {
    const surfaces = bundle.instructions.map((f) => f.surface);
    expect(surfaces).toContain("agent");
    expect(surfaces).toContain("skill");
  });

  // Agent fragment documents all policy-enabled tools
  test("agent markdown mentions all 11 policy-enabled tools", () => {
    const agentFragment = bundle.instructions.find((f) => f.surface === "agent");
    expect(agentFragment).toBeDefined();

    const md = agentFragment!.markdown;
    for (const tool of POLICY_ENABLED_TOOLS) {
      expect(md).toContain(tool);
    }
  });

  // Agent fragment documents all disabled tools
  test("agent markdown mentions all 13 disabled tools", () => {
    const agentFragment = bundle.instructions.find((f) => f.surface === "agent");
    expect(agentFragment).toBeDefined();

    const md = agentFragment!.markdown;
    for (const tool of DISABLED_TOOLS) {
      expect(md).toContain(tool);
    }
  });

  // Agent markdown contains coexistence rules
  test("agent markdown contains coexistence rules", () => {
    const agentFragment = bundle.instructions.find((f) => f.surface === "agent");
    expect(agentFragment).toBeDefined();

    const md = agentFragment!.markdown;
    expect(md).toContain("codebase-memory");
    expect(md).toContain("Coexistence"); // section header
  });

  // REQ-SIB-007: Each fragment markdown > 50 chars
  test("each fragment markdown is > 50 characters", () => {
    for (const fragment of bundle.instructions) {
      expect(fragment.markdown.length).toBeGreaterThan(50);
    }
  });

  // REQ-SIB-008: Bundle is frozen
  test("bundle is frozen", () => {
    expect(Object.isFrozen(bundle.instructions)).toBe(true);
  });

  // Skill markdown is non-empty and shorter than agent markdown
  test("skill markdown is shorter than agent markdown", () => {
    const agentFragment = bundle.instructions.find((f) => f.surface === "agent");
    const skillFragment = bundle.instructions.find((f) => f.surface === "skill");

    expect(agentFragment).toBeDefined();
    expect(skillFragment).toBeDefined();
    expect(skillFragment!.markdown.length).toBeLessThan(agentFragment!.markdown.length);
  });
});

// REQ-SAE-006: Tool policy tests
describe("getSerenaToolPolicy", () => {
  const policy = getSerenaToolPolicy();

  test("returns policy for serena", () => {
    expect(policy).toBeDefined();
    expect(policy.packageId).toBe("serena");
  });

  test("declares 11 tools (6 read-only + 5 write) for apply agents", () => {
    expect(policy.enabledTools).toHaveLength(11);
    expect(policy.readOnlyTools).toHaveLength(6);
    expect(policy.writeTools).toHaveLength(5);
    for (const tool of SYMBOLIC_EDITING_TOOLS) {
      expect(policy.enabledTools).toContain(tool);
    }
  });

  test("target agents are the apply agents", () => {
    expect(policy.targetAgents).toContain("deck-developer-apply-backend");
    expect(policy.targetAgents).toContain("deck-developer-apply-frontend");
    expect(policy.targetAgents).toContain("deck-developer-apply-general");
  });

  test("contains fallback reporting text in bundle", () => {
    const bundle = buildSerenaInstructionBundle();
    const agentFragment = bundle.instructions.find((f) => f.surface === "agent");
    expect(agentFragment).toBeDefined();
    expect(agentFragment!.markdown).toContain("Fallback");
  });

  test("does NOT validate CLI existence", () => {
    const bundle = buildSerenaInstructionBundle();
    const agentFragment = bundle.instructions.find((f) => f.surface === "agent");
    expect(agentFragment).toBeDefined();
    // Should not contain CLI validation text
    expect(agentFragment!.markdown).not.toContain("CLI validation");
    expect(agentFragment!.markdown).not.toContain("validate.*cli");
    expect(agentFragment!.markdown).not.toContain("check.*binary");
  });

  test("contains priority rules for symbolic editing", () => {
    const bundle = buildSerenaInstructionBundle();
    const agentFragment = bundle.instructions.find((f) => f.surface === "agent");
    expect(agentFragment).toBeDefined();
    expect(agentFragment!.markdown).toContain("Tool Priority");
  });
});