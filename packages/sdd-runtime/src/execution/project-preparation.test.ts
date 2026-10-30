// Protects shared component caching, targeted invalidation, and exact authenticated repair authority.
import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import type { PreparationEffectRecord, PreparationInvocation, PreparationScope } from "@deck/core/session/preparation";
import { migrateRetiredTestingPolicy } from "./retired-testing-policy";
import { formatReadinessBlockV1, ProjectPreparationService, type IndexInitializerBinding } from "./project-preparation";

import { fixture, cleanupPreparationFixtures } from "./preparation-test-fixture";
afterEach(cleanupPreparationFixtures);

test("YAML cleanup preserves commands, collisions, opaque keys, comments and idempotence", () => {
  const source = `# project\nschema: spec-driven\ntdd: true\nrules:\n  apply:\n    tdd: true\n  verify:\n    coverage_threshold: 80\ntesting:\n  policy: strict\n  strict_tdd_gates:\n    test: |\n      bun test --coverage\n  commands:\n    test: bun test\n    tdd: echo keep\nopaque:\n  strict_tdd: true\n`;
  const result = migrateRetiredTestingPolicy(source), value = parse(result.text);
  expect(value.testing).toEqual({ policy: "proportional", commands: { test: "bun test", tdd: "echo keep", test_2: "bun test --coverage\n" } });
  expect(value.opaque.strict_tdd).toBe(true); expect(value.tdd).toBeUndefined(); expect(result.text).toContain("# project"); expect(result.text).toContain("|");
  expect(migrateRetiredTestingPolicy(result.text)).toMatchObject({ text: result.text, changed: false });
  expect(() => migrateRetiredTestingPolicy("testing:\n  strict_tdd_gates:\n    test: {unknown: true}\n")).toThrow("gate-shape-unsupported");
});
test("mixed enablement checks one shared index and only its enabled runner; all off removes optional findings", () => {
  const f = fixture();
  expect(f.snapshot.observations.filter(o => o.component === "codebase-memory-index")).toMatchObject([{ status: "indeterminate", requiredBy: ["quality"] }]);
  expect(f.snapshot.observations.filter(o => o.scope === "runner")).toMatchObject([{ bindingId: "quality" }]);
  const off = { ...f.scope, members: f.scope.members.map(m => ({ ...m, capabilities: {} })) };
  expect(f.service.status(off).observations.some(o => o.component.startsWith("codebase"))).toBe(false);
  expect(formatReadinessBlockV1(f.snapshot).match(/<deck-project-readiness/g)).toHaveLength(1);
});

