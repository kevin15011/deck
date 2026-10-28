import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getDefaultDeckConfig } from "@deck/core";
import { createOpenCodeRunnerAdapter } from "./runner-adapter";
import { prepareOpenCodeNativeRole, verifyOpenCodeNativeRole } from "./native-role";
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root,{recursive:true,force:true}); });
export async function installedOpenCodeRole(roleId = "deck-quality") {
  const root = mkdtempSync(join(tmpdir(),"deck-oc-role-")); roots.push(root);
  const adapter = createOpenCodeRunnerAdapter({developerTeamConfigDir:root});
  const plan = adapter.buildDeveloperTeamInstallPlan!({environmentId:"opencode-development",projectRoot:root,deckConfig:getDefaultDeckConfig()});
  await adapter.applyDeveloperTeamInstall!({environmentId:"opencode-development",projectRoot:root,plan});
  return {root, role: prepareOpenCodeNativeRole(root,roleId)};
}
test("installed OpenCode roles bind entry, prompt, skill and plugin; changes revoke the descriptor",async()=>{
  const {root,role} = await installedOpenCodeRole();
  expect(role.roleRef).toBe("deck-quality");
  verifyOpenCodeNativeRole(role);
  for (const path of ["opencode.json","prompts/deck-team/deck-quality.md","skills/deck-quality/SKILL.md","plugins/developer-team-execution.js"]) {
    const full=join(root,path), before=readFileSync(full,"utf8");
    writeFileSync(full,before+"\nchanged");
    expect(()=>verifyOpenCodeNativeRole(role)).toThrow("generation-unverified");
    writeFileSync(full,before);
  }
});
