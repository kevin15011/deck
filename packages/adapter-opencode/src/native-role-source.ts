import { configPaths } from "./native-search";
import type { RunnerPreparationFinding } from "@deck/core/session/driver";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, opendirSync, lstatSync, openSync, closeSync, readSync, fstatSync, constants } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { parseDocument } from "yaml";
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
    // Native {file:...} substitution trims the file; retain raw bytes in the source digest.
    const instructions = text(promptPath).trim();
    // Optional skill text can be missing without refusing ordinary work.
    try { text(join(root,"skills",roleId,"SKILL.md")); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      preparation.push({ kind: 'W', code: 'opencode-skill-unavailable', item: roleId, message: 'Optional role skill is unavailable; ordinary work can continue.' });
    }
    const plugin = join(root,"plugins/developer-team-execution.js");
    capture(plugin);
    authenticateOpenCodeExecutionPlugin(root);
    const variantsPlugin = join(root, "plugins/deck-model-variants.js");
    if (existsSync(variantsPlugin)) capture(variantsPlugin);
    return {runnerId:"opencode",roleId,roleRef:roleId,generation:files[manifestPath]!,source:{root,files},instructions,hooks:[plugin, ...(existsSync(variantsPlugin) ? [variantsPlugin] : [])].map(path => ({event:"plugin",command:pathToFileURL(path).href})), ...(preparation.length ? { preparation } : {})};
  } catch (cause) {
    const code = cause instanceof Error ? cause.message.split(':')[0] : '';
    const detail = code?.startsWith('read-only policy changed') ? 'read-only-policy-changed' : /^[a-z][a-z0-9-]{0,64}$/.test(code!) ? code : 'installed-security-boundary-unverified';
    throw Object.assign(new Error(`opencode-session-security-boundary: ${cause instanceof Error ? cause.message : 'selected role could not be validated'}`, {cause}), {detail});
  }
}

