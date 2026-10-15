import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DeckConfigError,
  diagnoseDeckConfigDeprecations,
  getDefaultDeckConfig,
  validateDeckConfig,
  writeDeckConfigFileAtomic,
} from "./deck-config";

const roots: string[] = [];
afterEach(() => { for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true }); });

function code(fn: () => unknown): string | undefined {
  try { fn(); } catch (e) { return (e as DeckConfigError).code; }
  return undefined;
}

describe("task 0.8 downgrade behavior (pre-change validator contract)", () => {
  // A binary that predates `crossRunner` sees it as an unknown top-level key. This test pins the
  // mechanism: unknown top-level keys are REJECTED (not preserved, not dropped), so a downgraded
  // binary cannot read a config that contains `crossRunner`.
  test("unknown top-level key is rejected with DECK_CONFIG_UNKNOWN_FIELD", () => {
    expect(code(() => validateDeckConfig({ version: 1, someFutureSection: { a: 1 } }))).toBe("DECK_CONFIG_UNKNOWN_FIELD");
  });
});

describe("crossRunner config (XR-2.1, XR-2.2, D-5)", () => {
  test("absence means not configured", () => {
    expect(validateDeckConfig({ version: 1 }).crossRunner).toBeUndefined();
    expect(getDefaultDeckConfig().crossRunner).toBeUndefined();
  });

  test("applies design defaults", () => {
    const c = validateDeckConfig({ version: 1, crossRunner: { enabled: true, members: { lead: { runnerId: "claude", modelId: "opus", thinking: "high" } } } });
    expect(c.crossRunner).toEqual({
      enabled: true,
      members: { lead: { runnerId: "claude", modelId: "opus", thinking: "high" } },
      approvals: { claude: "runner-default", opencode: "runner-default", codex: "runner-default" },
      maxConcurrentTasks: 4,
      executionBudget: { lead: 2, delegated: 4 },
      web: { port: 7421, trustedProxy: null, allowedOrigins: [], allowFunnel: false },
      claudeTosAcknowledgedAt: null,
    });
  });

  test("preserves explicit relay opt-in for each runner", () => {
    const approvals = { claude: "relay", codex: "relay", opencode: "relay" } as const;
    const c = validateDeckConfig({ version: 1, crossRunner: { approvals } });
    expect(c.crossRunner?.approvals).toEqual(approvals);
    expect(validateDeckConfig(c).crossRunner?.approvals).toEqual(approvals);
  });
  test("normalizes independent native turn budgets with positive bounded capacity", () => {
    expect(validateDeckConfig({ version: 1, crossRunner: { executionBudget: { lead: 3 } } }).crossRunner?.executionBudget).toEqual({ lead: 3, delegated: 4 });
    for (const invalid of [0, -1, 1.5, 65, "2", null]) {
      expect(code(() => validateDeckConfig({ version: 1, crossRunner: { executionBudget: { delegated: invalid } } }))).toBe("CROSS_RUNNER_CONFIG_INVALID");
    }
    expect(code(() => validateDeckConfig({ version: 1, crossRunner: { executionBudget: { unknown: 2 } } }))).toBe("DECK_CONFIG_UNKNOWN_FIELD");
  });

  test("empty section normalizes to disabled with defaults", () => {
    const c = validateDeckConfig({ version: 1, crossRunner: {} });
    expect(c.crossRunner?.enabled).toBe(false);
    expect(c.crossRunner?.members).toEqual({});
  });

  test("legacy string member normalizes to qualified shape using defaultRunner or claude", () => {
    const a = validateDeckConfig({ version: 1, crossRunner: { enabled: true, members: { lead: "sonnet" } } });
    expect(a.crossRunner?.members.lead).toEqual({ runnerId: "claude", modelId: "sonnet" });
    const b = validateDeckConfig({ version: 1, crossRunner: { defaultRunner: "codex", members: { lead: "gpt-x" } } });
    expect(b.crossRunner?.members.lead).toEqual({ runnerId: "codex", modelId: "gpt-x" });
    expect(b.crossRunner?.defaultRunner).toBe("codex");
  });

  test("legacy shape emits CROSS_ASSIGNMENT_LEGACY_SHAPE warning", () => {
    const d = diagnoseDeckConfigDeprecations({ version: 1, crossRunner: { members: { lead: "sonnet", dev: { runnerId: "codex", modelId: "x" } } } });
    expect(d).toEqual([expect.objectContaining({ code: "CROSS_ASSIGNMENT_LEGACY_SHAPE", severity: "warning", fieldPath: "crossRunner.members.lead" })]);
  });

  test("write persists the qualified shape (round-trip)", () => {
    const root = mkdtempSync(join(tmpdir(), "deck-cross-cfg-"));
    roots.push(root);
    const path = join(root, "config.json");
    writeDeckConfigFileAtomic(path, { version: 1, crossRunner: { enabled: true, members: { lead: "sonnet" } } });
    const raw = JSON.parse(readFileSync(path, "utf-8"));
    expect(raw.crossRunner.members.lead).toEqual({ runnerId: "claude", modelId: "sonnet" });
    expect(diagnoseDeckConfigDeprecations(raw)).toEqual([]);
    expect(validateDeckConfig(raw)).toEqual(validateDeckConfig(validateDeckConfig(raw)));
  });

  test.each([
    ["unknown field", { bogus: 1 }],
    ["enabled not boolean", { enabled: "yes" }],
    ["members not object", { members: [] }],
    ["member missing modelId", { members: { lead: { runnerId: "claude" } } }],
    ["member empty string", { members: { lead: "" } }],
    ["member unknown field", { members: { lead: { runnerId: "c", modelId: "m", x: 1 } } }],
    ["bad approvals value", { approvals: { claude: "maybe" } }],
    ["maxConcurrentTasks zero", { maxConcurrentTasks: 0 }],
    ["maxConcurrentTasks fractional", { maxConcurrentTasks: 1.5 }],
    ["web port out of range", { web: { port: 70000 } }],
    ["web unknown field", { web: { host: "0.0.0.0" } }],
    ["allowedOrigins not string[]", { web: { allowedOrigins: [1] } }],
    ["allowFunnel not boolean", { web: { allowFunnel: "no" } }],
    ["ack timestamp invalid", { claudeTosAcknowledgedAt: "yesterday" }],
  ])("rejects %s", (_name, section) => {
    expect(code(() => validateDeckConfig({ version: 1, crossRunner: section }))).toBeDefined();
  });

  test("accepts ISO acknowledgement and explicit web exposure settings", () => {
    const c = validateDeckConfig({ version: 1, crossRunner: { claudeTosAcknowledgedAt: "2026-10-12T00:00:00.000Z", web: { port: 8000, trustedProxy: "127.0.0.1", allowedOrigins: ["https://a.example"], allowFunnel: false }, approvals: { codex: "relay" } } });
    expect(c.crossRunner?.claudeTosAcknowledgedAt).toBe("2026-10-12T00:00:00.000Z");
    expect(c.crossRunner?.web.trustedProxy).toBe("127.0.0.1");
    expect(c.crossRunner?.approvals.codex).toBe("relay");
    expect(c.crossRunner?.approvals.claude).toBe("runner-default");
  });
});
