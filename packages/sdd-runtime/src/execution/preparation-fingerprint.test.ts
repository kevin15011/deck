// Protects safe-resume freshness without granting write authority; oracle: Slice 7.
import { afterEach, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createDeclaredSkillProvider } from "../../../core/src/skill-discovery/declared-provider";
import { discoverSharedSkillCatalog } from "../../../core/src/skill-discovery/shared";
import { ProjectPreparationService } from "./project-preparation";
import { fixture, cleanupPreparationFixtures, createPreparationService } from "./preparation-test-fixture";
afterEach(cleanupPreparationFixtures);
test("preparation detects a changed descriptor after restart and defers persistence to explicit Setup", async () => {
  const f = fixture(), root = f.scope.projectRoot;
  const skills = join(root, "skills"); mkdirSync(join(skills, "review"), { recursive: true });
  const file = join(skills, "review/SKILL.md"); writeFileSync(file, "---\nname: review\n---\n");
  const providers = [createDeclaredSkillProvider("claude", { roots: () => [{ id: "skills", root: skills, scope: "user", category: "user_runner" }] })];
  const catalog = await discoverSharedSkillCatalog({ projectRoot: root, providers });
  mkdirSync(join(root, ".atl")); const registry = join(root, ".atl/skill-registry.md"); writeFileSync(registry, catalog.document);
  const service = createPreparationService(f.scope.projectRoot, { registryProviders: () => providers });
  await service.prepareRegistryEvidence(f.scope, "claude");
  expect(service.status(f.scope).observations.find(o => o.component === "skill-registry")?.reason).toBe("registry-partial");
  writeFileSync(file, "---\nname: review\ndescription: Changed task guidance\n---\n");
  const restarted = createPreparationService(f.scope.projectRoot, { registryProviders: () => providers });
  await restarted.prepareRegistryEvidence(f.scope, "claude");
  expect(restarted.status(f.scope).observations.find(o => o.component === "skill-registry")?.reason).toBe("registry-stale");
  expect(readFileSync(registry, "utf8")).toBe(catalog.document);
});
