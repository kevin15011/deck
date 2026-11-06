import { test, expect } from 'bun:test';
import { mkdtempSync, realpathSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { contributionHash } from '@deck/core';
import { planOpenCodeRefresh, applyOpenCodeRefresh } from './content-refresh';
import { buildOpenCodeDeveloperTeamInstallPlan } from './developer-team-install';
import { prepareOpenCodeNativeRole } from './native-role';

// Policy P1/P2/P7: install regenerates canonical slots; launch never adopts altered code.
test('install repairs unreceipted read-only roles and plugin, backs up edits and preserves foreign JSONC', () => {
 const home=realpathSync(mkdtempSync(join(tmpdir(),'opencode-managed-'))), root=join(home,'opencode');
 try {
  const native=buildOpenCodeDeveloperTeamInstallPlan(home,{configDir:root});
  const plugin=native.executionPlugin!;
  const files=[{path:'opencode.json',content:'{}',kind:'other' as const},
   {path:plugin.relativePath,content:plugin.content,kind:'other' as const},
   {path:native.modelVariantsPlugin!.relativePath,content:native.modelVariantsPlugin!.content,kind:'other' as const},
   ...native.promptGenerationPlan.map(f=>({path:f.absolutePath.slice(root.length+1),content:f.content,kind:'prompt' as const}))];
  mkdirSync(join(root,'plugins'),{recursive:true});
  writeFileSync(join(root,plugin.relativePath),'untrusted code');
  writeFileSync(join(root,'opencode.json'),'// foreign comment\n'+JSON.stringify({provider:{custom:{token:'foreign-secret-sentinel'}},agent:{foreign:{tools:{bash:true}},'deck-quality':{tools:{bash:true,edit:true,write:true}},'deck-investigate':{tools:{bash:true,edit:true,write:true}}}}));
  expect(()=>prepareOpenCodeNativeRole(root,'deck-quality')).toThrow();
  const plan=planOpenCodeRefresh(root,files,native.agentEntries);
  const result=applyOpenCodeRefresh(root,plan);
  expect(contributionHash(readFileSync(join(root,plugin.relativePath)))).toBe(contributionHash(plugin.content));
  for(const id of ['deck-quality','deck-investigate']) expect(()=>prepareOpenCodeNativeRole(root,id)).not.toThrow();
  expect(readFileSync(join(root,'opencode.json'),'utf8')).toContain('// foreign comment');
  const text=readFileSync(join(root,'opencode.json'),'utf8');
  expect(text).toContain('"foreign-secret-sentinel"'); expect(text).toContain('"foreign"');
  expect((result as any).backupPath).toBeString();
  const backup=readFileSync((result as any).backupPath,'utf8');
  expect(backup).not.toContain('foreign-secret-sentinel');
  expect(JSON.parse(backup).entries.some((e:any)=>Buffer.from(e.content,'base64').toString()==='untrusted code')).toBe(true);
  expect(planOpenCodeRefresh(root,files,native.agentEntries).writes).toHaveLength(0);
 } finally {rmSync(home,{recursive:true,force:true});}
});

// Protects generated roles in the global JSONC overlay, with foreign selectors preserved.
// Oracle: inventory supplement explicitly includes exact known role IDs; generic MCP is input.
test('refresh reconciles generated overlay roles and preserves foreign overlay bytes', () => {
 const home=realpathSync(mkdtempSync(join(tmpdir(),'opencode-overlay-'))),root=join(home,'opencode');
 try {
  mkdirSync(root,{recursive:true});
  const native=buildOpenCodeDeveloperTeamInstallPlan(home,{configDir:root});
  const path=join(root,'opencode.jsonc');
  const foreign='"mcp": {"serena": {"command": ["foreign"]}}, "agent": {"personal": {"prompt": "mine"},';
  writeFileSync(path,'// retain overlay\n{'+foreign+'"deck-quality": {"tools": {"bash": true}, "permission": {"bash": "allow"}, /* preserve comment */ "obsoleteOne": true, "obsoleteTwo": true}}}');
  const files=[{path:'opencode.json',content:'{}',kind:'other' as const},
   {path:native.executionPlugin!.relativePath,content:native.executionPlugin!.content,kind:'other' as const},
   {path:native.modelVariantsPlugin!.relativePath,content:native.modelVariantsPlugin!.content,kind:'other' as const},
   ...native.promptGenerationPlan.map(f=>({path:f.absolutePath.slice(root.length+1),content:f.content,kind:'prompt' as const}))];
  applyOpenCodeRefresh(root,planOpenCodeRefresh(root,files,native.agentEntries));
  expect(()=>prepareOpenCodeNativeRole(root,'deck-quality')).not.toThrow();
  const text=readFileSync(path,'utf8');expect(text).toContain('// retain overlay');expect(text).toContain(foreign);
  expect(text).toContain('/* preserve comment */');
  expect(planOpenCodeRefresh(root,files,native.agentEntries).writes).toHaveLength(0);
 }finally{rmSync(home,{recursive:true,force:true});}
});

// Protects whole shared bundles: a basename collision grants no authority over sibling resources.
test('foreign shared skill prevents bundle effects and produces blocking health while roles still refresh', async () => {
 const home=realpathSync(mkdtempSync(join(tmpdir(),'opencode-skill-collision-'))),root=join(home,'opencode');
 try {
  const {createOpenCodeRunnerAdapter}=await import('./runner-adapter');
  const {getDefaultDeckConfig}=await import('@deck/core');
  const skill=join(root,'skills','generic-helper','SKILL.md');mkdirSync(join(root,'skills','generic-helper'),{recursive:true});writeFileSync(skill,'personal skill');
  const adapter=createOpenCodeRunnerAdapter({developerTeamConfigDir:root});
  const plan=adapter.buildDeveloperTeamInstallPlan({projectRoot:home,environmentId:'opencode-development',deckConfig:getDefaultDeckConfig(),standaloneSkills:[{skillId:'generic-helper',body:'canonical skill',files:{'guide.md':'canonical resource'}}]});
  await adapter.applyDeveloperTeamInstall({projectRoot:home,environmentId:'opencode-development',plan});
  expect(readFileSync(skill,'utf8')).toBe('personal skill');
  expect(require('node:fs').existsSync(join(root,'skills/generic-helper/guide.md'))).toBe(false);
  expect(readFileSync(join(root,'prompts/deck-team/deck-quality.md'),'utf8').length).toBeGreaterThan(0);
  const verified=await adapter.verifyDeveloperTeamInstall(plan);
  expect(verified.valid).toBe(false);
  expect(verified.diagnostics.some(message=>message.includes('generic-helper'))).toBe(true);
 }finally{rmSync(home,{recursive:true,force:true});}
});

// Protects bounded recognition: an established shared bundle can regenerate its planned leaves,
// while extra user files and unrelated shared skills remain outside the inventory.
test('recognized shared skill bundle repairs edited leaves without adopting extra user files', () => {
 const home=realpathSync(mkdtempSync(join(tmpdir(),'opencode-skill-history-'))),root=join(home,'opencode');
 try {
  const desired=[{path:'skills/helper/SKILL.md',content:'canonical entry',kind:'standalone-skill' as const},{path:'skills/helper/guide.md',content:'canonical guide',kind:'standalone-skill' as const}];
  applyOpenCodeRefresh(root,planOpenCodeRefresh(root,desired,{}));
  writeFileSync(join(root,'skills/helper/SKILL.md'),'edited entry');writeFileSync(join(root,'skills/helper/guide.md'),'edited guide');writeFileSync(join(root,'skills/helper/personal'),'keep');
  const plan=planOpenCodeRefresh(root,desired,{});expect(plan.findings).toHaveLength(0);applyOpenCodeRefresh(root,plan);
  expect(readFileSync(join(root,'skills/helper/SKILL.md'),'utf8')).toBe('canonical entry');expect(readFileSync(join(root,'skills/helper/guide.md'),'utf8')).toBe('canonical guide');expect(readFileSync(join(root,'skills/helper/personal'),'utf8')).toBe('keep');
  expect(planOpenCodeRefresh(root,desired,{}).writes).toHaveLength(0);
 }finally{rmSync(home,{recursive:true,force:true});}
});

// Protects local plugin delivery and migration: Deck-owned code must never resolve from npm.
test('public install migrates the obsolete model package and repairs its local plugin', async () => {
 const home=realpathSync(mkdtempSync(join(tmpdir(),'opencode-local-plugin-'))), root=join(home,'opencode');
 try {
  const {createOpenCodeRunnerAdapter}=await import('./runner-adapter');
  const {getDefaultDeckConfig}=await import('@deck/core');
  const adapter=createOpenCodeRunnerAdapter({developerTeamConfigDir:root});
  mkdirSync(root,{recursive:true});
  writeFileSync(join(root,'opencode.json'),'// user comment\n{"plugin": ["personal-plugin", /* preserve */ "deck-model-variants", "opencode-mermaid-renderer"]}');
  const install=async()=>{const plan=adapter.buildDeveloperTeamInstallPlan({projectRoot:home,environmentId:'opencode-development',deckConfig:getDefaultDeckConfig(),standaloneSkills:[]}); await adapter.applyDeveloperTeamInstall({projectRoot:home,environmentId:'opencode-development',plan});return plan;};
  const plan=await install();
  const role=prepareOpenCodeNativeRole(root,'deck-investigate');
  // Oracle: pinned native {file:...} expansion trims surrounding prompt whitespace.
  expect(role.instructions).toBe(readFileSync(join(root,'prompts/deck-team/deck-investigate.md'),'utf8').trim());
  const plugin=plan.files.find(f=>f.path==='plugins/deck-model-variants.js');
  expect(plugin).toBeDefined();
  const text=readFileSync(join(root,'opencode.json'),'utf8');
  const {parseJsonc}=await import('./model-discovery-context');
  const config=parseJsonc(text) as any;
  expect(config.plugin).not.toContain('deck-model-variants');
  expect(config.plugin).toContain('personal-plugin');
  expect(config.plugin).toContain('opencode-mermaid-renderer');
  expect(text).toContain('/* preserve */');
  writeFileSync(join(root,plugin!.path),'edited local plugin');
  // Protects admission from executing altered Deck-owned variant code before repair.
  expect(()=>prepareOpenCodeNativeRole(root,'deck-investigate')).toThrow('plugin-untrusted');
  await install();
  expect(readFileSync(join(root,plugin!.path),'utf8')).toBe(plugin!.content);
  expect((await install()).mutationPreview).toHaveLength(0);
 }finally{rmSync(home,{recursive:true,force:true});}
});

// Protects the direct installer path: local plugins share apply, verification and rollback coverage.
test('direct installer delivers and verifies local variants without retaining the obsolete npm identity', () => {
 const home=realpathSync(mkdtempSync(join(tmpdir(),'opencode-direct-plugin-'))),root=join(home,'opencode');
 try {
  const {applyOpenCodeDeveloperTeamInstall,verifyOpenCodeDeveloperTeamInstall}=require('./developer-team-install');
  const plan=buildOpenCodeDeveloperTeamInstallPlan(home,{configDir:root});
  mkdirSync(root,{recursive:true});
  writeFileSync(join(root,'opencode.json'),JSON.stringify({plugin:['personal-plugin','deck-model-variants']}));
  applyOpenCodeDeveloperTeamInstall(plan,{configDir:root});
  expect(verifyOpenCodeDeveloperTeamInstall(plan).valid).toBe(true);
  const plugins=JSON.parse(readFileSync(join(root,'opencode.json'),'utf8')).plugin;
  expect(plugins).not.toContain('deck-model-variants');
  expect(plugins).toContain('personal-plugin');
  writeFileSync(plan.modelVariantsPlugin!.absolutePath,'altered');
  expect(verifyOpenCodeDeveloperTeamInstall(plan).valid).toBe(false);
  applyOpenCodeDeveloperTeamInstall(plan,{configDir:root});
  expect(verifyOpenCodeDeveloperTeamInstall(plan).valid).toBe(true);
 }finally{rmSync(home,{recursive:true,force:true});}
});
