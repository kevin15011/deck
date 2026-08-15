import { describe, expect, test } from "bun:test";

import { buildAdaptiveMemoryInstructionBundle } from "./adaptive-memory";
import type { CapabilityInstructionSurface } from "./index";

describe("buildAdaptiveMemoryInstructionBundle canonical Supermemory conversation policy", () => {
  const bundle = buildAdaptiveMemoryInstructionBundle();
  const scopedBundle = buildAdaptiveMemoryInstructionBundle({
    supermemoryProjectScope: "sm_project_v1_kevin15011_deck",
    configuredSupermemoryProjectScope: "sm_project_v1_kevin15011_deck",
  });
  const surfaces: CapabilityInstructionSurface[] = ["agent", "session", "skill"];

  for (const surface of surfaces) {
    test(`${surface} surface describes automatic conversation capture without manual save policy`, () => {
      const markdown = bundle.instructions.find((fragment) => fragment.surface === surface)?.markdown ?? "";

      expect(markdown).toContain("conversation capture");
      expect(markdown).toContain("Deck-owned runtime");
      expect(markdown).toContain("stable customId");
      expect(markdown).toContain("canonical project scope");
      expect(markdown).toContain("five results");
      expect(markdown).toContain("1,500 tokens");
      expect(markdown).toContain("OPENSPEC IS OFFICIAL CONTEXT");

      expect(markdown).toContain("Do not");
      expect(markdown).toContain("topic keys");
      expect(markdown).toContain("semantic memory quota");
      expect(markdown).toContain("mandatory session summaries");
      expect(markdown).not.toMatch(/at most \d+ memories/i);
      expect(markdown).not.toContain("Deck configures provider-native conversation capture automatically");
      expect(markdown).not.toContain("Save Trigger Matrix");
    });

    test(`${surface} surface binds automatic memory to the exact canonical containerTag`, () => {
      const markdown = scopedBundle.instructions.find((fragment) => fragment.surface === surface)?.markdown ?? "";

      expect(markdown).toContain('containerTag: "sm_project_v1_kevin15011_deck"');
      expect(markdown).toContain("Automatic MCP write/save operations are disabled");
      expect(markdown).toContain('supermemory_search_memory({ query, containerTag: "sm_project_v1_kevin15011_deck" })');
      expect(markdown).toContain('supermemory_listMemories({ containerTag: "sm_project_v1_kevin15011_deck" })');
      expect(markdown).toContain('supermemory_listDocuments({ containerTag: "sm_project_v1_kevin15011_deck" })');
      expect(markdown).toContain('supermemory_fetch-graph-data({ containerTag: "sm_project_v1_kevin15011_deck" })');
      expect(markdown).toContain('supermemory_memory-graph({ containerTag: "sm_project_v1_kevin15011_deck" })');
      expect(markdown).toContain("explicit remember are routed through the Deck runtime");
      expect(markdown).not.toContain("supermemory_add_memory");
      expect(markdown).toContain("supermemory_getDocument");
      expect(markdown).not.toMatch(/supermemory_search_memory\(\{\s*q\s*,/);
      expect(markdown).toContain("Agents MUST NOT derive, replace, or omit this value");
      expect(markdown).toContain("x-sm-project is diagnostic/transport metadata only");
      expect(markdown).toContain("skip the memory operation");
      expect(markdown).not.toContain("sm_project_default");
      expect(markdown).not.toContain("No manual containerTag required");
      expect(markdown).not.toContain("x-sm-project header supplies an omitted tool argument");
    });
  }

  test("missing or mismatched canonical scope renders fail-closed memory guidance", () => {
    const markdown = buildAdaptiveMemoryInstructionBundle({
      supermemoryProjectScope: "sm_project_v1_kevin15011_deck",
      configuredSupermemoryProjectScope: "sm_project_v1_other_repo",
    }).instructions.map((fragment) => fragment.markdown).join("\n");

    expect(markdown).toContain("Adaptive-memory project operations are disabled");
    expect(markdown).toContain("scope mismatch");
    expect(markdown).toContain("fail open for coding work");
    expect(markdown).not.toContain('containerTag: "sm_project_v1_kevin15011_deck"');
    expect(markdown).not.toContain("sm_project_default");
  });

  test("derived scope without observed configured MCP scope fails closed", () => {
    const markdown = buildAdaptiveMemoryInstructionBundle({
      supermemoryProjectScope: "sm_project_v1_kevin15011_deck",
    }).instructions.map((fragment) => fragment.markdown).join("\n");

    expect(markdown).toContain("Adaptive-memory project operations are disabled");
    expect(markdown).toContain("configured scope missing");
    expect(markdown).not.toContain('containerTag: "sm_project_v1_kevin15011_deck"');
  });

  test("default or invalid configured MCP scope fails closed without echoing the value", () => {
    for (const configuredSupermemoryProjectScope of ["sm_project_default", "not-a-scope"]) {
      const markdown = buildAdaptiveMemoryInstructionBundle({
        supermemoryProjectScope: "sm_project_v1_kevin15011_deck",
        configuredSupermemoryProjectScope,
      }).instructions.map((fragment) => fragment.markdown).join("\n");

      expect(markdown).toContain("Adaptive-memory project operations are disabled");
      expect(markdown).toContain("scope invalid");
      expect(markdown).not.toContain(configuredSupermemoryProjectScope);
      expect(markdown).not.toContain('containerTag: "sm_project_v1_kevin15011_deck"');
    }
  });
});
