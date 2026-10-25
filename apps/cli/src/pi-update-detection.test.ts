import {test,expect} from 'bun:test';
import {mkdtempSync,mkdirSync,writeFileSync,symlinkSync,unlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createPiRunnerAdapter} from '../../../packages/adapter-pi/src/runner-adapter';
import {contributionHash} from '@deck/core';
test('Pi update detection uses actual legacy manifest hashes and rejects symlink ownership',async()=>{
 const home=mkdtempSync(join(tmpdir(),'nrp-pi-detect-')),root=join(home,'pi');mkdirSync(join(root,'deck'),{recursive:true});
 const manifest=join(root,'deck/manifest.json'),path=join(root,'deck/agent.md');writeFileSync(path,'old published content');
 writeFileSync(manifest,JSON.stringify({schema:'deck-pi-manifest-v1',files:{'deck/agent.md':contributionHash('old published content')},settings:{packages:[],addedPackages:[],skillExclusions:[]},mcp:{servers:{}}}));
 const adapter=createPiRunnerAdapter({homeDirectory:home,env:{HOME:home,PI_CODING_AGENT_DIR:root}});
 expect((await adapter.detectDeckInstall!({projectRoot:home})).installed).toBe(true);
 writeFileSync(path,'user edit');expect((await adapter.detectDeckInstall!({projectRoot:home})).installed).toBe(false);
 const external=join(home,'user-owned');writeFileSync(external,'old published content');unlinkSync(path);symlinkSync(external,path);expect((await adapter.detectDeckInstall!({projectRoot:home})).installed).toBe(false);
});
