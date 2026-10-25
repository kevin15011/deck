/** Execute verified release source in a marked isolated HOME, including real package effects. */
import { join, resolve } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { assertFixtureHome, materializedFixturePath, remapPublishedPiNativePlan, capturePublishedOpenCodeFiles } from './retirement-matrix-fixture';
import { historicalSerenaEffects, historicalOpenCodeRtk, fixtureSharedRtk, fixtureSharedContextMode, fixtureSharedCodebase, historicalOpenCodeCodebase, runHistoricalCommand, upstreamPins } from './retirement-historical-effects';
const [source, runner, home] = process.argv.slice(2) as [string, string, string];
if (!source || !runner || resolve(home) !== process.env.HOME) throw Error('isolated HOME required');
assertFixtureHome(home);
const resumeCapture=process.argv.includes('--resume-capture');
const resumeSelected=process.argv.includes('--resume-selected');
if(resumeCapture&&(runner!=='pi'||process.argv.includes('--selected-variants')||existsSync(join(home,'historical-installation.json'))))throw Error('Capture continuation is limited to an unfinished base Pi capture');
if(resumeSelected&&(resumeCapture||runner!=='codex'||!process.argv.includes('--selected-variants')||existsSync(join(home,'historical-installation.json'))))throw Error('Selected continuation is limited to an unfinished Codex selected installation');
const previousCapture=resumeCapture||resumeSelected?JSON.parse(readFileSync(join(home,'historical-selected-effects.json'),'utf8')):undefined;
if(resumeSelected){
 const previous=readFileSync(join(home,'historical-selected-effects.json'));
 writeFileSync(join(home,`historical-selected-effects-${createHash('sha256').update(previous).digest('hex')}.json`),previous,{flag:'wx'});
}
const core = await import(join(source, 'packages/core/src/index.ts'));
const roots = { codex: join(home, '.codex'), pi: join(home, '.pi/agent'), opencode: join(home, '.config/opencode'), data: join(home, '.local/share/deck') };
// Legacy installers assumed the native runner had already created its config root.
if (runner === 'opencode') mkdirSync(roots.opencode, { recursive: true });
const effects: any[] = previousCapture?.effects??[];
const gaps: string[] = previousCapture?.gaps??[];
const selectedVariants = process.argv.includes('--selected-variants');
const selected = ['context-mode', 'rtk', ...(selectedVariants ? ['serena', 'codebase-memory'] : [])];
const operation = { runner, operationId: 'explicit-isolated-fixture-selected-install', explicitlySelected: true };
const authorization = { kind: 'interactive-tui-explicit-selection', runner, operationId: operation.operationId };
let serenaEffects: any;
if (selectedVariants) {
  try { serenaEffects = await historicalSerenaEffects(core, home); }
  catch (error) { gaps.push(`Selected Serena prerequisite: ${(error as Error).message}`); }
}
process.env.PATH = `${join(home, 'npm/bin')}:${process.env.PATH}`;
const piContextKind = runner === 'pi' ? (await import(join(source, 'packages/adapter-pi/src/installation-plan.ts'))).PI_INSTALLABLE_TOOLS.find((tool: any) => tool.id === 'context-mode')?.installKind : undefined;
let sharedCodebase:any;
if(selectedVariants&&runner==='pi'&&!existsSync(join(source,'packages/adapter-pi/src/pi-owned-tools.ts'))){
 const catalog=await import(join(source,'packages/adapter-pi/src/installation-plan.ts'));
 if(catalog.PI_INSTALLABLE_TOOLS.find((tool:any)=>tool.id==='codebase-memory-mcp')?.installKind?.startsWith('shared-binary')){
  sharedCodebase=await fixtureSharedCodebase(home);effects.push(sharedCodebase);
 }
}
if (!resumeCapture&&runner === 'pi' && !existsSync(join(source, 'packages/adapter-pi/src/pi-owned-tools.ts'))) effects.push(await fixtureSharedRtk(home));
if (!resumeCapture&&runner === 'pi' && piContextKind?.startsWith('shared-binary')) {
  // Pi's historical path reuses an operator-provided shared binary. Provision a
  // real, pinned shared prerequisite and label it separately from Deck effects.
  const installed = spawnSync('npm', ['install', '-g', '--ignore-scripts', '--no-audit', '--no-fund', 'context-mode@1.0.169'], { cwd: home, env: process.env, encoding: 'utf8', timeout: 120000 });
  if (installed.status !== 0) throw Error('pinned fixture shared prerequisite failed');
  effects.push({ capability: 'context-mode', method: 'fixture-provisioned-shared-prerequisite', package: 'context-mode@1.0.169', historicalDeckInstallEffect: false });
}
const adapterPath = join(source, `packages/adapter-${runner}/src/runner-adapter.ts`);
const config = core.getDefaultDeckConfig?.() ?? {};
config.adaptiveMemory = { enabled: false, activeProvider: 'none' };
config.webSearch = { enabled: false };
const capabilityInstructions = runner === 'claude' ? undefined : core.buildCapabilityInstructionBundle?.(selected);
let plan: any, result: any, verified: any, files: any[], adapter: any, verificationCorrection: any;
if(resumeSelected){
 const tools=(await import(join(source,'packages/adapter-codex/src/tools.ts'))).createCodexTools({homeDir:home,dataRoot:roots.data});
 if(!effects.some(effect=>effect.capability==='context-mode'&&effect.outcome?.status==='executed')||!tools.contextMode.command()||tools.rtk.state()!=='ready')throw Error('Previously successful historical prerequisites no longer verify');
 const observed=effects.find(effect=>effect.method==='observed-historical-artifact'&&effect.capability==='codebase-memory');
 if(!observed)throw Error('No successful selected native artifact to continue');
 assertFixtureHome(home,observed.path);
 if(createHash('sha256').update(readFileSync(observed.path)).digest('hex')!==observed.sha256)throw Error('Previously successful selected native artifact changed');
}
if (existsSync(adapterPath)) {
  const module = await import(adapterPath);
  const factory = module[`create${runner === 'opencode' ? 'OpenCode' : runner[0]!.toUpperCase() + runner.slice(1)}RunnerAdapter`];
  if (typeof factory !== 'function') throw Error('historical installer factory unavailable');
  const options = runner === 'codex' ? { userHome: home, codexHome: roots.codex, tools: { homeDir: home, dataRoot: roots.data } }
    : runner === 'claude' ? { homeDir: home, dataRoot: roots.data }
    : runner === 'opencode' ? { developerTeamConfigDir: roots.opencode }
    : { homeDirectory: home, env: process.env, piVersionProbe: () => ({ exitCode: 0, stdout: '1.0.0' }) };
  const openCodeInstaller=runner==='opencode'?await import(join(source,'packages/adapter-opencode/src/install-tools.ts')):undefined;
  adapter = factory({ ...options, ...(serenaEffects ? { serenaEffects, serenaBootstrapEffects: serenaEffects,
    serenaOwnedRoot:join(roots.data,'tools/serena'),serenaRevalidator:core.createSerenaReadinessRevalidator?.(join(roots.data,'tools/serena'),serenaEffects) } : {}),
    ...(openCodeInstaller?{installTools:(command:string,tools:any[],onResult:any,run:any,installOptions:any)=>tools.some(tool=>tool.id==='codebase-memory'&&tool.installKind==='shell-script')
      ?historicalOpenCodeCodebase(openCodeInstaller,home,command,tools,onResult,run,installOptions)
      :openCodeInstaller.installOpenCodeTools(command,tools,onResult,run,installOptions)}:{}),
    serenaProxyCommand: process.env.NRP_HISTORICAL_DECK_PROXY
      ? [process.env.NRP_HISTORICAL_DECK_PROXY, 'internal', 'serena-mcp']
      : [process.execPath, 'run', join(source, 'apps/cli/src/main.tsx'), 'internal', 'serena-mcp'] });
  if ((runner === 'codex' || runner === 'claude')&&!resumeSelected) {
    for (const id of ['context-mode', 'rtk']) {
      const action = { id: `historical.${id}`, kind: `install-${runner}-${id === 'context-mode' ? 'tool' : 'rtk'}`, capabilityId: id };
      const outcome = await adapter.runAction(action, { projectRoot: home, deckConfig: config });
      effects.push({ capability: id, method: 'historical-adapter-runAction', action, outcome });
      if(runner==='codex'&&outcome.status==='informational'&&outcome.message==='Codex project effects are applied through the confirmed Developer Team plan.'){
        // The project-format epoch did not acquire these tools. Provision real
        // manual prerequisites separately, then run its actual content/config apply.
        effects.push(id==='rtk'?await fixtureSharedRtk(home):await fixtureSharedContextMode(home));
      }else if (outcome.status !== 'executed') throw Error(`historical ${id} package installation failed: ${outcome.message}`);
    }
  } else if (runner === 'pi'&&!resumeCapture) {
    const toolPath = join(source, 'packages/adapter-pi/src/pi-owned-tools.ts');
    if (existsSync(toolPath)) {
      const tools = (await import(toolPath)).createPiTools({ homeDir: home, env: process.env, dataRoot: roots.data });
      effects.push({ capability: 'rtk', method: 'historical-owned-installer', outcome: await tools.rtk.install() });
    }
    const installer = await import(join(source, 'packages/adapter-pi/src/install-tools.ts'));
    const catalog = await import(join(source, 'packages/adapter-pi/src/installation-plan.ts'));
    const tool = catalog.PI_INSTALLABLE_TOOLS.find((tool: any) => tool.id === 'context-mode');
    if (!tool) throw Error('historical Pi Context Mode selection missing');
    const outcome = tool.installKind === 'pi-package'
      ? process.env.NRP_NATIVE_PI ? await installer.installPiTools(process.env.NRP_NATIVE_PI, [{ ...tool, source: `npm:${upstreamPins.contextMode}` }], () => {}, runHistoricalCommand)
        : [{ success: false, status: 'incomplete', reason: 'Pinned native Pi CLI not provisioned' }]
      : await installer.installPiTools(process.execPath, [tool], () => {});
    effects.push({ capability: 'context-mode', method: 'historical-shared-binary-reuse', outcome });
    if (outcome.length !== 1 || !outcome[0].success) gaps.push('Historical Pi Context Mode installer did not complete');
    if(tool.installKind?.startsWith('shared-binary')&&outcome[0]?.success){
      const action={id:'historical.context-mode.configure',kind:'write-pi-mcp-config',capabilityId:'context-mode',source:tool.source};
      const configured=await adapter.runAction(action,{runnerId:'pi',projectRoot:home,deckConfig:config});
      effects.push({capability:'context-mode',method:'historical-native-config-action',action,outcome:configured});
      if(configured.status!=='executed')gaps.push('Historical Pi native MCP configuration did not complete');
    }
  }
  if (selectedVariants) {
    const context = { runnerId: runner, projectRoot: home, deckConfig: config, currentOperation: operation, operation,
      operationId: operation.operationId, serenaAuthorization: authorization, runnerCommand: process.env.NRP_NATIVE_PI };
    for (const id of ['codebase-memory', 'serena']) {
      if(resumeSelected&&id==='codebase-memory')continue;
      try {
        const kind = runner === 'pi' ? 'install-pi-package' : runner === 'opencode' ? 'install-opencode-plugin'
          : id === 'serena' ? 'install-serena' : `install-${runner}-codebase`;
        const toolId = id === 'codebase-memory' && runner === 'pi' ? 'codebase-memory-mcp' : id;
        const catalog=runner==='pi'?await import(join(source,'packages/adapter-pi/src/installation-plan.ts')):undefined;
        const capabilityId=catalog?.PI_INSTALLABLE_TOOLS.find((tool:any)=>tool.id===toolId)?.capabilityId??id;
        // Before v0.2.5 the facade calls its imported installer directly and cannot
        // accept the pinning callback. Use the same published plan/installer with
        // its original command seam; configuration still uses the original action.
        const legacyGlobal=runner==='opencode'&&id==='codebase-memory'&&!readFileSync(adapterPath,'utf8').includes('this.#installTools = options?.installTools ?? installOpenCodeTools;');
        let outcome:any;
        if(legacyGlobal){
          const published=await import(join(source,'packages/adapter-opencode/src/installation-plan.ts'));
          const nativePlan=published.buildOpenCodeInstallationPlan({tools:[],selectedToolIds:[toolId]});
          if(nativePlan.length!==1||nativePlan[0].installKind!=='shell-script')throw Error('Legacy Codebase selected installer mapping unsupported');
          const results=await historicalOpenCodeCodebase(openCodeInstaller,home,process.env.NRP_NATIVE_OPENCODE!,nativePlan,()=>{},runHistoricalCommand);
          effects.push({capability:id,method:'original-published-plan-and-installer-command-seam',outcomes:results,scope:'Facade-equivalent isolated selection; no user tool discovery or source rewriting'});
          outcome={status:results.length===1&&results[0].success?'executed':'failed'};
        }else outcome=await adapter.runAction({ id: `fixture.selected.${id}`, kind, capabilityId, toolId,
          title: `Explicit fixture selection ${id}`, source: id === 'serena' ? 'serena-agent' : 'DeusData/codebase-memory-mcp' }, context);
        effects.push({ capability: id, method: 'historical-selected-adapter-action', upstreamPin: id === 'serena' ? upstreamPins.serena : 'historical-native-release', outcome });
        if (outcome.status !== 'executed') gaps.push(`Selected ${id} installation did not complete`);
        else if(resumeSelected&&id==='serena'){
          for(let index=gaps.length-1;index>=0;index--)if(gaps[index]==='Selected serena installation did not complete')gaps.splice(index,1);
        }
        else if(id==='codebase-memory'){
          const globalInput=join(home,'historical-global-codebase-input.json');
          const global=runner==='opencode'&&existsSync(globalInput)?JSON.parse(readFileSync(globalInput,'utf8')):undefined;
          const path=sharedCodebase?.path??(global?join(home,'.local/bin/codebase-memory-mcp'):join(roots.data,runner,'tools',`codebase-native-v${core.OWNED_CODEBASE_VERSION}`,`${process.platform}-${process.arch}`,'codebase-memory-mcp'));
          assertFixtureHome(home,path);
          if(!existsSync(path))gaps.push('Selected Codebase Memory native artifact was not observed');
          else{
            const sha256=createHash('sha256').update(readFileSync(path)).digest('hex');
            if((global?.release?.binarySha256??sharedCodebase?.sha256)&&sha256!==(global?.release?.binarySha256??sharedCodebase?.sha256))throw Error('Pinned historical shared Codebase binary identity changed');
            effects.push({capability:id,method:'observed-historical-artifact',path,sha256,retireWhenDisabled:!global&&!sharedCodebase,
              ...(global||sharedCodebase?{preserveWhenDisabled:true,ownership:'external legacy/shared artifact without a Deck receipt',...(sharedCodebase?{exposedAs:sharedCodebase.exposedAs}:{}),upstream:global??sharedCodebase}:{})});
          }
        }
        if (outcome.status === 'executed'&&(runner === 'pi' || runner === 'opencode')) {
          const configured = await adapter.runAction({ id: `fixture.selected.${id}.config`, kind: runner === 'pi' ? 'write-pi-mcp-config' : 'write-mcp-config', capabilityId, toolId, source: id }, context);
          effects.push({ capability: id, method: 'historical-selected-config-action', outcome: configured });
          if (configured.status !== 'executed') gaps.push(`Selected ${id} configuration did not complete`);
        }
      } catch (error) { gaps.push(`Selected ${id}: ${(error as Error).message}`); }
    }
  }
  writeFileSync(join(home, 'historical-selected-effects.json'), JSON.stringify({ selected, effects, gaps }, null, 2));
  const input = { projectRoot: home, environmentId: `${runner}-development`, deckConfig: config,
    capabilityIds: selected, ...(capabilityInstructions ? { capabilityInstructions } : {}) };
  plan = adapter.buildDeveloperTeamInstallPlan(input);
  if (plan.blocked) throw Error('historical content plan blocked: ' + JSON.stringify(plan.diagnostics));
  files = plan.files;
  for (const file of files) assertFixtureHome(home, resolve(home, file.path));
  if(resumeCapture){
    if(!effects.some(effect=>effect.capability==='context-mode'&&Array.isArray(effect.outcome)&&effect.outcome.some((outcome:any)=>outcome.success===true)))throw Error('No successful original Pi acquisition evidence to resume');
    for(const file of files!){
      if(readFileSync(materializedFixturePath(home,runner,file.path),'utf8')!==file.content)throw Error('Previously installed historical content changed; capture continuation refused');
    }
    // No acquisition/content apply is repeated. Re-run the published verifier;
    // the intermediate facade may still need its actual apply-path mapping.
    result={};verified=await adapter.verifyDeveloperTeamInstall(plan);
    if(piContextKind?.startsWith('shared-binary')&&!effects.some(effect=>effect.method==='historical-native-config-action')){
      const action={id:'historical.context-mode.configure',kind:'write-pi-mcp-config',capabilityId:'context-mode'};
      const outcome=await adapter.runAction(action,{runnerId:'pi',projectRoot:home,deckConfig:config});
      effects.push({capability:'context-mode',method:'historical-native-config-action',action,outcome});
      if(outcome.status!=='executed')gaps.push('Historical Pi native MCP configuration did not complete');
    }
  }else{
    result = await adapter.applyDeveloperTeamInstall({ ...input, plan });
    verified = await adapter.verifyDeveloperTeamInstall(plan);
  }
} else {
  if(resumeCapture)throw Error('Pre-adapter capture continuation is unsupported; no successful effects replayed');
  // These exact published exports performed installation before the adapter interface.
  const legacy = await import(join(source, `packages/adapter-${runner}/src/developer-team-install.ts`));
  const openCode = runner === 'opencode';
  const build = legacy[openCode ? 'buildOpenCodeDeveloperTeamInstallPlan' : 'buildDeveloperTeamInstallPlan'];
  const apply = legacy[openCode ? 'applyOpenCodeDeveloperTeamInstall' : 'applyDeveloperTeamInstall'];
  const verify = legacy[openCode ? 'verifyOpenCodeDeveloperTeamInstall' : 'verifyDeveloperTeamInstall'];
  if (!build || !apply || !verify) throw Error('unmapped historical installer exports');
  plan = build(home, { configDir: roots.opencode, capabilityInstructions });
  files = Object.values(plan).filter(Array.isArray).flat().filter((file: any) => typeof file?.absolutePath === 'string' && typeof file?.content === 'string')
    .map((file: any) => ({ path: file.absolutePath, content: file.content }));
  for (const file of files) assertFixtureHome(home, file.path);
  result = await apply(plan, { configDir: roots.opencode }); verified = await verify(plan);
  if (runner === 'pi') {
    const installer = await import(join(source, 'packages/adapter-pi/src/install-tools.ts'));
    const catalog = await import(join(source, 'packages/adapter-pi/src/installation-plan.ts'));
    const tool = catalog.PI_INSTALLABLE_TOOLS.find((tool: any) => tool.id === 'context-mode');
    const outcome = process.env.NRP_NATIVE_PI ? await installer.installPiTools(process.env.NRP_NATIVE_PI, [{ ...tool, source: `npm:${upstreamPins.contextMode}` }], () => {}, runHistoricalCommand) : [];
    effects.push({ capability: 'context-mode', method: 'historical-native-package-installer', originalSpec: tool.source, pinnedInput: `npm:${upstreamPins.contextMode}`, outcome });
    if (outcome.length !== 1 || !outcome[0].success) gaps.push('Pre-adapter native Pi installer did not complete');
  }
  if (selectedVariants) gaps.push('Pre-adapter selected variants require epoch-specific mapping');
}
if(!verified.valid){
 const collapsed=join(runner==='pi'?roots.pi:roots.opencode,'skills/SKILL.md/SKILL.md');
 let observedCollapse:any;
 if((runner==='pi'||runner==='opencode')&&existsSync(collapsed)){
  assertFixtureHome(home,collapsed);
  const bytes=readFileSync(collapsed);
  if(files!.some(file=>bytes.equals(Buffer.from(file.content))))observedCollapse={path:collapsed,sha256:createHash('sha256').update(bytes).digest('hex'),detail:'Published generic apply reduced distinct skill paths to one basename; actual last-written bytes match published source output. This is not a healthy historical installation.'};
 }
 writeFileSync(join(home,'historical-verification.json'),JSON.stringify({runner,source,originalFacadeResult:verified,...(observedCollapse?{observedCollapse}:{})},null,2));
}
if(!verified.valid&&runner==='pi'&&adapter&&files!.some(file=>/^\.pi\/(?:agents|skills)\//.test(file.path))){
 const facade=readFileSync(adapterPath,'utf8');
 if(!/agentsDir:\s*piAgentsDir/.test(facade)||!/skillsDir:\s*piSkillsDir/.test(facade))throw Error('Unmapped published Pi apply/verify discrepancy');
 const published=await import(join(source,'packages/adapter-pi/src/developer-team-install.ts'));
 const native=published.buildDeveloperTeamInstallPlan(home,{capabilityInstructions});
 const actual=remapPublishedPiNativePlan(home,native);
 const original=verified;
 verified=await published.verifyDeveloperTeamInstall(actual);
 verificationCorrection={method:'unmodified published native verifier over the exact published global apply mapping',originalFacadeResult:original,valid:verified.valid};
 const observation=JSON.parse(readFileSync(join(home,'historical-verification.json'),'utf8'));
 writeFileSync(join(home,'historical-verification.json'),JSON.stringify({...observation,...verificationCorrection},null,2));
 for(const file of [...actual.agents,...actual.skills,...actual.standaloneSkills,...actual.sddSkillFiles]){
  if(!files!.some(existing=>materializedFixturePath(home,runner,existing.path)===file.absolutePath))files!.push({path:file.absolutePath,content:file.content});
 }
}
if (!verified.valid) throw Error('historical source install verification failed');
if(runner==='opencode'){
  // Some published facades return only skills although their native apply and
  // verifier also install an execution plugin. Capture that specific effect
  // from the original builder, never by adopting arbitrary existing files.
  const published=await import(join(source,'packages/adapter-opencode/src/developer-team-install.ts'));
  const native=published.buildOpenCodeDeveloperTeamInstallPlan(home,{configDir:roots.opencode,capabilityInstructions});
  files!.push(...capturePublishedOpenCodeFiles(home,native,files!));
}
if (runner === 'opencode' && existsSync(join(roots.opencode, 'opencode.json')) && !files!.some(file => materializedFixturePath(home, runner, file.path) === join(roots.opencode, 'opencode.json'))) {
  // Pre-adapter config merge is an actual apply effect outside its content arrays.
  files!.push({ path: join(roots.opencode, 'opencode.json'), content: readFileSync(join(roots.opencode, 'opencode.json'), 'utf8') });
}
const captured = files!.map(file => ({ path: materializedFixturePath(home, runner, file.path), content: readFileSync(materializedFixturePath(home, runner, file.path), 'utf8') }));
writeFileSync(join(home, 'historical-files.json'), JSON.stringify(captured));
// Retain verified content output even when a separate old package installer is
// unsupported. A failed package effect must never erase the explicit gap row.
writeFileSync(join(home, 'historical-installation.json'), JSON.stringify({ runner, source, files: captured.length, verified: true, packageEffects: 'incomplete', effects }, null, 2));
if (runner === 'opencode') {
  const installer = await import(join(source, 'packages/adapter-opencode/src/install-tools.ts'));
  const catalog = await import(join(source, 'packages/adapter-opencode/src/installation-plan.ts'));
  const tool = catalog.OPENCODE_INSTALLABLE_TOOLS.find((tool: any) => tool.id === 'context-mode');
  if (!tool) throw Error('historical Context Mode tool missing');
  // Published OpenCode used an unversioned npm spec. Freeze that upstream input
  // to the reviewed Codex/Claude version and record this explicit deviation.
  const outcome = tool.installKind === 'opencode-plugin'
    ? process.env.NRP_NATIVE_OPENCODE ? await installer.installOpenCodeTools(process.env.NRP_NATIVE_OPENCODE, [{ ...tool, module: upstreamPins.contextMode }], () => {}, runHistoricalCommand)
      : [{ success: false, status: 'incomplete', reason: 'Pinned native OpenCode CLI not provisioned' }]
    : await installer.installOpenCodeTools(process.execPath, [{ ...tool, module: 'context-mode@1.0.169' }], () => {});
  effects.push({ capability: 'context-mode', method: 'historical-npm-installer', upstreamPinOverride: 'context-mode@1.0.169', originalSpec: tool.module, outcome });
  if (outcome.length !== 1 || outcome[0].success !== true) gaps.push(`Historical OpenCode ${tool.installKind} command failed with pinned CLI; inspect exact outcome`);
  if (adapter && outcome[0].success) {
    const action = { id: 'historical.context-mode.configure', kind: 'write-mcp-config', capabilityId: 'context-mode', source: 'context-mode' };
    const configured = await adapter.runAction(action, { projectRoot: home, deckConfig: config });
    effects.push({ capability: 'context-mode', method: 'historical-native-config-action', action, outcome: configured });
    if (configured.status !== 'executed') throw Error('historical OpenCode native MCP configuration failed');
  }
  const rtkTool = catalog.OPENCODE_INSTALLABLE_TOOLS.find((tool: any) => tool.id === 'rtk');
  if (rtkTool?.shellInstallUrl) {
    const outcome = await historicalOpenCodeRtk(installer, rtkTool, home);
    effects.push({ capability: 'rtk', ...outcome });
    if (outcome.gap) gaps.push(outcome.gap);
  } else effects.push(await fixtureSharedRtk(home));
}
const locks = [join(roots.data, runner, 'tools/package-lock.json'), join(home, 'npm/lib/node_modules/context-mode/package.json')]
  .filter(existsSync).map(path => ({ path, content: JSON.parse(readFileSync(path, 'utf8')) }));
writeFileSync(join(home, 'historical-installation.json'), JSON.stringify({ runner, source, files: captured.length, changed: result.changedCount, verified: true,
  scope: 'verified published source with real installer effects; individual gaps remain explicit', effects, locks, gaps,
  ...(verificationCorrection?{verificationCorrection}:{}),
  ...(resumeCapture?{captureContinuation:'Actual old output compared exactly; no successful acquisition/content apply repeated'}:{}),
  ...(resumeSelected?{selectedContinuation:'Original successful package effects retained and reverified; only failed Serena action retried before the first content apply'}:{}),
  selectedVariants: { status: selectedVariants && !gaps.some(gap => /Selected|selected variants/.test(gap)) ? 'verified' : 'incomplete' },
  capabilityCoverage: { selected, incomplete: selectedVariants ? gaps : ['Serena selected-install epoch', 'Codebase Memory selected-install epoch'] },
  retiredInstructions: captured.filter(file => /context-mode|serena/i.test(file.content)).length }, null, 2));
// Configuration actions may update a planned shared file; capture its final exact
// bytes for subsequent explicit fixture review rather than its earlier template.
writeFileSync(join(home, 'historical-files.json'), JSON.stringify(files!.map(file => ({ path: materializedFixturePath(home, runner, file.path), content: readFileSync(materializedFixturePath(home, runner, file.path), 'utf8') }))));