/** Shared executable trust boundary; inventory may run before Deck is installed. */
export function authenticateOpenCodeExecutionPlugin(root: string, required = true): void {
  root = resolve(root);
  const executionPlugin = join(root, "plugins/developer-team-execution.js");
  const variantsPlugin = join(root, "plugins/deck-model-variants.js");
  const configPath = join(root, "opencode.json");
  const variantsDeclared = existsSync(configPath) && (parseJsonc(readFileSync(configPath, 'utf8')) as any)?.plugin?.includes(pathToFileURL(variantsPlugin).href);
  const manifest = readRunnerContributions(join(root, "deck/manifest.json"));
  for (const [plugin, needed] of [[executionPlugin, required], [variantsPlugin, variantsDeclared]] as const) {
    assertNoContributionSymlink(plugin);
    if (!needed && !existsSync(plugin)) continue;
    const receipt = manifest?.contributions.find(e => e.path === plugin && e.selector.kind === 'file');
    if (manifest?.runnerId !== 'opencode' || manifest.root !== root || !receipt || !existsSync(plugin) || receipt.hash !== contributionHash(readFileSync(plugin, 'utf8'))) {
      throw new Error("execution-plugin-untrusted: preserve your edit elsewhere and remove the conflicting plugin to let Deck recreate it before launch");
    }
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
  const paths = configPaths({ projectRoot: cwd, environment: env }, root);
  for (const path of paths) {
    const absolute = resolve(cwd, path);
    if (existsSync(absolute)) config = merge(config, parseJsonc(readFileSync(absolute, 'utf8')));
  }
  if (env.OPENCODE_CONFIG_CONTENT) config = merge(config, parseJsonc(env.OPENCODE_CONFIG_CONTENT));
  // Native Markdown agents/modes can name a managed role even from a differently
  // named file. Inspect declarations without executing plugins or expanding prose.
  const explicitDirectory = env.OPENCODE_CONFIG_DIR === undefined ? undefined : resolve(cwd, env.OPENCODE_CONFIG_DIR);
  const globalDirectory = resolve(cwd, env.XDG_CONFIG_HOME ?? join(env.HOME ?? '', '.config'), 'opencode');
  const directories = new Set([resolve(root), ...paths.map(path => resolve(cwd, dirname(path))).filter(dir => basename(dir) === '.opencode' || dir === explicitDirectory || dir === globalDirectory)]);
  for (const path of nativeRoleMarkdownFiles(directories)) {
      const text = readRoleMetadataPrefix(path);
      const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
      if (/^---\r?\n/.test(text) && !frontmatter) throw new Error('opencode-native-role-inspection-limit');
      if (!frontmatter) continue;
      let data: any;
      try {
        const document = parseDocument(frontmatter[1]!, { uniqueKeys: true });
        if (document.errors.length) throw new Error();
        data = document.toJS({ maxAliasCount: 0 });
        if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error();
      } catch { throw new Error('opencode-native-role-metadata-unverified'); }
      const roleId = typeof data.name === 'string' ? data.name : basename(path, '.md');
      if (!isReadOnlyRole(roleId)) continue;
      // A shadowed grant is conservatively refused: resolving conflicting Markdown
      // declarations must not create a second native loader or adopt executable input.
      validateReadOnlyRole(roleId, merge(config.agent?.[roleId], data));
  }
  for (const roleId of ROLE_TOOL_POLICY.readOnlyRoles) {
    const entry = config.mode?.[roleId] ? merge(config.agent?.[roleId], config.mode[roleId]) : config.agent?.[roleId];
    if (!entry) continue; // Fresh installations are validated after preparation.
    const permission = merge(normalizePermissions(config.permission), normalizePermissions(entry.permission));
    validateReadOnlyRole(roleId, { ...entry, permission: env.OPENCODE_PERMISSION ? merge(permission, normalizePermissions(parseJsonc(env.OPENCODE_PERMISSION))) : permission });
  }
}

// These are inspection bounds, not a parallel native loader. Refuse sources whose
// metadata cannot be checked; never silently omit a native-followed symlink.
function* nativeRoleMarkdownFiles(directories: Iterable<string>): Generator<string> {
  let entries = 0;
  function* walk(directory: string, depth: number): Generator<string> {
    if (depth > 32) throw new Error('opencode-native-role-inspection-limit');
    if (!existsSync(directory)) return;
    assertNoContributionSymlink(directory);
    const dir = opendirSync(directory);
    try {
      for (let entry = dir.readSync(); entry; entry = dir.readSync()) {
        if (++entries > 4096) throw new Error('opencode-native-role-inspection-limit');
        const path = join(directory, entry.name);
        const stat = lstatSync(path);
        if (stat.isSymbolicLink()) throw new Error('opencode-native-role-source-unsafe');
        if (stat.isDirectory()) yield* walk(path, depth + 1);
        else if (entry.name.endsWith('.md')) {
          if (!stat.isFile()) throw new Error('opencode-native-role-source-unsafe');
          yield path;
        }
      }
    } finally { dir.closeSync(); }
  }
  for (const directory of directories) for (const name of ['agent', 'agents', 'mode', 'modes']) {
    const path = join(directory, name);
    // existsSync follows symlinks, so also check dangling links before deciding absent.
    try {
      if (lstatSync(path).isSymbolicLink()) throw new Error('opencode-native-role-source-unsafe');
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
    yield* walk(path, 0);
  }
}

function readRoleMetadataPrefix(path: string): string {
  assertNoContributionSymlink(path);
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    if (!fstatSync(fd).isFile()) throw new Error('opencode-native-role-source-unsafe');
    const buffer = Buffer.alloc(65_536);
    let length = 0;
    while (length < buffer.length) {
      const count = readSync(fd, buffer, length, buffer.length - length, null);
      if (!count) break;
      length += count;
    }
    return buffer.subarray(0, length).toString('utf8');
  } finally { closeSync(fd); }
}
