import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { createMcpExtension } from '@earendil-works/pi-coding-agent';
import { installReviewedPiMcp } from './pi-extensions/tool-policy/native-mcp';
import { createDeckToolPolicyExtension } from './pi-extensions/tool-policy/extension';

for(const role of ['lead','investigate','apply-deep'])test(`Pi 1.0.0 native fake stdio transport retains personal exposure and ${role} permissions`,async()=>{
 const sdkPath=import.meta.resolve('@earendil-works/pi-coding-agent').replace('file://','');expect(JSON.parse(readFileSync(join(dirname(sdkPath),'../package.json'),'utf8')).version).toBe('1.0.0');
 const root=mkdtempSync('/tmp/deck-pi-personal-native-'),cwd=join(root,'work');mkdirSync(cwd);const envRole=process.env.DECK_PI_ROLE;process.env.DECK_PI_ROLE=role;
 const handlers:Record<string,Array<(event:any,ctx:any)=>any>>={};const definitions=new Map<string,any>();let active:string[]=[];
 const api={on(name:string,handler:any){(handlers[name]??=[]).push(handler);},getMcpServers:()=>[],registerCommand(){},registerTool(tool:any){definitions.set(tool.name,tool);if(tool.exposure==='direct')active.push(tool.name);},getActiveTools:()=>active,setActiveTools:(names:string[])=>{active=names;},getAllTools:()=>[...definitions.values()]};
 const ctx={cwd,hasUI:false,mode:'print',isProjectTrusted:()=>false,signal:new AbortController().signal,ui:{setStatus(){},notify(){}}};
 const dispatch=async(name:string,event:any={})=>{let result:any;for(const handler of handlers[name]??[])result=await handler(event,ctx)??result;return result;};
 try{
  const file=join(root,'mcp.json');const source=JSON.stringify({mcpServers:{docs:{command:process.execPath,args:[resolve(import.meta.dir,'../../../apps/cli/src/__fixtures__/personal-mcp.mjs')],exposure:'deferred',env:{PERSONAL_LITERAL:'FAKE_SECRET_SENTINEL'}}}});writeFileSync(file,source);
  const reviewed=installReviewedPiMcp(api as any,{getAgentDir:()=>root,createMcpExtension:options=>createMcpExtension({...options,logPath:join(root,'mcp.log'),startupWaitMs:3000})});
  createDeckToolPolicyExtension({env:{DECK_PI_ROLE:role}})(api as any);await dispatch('session_start');
  const end=Date.now()+5000;while(!definitions.has('mcp__docs__lookup')){if(Date.now()>end)throw new Error('native MCP tool timeout');await new Promise(r=>setTimeout(r,10));}
  expect(reviewed.personalAvailability()).toContainEqual({id:'docs',source:'user',status:'configured'});
  const decision=await dispatch('tool_call',{toolName:'mcp__docs__lookup',toolCallId:'lookup',input:{}});
  if(role==='investigate'){expect(active).toContain('mcp__docs__lookup');expect(decision).toMatchObject({block:true});}
  else{expect(decision).toBeUndefined();const result=await definitions.get('mcp__docs__lookup').execute('lookup',{},ctx.signal,()=>{},ctx);expect(JSON.stringify(result)).toContain('fixture result');}
  expect(readFileSync(file,'utf8')).toBe(source);
 }finally{await dispatch('session_shutdown');if(envRole===undefined)delete process.env.DECK_PI_ROLE;else process.env.DECK_PI_ROLE=envRole;rmSync(root,{recursive:true,force:true});}
},10000);


test('Pi 1.0.0 native user skills and extension plugins survive the Deck member lane without project execution',async()=>{
 const {DefaultResourceLoader,SettingsManager}=await import('@earendil-works/pi-coding-agent');
 const root=mkdtempSync('/tmp/deck-pi-resources-'),cwd=join(root,'work'),agentDir=join(root,'agent');
 mkdirSync(cwd);mkdirSync(join(agentDir,'extensions'),{recursive:true});mkdirSync(join(agentDir,'skills','user-skill'),{recursive:true});mkdirSync(join(cwd,'.pi','extensions'),{recursive:true});
 const userMarker=join(root,'user-loaded'),projectMarker=join(root,'project-loaded');
 writeFileSync(join(agentDir,'skills','user-skill','SKILL.md'),'---\nname: user-skill\ndescription: Isolated native skill\n---\nFixture instructions.\n');
 writeFileSync(join(agentDir,'extensions','fixture.js'),`import fs from 'node:fs';export default (pi)=>{fs.writeFileSync(${JSON.stringify(userMarker)},'loaded');pi.registerCommand('personal-plugin',{description:'Fixture',handler:async()=>{}});};`);
 writeFileSync(join(cwd,'.pi','extensions','untrusted.js'),`import fs from 'node:fs';export default ()=>fs.writeFileSync(${JSON.stringify(projectMarker)},'executed');`);
 try{const loader=new DefaultResourceLoader({cwd,agentDir,settingsManager:SettingsManager.inMemory({})});await loader.reload({resolveProjectTrust:async()=>false});expect(loader.getSkills().skills.map(s=>s.name)).toContain('user-skill');expect(loader.getExtensions().errors).toEqual([]);expect(readFileSync(userMarker,'utf8')).toBe('loaded');expect(loader.getExtensions().extensions.length).toBeGreaterThan(0);const {existsSync}=await import('node:fs');expect(existsSync(projectMarker)).toBe(false);}finally{rmSync(root,{recursive:true,force:true});}
},10000);
