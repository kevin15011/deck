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
      expect(markdown).toContain("verified Git repository identity held by Runtime");
      expect(markdown).toContain("five results");
      expect(markdown).toContain("1,500 tokens");
      expect(markdown).toContain("OPENSPEC IS OFFICIAL CONTEXT");
      expect(markdown).toContain("When available, use `deck_project_memory_recall` first");
      expect(markdown).toContain("earlier project decisions, names, conventions, rationale, discoveries, or prior-session work");
      expect(markdown).toContain("Si existe alguna denominación o convención del proyecto relacionada con esta arquitectura, inclúyela únicamente si realmente aplica.");
      expect(markdown).toContain("si existe");
      expect(markdown).toContain("if applicable");
      expect(markdown).toContain("Repository inspection may verify current implementation but must not be used to conclude that no historical convention exists before managed recall");
      expect(markdown).toContain("Do not force recall for ordinary current-state implementation questions with no historical/project-convention aspect");
      expect(markdown).toContain("preserve every historical facet requested by the user");
      expect(markdown).toContain("name/denomination/terminology and convention");
      expect(markdown).toContain("nombre interno");
      expect(markdown).toContain("denominación");
      expect(markdown).toContain("convención");
      expect(markdown).toContain("arquitectura de memoria");
      expect(markdown).toContain("concise and discriminative");
      expect(markdown).toContain("requested historical facets + relevant project subject, not by paraphrasing the full current task");
      expect(markdown).toContain("nombre interno denominación convención arquitectura de memoria proyecto");
      expect(markdown).toContain("omit incidental hypothetical implementation terms such as provider externo, integración, separación, core/adapters");
      expect(markdown).toContain("unless those are themselves the historical fact being sought");
      expect(markdown).toContain("Preserve requested names, conventions, rationale, decisions, and discoveries as separate query facets");
      expect(markdown).toContain("do not insert facts or proper nouns the user did not provide");
      expect(markdown).toContain("Context Mode remains for local/indexed documentation, command output, and current session knowledge");

      expect(markdown).toContain("Do not");
      expect(markdown).toContain("topic keys");
      expect(markdown).toContain("semantic memory quota");
      expect(markdown).toContain("mandatory session summaries");
      expect(markdown).not.toMatch(/at most \d+ memories/i);
      expect(markdown).not.toContain("Deck configures provider-native conversation capture automatically");
      expect(markdown).not.toContain("Save Trigger Matrix");
      expect(markdown).not.toContain("Always use `deck_project_memory_recall`");
    });

    test(`${surface} surface binds automatic memory to Runtime-owned project scope without model-controlled tool arguments`, () => {
      const markdown = scopedBundle.instructions.find((fragment) => fragment.surface === surface)?.markdown ?? "";

      expect(markdown).toContain("Deck has resolved a verified project identity");
      expect(markdown).toContain("Runtime-managed recall and capture bind project scope server-side");
      expect(markdown).toContain("schemas permit model-selected project scope");
      expect(markdown).not.toContain('containerTag: "sm_project_v1_kevin15011_deck"');
      expect(markdown).not.toContain("supermemory_search_memory");
      expect(markdown).not.toContain("supermemory_add_memory");
      expect(markdown).not.toContain("supermemory_getDocument");
      expect(markdown).not.toMatch(/supermemory_search_memory\(\{\s*q\s*,/);
      expect(markdown).not.toContain("sm_project_default");
      expect(markdown).not.toContain("No manual containerTag required");
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

  test("derived scope without observed configured MCP scope remains authorized because Runtime owns scope", () => {
    const markdown = buildAdaptiveMemoryInstructionBundle({
      supermemoryProjectScope: "sm_project_v1_kevin15011_deck",
    }).instructions.map((fragment) => fragment.markdown).join("\n");

    expect(markdown).toContain("Deck has resolved a verified project identity");
    expect(markdown).toContain("Runtime-managed recall and capture bind project scope server-side");
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
