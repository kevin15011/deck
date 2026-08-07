import type { AdapterRegistry } from "@deck/core";
import type { RunnerAdapter } from "@deck/core";

export type RunnerMenuOption = { id: string; label: string };
export type EnvironmentMenuOption = { value: string; label: string; available?: boolean };

export function buildRunnerMenuOptions(registry: AdapterRegistry): RunnerMenuOption[] {
  return [
    ...registry.list().map((adapter) => ({ id: adapter.runnerId, label: adapter.displayName })),
    { id: "back", label: "Back" },
  ];
}

export function resolveRunnerMenuSelection(
  registry: AdapterRegistry,
  options: readonly RunnerMenuOption[],
  cursor: number,
): RunnerAdapter | undefined {
  const selected = options[cursor];
  return !selected || selected.id === "back" ? undefined : registry.tryGet(selected.id);
}

export function buildEnvironmentMenuOptions(
  registry: AdapterRegistry,
  baseOptions: readonly EnvironmentMenuOption[],
): EnvironmentMenuOption[] {
  const registered = new Map<string, EnvironmentMenuOption>();
  for (const adapter of registry.list()) {
    for (const environmentId of adapter.environmentIds) {
      if (registered.has(environmentId)) continue;
      registered.set(environmentId, {
        value: environmentId,
        label: adapter.ui?.environmentLabels[environmentId] ?? `${adapter.displayName} (${environmentId})`,
        available: true,
      });
    }
  }
  const options = baseOptions.map((option) => registered.get(option.value) ?? option);
  const existing = new Set(options.map((option) => option.value));
  for (const adapter of registry.list()) {
    for (const environmentId of adapter.environmentIds) {
      if (!existing.has(environmentId)) {
        options.push(registered.get(environmentId)!);
        existing.add(environmentId);
      }
    }
  }
  return options;
}
