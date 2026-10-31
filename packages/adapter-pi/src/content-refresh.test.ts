import { test, expect } from 'bun:test';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { createNodePiFileIO, planPiGlobalInstall, applyPiGlobalPlan } from './pi-global-install';
import { createPiSessionDriver } from './session-driver/driver';

// Protects ownership: customization never becomes a receipt and never blocks unrelated healing.
test('preserves edited files without adoption while healing owned files, then writes nothing', () => {
 const root=mkdtempSync(join(tmpdir(),'pi-refresh-'));
 try {
  const io=createNodePiFileIO();
  const desired={agentDir:root, files:[{relPath:'deck/package/agents/deck-quality.md',content:'original'},{relPath:'deck/package/prompt.md',content:'old'}],packageEntry:undefined,skillExclusions:[],mcpServers:{},legacyDeckEvidence:false};
  applyPiGlobalPlan(planPiGlobalInstall(desired,io),io);
  writeFileSync(join(root,desired.files[0]!.relPath),'custom');
  desired.files[1]!.content='new';
  const plan=planPiGlobalInstall(desired,io);
  expect(plan.blocked).toBe(false);
  applyPiGlobalPlan(plan,io);
  expect(readFileSync(join(root,desired.files[0]!.relPath),'utf8')).toBe('custom');
  expect(readFileSync(join(root,desired.files[1]!.relPath),'utf8')).toBe('new');
  expect(JSON.parse(readFileSync(join(root,'deck/manifest.json'),'utf8')).files[desired.files[0]!.relPath]).toBeUndefined();
  expect(planPiGlobalInstall(desired,io).writes).toHaveLength(0);
 } finally {rmSync(root,{recursive:true,force:true});}
});
test('identical unreceipted executable is not adopted',()=>{
 const root=mkdtempSync(join(tmpdir(),'pi-unowned-'));
 try {
 const path=join(root,'deck/package/extensions/a.js');mkdirSync(dirname(path),{recursive:true});writeFileSync(path,'code');
 const io=createNodePiFileIO();
 applyPiGlobalPlan(planPiGlobalInstall({agentDir:root,files:[{relPath:'deck/package/extensions/a.js',content:'code'}],packageEntry:undefined,skillExclusions:[],mcpServers:{},legacyDeckEvidence:false},io),io);
 expect(JSON.parse(readFileSync(join(root,'deck/manifest.json'),'utf8')).files['deck/package/extensions/a.js']).toBeUndefined();
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('cross Setup admits newer Pi and refuses below minimum',async()=>{
 for(const [version,status] of [['1.1.0','degraded'],['0.9.0','blocked']] as const) {
 const driver=createPiSessionDriver({exec:async()=>version!});
 expect((await driver.probe({cwd:'/tmp'})).status).toBe(status);
 }
});

import { buildPiGlobalMaterialization } from './global-materialization';
import { verifyPiInstallation } from './installation-trust';
import { acquireInstallationUse, withInstallationMutation } from '../../core/src/installation-use';
import { runPiModelDiscovery } from './model-discovery-command';
// Protects the executable boundary and the actual role allowlist, including safe narrowing.
test('trust rejects edited and unreceipted extensions but permits narrowed roles',()=>{
 const root=mkdtempSync(join(tmpdir(),'pi-trust-'));
 try {
  const materialization=buildPiGlobalMaterialization({agentDir:root,projectRoot:root,legacyDeckEvidence:false});
  const io=createNodePiFileIO();
  const desired={...materialization.desired,files:materialization.desired.files.filter(f=>!f.relPath.includes("/skills/"))};
  applyPiGlobalPlan(planPiGlobalInstall(desired,io),io);
  verifyPiInstallation(root);
  const role=join(root,'deck/package/agents/deck-quality.md');
  const original=readFileSync(role,'utf8');writeFileSync(role,original.replace(/^tools:.*$/m,'tools: read'));
  verifyPiInstallation(root);
  writeFileSync(role,original.replace(/^tools:.*$/m,'tools: bash'));
  expect(()=>verifyPiInstallation(root)).toThrow(/deck-quality.*bash/);
  writeFileSync(role,original);
  const extension=join(root,'deck/package/extensions/deck-memory/impl.js');
  writeFileSync(extension,readFileSync(extension,'utf8')+'\n// edit');
  expect(()=>verifyPiInstallation(root)).toThrow(/edited or unreceipted/);
 } finally {rmSync(root,{recursive:true,force:true});}
});
test('inventory suppresses extensions and reserves the effective overridden root',async()=>{
 const root=mkdtempSync(join(tmpdir(),'pi-inventory-'));
 try {
  let mutation:Promise<unknown>|undefined;
  runPiModelDiscovery('pi',['--list-models'],(_command,args)=>{
    expect(args).toContain('--no-extensions');
    mutation=withInstallationMutation(root,async()=>{});
    void mutation.catch(()=>{});
  },{HOME:root,XDG_CONFIG_HOME:join(root,'xdg'),PI_CODING_AGENT_DIR:root});
  await expect(mutation).rejects.toThrow(/deferred/);
  await withInstallationMutation(root,async()=>{});
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('JSON formatting does not rewrite owned configuration',()=>{
 const root=mkdtempSync(join(tmpdir(),'pi-semantic-'));
 try {
  const io=createNodePiFileIO();
  const desired={agentDir:root,files:[{relPath:'deck/package/config.json',content:'{"a":1,"b":2}'}],packageEntry:undefined,skillExclusions:[],mcpServers:{},legacyDeckEvidence:false};
  applyPiGlobalPlan(planPiGlobalInstall(desired,io),io);
  const path=join(root,desired.files[0]!.relPath);writeFileSync(path,'{ "b": 2, "a": 1 }');
  const plan=planPiGlobalInstall(desired,io);
  expect(plan.writes.some(w=>w.path===path)).toBe(false);
  applyPiGlobalPlan(plan,io);
  expect(planPiGlobalInstall(desired,io).writes).toHaveLength(0);
 }finally{rmSync(root,{recursive:true,force:true});}
});

