import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { validateDeckConfig } from "@deck/core";

/** Security fixtures opt in explicitly so they continue exercising the guards. */
export const explicitCodebaseConfig = () => validateDeckConfig({ capabilities: { "codebase-memory": { enabled: true } } });
export function writeExplicitCodebaseConfig(home: string): void {
  const directory = join(home, ".config/deck");
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "config.json"), JSON.stringify(explicitCodebaseConfig()), { mode: 0o600 });
}
