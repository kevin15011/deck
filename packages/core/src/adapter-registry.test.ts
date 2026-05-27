import { describe, expect, test } from "bun:test";
import {
  createAdapterRegistry,
  DuplicateRunnerError,
  RunnerNotRegisteredError,
} from "./adapter-registry";
import type { RunnerAdapter } from "./runner-adapter";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function createMockAdapter(
  runnerId: string,
  environmentIds: readonly string[],
): RunnerAdapter {
  return {
    runnerId,
    displayName: `Test Runner (${runnerId})`,
    environmentIds,
    async detectRuntimes() {
      return [];
    },
    async getCapabilityInventory() {
      return { capabilities: [], runnerId, environmentId: environmentIds[0] ?? "" };
    },
    buildReviewPlan() {
      return {
        groups: {
          automaticInstalls: [],
          manualSteps: [],
          configWrites: [],
          teamApplications: [],
          validations: [],
        },
        diagnostics: [],
        ready: true,
      };
    },
    buildInstallationPlan() {
      return { steps: [] };
    },
    async runAction() {
      return { actionId: "", status: "informational" as const, message: "", diagnostics: [] };
    },
    getTeams() {
      return [];
    },
    getModelCatalog() {
      return { providers: [], models: [], developerTeamDefaults: [] };
    },
    readModelAssignments() {
      return {};
    },
    readThinkingAssignments() {
      return {};
    },
    getThinkingLevels() {
      return [];
    },
    supportsThinking() {
      return false;
    },
    buildDeveloperTeamInstallPlan() {
      return { files: [] };
    },
    async applyDeveloperTeamInstall() {
      return { results: [], changedCount: 0, unchangedCount: 0 };
    },
    getNextScreen() {
      return "complete";
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createAdapterRegistry", () => {
  test("returns an AdapterRegistry instance", () => {
    const registry = createAdapterRegistry();
    expect(typeof registry.register).toBe("function");
    expect(typeof registry.get).toBe("function");
    expect(typeof registry.tryGet).toBe("function");
    expect(typeof registry.list).toBe("function");
    expect(typeof registry.resolveByEnvironment).toBe("function");
    expect(typeof registry.has).toBe("function");
  });
});

describe("register", () => {
  test("registers an adapter successfully", () => {
    const registry = createAdapterRegistry();
    const adapter = createMockAdapter("pi", ["pi-development"]);
    registry.register("pi", adapter);
    expect(registry.has("pi")).toBe(true);
  });

  test("throws DuplicateRunnerError on duplicate ID", () => {
    const registry = createAdapterRegistry();
    const adapter = createMockAdapter("pi", ["pi-development"]);
    registry.register("pi", adapter);
    expect(() => registry.register("pi", adapter)).toThrow(DuplicateRunnerError);
  });

  test("throws DuplicateRunnerError when adapter.runnerId !== id", () => {
    const registry = createAdapterRegistry();
    const adapter = createMockAdapter("pi", ["pi-development"]);
    expect(() => registry.register("opencode", adapter)).toThrow(DuplicateRunnerError);
  });

  test("throws DuplicateRunnerError when environmentIds is empty", () => {
    const registry = createAdapterRegistry();
    const adapter = createMockAdapter("pi", []);
    expect(() => registry.register("pi", adapter)).toThrow(DuplicateRunnerError);
  });

  test("registers multiple adapters with different IDs", () => {
    const registry = createAdapterRegistry();
    registry.register("pi", createMockAdapter("pi", ["pi-development"]));
    registry.register("opencode", createMockAdapter("opencode", ["opencode-development"]));
    expect(registry.list()).toHaveLength(2);
  });
});

describe("get", () => {
  test("returns the registered adapter", () => {
    const registry = createAdapterRegistry();
    const adapter = createMockAdapter("pi", ["pi-development"]);
    registry.register("pi", adapter);
    expect(registry.get("pi")).toBe(adapter);
  });

  test("throws RunnerNotRegisteredError for unknown runner", () => {
    const registry = createAdapterRegistry();
    registry.register("pi", createMockAdapter("pi", ["pi-development"]));
    try {
      registry.get("unknown");
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(RunnerNotRegisteredError);
      const error = err as RunnerNotRegisteredError;
      expect(error.runnerId).toBe("unknown");
      expect(error.message).toContain("unknown");
      expect(error.message).toContain("pi"); // lists available runners
    }
  });

  test("error message includes list of registered runners", () => {
    const registry = createAdapterRegistry();
    registry.register("pi", createMockAdapter("pi", ["pi-development"]));
    registry.register("opencode", createMockAdapter("opencode", ["opencode-development"]));
    try {
      registry.get("nonexistent");
      expect.unreachable("Should have thrown");
    } catch (err) {
      const error = err as RunnerNotRegisteredError;
      expect(error.message).toContain("pi");
      expect(error.message).toContain("opencode");
    }
  });
});

describe("tryGet", () => {
  test("returns the adapter when found", () => {
    const registry = createAdapterRegistry();
    const adapter = createMockAdapter("pi", ["pi-development"]);
    registry.register("pi", adapter);
    expect(registry.tryGet("pi")).toBe(adapter);
  });

  test("returns undefined for unknown runner (does not throw)", () => {
    const registry = createAdapterRegistry();
    expect(registry.tryGet("unknown")).toBeUndefined();
  });
});

describe("list", () => {
  test("returns empty array when no adapters registered", () => {
    const registry = createAdapterRegistry();
    expect(registry.list()).toEqual([]);
  });

  test("returns adapters in registration order", () => {
    const registry = createAdapterRegistry();
    const pi = createMockAdapter("pi", ["pi-development"]);
    const opencode = createMockAdapter("opencode", ["opencode-development"]);
    registry.register("pi", pi);
    registry.register("opencode", opencode);
    const list = registry.list();
    expect(list).toHaveLength(2);
    expect(list[0].runnerId).toBe("pi");
    expect(list[1].runnerId).toBe("opencode");
  });
});

describe("resolveByEnvironment", () => {
  test("resolves pi-development to pi adapter", () => {
    const registry = createAdapterRegistry();
    registry.register("pi", createMockAdapter("pi", ["pi-development", "pi-production"]));
    const adapter = registry.resolveByEnvironment("pi-development");
    expect(adapter?.runnerId).toBe("pi");
  });

  test("resolves opencode-development to opencode adapter", () => {
    const registry = createAdapterRegistry();
    registry.register("opencode", createMockAdapter("opencode", ["opencode-development"]));
    const adapter = registry.resolveByEnvironment("opencode-development");
    expect(adapter?.runnerId).toBe("opencode");
  });

  test("returns undefined for unknown environment", () => {
    const registry = createAdapterRegistry();
    registry.register("pi", createMockAdapter("pi", ["pi-development"]));
    expect(registry.resolveByEnvironment("unknown-env")).toBeUndefined();
  });
});

describe("has", () => {
  test("returns true for registered runner", () => {
    const registry = createAdapterRegistry();
    registry.register("pi", createMockAdapter("pi", ["pi-development"]));
    expect(registry.has("pi")).toBe(true);
  });

  test("returns false for unregistered runner", () => {
    const registry = createAdapterRegistry();
    expect(registry.has("unknown")).toBe(false);
  });
});
