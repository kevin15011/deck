import { configPaths } from "./native-search";
import type { RunnerPreparationFinding } from "@deck/core/session/driver";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { assertNoContributionSymlink, contributionHash, readRunnerContributions, buildDeveloperTeamManifest, DEVELOPER_TEAM, DEVELOPER_TEAM_AGENTS } from "@deck/core";
import { ROLE_TOOL_POLICY, isReadOnlyRole, readOnlyMcpTools } from "@deck/core/session/role-tool-policy";
import type { NativeRoleDescriptor } from "@deck/core/session/driver";
import { parseJsonc } from "./model-discovery-context";

let generation: string | undefined;
export function openCodeRoleGeneration(): string {
  return generation ??= createHash("sha256").update(JSON.stringify({ manifest: buildDeveloperTeamManifest({team:DEVELOPER_TEAM}).manifest, policy: ROLE_TOOL_POLICY })).digest("hex");
}
export function readOpenCodeNativeRole(root: string, roleId: string): NativeRoleDescriptor {
  try {
    root = resolve(root);
    if (!DEVELOPER_TEAM_AGENTS.some(role => role.id === roleId)) throw new Error("unknown-role");
    const manifestPath = join(root, "deck/manifest.json");
    const manifest = readRunnerContributions(manifestPath);
    if (manifest?.runnerId !== "opencode" || manifest.root !== root) throw new Error("missing-receipt");
    const files: Record<string,string> = {}, preparation: RunnerPreparationFinding[] = [];
    const capture = (path: string) => { assertNoContributionSymlink(path); const text = readFileSync(path,"utf8"); files[path] = contributionHash(text); return text; };
    capture(manifestPath);
    const config = parseJsonc(capture(join(root, "opencode.json"))) as any;
    const overlayPath = join(root, 'opencode.jsonc');
    assertNoContributionSymlink(overlayPath);
    const overlay = existsSync(overlayPath) ? parseJsonc(capture(overlayPath)) as any : undefined;
    const merge = (base: any, next: any): any => next && typeof next === 'object' && !Array.isArray(next)
      ? Object.fromEntries([...new Set([...Object.keys(base ?? {}), ...Object.keys(next)])].map(key => [key, Object.hasOwn(next, key) ? merge(base?.[key], next[key]) : base[key]])) : next;
    const entry = overlay?.agent?.[roleId] ? merge(config.agent?.[roleId], overlay.agent[roleId]) : config.agent?.[roleId];
    const promptPath = join(root,"prompts/deck-team",`${roleId}.md`);
    if (entry?.prompt !== `{file:${promptPath}}`) throw new Error("unexpected-prompt-source: restore the selected agent's Deck prompt path");
    validateReadOnlyRole(roleId, entry);
    const text = (path: string) => {
      const value = capture(path), receipt = manifest.contributions.find(e => e.path === path && e.selector.kind === 'file');
      if (!receipt || receipt.hash !== contributionHash(value)) preparation.push({ kind: 'W', code: 'opencode-custom-content-preserved', item: path, message: `Using preserved customized OpenCode text: ${path}.` });
      return value;
    };
    const instructions = text(promptPath);
    // Optional skill text can be missing without refusing ordinary work.
    try { text(join(root,"skills",roleId,"SKILL.md")); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      preparation.push({ kind: 'W', code: 'opencode-skill-unavailable', item: roleId, message: 'Optional role skill is unavailable; ordinary work can continue.' });
    }
    const plugin = join(root,"plugins/developer-team-execution.js");
    capture(plugin);
    authenticateOpenCodeExecutionPlugin(root);
    return {runnerId:"opencode",roleId,roleRef:roleId,generation:files[manifestPath]!,source:{root,files},instructions,hooks:[{event:"plugin",command:pathToFileURL(plugin).href}], ...(preparation.length ? { preparation } : {})};
  } catch (cause) { throw new Error(`opencode-session-security-boundary: ${cause instanceof Error ? cause.message : 'selected role could not be validated'}`,{cause}); }
}

