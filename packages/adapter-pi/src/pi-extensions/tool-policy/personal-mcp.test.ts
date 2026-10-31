import { expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createReviewedPiMcp } from './native-mcp';
import { personalPiToolNames } from '../pi-personal-mcp';
import { evaluateRolePolicy } from './policy';
test('native trust, transports/exposure/OAuth remain intact; control namespaces are reported and filtered',()=>{
 const root=mkdtempSync('/tmp/deck-personal-pi-');const project=join(root,'work');mkdirSync(join(project,'.pi'),{recursive:true});
 try{
  const path=join(root,'mcp.json');writeFileSync(path,JSON.stringify({mcpServers:{docs:{url:'https://example.invalid',exposure:'deferred',oauth:{clientId:'identity'}},deck:{command:'never'},supermemory:{command:'never'},disabled:{command:'never',enabled:false}}}));
  writeFileSync(join(project,'.pi','mcp.json'),JSON.stringify({mcpServers:{project:{command:'project',exposure:'direct'}}}));const bytes=readFileSync(path);
  const reviewed=createReviewedPiMcp({agentDir:root});let trusted=false;const ctx={cwd:project,isProjectTrusted:()=>trusted,ui:{setStatus(){}}} as any;
  const initial=reviewed.loadConfig(ctx);expect(initial.servers.map(x=>x.name)).toEqual(['docs','disabled']);expect(initial.servers[0]?.config).toMatchObject({oauth:{clientId:'identity'},exposure:'deferred'});
  expect(reviewed.personalAvailability().find(x=>x.id==='deck')?.status).toBe('conflicting');trusted=true;expect(reviewed.loadConfig(ctx).servers.some(x=>x.name==='project')).toBe(true);expect(readFileSync(path)).toEqual(bytes);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('member schemas include personal native tools without changing deny-by-default read-only permissions',()=>{
 const tools=personalPiToolNames([{name:'mcp__docs__lookup',exposure:'deferred'},{name:'mcp__serena__rename_symbol',exposure:'direct'},{name:'mcp__deck__deck_delegate',exposure:'direct'},{name:'mcp__hidden__tool',exposure:'hidden'}] as any);
 expect(tools).toEqual(['mcp__docs__lookup', 'mcp__serena__rename_symbol']);expect(evaluateRolePolicy('investigate', tools[1]!)).toMatchObject({block:true});expect(evaluateRolePolicy('investigate',tools[0]!)).toMatchObject({block:true});expect(evaluateRolePolicy('apply-deep',tools[0]!)).toBeUndefined();
});
