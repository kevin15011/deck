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
