import { describe, expect, test } from "bun:test";

import { runSupermemoryMigrationDryRun } from "./supermemory-migration-command";

describe("runSupermemoryMigrationDryRun", () => {
  test("classifies a local inventory without exposing content or offering remote deletion", () => {
    const result = runSupermemoryMigrationDryRun({
      destinationScope: "sm_project_v1_kevin15011_deck",
      inventoryPath: "/tmp/inventory.json",
      readFile: () => JSON.stringify({
        records: [
          { id: "confirmed", sourceContainerTag: "sm_project_kevin15011-deck", content: "confirmed secret-free content" },
          { id: "unrelated", sourceContainerTag: "sm_project_other", content: "Unrelated raw content" },
          { id: "ambiguous", sourceContainerTag: "p:deck", content: "Ambiguous raw content" },
          { id: "confirmed", sourceContainerTag: "sm_project_kevin15011-deck", content: "confirmed secret-free content" },
        ],
      }),
    });

    expect(result.exitCode).toBe(0);
    const output = JSON.parse(result.output) as Record<string, unknown>;
    expect(output).toMatchObject({
      dryRun: true,
      copyAvailable: false,
      remoteDeletionAvailable: false,
      summary: { confirmed: 1, unrelated: 1, duplicate: 1, ambiguous: 1 },
    });
    expect(result.output).not.toContain("Unrelated raw content");
    expect(result.output).not.toContain("confirmed secret-free content");
  });

  test("rejects invalid destination scopes without reading or copying", () => {
    const result = runSupermemoryMigrationDryRun({
      destinationScope: "sm_project_default",
      inventoryPath: "/tmp/inventory.json",
      readFile: () => JSON.stringify({ records: [] }),
    });

    expect(result.exitCode).toBe(2);
    expect(result.output).toContain("canonical destination scope");
  });
});
