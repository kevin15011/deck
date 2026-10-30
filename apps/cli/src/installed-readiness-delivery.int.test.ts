// Protects install -> native discovery -> lifecycle -> model input composition.
// Oracle: host readiness reaches each runner with memory disabled; stale evidence never does.
import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { getDefaultDeckConfig } from '@deck/core';
import { startNativeProjectReadiness } from './native-project-readiness';

test.each(['codex', 'opencode', 'pi'] as const)('installed %s discovery delivers readiness to model input', async runnerId => {
  const root = mkdtempSync(join(tmpdir(), 'deck-installed-readiness-'));
  const config = getDefaultDeckConfig(); config.adaptiveMemory.enabled = false; config.capabilities!['codebase-memory'].enabled = false;
  const owner = await startNativeProjectReadiness({ projectRoot: root, runnerId, generation: 'installed', config: () => config });
  try {
    let script: string;
    if (runnerId === 'codex') {
      const { buildCodexDeveloperTeamInstallPlan } = await import('../../../packages/adapter-codex/src/developer-team-install');
      const plan = buildCodexDeveloperTeamInstallPlan({projectRoot: root, existingFiles: new Map()});
      expect(plan.blocked).toBe(false);
      for (const file of plan.expectedFiles) { const path = join(root,file.relativePath); mkdirSync(dirname(path),{recursive:true}); writeFileSync(path,file.content); }
      script = `
        const config = Bun.TOML.parse(await Bun.file(${JSON.stringify(join(root,'.codex/config.toml'))}).text());
        const hooks = config.hooks.SessionStart.flatMap(group => group.hooks);
        const hook = hooks.find(hook => hook.command.includes('developer-team-execution.js'));
        if (!hook) throw new Error('Readiness not installed');
        const child = Bun.spawn(['/bin/sh','-c',hook.command], {env:process.env, stdin:Buffer.from(JSON.stringify({session_id:'native',cwd:process.cwd(),hook_event_name:'SessionStart'})),stdout:'pipe',stderr:'inherit'});
        const output = JSON.parse(await new Response(child.stdout).text());
        if (await child.exited) throw new Error('Hook failed');
        console.log(output.hookSpecificOutput?.additionalContext ?? '');`;
    } else if (runnerId === 'opencode') {
      const { createOpenCodeRunnerAdapter } = await import('../../../packages/adapter-opencode/src/runner-adapter');
      const adapter = createOpenCodeRunnerAdapter({developerTeamConfigDir:root});
      const plan = adapter.buildDeveloperTeamInstallPlan!({environmentId:'opencode-development',projectRoot:root,deckConfig:config});
      await adapter.applyDeveloperTeamInstall!({environmentId:'opencode-development',projectRoot:root,plan});
      script = `
        import { readdirSync } from 'node:fs';
        import { pathToFileURL } from 'node:url';
        const system = [];
        // OpenCode auto-discovers plugin files in its configured plugins directory.
        for (const name of readdirSync('./plugins').filter(name=>name.endsWith('.js'))) {
          const module = await import(pathToFileURL(process.cwd()+'/plugins/'+name).href);
          const hooks = await module.default({directory:process.cwd()});
          await hooks['experimental.chat.system.transform']?.({}, {system});
        }
        console.log(system.join('\\n'));`;
    } else {
      const { buildPiGlobalMaterialization } = await import('../../../packages/adapter-pi/src/global-materialization');
      const { createNodePiFileIO, planPiGlobalInstall, applyPiGlobalPlan } = await import('../../../packages/adapter-pi/src/pi-global-install');
      const io = createNodePiFileIO();
      applyPiGlobalPlan(planPiGlobalInstall(buildPiGlobalMaterialization({agentDir:root,projectRoot:root,legacyDeckEvidence:false}).desired,io),io);
      script = `
        import { readFileSync, readdirSync } from 'node:fs';
        import { resolve, join } from 'node:path';
        import { pathToFileURL } from 'node:url';
        const settings = JSON.parse(readFileSync('settings.json','utf8'));
        const handlers = {};
        const pi = {on(name, fn){(handlers[name]??=[]).push(fn);}};
        for (const entry of settings.packages) {
          const root = resolve(typeof entry === 'string' ? entry : entry.source);
          const manifest = JSON.parse(readFileSync(join(root,'package.json'),'utf8'));
          for (const directory of manifest.pi.extensions) for (const name of readdirSync(join(root,directory))) {
            // Exercise the installed readiness guard entry, not its implementation factory.
            if (name !== 'developer-team-execution') continue;
            await (await import(pathToFileURL(join(root,directory,name,'index.js')).href)).default(pi);
          }
        }
        for (const handler of handlers.session_start??[]) await handler({}, {cwd:process.cwd()});
        let systemPrompt = 'base';
        for (const handler of handlers.before_agent_start??[]) systemPrompt = (await handler({systemPrompt}, {}))?.systemPrompt ?? systemPrompt;
        console.log(systemPrompt);`;
    }
    for (const stale of [false, true]) {
      const env = {...process.env,...owner.environment,DECK_PI_SESSION:'1',DECK_PI_ROLE:'lead',DECK_PI_CHILD:'0', ...(stale ? {DECK_SESSION_START_EPOCH:'stale'} : {})};
      const child = Bun.spawn([process.execPath,'--eval',script],{cwd:root,env,stdout:'pipe',stderr:'pipe'});
      const [stdout, stderr, exit] = await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);
      expect({exit, stderr:stderr.replaceAll('deck-preparation: session-start-context-unverified\n','')}).toEqual({exit:0,stderr:''});
      if (stale) expect(stdout).not.toContain('config-missing');
      else expect(stdout).toContain('config-missing');
    }
  } finally { owner.close(); rmSync(root,{recursive:true,force:true}); }
}, 20000);
