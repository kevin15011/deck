import { describe, expect, test } from "bun:test";
import { createAdapterRegistry, type RunnerAdapter } from "@deck/core";
import { buildEnvironmentMenuOptions, buildRunnerMenuOptions, resolveRunnerMenuSelection } from "./runner-options";

function adapter(runnerId: string, environmentId: string, displayName: string): RunnerAdapter {
  return {
    runnerId,
    displayName,
    environmentIds: [environmentId],
    ui: {
      environmentLabels: { [environmentId]: `${displayName} Development` },
      model: {
        providerSource: `${displayName} owns model discovery.`,
        missingChecks: [`${displayName} model inventory`],
        remediation: `Repair ${displayName} model discovery.`,
        defaultThinkingLevels: [],
      },
    },
  } as unknown as RunnerAdapter;
}

describe("registry-derived runner options", () => {
  test("surfaces and routes a synthetic registered runner without menu changes", () => {
    const registry = createAdapterRegistry();
    registry.register("atlas", adapter("atlas", "atlas-development", "Atlas"));

    const options = buildRunnerMenuOptions(registry);
    expect(options).toEqual([
      { id: "atlas", label: "Atlas" },
      { id: "back", label: "Back" },
    ]);
    expect(resolveRunnerMenuSelection(registry, options, 0)?.runnerId).toBe("atlas");
    expect(resolveRunnerMenuSelection(registry, options, 1)).toBeUndefined();
    expect(buildEnvironmentMenuOptions(registry, [])).toEqual([
      { value: "atlas-development", label: "Atlas Development", available: true },
    ]);
    expect(registry.resolveByEnvironment("atlas-development")?.runnerId).toBe("atlas");
  });

  test("preserves unsupported base environments and registry order", () => {
    const registry = createAdapterRegistry();
    registry.register("first", adapter("first", "first-development", "First"));
    registry.register("second", adapter("second", "second-development", "Second"));

    expect(buildEnvironmentMenuOptions(registry, [
      { value: "unsupported-development", label: "Unsupported", available: false },
    ])).toEqual([
      { value: "unsupported-development", label: "Unsupported", available: false },
      { value: "first-development", label: "First Development", available: true },
      { value: "second-development", label: "Second Development", available: true },
    ]);
  });

  test("matches first-registration routing when adapters claim the same environment", () => {
    const registry = createAdapterRegistry();
    registry.register("first", adapter("first", "shared-development", "First"));
    registry.register("second", adapter("second", "shared-development", "Second"));

    expect(buildEnvironmentMenuOptions(registry, [])).toEqual([
      { value: "shared-development", label: "First Development", available: true },
    ]);
    expect(registry.resolveByEnvironment("shared-development")?.runnerId).toBe("first");
  });
});