test("session component reads survive roster changes and refresh only changed files", () => {
  const f = fixture(), reads: string[] = [];
  const service = new ProjectPreparationService({ onProjectRead: path => reads.push(path) });
  service.status(f.scope);
  expect(reads).toEqual(["openspec/config.yaml", ".atl/skill-registry.md"]);
  reads.length = 0;
  const changedRoster = { ...f.scope, policyDigest: "new-policy", members: f.scope.members.slice(0, 1) };
  const off = service.status(changedRoster);
  expect(off.observations.some(o => o.component.startsWith("codebase"))).toBe(false);
  expect(off.observations.find(o => o.component === "openspec")?.requiredBy).toEqual(["lead"]);
  expect(reads).toEqual([]);
  mkdirSync(join(f.scope.projectRoot, ".atl"));
  writeFileSync(join(f.scope.projectRoot, ".atl/skill-registry.md"), "registry evidence");
  const appeared = service.status(changedRoster);
  expect(appeared.observations.find(o => o.component === "skill-registry")?.reason).toBe("registry-invalid");
  expect(reads).toEqual([".atl/skill-registry.md"]);
  reads.length = 0;
  writeFileSync(f.file, "schema: spec-driven\ntesting:\n  policy: proportional\n");
  expect(service.status(changedRoster).observations.find(o => o.component === "retired-testing-policy")?.status).toBe("ready");
  expect(reads).toEqual(["openspec/config.yaml"]);
  reads.length = 0;
  service.status({ ...changedRoster, epoch: "restarted" });
  expect(reads).toHaveLength(2);
});
test("serialized repair writes once, reconciles repeat and refreshes readiness", async () => {
  const f = fixture();
  const results = await Promise.all([f.service.repair(f.request, f.invocation), f.service.repair(f.request, f.invocation)]);
  expect(results.map(r => r.status)).toEqual(["changed", "reconciled"]);
  expect(f.records.filter(r => r.state === "intent")).toHaveLength(1);
  expect(readFileSync(f.file, "utf8")).toContain("# old policy");
  expect(f.service.status(f.scope).observations.find(o => o.component === "retired-testing-policy")?.status).toBe("ready");
});
test("spoofed fields, revoked callbacks and source races preserve bytes", async () => {
  const f = fixture(), before = readFileSync(f.file, "utf8");
  await expect(f.service.repair({ ...f.request, agentId: "deck-setup" }, f.invocation)).rejects.toThrow("request-invalid");
  await expect(f.service.repair(f.request, { ...f.invocation, roleId: "deck-lead" })).rejects.toThrow("authority-revoked");
  const pending = f.service.repair(f.request, f.invocation); f.revoke();
  await expect(pending).rejects.toThrow("authority-revoked"); expect(readFileSync(f.file, "utf8")).toBe(before);
  const other = fixture(); writeFileSync(other.file, before + "# concurrent edit\n");
  await expect(other.service.repair(other.request, other.invocation)).rejects.toThrow("source-changed");
  expect(readFileSync(other.file, "utf8")).toContain("# concurrent edit");
});
test("persisted intent after an uncertain write reconciles without another effect", async () => {
  const f = fixture(); let crash = true;
  const invocation = { ...f.invocation, record: (r: PreparationEffectRecord) => { if (r.state === "completed" && crash) { crash = false; throw new Error("ledger-unavailable"); } f.records.push(r); } };
  await expect(f.service.repair(f.request, invocation)).rejects.toThrow("ledger-unavailable");
  expect(f.service.status(f.scope).observations.find(o => o.component === "retired-testing-policy")?.status).toBe("indeterminate");
  const restarted = new ProjectPreparationService();
  expect(restarted.reconcile(f.scope, f.records)).toMatchObject([{ state: "reconciled" }]);
  expect(restarted.status(f.scope).observations.find(o => o.component === "retired-testing-policy")?.status).toBe("ready");
  expect((await f.service.repair(f.request, invocation)).status).toBe("reconciled");
  expect(f.records.filter(r => r.state === "intent")).toHaveLength(1);
});
test("an intent with no proven postimage stays indeterminate after restart", () => {
  const f = fixture();
  const restarted = new ProjectPreparationService();
  expect(restarted.reconcile(f.scope, [{ effectId: "e", delegationId: "d", component: "retired-testing-policy", before: "b", after: "unknown", state: "intent" }])).toEqual([]);
  expect(restarted.status(f.scope).observations.find(o => o.component === "retired-testing-policy")?.status).toBe("indeterminate");
});
test.each([false, true])("disabled Setup uses an enabled initializer binding; last-consumer revocation fences effects (%s)", async revoke => {
  const f = fixture(); let calls = 0, observations = 0, currentScope = f.scope;
  const binding: IndexInitializerBinding = { projectRoot: f.scope.projectRoot, bindingId: "quality", backendId: "fixture", generation: "g1", inputDigest: "a".repeat(64), expectedPostDigest: "b".repeat(64), status: "needs-index", validUntil: Date.now() + 60000,
    initializeProjectSync: root => { expect(root).toBe(f.scope.projectRoot); calls++; binding.inputDigest = binding.expectedPostDigest; binding.status = "ready"; },
  };
  const service = new ProjectPreparationService({ indexBindings: () => { observations++; return [binding]; } });
  const snapshot = service.status(currentScope), request = { snapshotId: snapshot.snapshotId, components: ["codebase-memory-index"] };
  const delegation = service.delegate(request, currentScope, { taskId: "setup", attempt: 1 });
  const invocation = { ...f.invocation, delegation, current: () => currentScope, record: (record: PreparationEffectRecord) => {
    f.records.push(record);
    if (revoke && record.state === "intent") currentScope = { ...f.scope, members: f.scope.members.map(m => ({ ...m, capabilities: {} })) };
  } };
  if (revoke) await expect(service.repair(request, invocation)).rejects.toThrow("authority-revoked");
  else expect((await service.repair(request, invocation)).status).toBe("changed");
  expect(calls).toBe(revoke ? 0 : 1);
  expect(f.records[0]?.executorBindingId).toBe("quality");
  expect(f.scope.members.find(m => m.memberId === "setup")?.capabilities["codebase-memory"]?.enabled).toBe(false);
  observations = 0;
  const off = { ...f.scope, members: f.scope.members.map(m => ({ ...m, capabilities: {} })) };
  expect(service.status(off).observations.some(o => o.component === "codebase-memory-index")).toBe(false);
  expect(observations).toBe(0);
});

