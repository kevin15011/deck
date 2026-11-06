import { afterEach, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ProjectPreparationService } from "./project-preparation";
import { fixture, cleanupPreparationFixtures, createPreparationService } from "./preparation-test-fixture";
afterEach(cleanupPreparationFixtures);

// protects: writer-supported large registries verify and reconcile without repeating effects.
// oracle: a valid ~400 KB postimage is within the canonical 512 KiB writer bound.
test('large registry repair verifies, replays, and reconciles uncertain restart', async () => {
  const f = fixture(), root = f.scope.projectRoot, target = join(root, '.atl/skill-registry.md');
  writeFileSync(join(root, '.gitignore'), '/.atl/skill-registry.md\n');
  // Multibyte metadata reaches the same byte boundary with fewer filesystem entries.
  for (let i = 0; i < 100; i++) {
    const dir = join(root, '.skills', `skill-${i}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'SKILL.md'), `---\nname: skill-${i}\ndescription: ${'🧪'.repeat(500)}\n---\n`);
  }
  let discoveries = 0;
  const service = createPreparationService(f.scope.projectRoot, { registryProvider: runnerId => ({ schema: 'skill-discovery-source-provider-v1', runnerId,
    resolveLocator: async () => ({ status: 'missing' }),
    listSources: async () => { discoveries++; return { outcome: 'complete', sources: [], diagnostics: [] }; },
  }) });
  const request = { snapshotId: service.status(f.scope).snapshotId, components: ['skill-registry'] };
  const invocation = { ...f.invocation, delegation: service.delegate(request, f.scope, { taskId: 'setup-task', attempt: 1 }) };
  expect((await service.repair(request, invocation)).status).toBe('changed');
  const bytes = readFileSync(target);
  expect(bytes.length).toBeGreaterThan(380_000);
  expect(bytes.length).toBeLessThan(512 * 1024);
  const { parseSkillRegistryDocument } = await import('../../../core/src/skill-discovery/registry');
  expect(parseSkillRegistryDocument(bytes.toString()).frontmatter?.completeness).toBe('complete');
  expect((await service.repair(request, invocation)).status).toBe('reconciled');
  const restarted = createPreparationService(f.scope.projectRoot);
  expect(restarted.reconcile(f.scope, f.records.filter(r => r.state === 'intent'))).toMatchObject([{ component: 'skill-registry', state: 'reconciled' }]);
  expect(discoveries).toBe(1);
  expect(readFileSync(target).equals(bytes)).toBe(true);
});

