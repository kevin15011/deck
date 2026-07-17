import { describe, expect, test } from "bun:test";
import { parseYaml } from "./yaml";
import { EXECUTION_V1_REGISTRY_FIXTURES } from "../../../sdd-runtime/src/fixtures/execution-v1/registry-fixtures";

describe("execution-v1 registry compatibility baseline", () => {
  test("active, archived, and legacy YAML remain readable with warnings/history intact", () => {
    for (const fixture of EXECUTION_V1_REGISTRY_FIXTURES) {
      const parsed = parseYaml(fixture.yaml);
      expect(parsed.ok).toBe(true);
      expect(parsed.diagnostics.map((item) => item.code)).toEqual(fixture.diagnosticCodes);
      expect(JSON.stringify(parsed.data)).toContain(fixture.historyMarker);
    }
  });
});
