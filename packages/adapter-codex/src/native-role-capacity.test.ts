import { tmpdir } from 'node:os';
import { expect, test } from 'bun:test';
import { mkdtempSync, realpathSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { getDefaultDeckConfig } from '@deck/core';
import { createCodexRunnerAdapter } from './runner-adapter';
import { prepareCodexNativeRole } from './native-role';
// A catalog's receipt volume must not prevent authenticating its small role file.
// Size relaxation applies only to the bounded manifest; role drift stays guarded.
test('native admission authenticates a full catalog manifest above 1 MiB', () => {
 const home=realpathSync(mkdtempSync(join(tmpdir(),'codex-role-capacity-'))),root=join(home,'.codex');
 try {
  const adapter=createCodexRunnerAdapter({userHome:home,codexHome:root,tools:{homeDir:home,dataRoot:join(home,'deck'),nodeCommand:process.execPath,verifyNodeRuntime:()=>true,resolveCommand:()=>undefined}});
  const plan=adapter.buildDeveloperTeamInstallPlan({projectRoot:home,environmentId:'codex-development',deckConfig:getDefaultDeckConfig()});
  for(const file of plan.files){const path=join(home,file.path);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,file.content,{mode:0o600});}
  const path=join(root,'deck/manifest.json'),manifest=JSON.parse(readFileSync(path,'utf8'));
  manifest.catalogAnnotation='x'.repeat(1100000);writeFileSync(path,JSON.stringify(manifest));
  expect(prepareCodexNativeRole(root,'deck-quality').roleId).toBe('deck-quality');
  writeFileSync(join(root,'agents/deck-quality.toml'),'x'.repeat(1100000));
  expect(()=>prepareCodexNativeRole(root,'deck-quality')).toThrow('codex-session-generation-unverified');
 }finally{rmSync(home,{recursive:true,force:true});}
});
