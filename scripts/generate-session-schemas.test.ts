import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateSessionSchemas, renderSessionSchemasModule, SESSION_SCHEMA_OUTPUT } from "./generate-session-schemas";

describe("generate-session-schemas", () => {
  test("regeneration is idempotent", async () => {
    const root = mkdtempSync(join(tmpdir(), "deck-schema-gen-"));
    try {
      mkdirSync(join(root, "packages/core/src/session"), { recursive: true });
      expect(await generateSessionSchemas(root)).toBe(true);
      const first = readFileSync(join(root, SESSION_SCHEMA_OUTPUT), "utf-8");
      expect(await generateSessionSchemas(root)).toBe(false);
      expect(readFileSync(join(root, SESSION_SCHEMA_OUTPUT), "utf-8")).toBe(first);
      expect(first).toBe(renderSessionSchemasModule());
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
