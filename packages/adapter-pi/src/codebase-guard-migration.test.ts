import { expect, test } from "bun:test";
import { getDefaultDeckConfig } from "@deck/core";
import { createPiRunnerAdapter } from "./runner-adapter";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPiTools } from "./pi-owned-tools";
import { buildCodebaseGuardEntry, parseCodebaseGuardEntry } from "./pi-codebase-guard-command";
import { createEmptyPiManifest, hashJsonValue } from "./pi-manifest";

// Protects public upgrade planning when the owned Codebase binary is unavailable; custom environments fail closed.
for(const evidence of ["owned-legacy", "unreceipted", "edited", "receipted-custom"] as const) {
 test(`Codebase guard migration with unavailable binary: ${evidence}`,async()=>{
  const root=realpathSync(mkdtempSync(join(tmpdir(),"pi-guard-migration-")));
  try {
  const invocation={command:"/fixture/deck",executableId:`1:${"a".repeat(64)}`};
  const legacy={...buildCodebaseGuardEntry(invocation,root,"/fixture/missing-codebase"),env:{DECK_RUNNER_MEMORY_ENDPOINT:"",DECK_RUNNER_MEMORY_TOKEN:"",DECK_RUNNER_MEMORY_TOKEN_FILE:""}};
  const manifest=createEmptyPiManifest();
  if(evidence !== "unreceipted") manifest.mcp.servers["codebase-memory"]=hashJsonValue(legacy);
  if(evidence === "edited" || evidence === "receipted-custom") legacy.env.DECK_RUNNER_MEMORY_TOKEN="custom";
  if(evidence === "receipted-custom") manifest.mcp.servers["codebase-memory"]=hashJsonValue(legacy);
  const files=new Map([[`${root}/mcp.json`,JSON.stringify({mcpServers:{"codebase-memory":legacy}})],[`${root}/deck/manifest.json`,JSON.stringify(manifest)]]);
  const before=files.get(`${root}/mcp.json`);
  const adapter=createPiRunnerAdapter({homeDirectory:root,env:{HOME:root,PI_CODING_AGENT_DIR:root},piVersionProbe:()=>({exitCode:0,stdout:"1.0.0"}),codebaseGuardInvocation:()=>invocation,
   piTools:createPiTools({homeDir:root,env:{},dataRoot:join(root,"data","deck"),resolveCommand:()=>undefined}),
   piFileIO:{exists:path=>files.has(path),readText:path=>files.get(path),writeText:(path,content)=>{files.set(path,content);},remove:path=>{files.delete(path);},removeDirIfEmpty:()=>{}}});
  const input={projectRoot:root,environmentId:"pi-development" as const,deckConfig:{...getDefaultDeckConfig(),capabilities:{"codebase-memory":{enabled:true,runners:{}}}}};
  const plan=adapter.buildDeveloperTeamInstallPlan(input);
  expect(files.get(`${root}/mcp.json`)).toBe(before);
  if(evidence === "owned-legacy") {
   expect(plan.blocked).toBe(false);
   const config=plan.mutationPreview?.find(m=>m.path === `${root}/mcp.json`);
   expect(config).toBeDefined();
   await adapter.applyDeveloperTeamInstall({...input,plan});
   const migrated=JSON.parse(files.get(`${root}/mcp.json`)!).mcpServers["codebase-memory"];
   expect(migrated.env).toEqual({});
   expect(parseCodebaseGuardEntry(migrated,root)?.binary).toBe("/fixture/missing-codebase");
  } else if(evidence === "receipted-custom") expect(plan.blocked).toBe(true);
  // Legacy tolerance is limited to owned planning, never execution validation.
  expect(()=>parseCodebaseGuardEntry(legacy,root)).toThrow("pi-codebase-guard-invalid");
  } finally { rmSync(root,{recursive:true,force:true}); }
 });
}
