import { expect, test } from 'bun:test';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getDefaultDeckConfig, type RunnerAdapter } from '@deck/core';
import { createCodexRunnerAdapter } from '../../../packages/adapter-codex/src/runner-adapter';
import { createOpenCodeRunnerAdapter } from '../../../packages/adapter-opencode/src/runner-adapter';
import { createClaudeRunnerAdapter } from '../../../packages/adapter-claude/src/runner-adapter';
import { createPiRunnerAdapter } from '../../../packages/adapter-pi/src/runner-adapter';
// Oracle: mixed installations have separate ownership and all admit after install and no-op repeat.
// Native processes and external providers are deliberately absent; this is a filesystem contract.
test('four runners install, admit and repeat without cross-runner ownership drift', async () => {
 const home=realpathSync(mkdtempSync(join(tmpdir(),'deck-lifecycle-')));
 const config=getDefaultDeckConfig();
 try {
  const adapters: RunnerAdapter[] = [
   createCodexRunnerAdapter({userHome:home,codexHome:join(home,'codex'),journalRoot:join(home,'journals'),tools:{homeDir:home,dataRoot:join(home,'deck'),nodeCommand:process.execPath,verifyNodeRuntime:()=>true,resolveCommand:()=>undefined}}),
   createOpenCodeRunnerAdapter({developerTeamConfigDir:join(home,'opencode'),skillDiscoveryHomeDir:home}),
   createClaudeRunnerAdapter({homeDir:home,dataRoot:join(home,'deck')}),
   createPiRunnerAdapter({homeDirectory:home,env:{HOME:home,PI_CODING_AGENT_DIR:join(home,'pi')},piVersionProbe:()=>({exitCode:0,stdout:'1.0.0'})}),
  ];
  for (const adapter of adapters) {
   const input={projectRoot:home,environmentId:`${adapter.runnerId}-development` as never,deckConfig:config,standaloneSkills:[]};
   const plan=adapter.buildDeveloperTeamInstallPlan(input);
   expect(plan.blocked).not.toBe(true);
   await adapter.applyDeveloperTeamInstall({...input,plan});
   const verified=await adapter.verifyDeveloperTeamInstall(plan);
   expect(verified.valid).toBe(true);
   expect((await adapter.evaluateSessionAdmission?.({config}))?.verdict).not.toBe('blocked');
   const repeat=adapter.buildDeveloperTeamInstallPlan(input);
   const result=await adapter.applyDeveloperTeamInstall({...input,plan:repeat});
   expect(result.changedCount).toBe(0);
   expect((await adapter.verifyDeveloperTeamInstall(repeat)).valid).toBe(true);
  }
  for(const adapter of adapters) expect((await adapter.evaluateSessionAdmission?.({config}))?.verdict).not.toBe('blocked');
 } finally {rmSync(home,{recursive:true,force:true});}
},20000);