// Protects dependency freshness even when a previously trusted path becomes a link.
test("cached project evidence never survives a symlink substitution", () => {
  const f = fixture();
  const source = readFileSync(f.file, "utf8");
  const other = join(f.scope.projectRoot, "other.yaml"); writeFileSync(other, source);
  rmSync(f.file); symlinkSync(other, f.file);
  const current = f.service.status(f.scope);
  expect(current.observations.find(o => o.component === "openspec")?.status).toBe("indeterminate");
  expect(current.observations.some(o => o.component === "retired-testing-policy")).toBe(false);
});

// Protects exact runner-scoped registry generation through the production bounded writer.
// Oracle: only an authenticated Setup may create the missing registry; replay never rediscovers or rewrites it.
test.each([false, true])("registry generation/refresh uses the current Setup runner and reconciles replay (existing=%s)", async existing => {
  const f = fixture();
  if (existing) { mkdirSync(join(f.scope.projectRoot, '.atl')); writeFileSync(join(f.scope.projectRoot, '.atl/skill-registry.md'), 'invalid registry'); }
  writeFileSync(join(f.scope.projectRoot, '.gitignore'), '/.atl/skill-registry.md\n');
  const { SKILL_DISCOVERY_SOURCE_PROVIDER_SCHEMA } = await import('../../../core/src/skill-discovery/contracts');
  let discoveries = 0;
  const service = new ProjectPreparationService({ registryProvider: runnerId => ({ schema: SKILL_DISCOVERY_SOURCE_PROVIDER_SCHEMA, runnerId,
    resolveLocator: async () => ({ status: 'missing' }),
    listSources: async () => { discoveries++; return { outcome: 'complete', sources: [], diagnostics: [] }; },
  }) });
  const request = { snapshotId: service.status(f.scope).snapshotId, components: ['skill-registry'] };
  const invocation = { ...f.invocation, delegation: service.delegate(request, f.scope, { taskId: 'setup-task', attempt: 1 }) };
  const results = await Promise.all([service.repair(request, invocation), service.repair(request, invocation)]);
  expect(results.map(r => r.status)).toEqual(['changed', 'reconciled']);
  expect(discoveries).toBe(1);
  const { parseSkillRegistryDocument } = await import('../../../core/src/skill-discovery/registry');
  expect(parseSkillRegistryDocument(readFileSync(join(f.scope.projectRoot, '.atl/skill-registry.md'), 'utf8')).ok).toBe(true);
  expect(f.records.filter(r => r.state === 'intent')).toHaveLength(1);
});

