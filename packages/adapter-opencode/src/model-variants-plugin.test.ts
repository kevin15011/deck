import { test, expect } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import plugin from '../assets/opencode/plugins/model-variants';

// Protects native plugin loading and nonblocking discovery: provider initialization may wait for plugins.
// Oracle: OpenCode's plugin factory returns hooks, SDK provider.list returns {data:{all:[...]}}.
test('variant plugin returns hooks before discovery resolves, writes SDK model maps, and cancels on dispose', async () => {
 const root=mkdtempSync('/private/tmp/deck-variants-plugin-'), previous=process.env.XDG_CACHE_HOME;
 process.env.XDG_CACHE_HOME=root;
 try {
  let complete!: (value: any)=>void;
  const response=new Promise<any>(resolve=>complete=resolve);
  const hooks=await (plugin as any)({client:{provider:{list:()=>response}}});
  expect(hooks.config).toBeFunction();
  await hooks.config({});
  const path=join(root,'deck/opencode/model-variants.json');
  expect(existsSync(path)).toBe(false);
  complete({data:{all:[{id:'fixture',models:{model:{id:'model',variants:{low:{},high:{},disabled:{disabled:true}}}}}]}});
  await hooks.dispose();
  expect(existsSync(path)).toBe(false);
  const ready=await (plugin as any)({client:{provider:{list:async()=>({data:{all:[{id:'fixture',models:{model:{id:'model',variants:{low:{},high:{},disabled:{disabled:true}}}}}]}})}}});
  await ready.config({});
  // Drain the fulfilled SDK response without relying on timers or network.
  await Promise.resolve();
  expect(JSON.parse(readFileSync(path,'utf8')).providers).toEqual({fixture:{model:['low','high']}});
  await ready.dispose();
 }finally{if(previous===undefined)delete process.env.XDG_CACHE_HOME;else process.env.XDG_CACHE_HOME=previous;rmSync(root,{recursive:true,force:true});}
});
