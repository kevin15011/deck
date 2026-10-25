import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { nativeSearchEvidence, type NativeSearchEvidence, type NativeSearchInspectionInput } from '@deck/core';
/** Pi has no built-in web search; extensions require an actual supported tool inventory. */
export function inspectPiNativeSearch(input: NativeSearchInspectionInput, agentDir: string): NativeSearchEvidence {
  const facts: Record<string, unknown> = { runner: 'pi', model: input.modelId, version: input.runnerVersion };
  try {
    if (input.exposedTools) return nativeSearchEvidence(input.exposedTools.includes('web_search') || input.exposedTools.includes('websearch') ? 'available' : 'unavailable', 'tool-inventory', { ...facts, tools: input.exposedTools });
    const settingsPath = join(agentDir, 'settings.json');
    const settings = existsSync(settingsPath) ? JSON.parse(readFileSync(settingsPath, 'utf8')) : {};
    const extensions = existsSync(join(agentDir, 'extensions')) ? readdirSync(join(agentDir, 'extensions')) : [];
    const custom = (settings.extensions?.length ?? 0) > 0 || extensions.some(name => !name.startsWith('deck-')) || (settings.packages ?? []).some((entry: unknown) => entry !== 'deck/package');
    return nativeSearchEvidence(custom ? 'unknown' : 'unavailable', 'effective-config', { ...facts, extensions: extensions.sort(), custom }, custom ? 'pi-extension-tool-inventory-required' : 'pi-no-native-search-extension');
  } catch { return nativeSearchEvidence('unknown', 'effective-config', facts, 'pi-effective-search-config-unreadable'); }
}
