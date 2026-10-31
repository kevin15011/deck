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