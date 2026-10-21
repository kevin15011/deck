import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync, renameSync, symlinkSync, realpathSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { codeSign } from "../../../scripts/build-binaries";
import { parseArgs } from "./cli-args";
import { buildCodebaseGuardEntry, codebaseGuardCliArgs, createCodebaseGuardInvocation, createEmptyPiManifest, hashJsonValue } from "@deck/adapter-pi";

test("versioned internal guard grammar rejects extras, duplicate options, relative paths and arbitrary releases",()=>{
 const args=["--agent-dir","/agent","--binary","/binary","--guard-id",`1:${"a".repeat(64)}`];
 expect(parseArgs(["internal","codebase-mcp-guard-v1",...args]).command).toBe("internal-codebase-mcp-guard-v1");
 for(const bad of [args.slice(1),[...args,"--release","bad"],[...args,"--binary","/other"],args.map(v=>v==="/agent"?"relative":v),args.map(v=>v==="/binary"?"/binary\nsecret":v)])expect(parseArgs(["internal","codebase-mcp-guard-v1",...bad])).toMatchObject({command:"error",message:"Invalid Codebase guard invocation."});
});
test("actual production internal CLI refuses unavailable owned selection before child dispatch",async()=>{
 const root=mkdtempSync(join(tmpdir(),"deck-guard-cli-"));
 try{
  mkdirSync(join(root,"deck"));
  const main=resolve(import.meta.dir,"main.tsx"), invocation=createCodebaseGuardInvocation(process.execPath,main), binary=join(root,"missing-codebase");
  const entry=buildCodebaseGuardEntry(invocation,root,binary);const manifest=createEmptyPiManifest();manifest.mcp.servers["codebase-memory"]=hashJsonValue(entry);
  writeFileSync(join(root,"mcp.json"),JSON.stringify({mcpServers:{"codebase-memory":entry}}));writeFileSync(join(root,"deck/manifest.json"),JSON.stringify(manifest));
  const before=readFileSync(join(root,"mcp.json"));
  const child=Bun.spawn([entry.command,...entry.args],{cwd:root,env:{PATH:process.env.PATH!,HOME:root},stdin:"ignore",stdout:"pipe",stderr:"pipe"});
  const [stdout,stderr]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text()]);
  expect(await child.exited).toBe(69);expect(stdout).toBe("");expect(stderr).toContain("codebase-memory-unavailable");expect(stderr).not.toContain(root);expect(readFileSync(join(root,"mcp.json"))).toEqual(before);
 }finally{rmSync(root,{recursive:true,force:true});}
},15000);

test("real dev, compiled stable and canary payload resolve exact executable/script receipts",async()=>{
 const root=mkdtempSync(join(tmpdir(),"deck-guard-provenance-"));
 try{
  const main=join(root,"main.ts"), executable=join(root,"deck");
  const binary=join(root,"codebase-memory-mcp"), agentDir=join(root,"agent"), project=join(root,"project");mkdirSync(project);writeFileSync(binary,"#!/usr/bin/env node\n// reviewed fixture\n",{mode:0o700});
  writeFileSync(main,`import {deckCodebaseGuardInvocation,createDefaultAdapterRegistry} from ${JSON.stringify(join(import.meta.dir,"runner-adapters.ts"))};
import {createPiTools} from ${JSON.stringify(resolve(import.meta.dir,"../../../packages/adapter-pi/src/pi-owned-tools.ts"))};
import {createHash} from 'node:crypto';import {readFileSync} from 'node:fs';
const root=${JSON.stringify(root)},binary=${JSON.stringify(binary)},agentDir=${JSON.stringify(agentDir)},projectRoot=${JSON.stringify(project)};
const bytes=readFileSync(binary);const release={asset:'fixture',archiveBytes:1,archiveSha256:'0'.repeat(64),binaryBytes:bytes.length,binarySha256:createHash('sha256').update(bytes).digest('hex')};
const tools=createPiTools({homeDir:root,dataRoot:root+'/deck',env:{},resolveCommand:()=>binary,codebaseReleaseOverride:release});
const registry=createDefaultAdapterRegistry({pi:{homeDirectory:root,env:{PI_CODING_AGENT_DIR:agentDir},piTools:tools,piVersionProbe:()=>({exitCode:0,stdout:'1.0.0\\n'})}});
const adapter=registry.get('pi');const input={projectRoot,environmentId:'pi-development',deckConfig:(await import(${JSON.stringify(resolve(import.meta.dir,"../../../packages/core/src/index.ts"))})).getDefaultDeckConfig(),capabilityIds:['codebase-memory-mcp']};
const plan=adapter.buildDeveloperTeamInstallPlan(input);if(plan.blocked)throw Error('fixture blocked');await adapter.applyDeveloperTeamInstall({projectRoot,environmentId:'pi-development',plan});
console.log(JSON.stringify({invocation:deckCodebaseGuardInvocation(),selection:JSON.parse(readFileSync(agentDir+'/mcp.json','utf8')).mcpServers['codebase-memory']}));`);
  const dev=Bun.spawnSync([process.execPath,main]);expect(dev.exitCode).toBe(0);
  const devOutput=JSON.parse(dev.stdout.toString()), devInvocation=devOutput.invocation;expect(devOutput.selection).toEqual(buildCodebaseGuardEntry(devInvocation,agentDir,binary));expect(devInvocation).toEqual(createCodebaseGuardInvocation(process.execPath,main));
  const build=Bun.spawnSync([process.execPath,"build",main,"--compile","--outfile",executable],{stdout:"pipe",stderr:"pipe"});expect(build.exitCode).toBe(0);
  if(process.platform==="darwin") codeSign(executable);
  const stable=Bun.spawnSync([executable]);expect(stable.exitCode).toBe(0);const stableOutput=JSON.parse(stable.stdout.toString()),stableInvocation=stableOutput.invocation;expect(stableOutput.selection).toEqual(buildCodebaseGuardEntry(stableInvocation,agentDir,binary));expect(stableInvocation).toEqual(createCodebaseGuardInvocation(executable));expect(stableInvocation.script).toBeUndefined();
  const payload=join(root,`.deck-canary.payload-${stableInvocation.executableId.split(":")[1]}`);renameSync(executable,payload);const canary=join(root,"deck-canary");symlinkSync(payload,canary);
  const result=Bun.spawnSync([canary]);expect(result.exitCode).toBe(0);const canaryOutput=JSON.parse(result.stdout.toString()),canaryInvocation=canaryOutput.invocation;expect(canaryOutput.selection).toEqual(buildCodebaseGuardEntry(canaryInvocation,agentDir,binary));expect(canaryInvocation).toEqual(createCodebaseGuardInvocation(realpathSync(canary)));expect(canaryInvocation.command).toBe(realpathSync(payload));expect(existsSync(canaryInvocation.command)).toBe(true);
 }finally{rmSync(root,{recursive:true,force:true});}
},60000);
