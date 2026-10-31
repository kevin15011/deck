import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverSharedSkillCatalog } from "../../../core/src/skill-discovery/shared";
import { composeSkillSessionStartContext } from "./session-start-context";
import { ProjectPreparationService } from "./project-preparation";
const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(r => rmSync(r, { recursive: true, force: true })));
// Oracle: native and cross use the same bounded advisory renderer, even with no findings.
test("native/cross context changes highlights with trusted role/task without rewriting catalog", async () => {
 const root = mkdtempSync(join(tmpdir(), "deck-candidates-")); roots.push(root);
 for (const name of ["verification", "interfaces"]) {
  mkdirSync(join(root, ".skills", name), { recursive: true });
  writeFileSync(join(root, ".skills", name, "SKILL.md"), `---\nname: ${name}\ndescription: ${name}\n---\n`);
 }
 const catalog = await discoverSharedSkillCatalog({ projectRoot: root, providers: [] });
 mkdirSync(join(root, ".atl")); writeFileSync(join(root, ".atl/skill-registry.md"), catalog.document);
 const snapshot = new ProjectPreparationService().status({ projectRoot: root, sessionId: "s", epoch: "e", policyDigest: "p", members: [] });
 const clean = { ...snapshot, observations: [] };
 for (const runner of ["claude", "codex", "pi", "opencode"]) {
  const quality = composeSkillSessionStartContext(clean, runner, { roleId: "deck-quality" });
  const architect = composeSkillSessionStartContext(clean, runner, { roleId: "deck-architect" });
  expect(quality).toContain('"name":"verification"');
  expect(architect).toContain('"name":"interfaces"');
  expect(quality).not.toContain(root);
  expect(quality).not.toContain("<deck-project-readiness");
  expect(Buffer.byteLength(quality.split("## Skill candidates")[1]!)).toBeLessThan(6144);
 }
});
// Protects: install/preparation observations replace stale highlights while preserving unknown user bytes.
test("ephemeral lifecycle refresh reflects additions and removals without changing an edited registry", async () => {
 const { refreshSharedSkillCatalogView, readEphemeralSkillCatalog } = await import("../../../core/src/skill-discovery/shared");
 const { readFileSync } = await import("node:fs");
 const root = mkdtempSync(join(tmpdir(), "deck-candidate-refresh-")); roots.push(root);
 mkdirSync(join(root, ".atl"));
 const registry = join(root, ".atl/skill-registry.md");
 writeFileSync(registry, "User-owned notes");
 mkdirSync(join(root, ".skills", "new"), { recursive: true });
 writeFileSync(join(root, ".skills/new/SKILL.md"), "---\nname: new\ndescription: verification\n---\n");
 await refreshSharedSkillCatalogView({ projectRoot: root, providers: [] });
 const snapshot = new ProjectPreparationService().status({ projectRoot: root, sessionId: "s", epoch: "e", policyDigest: "p", members: [] });
 expect(composeSkillSessionStartContext(snapshot, "codex", { roleId: "quality" })).toContain('"name":"new"');
 const view = readEphemeralSkillCatalog(root)!;
 (view.records as unknown[]).length = 0;
 expect(readEphemeralSkillCatalog(root)!.records.some(r => r.name === "new")).toBe(true);
 rmSync(join(root, ".skills/new"), { recursive: true });
 await refreshSharedSkillCatalogView({ projectRoot: root, providers: [] });
 expect(composeSkillSessionStartContext(snapshot, "codex", { roleId: "quality" })).not.toContain('"name":"new"');
 expect(readFileSync(registry, "utf8")).toBe("User-owned notes");
});
