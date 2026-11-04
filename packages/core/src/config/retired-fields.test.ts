import { expect, test } from "bun:test";
import { validateDeckConfig, diagnoseDeckConfigDeprecations } from "./deck-config";

// Protects old-config admission without retaining selection or weakening secret rejection.
test("retired fields are diagnosed and projected away without mutating input", () => {
  const raw = { version: 1, adaptiveMemory: { enabled: true, activeProvider: "supermemory", supermemory: { projectId: "old" } }, packageInstructions: { codex: { "adaptive-memory": true } } };
  const before = structuredClone(raw);
  const normalized = validateDeckConfig(raw);
  expect(normalized).not.toHaveProperty("adaptiveMemory");
  expect(normalized.packageInstructions.codex).not.toHaveProperty("adaptive-memory");
  expect(raw).toEqual(before);
  expect(diagnoseDeckConfigDeprecations(raw).map(d => d.fieldPath)).toEqual(["adaptiveMemory", "packageInstructions.codex.adaptive-memory"]);
});
test("secret validation precedes retired field projection", () => {
  expect(() => validateDeckConfig({ adaptiveMemory: { token: "do-not-store" } })).toThrow(/secret/i);
});
