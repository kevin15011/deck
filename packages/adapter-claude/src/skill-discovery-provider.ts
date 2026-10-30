import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { createDeclaredSkillProvider, sharedSkillRoots, type DeclaredSkillProviderOptions, type DeclaredSkillRoot, type SkillDiscoverySourceProviderV1 } from "@deck/core";

export interface ClaudeSkillDiscoveryOptions {
  readonly homeDir: string;
  readonly configDir: string;
  readonly projectAdmitted: (projectRoot: string) => boolean;
  readonly selectedPlugin: () => string | undefined;
  readonly systemRoots?: readonly string[];
  readonly exposedRoots?: DeclaredSkillProviderOptions["roots"];
  readonly inventory?: DeclaredSkillProviderOptions["inventory"];
}

async function readObject(file: string): Promise<Record<string, unknown>> {
  try {
    const handle = await fs.open(file, "r");
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > 512 * 1024) throw new Error("plugin-metadata-budget");
      const buffer = Buffer.alloc(512 * 1024 + 1);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      if (bytesRead > 512 * 1024) throw new Error("plugin-metadata-budget");
      const value = JSON.parse(buffer.subarray(0, bytesRead).toString("utf8"));
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("plugin-metadata-invalid");
      return value;
    } finally { await handle.close(); }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

export function createClaudeSkillDiscoveryProvider(options: ClaudeSkillDiscoveryOptions): SkillDiscoverySourceProviderV1 {
  // Build each operation from current declarations, so disabling a plugin revokes resolution.
  async function current(projectRoot: string) {
    let partial = false;
    const roots: DeclaredSkillRoot[] = [
      ...sharedSkillRoots(options.homeDir, options.systemRoots),
      { id: "claude-user-skills", root: join(options.configDir, "skills"), category: "user_runner", scope: "user" },
    ];
    let admitted = false;
    try { admitted = options.projectAdmitted(projectRoot); } catch { partial = true; }
    if (admitted) roots.push({ id: "claude-project-skills", root: join(projectRoot, ".claude", "skills"), category: "project_runner", scope: "project" });
    try {
      const plugin = options.selectedPlugin();
      if (plugin) roots.push({ id: "claude-selected-skills", root: join(plugin, "skills"), category: "deck_materialized", scope: "runner" });
    } catch { partial = true; }
    try {
      const settingsFiles = [join(options.configDir, "settings.json"), ...(admitted ? [join(projectRoot, ".claude/settings.json"), join(projectRoot, ".claude/settings.local.json")] : [])];
      const enabled = new Map<string, boolean>();
      for (const file of settingsFiles) {
        const settings = await readObject(file);
        if (settings.enabledPlugins === undefined) continue;
        if (!settings.enabledPlugins || typeof settings.enabledPlugins !== "object" || Array.isArray(settings.enabledPlugins)) throw new Error("plugin-settings-invalid");
        for (const [id, value] of Object.entries(settings.enabledPlugins)) {
          if (typeof value !== "boolean") throw new Error("plugin-settings-invalid");
          enabled.set(id, value);
        }
      }
      if (enabled.size > 500) throw new Error("plugin-settings-budget");
      if ([...enabled.values()].some(Boolean)) {
        const installed = await readObject(join(options.configDir, "plugins/installed_plugins.json"));
        if (installed.version !== 2 || !installed.plugins || typeof installed.plugins !== "object" || Array.isArray(installed.plugins)) throw new Error("plugin-inventory-unavailable");
        for (const [id, active] of enabled) {
          if (!active) continue;
          const entries = (installed.plugins as Record<string, unknown>)[id];
          if (!Array.isArray(entries) || entries.length > 500) { partial = true; continue; }
          let found = false;
          for (const entry of entries) {
            if (!entry || typeof entry !== "object") { partial = true; continue; }
            if (entry.scope !== "user" && !(["project", "local"].includes(entry.scope) && admitted && typeof entry.projectPath === "string" && resolve(entry.projectPath) === resolve(projectRoot))) continue;
            if (typeof entry.installPath !== "string" || !isAbsolute(entry.installPath)) { partial = true; continue; }
            found = true;
            const root = join(entry.installPath, "skills");
            const sourceId = `claude-plugin-${createHash("sha256").update(id + "\0" + root).digest("hex").slice(0, 32)}`;
            if (!roots.some(source => source.id === sourceId)) roots.push({ id: sourceId, root, category: "runner_exposed", scope: "runner" });
            if (roots.length > 500) throw new Error("plugin-roots-budget");
          }
          if (!found) partial = true;
        }
      }
    } catch { partial = true; }
    try { roots.push(...await options.exposedRoots?.(projectRoot) ?? []); } catch { partial = true; }
    return { partial, provider: createDeclaredSkillProvider("claude", { inventory: options.inventory, roots: () => roots }) };
  }
  return {
    schema: "skill-discovery-source-provider-v1", runnerId: "claude",
    async listSources(input) {
      const { provider, partial } = await current(input.projectRoot);
      const result = await provider.listSources(input);
      return partial ? { ...result, outcome: "indeterminate", reasonCode: "partial_source_evaluation", diagnostics: [...result.diagnostics, { code: "claude_sources_partial", message: "Some Claude source declarations could not be evaluated." }].slice(0, 50) } : result;
    },
    async resolveLocator(input) { return (await current(input.projectRoot)).provider.resolveLocator(input); },
  };
}
