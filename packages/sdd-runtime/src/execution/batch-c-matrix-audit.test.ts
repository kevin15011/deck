import { expect, test } from "bun:test";

test("Batch C matrix uses independent executable contract cases", async () => {
  const source = await Bun.file(new URL("./batch-c-authoritative-matrix.test.ts", import.meta.url)).text();
  const blocks = source.match(/^test\("C-[\s\S]*?^\}\);/gm) ?? [];
  const ids = blocks.map((block) => block.match(/^test\("(C-[A-Z]+-\d+)/)?.[1]);

  expect(blocks).toHaveLength(68);
  expect(new Set(ids).size).toBe(68);
  for (const block of blocks) {
    expect(block.match(/assertBatchCContract\(/g)).toHaveLength(1);
    expect(block).toContain("action:");
    expect(block).toContain("rationale:");
    expect(block).toContain("terminal:");
    expect(block).toContain("digest:");
    expect(block).toContain("authority:");
    expect(block).toContain("git:");
    expect(block).toContain("effect:");
    expect(block).toContain("legacy:");
  }
  expect(source).not.toMatch(/SCENARIO_CATALOG|test\.each|describe\.each|toMatchObject|for \(const scenario|forEach\(\(scenario/);
});