// Protects revocation across asynchronous discovery, source races, exact role/runner admission,
// durable uncertain effects and the separately scoped ignore-file authority.
test.each([false, true].flatMap(existing => ['cancel', 'role', 'runner', 'source', 'late-source', 'late-cancel', 'generation', 'ignore', 'ledger'].map(fault => ({ existing, fault }))))('registry repair preserves authority and postimages: %j', async ({ existing, fault }) => {
  const f = fixture(), root = f.scope.projectRoot, target = join(root, '.atl/skill-registry.md');
  if (existing) { mkdirSync(join(root, '.atl')); writeFileSync(target, 'invalid registry'); }
  writeFileSync(join(root, '.gitignore'), fault === 'ignore' ? '# personal rules\n' : '/.atl/skill-registry.md\n');
  const { SKILL_DISCOVERY_SOURCE_PROVIDER_SCHEMA } = await import('../../../core/src/skill-discovery/contracts');
  let active = true, currentScope = f.scope;
  const service = new ProjectPreparationService({ registryProvider: runnerId => ({ schema: SKILL_DISCOVERY_SOURCE_PROVIDER_SCHEMA, runnerId: fault === 'runner' ? 'pi' : runnerId,
    resolveLocator: async () => ({ status: 'missing' }),
    listSources: async () => {
      if (fault === 'cancel') active = false;
      if (fault === 'generation') currentScope = { ...f.scope, policyDigest: 'changed-generation' };
      if (fault === 'source') { mkdirSync(join(root, '.atl'), { recursive: true }); writeFileSync(target, 'concurrent editor'); }
      return { outcome: 'complete', sources: [], diagnostics: [] };
    },
  }) });
  const request = { snapshotId: service.status(f.scope).snapshotId, components: ['skill-registry'] };
  const invocation: PreparationInvocation = { ...f.invocation, delegation: service.delegate(request, f.scope, { taskId: 'setup-task', attempt: 1 }),
    roleId: fault === 'role' ? 'deck-lead' : 'deck-setup', current: () => active ? currentScope : undefined,
    record: record => {
      if (record.state === 'intent' && fault === 'late-cancel') active = false;
      if (record.state === 'intent' && fault === 'late-source') { mkdirSync(join(root, '.atl'), { recursive: true }); writeFileSync(target, 'concurrent editor'); }
      if (fault === 'ledger' && record.state === 'completed') throw new Error('ledger-unavailable'); f.records.push(record); },
  };
  await expect(service.repair(request, invocation)).rejects.toThrow();
  if (fault === 'source' || fault === 'late-source') expect(readFileSync(target, 'utf8')).toBe('concurrent editor');
  else if (fault === 'ledger') {
    const bytes = readFileSync(target, 'utf8');
    const restarted = new ProjectPreparationService();
    expect(restarted.reconcile(f.scope, f.records)).toMatchObject([{ component: 'skill-registry', state: 'reconciled' }]);
    expect((await service.repair(request, { ...invocation, record: record => f.records.push(record) })).status).toBe('reconciled');
    expect(readFileSync(target, 'utf8')).toBe(bytes);
    expect(f.records.filter(record => record.state === 'intent')).toHaveLength(1);
  } else if (existing) expect(readFileSync(target, 'utf8')).toBe('invalid registry');
  else expect(() => readFileSync(target)).toThrow();
  expect(readFileSync(join(root, '.gitignore'), 'utf8')).toBe(fault === 'ignore' ? '# personal rules\n' : '/.atl/skill-registry.md\n');
});

// Protects the established OpenSpec init-state contract: a schema name is not initialization.
test('readiness requires explicit OpenSpec initialization', () => {
  const f = fixture();
  expect(f.service.status(f.scope).observations.find(o => o.component === 'openspec')).toMatchObject({ status: 'degraded', reason: 'config-uninitialized', repair: 'project' });
  writeFileSync(f.file, 'schema: spec-driven\ninitialized: true\ntesting:\n  policy: proportional\n');
  expect(f.service.status(f.scope).observations.find(o => o.component === 'openspec')).toMatchObject({ status: 'ready', reason: 'config-readable' });
});

