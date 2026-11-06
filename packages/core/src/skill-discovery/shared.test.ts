// Protects shared visibility, stable identity, truthful partial coverage and inert provenance.
import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDeclaredSkillProvider } from "./declared-provider";
import { discoverSharedSkillCatalog } from "./shared";
import { parseSkillRegistryDocument } from "./registry";
const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "shared-skills-"))); roots.push(root);
  const skill = join(root, "skills/example"); mkdirSync(skill, { recursive: true });
  writeFileSync(join(skill, "SKILL.md"), "---\nname: example\ndescription: Review typed interfaces\n---\nbody\n");
  const providers = ["claude", "codex", "opencode", "pi"].map(runnerId => createDeclaredSkillProvider(runnerId, {
    roots: () => [{ id: "shared", root: join(root, "skills"), category: "user_runner", scope: "user" }],
  }));
  return { root, providers };
}
test("all provider orders merge one physical skill with all exposures and truthful partial coverage", async () => {
  const { root, providers } = fixture();
  const a = await discoverSharedSkillCatalog({ projectRoot: root, providers });
  const b = await discoverSharedSkillCatalog({ projectRoot: root, providers: [...providers].reverse() });
  expect(a.frontmatter.schema_version).toBe(2);
  expect(a.frontmatter.completeness).toBe("partial");
  expect(a.frontmatter.records).toHaveLength(1);
  expect(a.frontmatter.exposures).toHaveLength(4);
  expect(a.frontmatter.fingerprint).toBe(b.frontmatter.fingerprint);
  expect(a.document).not.toContain(root);
  expect(parseSkillRegistryDocument(a.document).ok).toBe(true);
  expect(parseSkillRegistryDocument(a.document.replace('owner: claude', 'owner: attacker')).ok).toBe(false);
});
test("same-name distinct resources stay separate and unavailable providers retain usable rows", async () => {
  const { root, providers } = fixture();
  const other = join(root, "other/example"); mkdirSync(other, { recursive: true });
  writeFileSync(join(other, "SKILL.md"), "---\nname: example\n---\n");
  const extra = createDeclaredSkillProvider("codex", { roots: () => [{ id: "other", root: join(root, "other"), category: "user_runner", scope: "user" }] });
  const result = await discoverSharedSkillCatalog({ projectRoot: root, providers: [providers[0]!, extra] });
  expect(result.frontmatter.records).toHaveLength(2);
  expect(result.frontmatter.completeness).toBe("partial");
});

test("portable skills resolve across runners while native-only exposure cannot be borrowed", async () => {
  const { root, providers } = fixture();
  const { resolveSharedSkillExposure } = await import("./shared");
  const catalog = await discoverSharedSkillCatalog({ projectRoot: root, providers });
  const exposure = catalog.frontmatter.exposures![0]!;
  expect((await resolveSharedSkillExposure({ projectRoot: root, activeRunnerId: "pi", exposure, providers })).outcome).toBe("available");
  expect((await resolveSharedSkillExposure({ projectRoot: root, activeRunnerId: "pi", exposure: { ...exposure, load_mode: "native" }, providers })).outcome).toBe("not_exposed");
  expect((await resolveSharedSkillExposure({ projectRoot: root, activeRunnerId: "pi", exposure: { ...exposure, locator: exposure.locator.replace("example/SKILL.md", "../secret/SKILL.md") }, providers })).outcome).toBe("rejected");
});
test("every consuming runner searches the same partial catalog without acquiring load authority", async () => {
  const { root, providers } = fixture();
  const { createTaskScopedSkillDiscoveryRuntime } = await import("./runtime");
  const catalog = await discoverSharedSkillCatalog({ projectRoot: root, providers });
  mkdirSync(join(root, ".atl")); writeFileSync(join(root, ".atl/skill-registry.md"), catalog.document);
  for (const provider of providers) {
    const runtime = createTaskScopedSkillDiscoveryRuntime({ projectRoot: root, activeRunnerId: provider.runnerId, sessionId: "s", taskId: "t",
      registryStatus: "indeterminate", provider, providers, discoverDirectly: async () => ({ outcome: "complete", observations: [], diagnostics: [] }) });
    const found = await runtime.search({ schema: "skill-candidate-query-v1", terms: [], limit: 8 });
    expect(found.candidates.map(c => c.name)).toEqual(["example"]);
    expect(found.completeness).toBe("indeterminate");
    const selection = runtime.select({ observation_id: found.candidates[0]!.observation_id });
    expect(selection.outcome).toBe("selected");
    if (selection.outcome === "selected") expect((await runtime.prepare(selection.reference)).outcome).toBe("unsupported");
  }
});

test("shared publication binds candidate bytes as well as the executor", async () => {
  const { root, providers } = fixture();
  const { createSkillRegistryWriteAuthority, createSkillRegistryWriter, computeSkillRegistryPersistenceDigest: hash } = await import("./persistence");
  const catalog = await discoverSharedSkillCatalog({ projectRoot: root, providers });
  writeFileSync(join(root, ".gitignore"), "/.atl/skill-registry.md\n");
  const plan = { schema: "skill-registry-write-plan-v1" as const, action: "initial_generation" as const,
    active_runner_id: "pi", project_root_digest: hash(root), allowed_targets: [".atl/skill-registry.md"] as const,
    expected_registry_digest: "missing" as const, candidate_document: catalog.document, candidate_digest: hash(catalog.document) };
  const mint = (candidateDigest?: `sha256:${string}`) => createSkillRegistryWriteAuthority({ projectRoot: root, projectRootDigest: hash(root),
    activeRunnerId: "pi", action: "initial_generation", allowedTargets: plan.allowed_targets, candidateDigest });
  const writer = createSkillRegistryWriter({ projectRoot: root, stateRoot: join(root, "state"), registryLockRoot: join(root, "locks"), isTracked: () => false });
  expect((await writer.commit(plan, mint())).reason_code).toBe("candidate_authority_required");
  expect((await writer.commit(plan, mint(hash("different candidate")))).reason_code).toBe("candidate_digest_mismatch");
  expect((await writer.commit(plan, mint(plan.candidate_digest))).outcome).toBe("committed");
});
