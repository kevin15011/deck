import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { buildCommandGenerationPlan, applyCommandGeneration } from "./command-generation";

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), "deck-command-test-"));
}

function cleanup(dir: string) {
  rmSync(dir, { recursive: true, force: true });
}

describe("buildCommandGenerationPlan", () => {
  test("does not generate Deck-owned OpenCode sdd-* command files", () => {
    const plan = buildCommandGenerationPlan({ configDir: "/tmp/.config/opencode" });

    expect(plan).toEqual([]);
    expect(plan.some((p) => p.commandId.startsWith("sdd-"))).toBe(false);
    expect(plan.some((p) => /\/commands\/sdd-[^/]+\.md$/.test(p.absolutePath))).toBe(false);
  });

  test("ignores repair incident context because adapter commands are not Deck-owned", () => {
    const plan = buildCommandGenerationPlan({
      configDir: "/tmp/.config/opencode",
      repairIncident: {
        path: "openspec/changes/example/repair-incident.md",
        incidentId: "repair-example-001",
      },
    });

    expect(plan).toEqual([]);
  });
});

describe("applyCommandGeneration", () => {
  test("is a no-op for an empty command plan", () => {
    const dir = createTempDir();
    const writes: string[] = [];
    const mkdirs: string[] = [];
    try {
      applyCommandGeneration(buildCommandGenerationPlan({ configDir: join(dir, ".config", "opencode") }), {
        writeFile: (path) => writes.push(path),
        mkdir: (path) => mkdirs.push(path),
      });

      expect(writes).toEqual([]);
      expect(mkdirs).toEqual([]);
    } finally {
      cleanup(dir);
    }
  });
});
