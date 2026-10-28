import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createClaudeRunnerAdapter } from "../runner-adapter";
import { buildClaudeTurnLaunch } from "./launch";
import { getDefaultDeckConfig } from "@deck/core";

test.each([true, false])("selected read-only roles preserve exact managed queries only when enabled (%s)", async enabled => {
 const home=mkdtempSync(join(tmpdir(),"deck-quality-role-probe-")), project=join(home,"project");mkdirSync(project);
 try {
 const adapter=createClaudeRunnerAdapter({homeDir:home,dataRoot:join(home,"data","deck"),resolveCommand:()=>process.execPath,verifyExistingCodebase:()=>true});
 const plan=adapter.buildDeveloperTeamInstallPlan({projectRoot:project,environmentId:"claude-development",deckConfig:{...getDefaultDeckConfig(),capabilities:{"codebase-memory":{enabled,runners:{}}}},capabilityIds: enabled ? ["claude-team-files","codebase-memory"] : ["claude-team-files"]});
 await adapter.applyDeveloperTeamInstall({projectRoot:project,environmentId:"claude-development",plan});
 const nativeSkills=await adapter.prepareSessionNativeSkills();
 const results=[];
 for(const roleId of ["deck-quality","deck-investigate"]) {
 const text=readFileSync(join(nativeSkills.root,"agents",roleId+".md"),"utf8");
 const allowed=text.match(/^tools: (.*)$/m)![1]!.split(", ");const files=new Map();
 const launch=buildClaudeTurnLaunch({taskId:"q",memberId:roleId.slice(5),cwd:project,assignment:{runnerId:"claude",modelId:"haiku"},rolePrompt:"",prompt:"Review",nativeSessionId:"3f2b8c1e-5d4a-4b7e-9a1c-0e2d3f4a5b6c",mcp:{servers:enabled ? ["deck","codebase-memory"] : ["deck"],sessionTools:["deck_status","deck_approve"]},mcpServerSpecs:{deck:{command:process.execPath,args:[],env:{}},"codebase-memory":{command:process.execPath,args:[],env:{}}},approvals:"relay",credentialFile:join(home,"credential"),disableNativeDelegation:true,nativeSkills,nativeRole:{roleId,roleRef:`deck-developer-team:${roleId}`,generation:nativeSkills.contentHash}}, {writePrivateFile:(name,content)=>{files.set(name,content);return join(home,name)}},{baseEnv:{HOME:home}});
 const settings=JSON.parse(launch.args[launch.args.indexOf("--settings")+1]!);
 results.push({roleId,allowed,selected:launch.args[launch.args.indexOf("--agent")+1],denied:settings.deniedMcpServers,servers:Object.keys(JSON.parse(files.get("mcp-config.json")).mcpServers),allowsSessionQuery:allowed.includes("mcp__codebase-memory__search_graph")});
 }
 for (const result of results) {
   expect(result.selected).toBe(`deck-developer-team:${result.roleId}`);
   expect((result.denied ?? []).some((entry: any) => entry.serverName === "plugin:deck-developer-team:codebase-memory")).toBe(enabled);
   expect(result.servers.includes("codebase-memory")).toBe(enabled);
   for (const tool of ["index_repository", "delete_project", "manage_adr"]) {
     expect(result.allowed).not.toContain(`mcp__codebase-memory__${tool}`);
     expect(result.allowed).not.toContain(`mcp__plugin_deck-developer-team_codebase-memory__${tool}`);
   }
   expect(result.allowed.some((tool: string) => tool.includes("*"))).toBe(false);
   for (const tool of ["WebSearch", "WebFetch", "mcp__web-search__tavily_search"]) expect(result.allowed).not.toContain(tool);
   for (const tool of ["Write", "Edit", "Bash"]) expect(result.allowed).not.toContain(tool);
 }
 for (const result of results) {
   for (const tool of ["search_graph", "trace_path", "get_code_snippet", "check_index_coverage", "query_graph", "get_architecture", "search_code", "index_status", "list_projects"]) {
     expect(result.allowed.includes(`mcp__codebase-memory__${tool}`)).toBe(enabled);
   }
 }
 }finally{rmSync(home,{recursive:true,force:true})}
});
