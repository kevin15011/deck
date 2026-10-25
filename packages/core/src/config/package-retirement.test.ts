import { expect, test } from 'bun:test';
import { validateDeckConfig, diagnoseDeckConfigDeprecations, PACKAGE_INSTRUCTION_PACKAGE_IDS } from './deck-config';
import { getEnabledCapabilityInstructionIds, buildCapabilityInstructionBundle } from '../teams/developer/instruction-bundles';
test('global explicit opt-in inherits and boolean runner exceptions win', () => {
  const config = validateDeckConfig({ capabilities: { 'codebase-memory': { enabled: true, runners: { codex: false, pi: true } } } });
  expect(getEnabledCapabilityInstructionIds(config, 'claude')).toContain('codebase-memory');
  expect(getEnabledCapabilityInstructionIds(config, 'codex')).not.toContain('codebase-memory');
  expect(getEnabledCapabilityInstructionIds(config, 'pi')).toContain('codebase-memory');
});
test('absent and legacy true are off; canonical config drops retired keys and reports legacy intent', () => {
  expect(getEnabledCapabilityInstructionIds(validateDeckConfig({}), 'pi')).not.toContain('codebase-memory');
  const legacy = { packageInstructions: { pi: { 'context-mode': true, serena: true, 'codebase-memory': true } } };
  const normalized = validateDeckConfig(legacy);
  expect(getEnabledCapabilityInstructionIds(normalized, 'pi')).not.toContain('codebase-memory');
  expect(JSON.stringify(normalized)).not.toMatch(/context-mode|serena/);
  expect(diagnoseDeckConfigDeprecations(legacy)).toHaveLength(3);
  expect(PACKAGE_INSTRUCTION_PACKAGE_IDS).not.toContain('serena');
  expect(PACKAGE_INSTRUCTION_PACKAGE_IDS).not.toContain('context-mode');
  expect(JSON.stringify(buildCapabilityInstructionBundle(['serena', 'context-mode'] as never))).not.toMatch(/serena|context-mode/i);
});
test('new explicit intent survives normalization and false overrides global true', () => {
  const raw = { capabilities: { 'codebase-memory': { enabled: true, runners: { claude: false } } } };
  expect(validateDeckConfig(validateDeckConfig(raw)).capabilities).toEqual(raw.capabilities);
  expect(() => validateDeckConfig({ capabilities: { 'codebase-memory': { runners: { pi: 'yes' } } } })).toThrow();
});
