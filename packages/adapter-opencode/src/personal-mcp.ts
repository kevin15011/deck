import { PersonalMcpPreparationError } from "@deck/core/session/personal-mcp";
import { parseJsonc } from "./model-discovery-context";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { PersonalMcpAvailability } from "@deck/core/session/personal-mcp";

/** Native boolean parsing, pinned to OpenCode 1.18.31. */
export const openCodeProjectConfigDisabled = (env: Readonly<Record<string,string|undefined>>) => ["true","1"].includes(env.OPENCODE_DISABLE_PROJECT_CONFIG?.toLowerCase() ?? "");

/** Presence-only status for the existing settings surface; never executes config. */
export function pendingOpenCodeProjectSources(cwd: string, reason: "project-untrusted" | "disabled" = "project-untrusted"): PersonalMcpAvailability[] {
  return ["opencode.json", "opencode.jsonc", ".opencode"].filter(name => existsSync(join(cwd, name))).map((): PersonalMcpAvailability => ({ id: "project-configuration", source: "project", status: "unavailable", reason })).slice(0, 1);
}

/** Explicit project-bound sources also load before native project filtering.
 * Refuse that concrete bypass rather than silently dropping user customizations.
 */
export function assertOpenCodeProjectConfigAdmission(cwd: string, env: Readonly<Record<string,string|undefined>>, trusted: boolean): void {
  if (trusted) return;
  const canonical = (path: string) => { try { return realpathSync(path); } catch { return resolve(path); } };
  const roots = [resolve(cwd),canonical(cwd)];
  for (const path of [env.OPENCODE_CONFIG,env.OPENCODE_CONFIG_DIR]) {
    if (!path) continue;
    const within = (target: string) => roots.some(root => { const rel = relative(root,target); return rel === "" || rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel); });
    const logical = resolve(cwd,path);
    if (within(logical) || within(canonical(logical))) throw new PersonalMcpPreparationError("opencode-project-trust-required",[{id:"project-configuration",source:"project",status:"unavailable",reason:"project-untrusted"}]);
  }
}

/** Native effective config hides shadowed definitions. Inspect only the reserved control key. */
export function assertOpenCodeControlName(home: string, cwd: string, env: Readonly<Record<string, string | undefined>>, projectTrusted = false): void {
  const global = join(env.XDG_CONFIG_HOME ?? join(home, '.config'), 'opencode');
  const paths = [join(global, 'config.json'), join(global, 'opencode.json'), join(global, 'opencode.jsonc')];
  for (let directory = home, depth = 0; directory && depth < 64; depth++) {
    paths.push(join(directory, '.opencode', 'opencode.json'), join(directory, '.opencode', 'opencode.jsonc'));
    const parent = dirname(directory); if (parent === directory) break; directory = parent;
  }
  if (env.OPENCODE_CONFIG) paths.push(resolve(cwd, env.OPENCODE_CONFIG));
  if (env.OPENCODE_CONFIG_DIR) paths.push(join(env.OPENCODE_CONFIG_DIR, 'opencode.json'), join(env.OPENCODE_CONFIG_DIR, 'opencode.jsonc'));
  if (projectTrusted && !openCodeProjectConfigDisabled(env)) for (let directory = cwd, depth = 0; depth < 128; depth++) {
    paths.push(join(directory, 'opencode.json'), join(directory, 'opencode.jsonc'), join(directory, '.opencode', 'opencode.json'), join(directory, '.opencode', 'opencode.jsonc'));
    const parent = dirname(directory); if (parent === directory || existsSync(join(directory, '.git'))) break; directory = parent;
  }
  for (const path of new Set(paths)) {
    if (!existsSync(path)) continue;
    let config: {mcp?:Record<string,unknown>};
    try { config = parseJsonc(readFileSync(path, 'utf8')) as typeof config; }
    catch { throw new PersonalMcpPreparationError('opencode-native-configuration-invalid', [{id:'configuration',source:'native',status:'unavailable',reason:'unreadable'}]); }
    if (config?.mcp && Object.hasOwn(config.mcp, 'deck')) throw new PersonalMcpPreparationError('opencode-native-mcp-conflict', [{id:'deck',source:'native',status:'conflicting',reason:'managed-name-conflict'}]);
  }
}