// Protects complete registry byte preservation and exact-authority refresh of bounded/truncated output.
test('complete registries require source evidence; truncated registries can be refreshed', async () => {
  const f = fixture(), root = f.scope.projectRoot, target = join(root, '.atl/skill-registry.md');
  writeFileSync(join(root, '.gitignore'), '/.atl/skill-registry.md\n');
  const service = new ProjectPreparationService({ registryProvider: runnerId => ({ schema: 'skill-discovery-source-provider-v1', runnerId,
    resolveLocator: async () => ({ status: 'missing' }), listSources: async () => ({ outcome: 'complete', sources: [], diagnostics: [] }),
  }) });
  const request = { snapshotId: service.status(f.scope).snapshotId, components: ['skill-registry'] };
  await service.repair(request, { ...f.invocation, delegation: service.delegate(request, f.scope, { taskId: 'setup-task', attempt: 1 }) });
  const complete = readFileSync(target, 'utf8');
  const current = service.status(f.scope);
  expect(() => service.delegate({ ...request, snapshotId: current.snapshotId }, f.scope, { taskId: 'setup-task', attempt: 2 })).toThrow('component-unavailable');
  expect(readFileSync(target, 'utf8')).toBe(complete);
  const { parseSkillRegistryDocument, renderSkillRegistryMarkdown } = await import('../../../core/src/skill-discovery/registry');
  writeFileSync(target, renderSkillRegistryMarkdown({ ...parseSkillRegistryDocument(complete).frontmatter!, completeness: 'truncated' }));
  const snapshot = service.status(f.scope);
  expect(snapshot.observations.find(o => o.component === 'skill-registry')).toMatchObject({ status: 'degraded', reason: 'registry-truncated', repair: 'project' });
  const refresh = { ...request, snapshotId: snapshot.snapshotId };
  expect((await service.repair(refresh, { ...f.invocation, delegation: service.delegate(refresh, f.scope, { taskId: 'setup-task', attempt: 2 }) })).status).toBe('changed');
  expect(parseSkillRegistryDocument(readFileSync(target, 'utf8')).frontmatter?.completeness).toBe('complete');
});

// Protects additive initialization, exact delegation, replay and crash recovery without overwriting user data.
test.each(['missing', 'merge'])('OpenSpec %s repair is additive and reconciles uncertain restart', async shape => {
  const f = fixture();
  if (shape === 'missing') rmSync(join(f.scope.projectRoot, 'openspec'), { recursive: true });
  else writeFileSync(f.file, '# keep\nschema: spec-driven\ncontext: custom\ntesting:\n  commands:\n    test: custom-test\n');
  const request = { snapshotId: f.service.status(f.scope).snapshotId, components: ['openspec'] };
  const invocation = { ...f.invocation, delegation: f.service.delegate(request, f.scope, { taskId: 'setup-task', attempt: 1 }) };
  await expect(f.service.repair(request, { ...invocation, roleId: 'deck-lead' })).rejects.toThrow('authority-revoked');
  await expect(f.service.repair(request, { ...invocation, record: r => { if (r.state === 'completed') throw new Error('ledger-unavailable'); f.records.push(r); } })).rejects.toThrow('ledger-unavailable');
  const bytes = readFileSync(f.file, 'utf8');
  expect(parse(bytes)).toMatchObject({ schema: 'spec-driven', initialized: true });
  if (shape === 'merge') expect(parse(bytes)).toMatchObject({ context: 'custom', testing: { commands: { test: 'custom-test' } } });
  expect(new ProjectPreparationService().reconcile(f.scope, f.records)).toMatchObject([{ component: 'openspec', state: 'reconciled' }]);
  expect((await f.service.repair(request, invocation)).status).toBe('reconciled');
  expect(readFileSync(f.file, 'utf8')).toBe(bytes);
  expect(f.records.filter(r => r.state === 'intent')).toHaveLength(1);
});
test('OpenSpec merge rejects unknown shapes and preserves concurrent edits', async () => {
  const f = fixture();
  for (const source of ['schema: custom\n', 'schema: [broken\n', 'schema: spec-driven\ninitialized: maybe\n']) {
    writeFileSync(f.file, source);
    const snapshot = f.service.status(f.scope);
    expect(() => f.service.delegate({ snapshotId: snapshot.snapshotId, components: ['openspec'] }, f.scope, { taskId: 'setup-task', attempt: 1 })).toThrow();
    expect(readFileSync(f.file, 'utf8')).toBe(source);
  }
  writeFileSync(f.file, 'schema: spec-driven\n');
  const request = { snapshotId: f.service.status(f.scope).snapshotId, components: ['openspec'] };
  const delegation = f.service.delegate(request, f.scope, { taskId: 'setup-task', attempt: 1 });
  await expect(f.service.repair(request, { ...f.invocation, delegation, record: r => { f.records.push(r); if (r.state === 'intent') writeFileSync(f.file, '# concurrent\n'); } })).rejects.toThrow('source-changed');
  expect(readFileSync(f.file, 'utf8')).toBe('# concurrent\n');
  expect(new ProjectPreparationService().reconcile(f.scope, f.records)).toEqual([]);
});

