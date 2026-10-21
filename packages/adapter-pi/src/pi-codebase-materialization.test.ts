import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateDeckConfig } from "@deck/core";
import { createPiRunnerAdapter } from "./runner-adapter";
import { createPiTools } from "./pi-owned-tools";
import { createCodebaseGuardInvocation } from "./pi-codebase-guard-command";
import { classifyNativeCodebase } from "./pi-native-codebase-readiness";
import { createNodePiFileIO } from "./pi-global-install";

for (const action of ["missing-old-payload", "custom-conflict", "rollback"] as const) test(`owned guard migration: ${action}`,async()=>{
 const root=mkdtempSync(join(tmpdir(),"deck-guard-migration-")),agentDir=join(root,"agent"),projectRoot=join(root,"project"),binary=join(root,"codebase-memory-mcp");
 try{
  mkdirSync(join(projectRoot,".pi"),{recursive:true});
  const projectConfig=join(projectRoot,".pi/mcp.json"),projectBytes=JSON.stringify({mcpServers:{"codebase-memory":{url:"https://custom.invalid/mcp"}}});writeFileSync(projectConfig,projectBytes);
  const script="#!/usr/bin/env node\nprocess.stdin.pipe(process.stdout);\n";writeFileSync(binary,script,{mode:0o700});
  const release={asset:"fixture",archiveBytes:1,archiveSha256:"0".repeat(64),binaryBytes:Buffer.byteLength(script),binarySha256:createHash("sha256").update(script).digest("hex")};
  const tools=createPiTools({homeDir:root,dataRoot:join(root,"deck"),env:{},resolveCommand:()=>binary,codebaseReleaseOverride:release});
  const oldScript=join(root,"old-main.ts"),newScript=join(root,"new-main.ts");writeFileSync(oldScript,"// old guard fixture");writeFileSync(newScript,"// new guard fixture");
  const oldInvocation=createCodebaseGuardInvocation(process.execPath,oldScript),newInvocation=createCodebaseGuardInvocation(process.execPath,newScript);
  const options={homeDirectory:root,env:{PI_CODING_AGENT_DIR:agentDir},piTools:tools,piVersionProbe:()=>({exitCode:0,stdout:"1.0.0\n"})};
  const input={projectRoot,environmentId:"pi-development" as const,deckConfig:validateDeckConfig({}),capabilityIds:["codebase-memory-mcp"]};
  const old=createPiRunnerAdapter({...options,...(action==="missing-old-payload"?{codebaseGuardInvocation:()=>oldInvocation}:{})});
  await old.applyDeveloperTeamInstall({projectRoot,environmentId:"pi-development",plan:old.buildDeveloperTeamInstallPlan(input)});
  const configPath=join(agentDir,"mcp.json"),manifestPath=join(agentDir,"deck/manifest.json");
  const config=JSON.parse(readFileSync(configPath,"utf8"));config.mcpServers.personal={command:"/personal",args:["literal"]};
  if(action==="custom-conflict")config.mcpServers["codebase-memory"]={command:"/personal-codebase",args:["user-owned"]};
  writeFileSync(configPath,JSON.stringify(config));
  const configBefore=readFileSync(configPath),manifestBefore=readFileSync(manifestPath);
  if(action==="missing-old-payload"){rmSync(oldScript);rmSync(binary);}
  const io=createNodePiFileIO();let failed=false;
  const current=createPiRunnerAdapter({...options,codebaseGuardInvocation:()=>newInvocation,...(action==="rollback"?{piFileIO:{...io,writeText:(path:string,content:string,mode?:number)=>{if(path===manifestPath&&!failed){failed=true;throw new Error("fixture disk failure");}io.writeText(path,content,mode);}}}:{})});
  const plan=current.buildDeveloperTeamInstallPlan(input);expect(readFileSync(configPath)).toEqual(configBefore);
  if(action==="custom-conflict"){expect(plan.blocked).toBeTruthy();expect(readFileSync(manifestPath)).toEqual(manifestBefore);}
  else if(action==="rollback"){await expect(current.applyDeveloperTeamInstall({projectRoot,environmentId:"pi-development",plan})).rejects.toThrow("fixture disk failure");expect(readFileSync(configPath)).toEqual(configBefore);expect(readFileSync(manifestPath)).toEqual(manifestBefore);}
  else{expect(plan.blocked).toBeFalsy();await current.applyDeveloperTeamInstall({projectRoot,environmentId:"pi-development",plan});const next=JSON.parse(readFileSync(configPath,"utf8"));expect(next.mcpServers.personal).toEqual(config.mcpServers.personal);expect(next.mcpServers["codebase-memory"].args[0]).toBe(newInvocation.script);expect(classifyNativeCodebase({agentDir})).toMatchObject({status:"unavailable",owned:true,guarded:true,binary});}
  expect(readFileSync(projectConfig,"utf8")).toBe(projectBytes);
 }finally{rmSync(root,{recursive:true,force:true});}
});
