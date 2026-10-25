import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { nativeSearchEvidence, hasRunnerContributionProof, type NativeSearchEvidence, type NativeSearchInspectionInput } from '@deck/core';
import { openCodeProjectConfigDisabled } from './personal-mcp';
import { enumerateOpenCodeConfigCandidates, parseJsonc } from './model-discovery-context';
const object = (v: unknown): Record<string, any> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, any> : {};
const permissions = (previous: unknown, next: unknown): unknown => next === undefined ? previous : typeof next === 'string' ? next : { ...(typeof previous === 'string' ? { '*': previous } : object(previous)), ...object(next) };
const truthy = (v: string | undefined) => !!v && !['false', '0', ''].includes(v.toLowerCase());
/** Interactive OpenCode admits native project sources unless explicitly disabled.
 * Managed callers pass their separate prior-consent decision explicitly. Reading
 * these settings grants no execution or project trust. */
function configPaths(input: NativeSearchInspectionInput, root: string): string[] {
  const env = input.environment ?? process.env;
  let workspaceRoot = input.projectRoot;
  while (!existsSync(join(workspaceRoot, '.git')) && dirname(workspaceRoot) !== workspaceRoot) workspaceRoot = dirname(workspaceRoot);
  const admitted = input.projectConfigTrusted !== false && !openCodeProjectConfigDisabled(env);
  const effectiveEnv = admitted ? env : { ...env, OPENCODE_DISABLE_PROJECT_CONFIG: 'true' };
  const candidates = enumerateOpenCodeConfigCandidates({ projectRoot: input.projectRoot, workspaceRoot, homeDir: env.HOME ?? '', env: effectiveEnv });
  if (env.OPENCODE_PURE) return [];
  return [...new Set([join(root, 'opencode.json'), join(root, 'opencode.jsonc'), ...candidates.filter(candidate => candidate.source !== 'global').map(candidate => candidate.path)])];
}
function inspectOpenCodeFacts(input: NativeSearchInspectionInput, configRoot: string): NativeSearchEvidence {
  const env = input.environment ?? process.env;
  const facts: Record<string, unknown> = { runner: 'opencode', version: input.runnerVersion, model: input.modelId, projectAdmitted: input.projectConfigTrusted !== false && !openCodeProjectConfigDisabled(env) };
  try {
    let config: Record<string, any> = {};
    const merge = (path: string) => { if (existsSync(path)) { const next = object(parseJsonc(readFileSync(path, 'utf8'))); config = { ...config, ...next, tools: { ...config.tools, ...next.tools }, permission: permissions(config.permission, next.permission) }; } };
    for (const path of configPaths(input, configRoot)) merge(path);
    if (!env.OPENCODE_PURE && env.OPENCODE_CONFIG_CONTENT) { const overlay = object(parseJsonc(env.OPENCODE_CONFIG_CONTENT)); config = { ...config, ...overlay, tools: { ...config.tools, ...overlay.tools }, permission: permissions(config.permission, overlay.permission) }; }
    if (env.OPENCODE_PERMISSION) config.permission = permissions(config.permission, parseJsonc(env.OPENCODE_PERMISSION));
    let model = input.modelId; let agentId = config.default_agent ?? "build";
    const flags = input.flags ?? [];
    for (let i = 0; i < flags.length; i++) {
      if (flags[i] === '--model' || flags[i] === '-m') model = flags[++i];
      else if (flags[i] === '--agent') agentId = flags[++i];
    }
    const agent = object(config.agent?.[agentId]);
    config.tools = { ...config.tools, ...agent.tools };
    config.permission = permissions(config.permission, agent.permission);
    const provider = input.providerId ?? (model ?? agent.model ?? config.model ?? '').split('/')[0];
    const enabledByProvider = ['opencode', 'opencode-go'].includes(provider);
    const exa = truthy(env.OPENCODE_ENABLE_EXA), parallel = truthy(env.OPENCODE_ENABLE_PARALLEL);
    const permission = object(config.permission).websearch ?? object(config.permission)['*'];
    const denied = config.permission === 'deny' || permission === 'deny' || (permission && typeof permission === 'object' && permission['*'] === 'deny');
    Object.assign(facts, { model: model ?? agent.model ?? config.model, agent: agentId, provider, exa, parallel, tool: config.tools?.websearch, permission: typeof permission === 'string' ? permission : !!permission, tools: input.exposedTools });
    if (denied) return { ...nativeSearchEvidence('unavailable', 'effective-config', facts, 'opencode-web-authority-denied'), webAllowed: false };
    if (config.tools?.websearch === false) return nativeSearchEvidence('unavailable', 'effective-config', facts, 'opencode-native-search-disabled');
    if (input.exposedTools) return nativeSearchEvidence(input.exposedTools.includes('websearch') ? 'available' : 'unavailable', 'tool-inventory', facts);
    return nativeSearchEvidence(enabledByProvider || exa || parallel ? 'available' : 'unavailable', 'provider-contract', facts);
  } catch { return nativeSearchEvidence('unknown', 'effective-config', facts, 'opencode-effective-search-config-unreadable'); }
}

export function inspectOpenCodeNativeSearch(input: NativeSearchInspectionInput, configRoot: string): NativeSearchEvidence {
  const evidence = inspectOpenCodeFacts(input, configRoot);
  const env = input.environment ?? process.env;
  let selected: { path?: string; entry: unknown } | undefined;
  try {
    const inspect = (path: string) => {
      if (!existsSync(path)) return;
      const config = object(parseJsonc(readFileSync(path, 'utf8')));
      if (Object.hasOwn(object(config.mcp), 'web-search')) selected = { path, entry: config.mcp['web-search'] };
    };
    for (const path of configPaths(input, configRoot)) inspect(path);
    if (!env.OPENCODE_PURE && env.OPENCODE_CONFIG_CONTENT) {
      const config = object(parseJsonc(env.OPENCODE_CONFIG_CONTENT));
      if (Object.hasOwn(object(config.mcp), 'web-search')) selected = { entry: config.mcp['web-search'] };
    }
    if (selected) {
      const target = selected.path ? { path: selected.path, selector: { kind: 'json' as const, keys: ['mcp', 'web-search'] } } : undefined;
      if (target && hasRunnerContributionProof(join(configRoot, 'deck/manifest.json'), target)) evidence.ownedFallbackServerIds = ['web-search'];
      else evidence.unresolvedFallbackServerIds = ['web-search'];
    }
  } catch { evidence.unresolvedFallbackServerIds = ['web-search']; }
  return evidence;
}
