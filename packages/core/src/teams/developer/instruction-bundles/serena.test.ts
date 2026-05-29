import { describe, expect, test } from "bun:test";
import { buildSerenaInstructionBundle } from "./serena";
import type { CapabilityInstructionSurface } from "./index";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ENABLED_TOOLS = [
  "find_symbol",
  "find_referencing_symbols",
  "find_implementations",
  "find_declaration",
  "get_symbols_overview",
  "get_diagnostics_for_file",
  "replace_symbol_body",
  "insert_after_symbol",
  "insert_before_symbol",
  "safe_delete_symbol",
  "rename_symbol",
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("buildSerenaInstructionBundle", () => {
  const bundle = buildSerenaInstructionBundle();

  // REQ-SIB-001: Builder returns bundle with 2 fragments (agent + skill)
  test("returns bundle with 2 fragments", () => {
    expect(bundle.instructions).toHaveLength(2);
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

  // Agent fragment documents all enabled tools
  test("agent markdown mentions all 15 enabled tools", () => {
    const agentFragment = bundle.instructions.find((f) => f.surface === "agent");
    expect(agentFragment).toBeDefined();

    const md = agentFragment!.markdown;
    for (const tool of ENABLED_TOOLS) {
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