// Protects source-qualified refresh: a different runner's valid projection is not staleness.
// Oracle: only the original source scope can authorize replacement; replay/restart never rewrite.
test('stale registry refresh requires its own source runner and preserves replay/restart', async () => {
  const f = fixture(), root = f.scope.projectRoot, target = join(root, '.atl/skill-registry.md');
  writeFileSync(join(root, '.gitignore'), '/.atl/skill-registry.md\n');
  const service = new ProjectPreparationService({ registryProvider: runnerId => ({ schema: 'skill-discovery-source-provider-v1', runnerId,
    resolveLocator: async () => ({ status: 'missing' }), listSources: async () => ({ outcome: 'complete', sources: [], diagnostics: [] }),
  }) });
  const initial = { snapshotId: service.status(f.scope).snapshotId, components: ['skill-registry'] };
  await service.repair(initial, { ...f.invocation, delegation: service.delegate(initial, f.scope, { taskId: 'setup-task', attempt: 1 }) });
  const before = readFileSync(target, 'utf8');
  mkdirSync(join(root, '.skills/new'), { recursive: true });
  writeFileSync(join(root, '.skills/new/SKILL.md'), '---\nname: new\ndescription: New project skill\n---\n');
  await service.prepareRegistryEvidence(f.scope, 'codex');
  expect(service.status(f.scope).observations.find(o => o.component === 'skill-registry')?.repair).toBe('none');
  expect(readFileSync(target, 'utf8')).toBe(before);
  await service.prepareRegistryEvidence(f.scope, 'claude');
  const snapshot = service.status(f.scope);
  expect(snapshot.observations.find(o => o.component === 'skill-registry')).toMatchObject({ reason: 'registry-stale', repair: 'project', sourceRunnerId: 'claude' });
  const request = { snapshotId: snapshot.snapshotId, components: ['skill-registry'] };
  const invocation = { ...f.invocation, delegation: service.delegate(request, f.scope, { taskId: 'setup-task', attempt: 2 }) };
  await expect(service.repair(request, { ...invocation, runnerId: 'codex' })).rejects.toThrow('preparation-executor-unavailable');
  await expect(service.repair(request, { ...invocation, roleId: 'deck-lead' })).rejects.toThrow('preparation-authority-revoked');
  expect((await service.repair(request, invocation)).status).toBe('changed');
  const after = readFileSync(target, 'utf8');
  expect(after).not.toBe(before);
  expect((await service.repair(request, invocation)).status).toBe('reconciled');
  const restarted = new ProjectPreparationService();
  expect(restarted.reconcile(f.scope, f.records.filter(r => r.state === 'intent').slice(-1))).toMatchObject([{ state: 'reconciled' }]);
  expect(readFileSync(target, 'utf8')).toBe(after);
  writeFileSync(target, before);
  await service.prepareRegistryEvidence(f.scope, 'claude');
  const concurrent = { snapshotId: service.status(f.scope).snapshotId, components: ['skill-registry'] };
  const concurrentInvocation = { ...invocation, previous: () => [], delegation: service.delegate(concurrent, f.scope, { taskId: 'setup-task', attempt: 3 }) };
  writeFileSync(target, 'concurrent editor');
  await expect(service.repair(concurrent, concurrentInvocation)).rejects.toThrow('preparation-source-changed');
  expect(readFileSync(target, 'utf8')).toBe('concurrent editor');
});
