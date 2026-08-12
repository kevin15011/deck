import { readFileSync } from "node:fs";
import { classifySupermemoryMigrationInventory } from "@deck/adapter-supermemory";

export type SupermemoryMigrationDryRunRecord = Readonly<{
  id: string;
  sourceContainerTag: string;
  content: string;
  sourceIdentity?: string;
}>;

export type SupermemoryMigrationDryRunResult = Readonly<{
  exitCode: number;
  output: string;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseInventory(value: unknown): readonly SupermemoryMigrationDryRunRecord[] {
  const records = isRecord(value) && Array.isArray(value.records) ? value.records : value;
  if (!Array.isArray(records)) throw new Error("Inventory JSON must be an array or an object with a records array.");
  return records.map((record, index) => {
    if (!isRecord(record)) throw new Error(`Inventory record ${index} must be an object.`);
    const { id, sourceContainerTag, content, sourceIdentity } = record;
    if (typeof id !== "string" || typeof sourceContainerTag !== "string" || typeof content !== "string") {
      throw new Error(`Inventory record ${index} must include string id, sourceContainerTag, and content fields.`);
    }
    if (sourceIdentity !== undefined && typeof sourceIdentity !== "string") {
      throw new Error(`Inventory record ${index} sourceIdentity must be a string when present.`);
    }
    return { id, sourceContainerTag, content, ...(sourceIdentity === undefined ? {} : { sourceIdentity }) };
  });
}

export function runSupermemoryMigrationDryRun(input: {
  destinationScope: string;
  inventoryPath: string;
  readFile?: (path: string) => string;
}): SupermemoryMigrationDryRunResult {
  try {
    const readFile = input.readFile ?? ((path: string) => readFileSync(path, "utf8"));
    const records = parseInventory(JSON.parse(readFile(input.inventoryPath)));
    const inventory = classifySupermemoryMigrationInventory({
      destinationScope: input.destinationScope,
      records,
    });
    return {
      exitCode: 0,
      output: JSON.stringify({
        dryRun: inventory.dryRun,
        copyAvailable: inventory.copyAvailable,
        remoteDeletionAvailable: inventory.remoteDeletionAvailable,
        summary: inventory.summary,
        examples: inventory.examples,
      }, null, 2),
    };
  } catch (error) {
    return {
      exitCode: 2,
      output: `Supermemory migration dry-run failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
