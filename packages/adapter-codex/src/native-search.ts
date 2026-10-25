import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { nativeSearchEvidence, hasRunnerContributionProof, type NativeSearchEvidence, type NativeSearchInspectionInput } from '@deck/core';
/** Codex config contract: cached/live expose search; disabled removes it. */
function inspectCodexFacts(input: NativeSearchInspectionInput, codexHome: string): NativeSearchEvidence {
  const facts: Record<string, unknown> = { runner: 'codex', version: input.runnerVersion, model: input.modelId, provider: input.providerId };
  try {
    const read = (path: string) => existsSync(path) ? Bun.TOML.parse(readFileSync(path, 'utf8')) as Record<string, any> : {};
    let config = read(join(codexHome, 'config.toml'));
    // Native Codex activates project layers only after persisted trust. The
    // managed preparation path may supply its explicit admission decision.
    let trusted = input.projectConfigTrusted;
    if (trusted === undefined) {
      let directory = resolve(input.projectRoot);
      try { directory = realpathSync(directory); } catch { /* native logical path */ }
      for (;;) {
        const level = config.projects?.[directory]?.trust_level;
        if (level === 'trusted' || level === 'untrusted') { trusted = level === 'trusted'; break; }
        const parent = dirname(directory); if (parent === directory) break; directory = parent;
      }
    }
    facts.projectAdmitted = trusted === true;
    if (trusted) {
      const layers: string[] = [];
      for (let directory = resolve(input.projectRoot);;) {
        layers.push(join(directory, '.codex/config.toml'));
        const parent = dirname(directory);
        if (parent === directory || existsSync(join(directory, '.git'))) break;
        directory = parent;
      }
      for (const path of layers.reverse()) config = { ...config, ...read(path) };
    }
    const flags = input.flags ?? [];
    for (let i = 0; i < flags.length; i++) {
      if (flags[i] === '--search') config.web_search = 'live';
      if (flags[i] === '-c' || flags[i] === '--config') {
        const override = Bun.TOML.parse(flags[++i] ?? '') as Record<string, unknown>; config = { ...config, ...override };
      }
    }
    const provider = input.providerId ?? (input.modelId?.split('/').slice(0, -1).join('/') || config.model_provider || 'openai');
    const mode = config.web_search ?? 'cached';
    Object.assign(facts, { model: input.modelId ?? config.model, provider, mode, tools: input.exposedTools });
    if (input.exposedTools) return nativeSearchEvidence(input.exposedTools.includes('web.run') || input.exposedTools.includes('web_search') ? 'available' : 'unavailable', 'tool-inventory', facts);
    if (mode === 'disabled') return nativeSearchEvidence('unavailable', 'effective-config', facts, 'native-search-disabled');
    if (!['live', 'cached'].includes(mode)) return nativeSearchEvidence('unknown', 'effective-config', facts, 'codex-web-search-mode-unrecognized');
    if (!['openai', 'openai-codex'].includes(provider)) return nativeSearchEvidence('unknown', 'provider-contract', facts, 'codex-provider-search-contract-unrecognized');
    return { ...nativeSearchEvidence('available', 'effective-config', facts), mode };
  } catch { return nativeSearchEvidence('unknown', 'effective-config', facts, 'codex-effective-search-config-unreadable'); }
}

export function inspectCodexNativeSearch(input: NativeSearchInspectionInput, codexHome: string): NativeSearchEvidence {
  const effectiveHome = input.environment?.CODEX_HOME;
  if (effectiveHome && isAbsolute(effectiveHome)) codexHome = effectiveHome;
  const evidence = inspectCodexFacts(input, codexHome);
  const target = { path: join(codexHome, 'config.toml'), selector: { kind: 'toml' as const, header: 'mcp_servers.web-search' } };
  if (hasRunnerContributionProof(join(codexHome, 'deck/manifest.json'), target)) evidence.ownedFallbackServerIds = ['web-search'];
  else if (existsSync(target.path) && /web-search/.test(readFileSync(target.path, 'utf8'))) evidence.unresolvedFallbackServerIds = ['web-search'];
  return evidence;
}
