/** Invoked only with an isolated historical fixture HOME. All confirmations below belong to fixtures. */
import {join,resolve} from 'node:path';
import {existsSync,writeFileSync,readFileSync,mkdirSync,readdirSync,statSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import { $ } from 'bun';
import {assertFixtureHome,reviewHistoricalReplacement,materializedFixturePath,retainFixtureBackup} from './retirement-matrix-fixture';
import {historicalPreservationScenarios,migratedRecoveryScenario} from './retirement-historical-scenarios';
import {cleanupRoots,planRunnerCleanup,runRunnerCleanupUpdate} from '../apps/cli/src/runner-cleanup-command';
import {runRunnerSync} from '../apps/cli/src/upgrade-command/runner-sync';
import {getDefaultDeckConfig,buildCapabilityInstructionBundle,getEnabledCapabilityInstructionIds,acquireRunnerGenerationReference,contributionHash,selectSearchRoute} from '../packages/core/src';
import { publicationGaps } from './retirement-publication-contract';
import { probeOpenCodeLiveSearch, probeFallbackMcpSearch } from './retirement-live-search';
import { TAVILY_PROVIDER_DESCRIPTOR } from '../packages/provider-tavily/src';
import {inspectCodexNativeSearch} from '../packages/adapter-codex/src/native-search';
import {inspectClaudeNativeSearch} from '../packages/adapter-claude/src/native-search';
import {inspectOpenCodeNativeSearch} from '../packages/adapter-opencode/src/native-search';
import {inspectPiNativeSearch} from '../packages/adapter-pi/src/native-search';
import {createCodexRunnerAdapter} from '../packages/adapter-codex/src/runner-adapter';
import {createClaudeRunnerAdapter} from '../packages/adapter-claude/src/runner-adapter';
import {createOpenCodeRunnerAdapter} from '../packages/adapter-opencode/src/runner-adapter';
import {createPiRunnerAdapter} from '../packages/adapter-pi/src/runner-adapter';
import {resolveStatePaths,withIdleRunnerMutation} from '../packages/session-host/src';
const [runner,home]=process.argv.slice(2) as [string,string];
const fixtureRunnerIds=[runner,...['codex','claude','opencode','pi'].filter(id=>id!==runner)];
if(home!==process.env.HOME || !existsSync(join(home,'historical-installation.json')))throw Error('historical isolated fixture required');
assertFixtureHome(home);
const checkpoint=(stage:string)=>writeFileSync(join(home,'candidate-checkpoint.json'),JSON.stringify({stage,at:new Date().toISOString()}));
checkpoint('preservation-scenarios');
const roots=cleanupRoots(),config=getDefaultDeckConfig();
const fallbackFixture=runner!=='opencode'&&process.env.NRP_LIVE_SEARCH==='1';
const liveFallback=fallbackFixture&&Boolean(process.env.TAVILY_API_KEY?.trim());
if(liveFallback)config.webSearch={enabled:true,provider:'tavily'};
const historicalInstallation=JSON.parse(readFileSync(join(home,'historical-installation.json'),'utf8'));
const observedArtifacts=historicalInstallation.effects.filter((effect:any)=>effect.method==='observed-historical-artifact');
for(const artifact of observedArtifacts){assertFixtureHome(home,artifact.path);if(!existsSync(artifact.path)||contributionHash(readFileSync(artifact.path))!==artifact.sha256)throw Error('Historical selected artifact preimage changed');}
const rtkCommands:string[]=[];
const walk=(path:string)=>{if(!existsSync(path))return;for(const name of readdirSync(path)){const full=join(path,name);if(name==='node_modules')continue;const stat=statSync(full);if(stat.isDirectory())walk(full);else if(name==='rtk')rtkCommands.push(full);}};
walk(join(roots.data,runner,'tools'));
for(const path of [join(home,'.local/bin/rtk'),join(home,'npm/bin/rtk')])if(existsSync(path))rtkCommands.push(path);
const beforeRtk=new Map(rtkCommands.map(command=>[command,contributionHash(readFileSync(command))]));
const openCodeRtkPlugin=join(roots.opencode,'plugins/rtk.ts');
const beforeRtkPlugin=runner==='opencode'&&existsSync(openCodeRtkPlugin)?contributionHash(readFileSync(openCodeRtkPlugin)):undefined;
const scenarios=historicalPreservationScenarios(home,runner,roots);
checkpoint('initial-plan-and-unattended-cleanup');
const providerOptions={webSearchProviderResolver:(id:string|undefined)=>id==='tavily'?TAVILY_PROVIDER_DESCRIPTOR:undefined};
const adapter=runner==='codex'?createCodexRunnerAdapter({userHome:home,codexHome:roots.codex,...providerOptions,tools:{homeDir:home,dataRoot:roots.data,resolveCommand:name=>Bun.which(name)??undefined,nodeCommand:process.execPath,verifyNodeRuntime:()=>true}})
 :runner==='claude'?createClaudeRunnerAdapter({homeDir:home,dataRoot:roots.data,...providerOptions})
 :runner==='opencode'?createOpenCodeRunnerAdapter({developerTeamConfigDir:roots.opencode})
 :createPiRunnerAdapter({homeDirectory:home,env:process.env,webSearchProvider:TAVILY_PROVIDER_DESCRIPTOR,piVersionProbe:()=>({exitCode:0,stdout:'1.0.0'})});
const registry={list:()=>[adapter],has:(id:string)=>id===runner,get:()=>adapter};
const statePaths=resolveStatePaths();
if(!process.env.TMPDIR||(!statePaths.socket.path.startsWith(`${process.env.TMPDIR}/`)&&!statePaths.socket.path.startsWith(`${home}/`)))throw Error('isolated fixture socket namespace required');
const admission=<T>(effect:()=>T|Promise<T>)=>withIdleRunnerMutation(effect,{paths:statePaths});
if(liveFallback&&runner==='claude'){
 const installed=await admission(()=>adapter.runAction({id:'fixture.candidate.search',kind:'install-claude-tool',capabilityId:'web-search',title:'Install pinned fallback for isolated functional exercise'},{runnerId:runner,projectRoot:home,deckConfig:config}));
 if(installed.status!=='executed')throw Error('Candidate Claude fallback installation failed');
}
const firstPlan=planRunnerCleanup(roots,[runner]);
const oldGeneration=firstPlan.plans[0]!.entries.find(entry=>entry.generation)?.generation;
const releaseReference=oldGeneration?acquireRunnerGenerationReference({...oldGeneration,selectionHash:contributionHash(readFileSync(oldGeneration.selectionPath))}):undefined;
const preservedBefore=firstPlan.plans[0]!.entries.filter(entry=>entry.action!=='remove').length;
const unattended=await runRunnerCleanupUpdate(roots,[runner],{admission});
checkpoint('replacement-review-and-sync');
const captured=JSON.parse(readFileSync(join(home,'historical-files.json'),'utf8')) as {path:string;content:string}[];
// Unowned pre-manifest files must not be adopted by matching names. Explicit
// fixture review authorizes only captured, still-exact old output that differs
// from the new desired file. The product update continues to preserve it.
const desired=adapter.buildDeveloperTeamInstallPlan({projectRoot:home,environmentId:`${runner}-development` as never,deckConfig:config,materializationScope:'content-only'});
const replacementReview=runner==='opencode'?reviewHistoricalReplacement(home,captured,captured.filter(old=>existsSync(old.path)&&desired.files.some(file=>materializedFixturePath(home,runner,file.path)===old.path&&file.content!==old.content)).map(file=>file.path)):[];
// The update entry point must replace Claude's selected old generation before its retired leaves can be collected.
const sync=await runRunnerSync({config,registry,projectRoot:home,deckVersion:'candidate',runnerIds:[runner],retirement:{roots},mutationAdmission:admission});
checkpoint('generation-reference-and-confirmed-cleanup');
let legacyInstallReview:any[]=[];
let fixtureNativeOverrideRestoredAfterLegacyReview=false;
if(sync.outcomes[0]?.status==='skipped'&&(runner==='pi'||runner==='codex')){
 // The product correctly does not infer ownership of the old project-local
 // format. Exercise explicit fixture review and a new installation separately.
 legacyInstallReview=reviewHistoricalReplacement(home,captured,captured.filter(file=>existsSync(file.path)).map(file=>file.path));
 const fresh=adapter.buildDeveloperTeamInstallPlan({projectRoot:home,environmentId:`${runner}-development` as never,deckConfig:config,materializationScope:'content-only'});
 await admission(()=>adapter.applyDeveloperTeamInstall({projectRoot:home,environmentId:'pi-development',plan:fresh}));
 if(!(await adapter.verifyDeveloperTeamInstall(fresh)).valid)throw Error(`explicit legacy ${runner} replacement failed verification`);
}else if(sync.outcomes[0]?.status!=='synced')throw Error('candidate sync incomplete: '+JSON.stringify(sync.outcomes.map(({status,diagnostics})=>({status,diagnostics}))));
if(liveFallback&&runner==='codex'){
 const path=join(roots.codex,'config.toml');
 const source=existsSync(path)?readFileSync(path,'utf8'):'';
 if((Bun.TOML.parse(source) as any).web_search===undefined){
  // The explicit whole-file fixture replacement of pre-manifest output also
  // discarded its fixture-only native setting. Reapply this declared test input
  // before the separately reviewed runtime install, without inferring consent.
  writeFileSync(path,'web_search = "disabled"\n'+source);
  fixtureNativeOverrideRestoredAfterLegacyReview=true;
 }
 // Content refresh intentionally preserves runtime bindings. This separately
 // reviewed fixture installation enables the selected search capability through
 // the real full installer; a content-only refresh is not search readiness.
 const full=adapter.buildDeveloperTeamInstallPlan({projectRoot:home,environmentId:'codex-development',deckConfig:config});
 if(full.blocked)throw Error('Candidate Codex fallback install plan is blocked');
 await admission(()=>adapter.applyDeveloperTeamInstall({projectRoot:home,environmentId:'codex-development',plan:full}));
 if(!(await adapter.verifyDeveloperTeamInstall(full)).valid)throw Error('Candidate Codex fallback installation failed verification');
}
if(oldGeneration){
  const held=planRunnerCleanup(roots,[runner]).plans[0]!.entries.filter(entry=>entry.generation?.root===oldGeneration.root);
  if(!held.length||held.some(entry=>entry.action!=='preserve'))throw Error('active historical generation was not preserved after replacement');
  await runRunnerCleanupUpdate(roots,[runner],{admission,ask:async()=> 'remove'});
  if(!held.every(entry=>existsSync(entry.path)))throw Error('active historical generation changed during cleanup');
  releaseReference!();
  scenarios.push({scenario:'historical-generation-reference/replacement/release',status:'verified'});
}
// The shared Serena launcher can be collected only after every runner root has
// been inspected. All four roots here belong to this one isolated fixture.
const confirmed=await runRunnerCleanupUpdate(roots,fixtureRunnerIds,{admission,ask:async()=> 'remove'});
// Retiring a protected old binding can make its shared executable collectible
// only in the next plan. Finish that dependency release before the idempotence
// assertion; a review-required pass is never a successful clean migration.
const collected=await runRunnerCleanupUpdate(roots,fixtureRunnerIds,{admission,ask:async()=> 'remove'});
checkpoint('repeat-and-verify');
const remaining=planRunnerCleanup(roots,fixtureRunnerIds).plans[0]!;
const repeated=await runRunnerCleanupUpdate(roots,fixtureRunnerIds,{admission});
const plan=adapter.buildDeveloperTeamInstallPlan({projectRoot:home,environmentId:`${runner}-development` as never,deckConfig:config,materializationScope:'content-only',...(getEnabledCapabilityInstructionIds(config,runner).includes('adaptive-memory')?{}:{capabilityInstructions:buildCapabilityInstructionBundle(getEnabledCapabilityInstructionIds(config,runner))})});
const verified=await adapter.verifyDeveloperTeamInstall(plan);
if(!verified.valid || remaining.entries.length || repeated.some(outcome=>outcome.status!=='complete'))throw Error('managed state incomplete: '+JSON.stringify({verified,remaining:remaining.entries.length,diagnostics:remaining.diagnostics,repeated}));
const managedRoot=runner==='claude'?join(roots.data,'claude'):roots[runner as 'codex'|'pi'|'opencode'];
const manifest=JSON.parse(readFileSync(join(managedRoot,runner==='claude'?'manifest.json':'deck/manifest.json'),'utf8'));
const actualFile=manifest.contributions.find((entry:any)=>entry.selector.kind==='file'&&existsSync(entry.path))?.path;
if(!actualFile)throw Error('No materialized candidate file for recovery exercise');
scenarios.push(migratedRecoveryScenario(home,runner,actualFile));
if(spawnSync('git',['init','--quiet',home],{env:process.env,encoding:'utf8'}).status!==0)throw Error('isolated RTK worktree setup failed');
const rtk=rtkCommands.map(command=>{const result=spawnSync(command,['git','status','--short'],{cwd:home,env:process.env,encoding:'utf8',timeout:10000});return {command,status:result.status,beforeHash:beforeRtk.get(command),afterHash:existsSync(command)?contributionHash(readFileSync(command)):undefined,exercised:'real installed RTK git status'};});
if(rtk.some(probe=>probe.status!==0))throw Error('migrated RTK execution failed');
let automaticRtk:any={status:'not-applicable',reason:'This row has no exercised automatic hook bridge'};
if(runner==='opencode'&&beforeRtkPlugin){
 const plugin=await import(openCodeRtkPlugin);
 const hooks=await plugin.RtkOpenCodePlugin({$:$.env(process.env).cwd(home)});
 const output={args:{command:'git status --short'}};
 await hooks['tool.execute.before']({tool:'bash'},output);
 const execution=spawnSync('/bin/sh',['-c',output.args.command],{cwd:home,env:process.env,encoding:'utf8',timeout:10000});
 const afterHash=contributionHash(readFileSync(openCodeRtkPlugin));
 if(!/^rtk git status/.test(output.args.command)||execution.status!==0||afterHash!==beforeRtkPlugin)throw Error('preserved OpenCode RTK plugin failed its real rewrite/execution path');
 automaticRtk={status:'verified',plugin:openCodeRtkPlugin,beforeHash:beforeRtkPlugin,afterHash,rewritten:output.args.command,
   exercised:'actual historical RTK plugin and installed binary; synthetic Bash event; no model session'};
}
if(runner==='claude'){
 const selected=JSON.parse(readFileSync(join(roots.data,'claude/model-assignments.json'),'utf8'));
 const plugin=join(roots.data,'claude',selected.plugin),hook=join(plugin,'hooks/rtk-hook.cjs');
 if(existsSync(hook)){
  const result=spawnSync('node',[hook],{cwd:home,env:{...process.env,CLAUDE_PLUGIN_ROOT:plugin},input:JSON.stringify({tool_name:'Bash',tool_input:{command:'git status'}}),encoding:'utf8',timeout:10000});
  if(result.status!==0||!result.stdout.includes('rtk'))throw Error('migrated Claude automatic RTK bridge failed');
  automaticRtk={status:'verified',hook,exercised:'actual generated PreToolUse bridge; synthetic Bash event; no native/model session'};
 }
}
const input={projectRoot:home,environment:process.env};
const native=runner==='codex'?inspectCodexNativeSearch({...input,providerId:'openai'},roots.codex)
 :runner==='claude'?inspectClaudeNativeSearch({...input,modelId:'sonnet'},home)
 :runner==='opencode'?inspectOpenCodeNativeSearch({...input,modelId:'opencode/big-pickle'},roots.opencode)
 :inspectPiNativeSearch(input,roots.pi);
const search={native,selection:selectSearchRoute(true,native,true),deckSearchEnabled:config.webSearch.enabled,routeProbeOnly:!config.webSearch.enabled,scope:'effective migrated configuration and production routing contract; configured functional transport evidence recorded separately'};
if(search.selection.route!==(runner==='pi'||fallbackFixture?'fallback':'native'))throw Error('migrated search routing contract regressed');
let functional:any={status:'incomplete',reason:fallbackFixture&&!liveFallback?'Set TAVILY_API_KEY for the isolated fallback functional check; no credential was provisioned':runner==='pi'?'No live fallback provider credential is provisioned in this isolated fixture':'No authenticated native search execution is provisioned in this isolated fixture'};
if(runner==='opencode'){
 try{functional=await probeOpenCodeLiveSearch(home);}catch(error){functional={status:'incomplete',reason:(error as Error).message};}
}
if(liveFallback){
 try{
  const selection=runner==='claude'?JSON.parse(readFileSync(join(roots.data,'claude/model-assignments.json'),'utf8')):undefined;
  const path=runner==='pi'?join(roots.pi,'mcp.json'):runner==='codex'?join(roots.codex,'config.toml'):join(roots.data,'claude',selection.plugin,'.mcp.json');
  assertFixtureHome(home,path);
  const raw=readFileSync(path,'utf8');
  const server=runner==='codex'?(Bun.TOML.parse(raw) as any).mcp_servers?.['web-search']:JSON.parse(raw).mcpServers?.['web-search'];
  if(!server||runner!=='claude'&&server.args?.join('\0')!==TAVILY_PROVIDER_DESCRIPTOR.command.slice(1).join('\0'))throw Error('Migrated fallback MCP configuration is not the selected provider');
  functional={...await probeFallbackMcpSearch(home,[server.command,...(server.args??[])],process.env),configurationPath:path,configurationHash:contributionHash(raw)};
 }catch(error){functional={status:'incomplete',reason:(error as Error).message};}
}
const searchEvidence={...search,functional};
const syncOutcomes=sync.outcomes.map(({adapterBackup,...outcome})=>({...outcome,...(adapterBackup===undefined?{}:{adapterBackup:retainFixtureBackup(home,adapterBackup)})}));
const evidence={unattended,preservedBefore,confirmed,collected,repeated,verified:verified.valid,remaining:remaining.entries.length,initialRetiredEntries:firstPlan.plans[0]!.entries.length,replacementReview,legacyInstallReview,fixtureNativeOverrideRestoredAfterLegacyReview,syncOutcomes,scenarios,rtk,automaticRtk,search:searchEvidence};
const installedArtifactChecks=observedArtifacts.map((artifact:any)=>({path:artifact.path,beforeHash:artifact.sha256,
 expected:artifact.preserveWhenDisabled?'preserved without ownership inference':'removed proven-owned installation artifact',
 ...(artifact.preserveWhenDisabled?{notAdopted:!manifest.contributions.some((entry:any)=>entry.path===artifact.path||entry.path===artifact.exposedAs)}:{}),
 status:artifact.preserveWhenDisabled?(existsSync(artifact.path)&&contributionHash(readFileSync(artifact.path))===artifact.sha256&&!manifest.contributions.some((entry:any)=>entry.path===artifact.path||entry.path===artifact.exposedAs)?'verified':'incomplete'):(existsSync(artifact.path)?'incomplete':'verified')}));
const completeEvidence={...evidence,installedArtifactChecks};
const gaps=publicationGaps(historicalInstallation,completeEvidence);
writeFileSync(join(home,'candidate-migration.json'),JSON.stringify({...completeEvidence,functionalGate:gaps.length?'incomplete':'verified',publicationGaps:gaps},null,2));
checkpoint('complete');
