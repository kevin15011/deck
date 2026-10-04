import { describe, expect, test } from "bun:test";
import type { CapabilityInstructionBundle } from "./index";
import { translateCapabilityInstructions } from "./runner-translation";

const bundle = (markdown: string): CapabilityInstructionBundle => ({
  instructions: [{ packageId: "rtk", surface: "skill", markdown, skillIds: ["a"] }],
});

describe("translateCapabilityInstructions", () => {
  test("is a no-op for an absent bundle", () => {
    expect(translateCapabilityInstructions(undefined, { sections: [], lines: [] })).toBeUndefined();
  });

  test("replaces a whole section up to the next heading of the same or higher level, keeping metadata", () => {
    const out = translateCapabilityInstructions(
      bundle("## Pkg\n\n### Hook\n\nold\n\n#### Detail\n\nold detail\n\n### Next\n\nkept"),
      { sections: [{ heading: /^### Hook$/, replacement: "### Mine\n\nnew\n" }], lines: [] },
    )!;
    expect(out.instructions[0]!.markdown).toBe("## Pkg\n\n### Mine\n\nnew\n\n### Next\n\nkept");
    expect(out.instructions[0]!.skillIds).toEqual(["a"]);
  });

  test("replaces or drops single lines", () => {
    const out = translateCapabilityInstructions(bundle("a\nDROP me\nSWAP me\nz"), {
      sections: [],
      lines: [{ match: /^DROP/, replacement: undefined }, { match: /^SWAP/, replacement: "swapped" }],
    })!;
    expect(out.instructions[0]!.markdown).toBe("a\nswapped\nz");
  });

  test("a section at the end of the document is replaced without a trailing blank line", () => {
    const out = translateCapabilityInstructions(bundle("## P\n\n### Hook\n\nold"), { sections: [{ heading: /^### Hook$/, replacement: "### X\n\nnew\n" }], lines: [] })!;
    expect(out.instructions[0]!.markdown).toBe("## P\n\n### X\n\nnew");
  });
});
