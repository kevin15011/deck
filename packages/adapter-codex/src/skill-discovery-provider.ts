import { join } from "node:path";
import { createDeclaredSkillProvider, sharedSkillRoots, type DeclaredSkillProviderOptions, type DeclaredSkillRoot } from "@deck/core";

export interface CodexSkillDiscoveryOptions {
  readonly homeDir: string;
  readonly codexHome: string;
  readonly systemRoots?: readonly string[];
  readonly exposedRoots?: DeclaredSkillProviderOptions["roots"];
  readonly inventory?: DeclaredSkillProviderOptions["inventory"];
}
export function createCodexSkillDiscoveryProvider(options: CodexSkillDiscoveryOptions) {
  return createDeclaredSkillProvider("codex", {
    inventory: options.inventory,
    roots: async projectRoot => [
      ...sharedSkillRoots(options.homeDir, options.systemRoots),
      { id: "codex-home-skills", root: join(options.codexHome, "skills"), category: "user_runner", scope: "user" } satisfies DeclaredSkillRoot,
      // .system is inside the admitted home root. No invented project .codex/skills.
      ...await options.exposedRoots?.(projectRoot) ?? [],
    ],
  });
}
