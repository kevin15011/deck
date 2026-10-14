import type { DriverEvent } from "../packages/core/src/session/driver";

/** Key/type-only contract evidence. No scalar values, prompts, config or credentials are retained. */
export type ContractShapes = Record<string, readonly string[]>;
export function collectContractShapes(events: readonly DriverEvent[]): ContractShapes {
  const paths = new Map<string, Set<string>>();
  const visit = (path: string, value: unknown, depth: number) => {
    const type = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
    const types = paths.get(path) ?? new Set<string>(); types.add(type); paths.set(path, types);
    if (depth >= 8 || value === null || typeof value !== "object") return;
    if (Array.isArray(value)) { for (const item of value.slice(0, 32)) visit(path + "[]", item, depth + 1); return; }
    for (const [key, child] of Object.entries(value).slice(0, 128)) {
      // Native object field identifiers only; user paths, dynamic ids and arbitrary keys are not evidence.
      const field = /^[A-Za-z_][A-Za-z_0-9]{0,63}$/.test(key) ? key : "<dynamic-key>";
      visit(path + "." + field, child, depth + 1);
    }
  };
  for (const event of events) {
    if (!/^[a-z][a-z.-]{0,63}$/.test(event.kind)) continue;
    visit(event.kind + ".data", event.data, 0);
    if (event.raw !== undefined) visit(event.kind + ".raw", event.raw, 0);
  }
  return Object.fromEntries([...paths].sort(([a], [b]) => a.localeCompare(b)).map(([path, types]) => [path, [...types].sort()]));
}

/** Optional fixture fields may be absent; newly observed fields/types require explicit review. */
export function compareContractShapes(baseline: ContractShapes, actual: ContractShapes): string[] {
  return Object.entries(actual).flatMap(([path, types]) => types.filter(type => !baseline[path]?.includes(type)).map(type => `${path}: unexpected ${type}`));
}
