// Protects repair authority against intent changes while allowing runtime evidence collection.
import { afterEach, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PreparationScope } from "@deck/core/session/preparation";
import { ProjectPreparationService } from "./project-preparation";
import { fixture, cleanupPreparationFixtures } from "./preparation-test-fixture";
afterEach(cleanupPreparationFixtures);

test.each(['observations', 'enabled', 'route', 'inputDigest', 'roster', 'epoch', 'policyDigest'] as const)('registry delegation after Setup runtime evidence: %s', async change => {
  const f = fixture(), target = join(f.scope.projectRoot, '.atl/skill-registry.md');
  writeFileSync(join(f.scope.projectRoot, '.gitignore'), '/.atl/skill-registry.md\n');
  const scope: PreparationScope = { ...f.scope, members: f.scope.members.map(member => ({ ...member,
    capabilities: { 'codebase-memory': { enabled: true, route: 'managed', inputDigest: 'generation-1', availability: 'unverified', prerequisites: 'missing' } },
  })) };
  const service = new ProjectPreparationService({ registryProvider: runnerId => ({ schema: 'skill-discovery-source-provider-v1', runnerId,
    resolveLocator: async () => ({ status: 'missing' }), listSources: async () => ({ outcome: 'complete', sources: [], diagnostics: [] }),
  }) });
  const request = { snapshotId: service.status(scope).snapshotId, components: ['skill-registry'] };
  const delegation = service.delegate(request, scope, { taskId: 'setup-task', attempt: 1 });
  let current: PreparationScope = { ...scope, members: scope.members.map(member => {
    if (member.memberId !== 'setup') return member;
    const capabilities = { 'codebase-memory': { ...member.capabilities['codebase-memory']!, availability: 'ready' as const, prerequisites: 'present' as const } };
    return { ...member, capabilities, runtimeEvidence: { taskId: 'setup-task', attempt: 1, bindingId: member.bindingId, generation: 'g', epoch: scope.epoch, capabilities } };
  }) };
  if (change === 'epoch' || change === 'policyDigest') current = { ...current, [change]: 'changed' };
  else if (change === 'roster') current = { ...current, members: current.members.slice(1) };
  else if (change !== 'observations') current = { ...current, members: current.members.map(member => ({ ...member,
    capabilities: { 'codebase-memory': { ...member.capabilities['codebase-memory']!, ...(change === 'enabled' ? { enabled: false } : change === 'route' ? { route: 'fallback' as const } : { inputDigest: 'generation-2' }) } },
  })) };
  const repair = service.repair(request, { ...f.invocation, delegation, current: () => current });
  if (change === 'observations') {
    expect((await repair).status).toBe('changed');
    await service.prepareRegistryEvidence(current, 'claude');
    expect(service.status(current).observations.find(o => o.component === 'skill-registry')?.status).toBe('ready');
    expect(readFileSync(target, 'utf8').length).toBeGreaterThan(0);
    expect(service.delegate(request, current, { taskId: 'setup-task', attempt: 2 }).snapshotId).toBe(request.snapshotId);
  } else {
    await expect(repair).rejects.toThrow('preparation-authority-revoked');
    expect(() => readFileSync(target)).toThrow();
    expect(f.records).toEqual([]);
    expect(() => service.delegate(request, current, { taskId: 'setup-task', attempt: 2 })).toThrow('preparation-snapshot-stale');
  }
});

// Protects actionable host diagnostics without leaking internal reasons into tool errors.
test.each(['invocation-revoked', 'request-snapshot-mismatch', 'snapshot-unavailable', 'delegation-expired', 'role-mismatch', 'generation-missing', 'launch-missing', 'native-session-missing', 'session-mismatch', 'epoch-mismatch', 'project-mismatch', 'component-outside-delegation', 'authority-scope-changed'] as const)('repair rejection reports host-only reason: %s', async reason => {
  const f = fixture(), original = readFileSync(f.file, 'utf8'), reasons: string[] = [];
  let request = f.request, service = f.service;
  const invocation = { ...f.invocation, delegation: { ...f.invocation.delegation }, rejected: (value: string) => { reasons.push(value); } };
  if (reason === 'invocation-revoked') f.revoke();
  else if (reason === 'request-snapshot-mismatch') request = { ...request, snapshotId: 'different' };
  else if (reason === 'snapshot-unavailable') service = new ProjectPreparationService();
  else if (reason === 'delegation-expired') invocation.delegation.expiresAt = 0;
  else if (reason === 'role-mismatch') invocation.roleId = 'deck-lead';
  else if (reason === 'generation-missing') invocation.generation = '';
  else if (reason === 'launch-missing') invocation.launchId = '';
  else if (reason === 'native-session-missing') invocation.nativeSessionId = '';
  else if (reason === 'session-mismatch') invocation.delegation.sessionId = 'different';
  else if (reason === 'epoch-mismatch') invocation.delegation.epoch = 'different';
  else if (reason === 'project-mismatch') invocation.delegation.projectRoot = '/different';
  else if (reason === 'component-outside-delegation') request = { ...request, components: ['openspec'] };
  else invocation.current = () => ({ ...f.scope, policyDigest: 'different' });
  await expect(service.repair(request, invocation)).rejects.toThrow(/^preparation-authority-revoked$/);
  expect(reasons).toEqual([reason]);
  expect(readFileSync(f.file, 'utf8')).toBe(original);
  expect(f.records).toEqual([]);
});
