import { claudeProjectConfigTrusted } from './personal-mcp';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { nativeSearchEvidence, type NativeSearchEvidence, type NativeSearchInspectionInput } from '@deck/core';
const enabled = (v: string | undefined) => v === '1' || v?.toLowerCase() === 'true';
export function inspectClaudeNativeSearch(input: NativeSearchInspectionInput, home: string): NativeSearchEvidence {
  const env = input.environment ?? process.env;
  const facts: Record<string, unknown> = { runner: 'claude', version: input.runnerVersion, model: input.modelId };
  try {
    const deny: string[] = []; let model: string | undefined;
    const read = (path: string) => { if (existsSync(path)) { const value = JSON.parse(readFileSync(path, 'utf8')); deny.push(...(value.permissions?.deny ?? [])); model = value.model ?? model; } };
    const projectAdmitted = input.projectConfigTrusted ?? claudeProjectConfigTrusted(home, input.projectRoot, env);
    facts.projectAdmitted = projectAdmitted;
    read(join(env.CLAUDE_CONFIG_DIR ?? join(home, '.claude'), 'settings.json'));
    if (projectAdmitted) { read(join(input.projectRoot, '.claude/settings.json')); read(join(input.projectRoot, '.claude/settings.local.json')); }
    read('/etc/claude-code/managed-settings.json');
    const flags = input.flags ?? []; let selectedTools: string[] | undefined;
    for (let i = 0; i < flags.length; i++) {
      if (flags[i] === '--disallowedTools') deny.push(...(flags[++i] ?? '').split(/[ ,]+/));
      else if (flags[i] === '--tools') selectedTools = (flags[++i] ?? '').split(/[ ,]+/);
      else if (flags[i] === '--model') model = flags[++i];
      else if (flags[i] === '--settings') { const setting = flags[++i] ?? ''; if (setting.startsWith('{')) { const value = JSON.parse(setting); deny.push(...(value.permissions?.deny ?? [])); } else read(setting); }
    }
    const provider = input.providerId ?? (enabled(env.CLAUDE_CODE_USE_BEDROCK) ? 'bedrock' : enabled(env.CLAUDE_CODE_USE_VERTEX) ? 'vertex' : enabled(env.CLAUDE_CODE_USE_FOUNDRY) ? 'foundry' : env.ANTHROPIC_BASE_URL && !env.ANTHROPIC_BASE_URL.startsWith('https://api.anthropic.com') ? 'gateway' : 'anthropic');
    const requestedModel = input.modelId?.replace(/^claude\//, '');
    model = (requestedModel === 'inherit' ? undefined : requestedModel) ?? model ?? env.ANTHROPIC_MODEL ?? 'sonnet';
    Object.assign(facts, { provider, model, deniesWebSearch: deny.some(rule => rule === '*' || /^WebSearch(?:\(|$)/.test(rule)), selectedTools, tools: input.exposedTools });
    if (facts.deniesWebSearch) return { ...nativeSearchEvidence('unavailable', 'effective-config', facts, 'claude-web-authority-denied'), webAllowed: false };
    if (selectedTools && !selectedTools.includes('default') && !selectedTools.includes('WebSearch')) return nativeSearchEvidence('unavailable', 'effective-config', facts, 'claude-native-search-not-exposed');
    if (input.exposedTools) return nativeSearchEvidence(input.exposedTools.includes('WebSearch') ? 'available' : 'unavailable', 'tool-inventory', facts);
    if (provider === 'bedrock') return nativeSearchEvidence('unavailable', 'provider-contract', facts, 'claude-bedrock-native-search-unavailable');
    if (provider === 'vertex' && /claude-3|haiku-3/.test(model)) return nativeSearchEvidence('unavailable', 'provider-contract', facts, 'claude-vertex-model-native-search-unavailable');
    if (!['anthropic', 'vertex', 'foundry', 'anthropicAws', 'anthropicGoogleCloud'].includes(provider) || !/^(?:claude-|sonnet|opus|haiku)/.test(model)) return nativeSearchEvidence('unknown', 'provider-contract', facts, 'claude-model-provider-search-contract-unrecognized');
    return nativeSearchEvidence('available', 'provider-contract', facts);
  } catch { return nativeSearchEvidence('unknown', 'effective-config', facts, 'claude-effective-search-config-unreadable'); }
}