/** Shared executable trust boundary; inventory may run before Deck is installed. */
export function authenticateOpenCodeExecutionPlugin(root: string, required = true): void {
  root = resolve(root);
  const plugin = join(root, "plugins/developer-team-execution.js");
  assertNoContributionSymlink(plugin);
  if (!required && !existsSync(plugin)) return;
  const manifest = readRunnerContributions(join(root, "deck/manifest.json"));
  const receipt = manifest?.contributions.find(e => e.path === plugin && e.selector.kind === 'file');
  if (manifest?.runnerId !== 'opencode' || manifest.root !== root || !receipt || !existsSync(plugin) || receipt.hash !== contributionHash(readFileSync(plugin, 'utf8'))) {
    throw new Error("execution-plugin-untrusted: preserve your edit elsewhere and remove the conflicting plugin to let Deck recreate it before launch");
  }
}

function normalizePermissions(permission: any): Record<string, any> {
  return typeof permission === 'string' ? { '*': permission } : permission ?? {};
}

function permissionActions(permission: unknown): unknown[] {
  if (!permission || typeof permission !== 'object' || Array.isArray(permission)) return [permission];
  const rules = Object.entries(permission);
  // A later catch-all supersedes every earlier input pattern.
  const catchAll = rules.findIndex(([pattern]) => pattern === '*');
  return rules.slice(Math.max(0, catchAll)).map(([, action]) => action);
}

function validateReadOnlyRole(roleId: string, entry: any): void {
    if (isReadOnlyRole(roleId)) {
      const allowed = [...ROLE_TOOL_POLICY.builtins, ...readOnlyMcpTools(Object.keys(ROLE_TOOL_POLICY.mcp), (server, tool) => [`${server}_${server === "web-search" ? `tavily_${tool}` : tool}`])];
      const allowedSet = new Set(allowed);
      // User restrictions may narrow access; only an actual grant outside the read set refuses.
      const unsafeTool = entry.tools?.['*'] !== false ? '*' : Object.entries(entry.tools).find(([name, enabled]) => enabled !== false && !(enabled === true && allowedSet.has(name)))?.[0];
      const permissions = normalizePermissions(entry.permission);
      const unsafePermission = !permissions['*'] || permissionActions(permissions['*']).some(action => action !== 'deny') ? '*'
        : Object.entries(permissions).find(([name, permission]) => permissionActions(permission).some(action => action !== 'deny' && !(allowedSet.has(name) && (action === 'allow' || action === 'ask'))))?.[0];
      if (unsafeTool || unsafePermission) throw new Error(`read-only policy changed: ${roleId} ${unsafePermission ? 'permission' : 'tool'} ${unsafePermission ?? unsafeTool} grants unsafe access; restore this role's read-only restrictions (deny/false)`);
    }
}

/** Validate the same file and process overlays admitted by the native launch. */
export function validateOpenCodeEffectiveRoles(root: string, cwd: string, env: Readonly<Record<string, string | undefined>>): void {
  const merge = (base: any, next: any): any => next && typeof next === 'object' && !Array.isArray(next)
    ? Object.fromEntries([...new Set([...Object.keys(base ?? {}), ...Object.keys(next)])].map(key => [key, Object.hasOwn(next, key) ? merge(base?.[key], next[key]) : base[key]])) : next;
  let config: any = {};
  for (const path of configPaths({ projectRoot: cwd, environment: env }, root)) {
    const absolute = resolve(cwd, path);
    if (existsSync(absolute)) config = merge(config, parseJsonc(readFileSync(absolute, 'utf8')));
  }
  if (env.OPENCODE_CONFIG_CONTENT) config = merge(config, parseJsonc(env.OPENCODE_CONFIG_CONTENT));
  for (const roleId of ROLE_TOOL_POLICY.readOnlyRoles) {
    const entry = config.agent?.[roleId];
    if (!entry) continue; // Fresh installations are validated after preparation.
    const permission = merge(normalizePermissions(config.permission), normalizePermissions(entry.permission));
    validateReadOnlyRole(roleId, { ...entry, permission: env.OPENCODE_PERMISSION ? merge(permission, normalizePermissions(parseJsonc(env.OPENCODE_PERMISSION))) : permission });
  }
}
