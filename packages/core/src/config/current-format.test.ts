import { expect, test } from "bun:test";
import { validateDeckConfig } from "./deck-config";

test("removed prompt profile is invalid", () => {
  expect(() => validateDeckConfig({ developerTeamExecution: { promptProfile: "legacy" } })).toThrow();
});
test("member assignments require the current object shape", () => {
  expect(() => validateDeckConfig({ crossRunner: { members: { "deck-lead": "model" } } })).toThrow();
});
test("retired package keys stay ignored without activating capabilities", () => {
  const config = validateDeckConfig({ packageInstructions: { codex: { "context-mode": true, serena: true, "codebase-memory": true } } });
  expect(config.packageInstructions.codex).not.toHaveProperty("context-mode");
  expect(config.packageInstructions.codex).not.toHaveProperty("serena");
  expect(config.capabilities!["codebase-memory"].enabled).toBe(false);
});
