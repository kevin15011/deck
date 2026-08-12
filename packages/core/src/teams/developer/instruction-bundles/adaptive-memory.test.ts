import { describe, expect, test } from "bun:test";

import { buildAdaptiveMemoryInstructionBundle } from "./adaptive-memory";
import type { CapabilityInstructionSurface } from "./index";

describe("buildAdaptiveMemoryInstructionBundle canonical Supermemory conversation policy", () => {
  const bundle = buildAdaptiveMemoryInstructionBundle();
  const surfaces: CapabilityInstructionSurface[] = ["agent", "session", "skill"];

  for (const surface of surfaces) {
    test(`${surface} surface describes automatic conversation capture without manual save policy`, () => {
      const markdown = bundle.instructions.find((fragment) => fragment.surface === surface)?.markdown ?? "";

      expect(markdown).toContain("conversation capture");
      expect(markdown).toContain("not production-wired");
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
  }
});
