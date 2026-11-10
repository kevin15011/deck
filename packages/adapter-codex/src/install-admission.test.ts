import { expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { getDefaultDeckConfig } from '@deck/core';
import { createCodexRunnerAdapter } from './runner-adapter';
// Oracle: established managed hook selectors regenerate canonically; admission refuses drift before repair.
test('install verification agrees with admission after managed hook repair', async () => {
 const home = realpathSync(mkdtempSync(join(tmpdir(), 'deck-install-admission-')));
 try {
  const adapter = createCodexRunnerAdapter({ userHome: home, codexHome: join(home, '.codex'), journalRoot: join(home, 'journals'), tools: { homeDir:home, dataRoot:join(home,'deck'), resolveCommand:()=>undefined, nodeCommand:process.execPath, verifyNodeRuntime:()=>true } });
  const input = { projectRoot: home, environmentId:'codex-development' as const, deckConfig:getDefaultDeckConfig() };
  const materialize = (plan: ReturnType<typeof adapter.buildDeveloperTeamInstallPlan>) => { for(const file of plan.files) {const path=join(home,file.path); mkdirSync(dirname(path),{recursive:true,mode:0o700});writeFileSync(path,file.content,{mode:0o644});} };
  materialize(adapter.buildDeveloperTeamInstallPlan(input));
  const path=join(home,'.codex/config.toml');
  const canonical = readFileSync(path, 'utf8');
  writeFileSync(path,readFileSync(path,'utf8').replace('developer-team-execution.js','custom-command.js'));
  expect((await adapter.evaluateSessionAdmission!({config:input.deckConfig})).verdict).toBe('blocked');
  const plan=adapter.buildDeveloperTeamInstallPlan(input);
  materialize(plan);
  const verified=await adapter.verifyDeveloperTeamInstall(plan);
  expect(readFileSync(path, 'utf8')).toBe(canonical);
  expect(verified.valid).toBe(true);
  expect(verified.admission?.verdict).not.toBe('blocked');
  expect(await adapter.evaluateSessionAdmission!({config:input.deckConfig})).toEqual(verified.admission!);
 } finally {rmSync(home,{recursive:true,force:true});}
});

import { withRunnerFence, readRunnerFence, recoverRunnerFence } from '@deck/core';
// Oracle: restart recovery proves actual adapter journal postimages, never just an admission success.
test('pending fence recovers a completed installation from its exact existing transaction journals', async () => {
 const home=realpathSync(mkdtempSync(join(tmpdir(), 'deck-journal-fence-')));
 try {
  const adapter=createCodexRunnerAdapter({userHome:home,codexHome:join(home,'codex'),journalRoot:join(home,'journals'),tools:{homeDir:home,dataRoot:join(home,'deck'),nodeCommand:process.execPath,verifyNodeRuntime:()=>true,resolveCommand:()=>undefined}});
  const input={projectRoot:home,environmentId:'codex-development' as const,deckConfig:getDefaultDeckConfig(),standaloneSkills:[]};
  // Both native scopes retain real journaled repairs; unrelated content is
  // already present so this proof does not benchmark a full first installation.
  const files = adapter.buildDeveloperTeamInstallPlan(input).files;
  const missing = new Set([files.find(file => file.kind === 'agent')?.path, files.find(file => file.kind === 'skill')?.path]);
  for (const file of files) {
   if (missing.has(file.path)) continue;
   const target = join(home, file.path); mkdirSync(dirname(target), {recursive: true}); writeFileSync(target, file.content, {mode: 0o644});
  }
  const plan=adapter.buildDeveloperTeamInstallPlan(input),path=join(home,'state','fence.json');
  await expect(withRunnerFence({path,self:{semver:'1.0.0',commit:'abc',channel:'stable'},stateSchema:1,effect:async()=>{await adapter.applyDeveloperTeamInstall({...input,plan});throw Error('crash-before-fence-promotion');},changed:()=>true})).rejects.toThrow('crash-before-fence-promotion');
  expect(readRunnerFence(path)).toMatchObject({epoch:0,pending:{epoch:1}});
  expect(await recoverRunnerFence(path,pending=>adapter.recoverPendingMutation!(pending.journals!))).toBe(true);
  expect(readRunnerFence(path)).toMatchObject({epoch:1});
  expect((await adapter.evaluateSessionAdmission!()).verdict).not.toBe('blocked');
 }finally{rmSync(home,{recursive:true,force:true});}
},15000);
