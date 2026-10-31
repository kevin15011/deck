import { test, expect } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { acquireInstallationUse } from '../../core/src/installation-use';

import { createPiRunnerAdapter } from './runner-adapter';
import { getDefaultDeckConfig } from '@deck/core';
import { statSync } from 'node:fs';
// Protects no-op preparation: no lease writes or false contention with a live reader.
test('unchanged adapter preparation does not mutate or contend with installation readers', async()=>{
 const root=mkdtempSync(join(tmpdir(),'pi-noop-'));
 try {
  const files=new Map<string,string>();
  let writes=0;
  const piFileIO={
   exists:(path:string)=>files.has(path),readText:(path:string)=>files.get(path),
   writeText:(path:string,content:string)=>{writes++;files.set(path,content);},
   remove:(path:string)=>{writes++;files.delete(path);},removeDirIfEmpty:()=>{},
  };
  const adapter=createPiRunnerAdapter({piFileIO,homeDirectory:root,env:{HOME:root,XDG_CONFIG_HOME:root,PI_CODING_AGENT_DIR:root},piVersionProbe:()=>({exitCode:0,stdout:'1.0.0'})});
  const input={projectRoot:root,environmentId:'pi-development' as const,deckConfig:getDefaultDeckConfig()};
  let plan=adapter.buildDeveloperTeamInstallPlan(input);
  await adapter.applyDeveloperTeamInstall({...input,plan});
  plan=adapter.buildDeveloperTeamInstallPlan(input);
  expect(plan.mutationPreview).toHaveLength(0);
  const reader=acquireInstallationUse(root);
  try {
   const leaseDir=join(root,'deck/installation-use');
   const writesBefore=writes;
   const before=statSync(leaseDir,{bigint:true}).mtimeNs;
   expect((await adapter.applyDeveloperTeamInstall({...input,plan})).changedCount).toBe(0);
   expect(statSync(leaseDir,{bigint:true}).mtimeNs).toBe(before);
   expect(writes).toBe(writesBefore);
  }finally{reader.release();}
 }finally{rmSync(root,{recursive:true,force:true});}
});
