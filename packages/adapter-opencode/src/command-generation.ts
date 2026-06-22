/**
 * Command file generation boundary for OpenCode Developer Team installs.
 *
 * Deck owns Developer Team agents, prompts, and skills. It does not own,
 * generate, install, or manage OpenCode `sdd-*` command files. Existing user
 * command files are left untouched by install/apply paths.
 */

export type PlannedCommandFile = {
  commandId: string;
  absolutePath: string;
  content: string;
};

export type GenerateCommandFilesOptions = {
  configDir?: string;
  writeFile?: (path: string, content: string, encoding: "utf-8") => void;
  mkdir?: (path: string, opts: { recursive: true }) => void;
};

export type RepairIncidentCommandContext = {
  path: string;
  incidentId?: string;
};

export function buildCommandGenerationPlan(_options: {
  configDir: string;
  repairIncident?: RepairIncidentCommandContext;
}): PlannedCommandFile[] {
  return [];
}

export function applyCommandGeneration(_plan: PlannedCommandFile[], _options?: GenerateCommandFilesOptions): void {
  // Intentionally no-op: Deck must not write OpenCode `sdd-*` command files.
}
