/** Published source is verified against pinned Git objects. All effects stay in a fresh fixture root. */
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,readdirSync,symlinkSync,writeFileSync,mkdtempSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import { fixtureMarker, fixtureRuntimeTemp, runFixtureProcess, verifyPublishedSourceFiles } from './retirement-matrix-fixture';
import { installationEffectIdentity, publicationGaps } from './retirement-publication-contract';
import { upstreamPins, verifyNativeTooling, pinnedDownload } from './retirement-historical-effects';
const repository=resolve(import.meta.dir,'..');
const pins=JSON.parse(readFileSync(join(import.meta.dir,'fixtures/retirement-releases.json'),'utf8'));
const output=resolve(process.argv.find(x=>x.startsWith('--output='))?.slice(9) ?? mkdtempSync(join(tmpdir(),'deck-retirement-matrix-')));
const selectedVersions=process.argv.filter(x=>x.startsWith('--version=')).map(x=>x.slice(10));
const selectedRunner=process.argv.find(x=>x.startsWith('--runner='))?.slice(9);
const exact=process.argv.includes('--install-dependencies');
const selectedVariants=process.argv.includes('--selected-variants');
const liveSearch=process.argv.includes('--live-search');
if(selectedVersions.some(version=>!pins.rows.some((row:any)=>row.version===version)))throw Error('Unknown published version; no verification rows selected');
if(selectedRunner && !['codex','claude','opencode','pi'].includes(selectedRunner))throw Error('Unknown runner; no verification rows selected');
if(new Set(pins.rows.map((row:any)=>`${row.version}:${row.runner}`)).size!==pins.rows.length)throw Error('Duplicate published matrix rows');
mkdirSync(output,{recursive:true});
if(readdirSync(output).length)throw Error('Use a fresh output directory; successful effects must not be replayed');
// Expose only the package manager/runtime, never installed runner commands or
// inherited runner/config/credential environment. Global npm effects stay here.
const runtimeBin=join(output,'runtime-bin');mkdirSync(runtimeBin,{recursive:true});
for(const name of ['node','npm','npx']) {
 const command=Bun.which(name);if(!command)throw Error(`Missing isolated installer prerequisite: ${name}`);
 symlinkSync(command,join(runtimeBin,name));
}
const nativeHome=join(output,'native-tooling-home');mkdirSync(nativeHome,{recursive:true,mode:0o700});
writeFileSync(join(nativeHome,'.retirement-fixture'),fixtureMarker);
const reusedNativePrefix=process.argv.find(x=>x.startsWith('--native-tooling='))?.slice(17);
const nativePrefix=reusedNativePrefix??join(nativeHome,'native');
if(reusedNativePrefix){
 const identity=verifyNativeTooling(reusedNativePrefix);
 writeFileSync(join(output,'native-tooling-identity.json'),JSON.stringify({...identity,reusedFrom:reusedNativePrefix},null,2));
}else{
const nativeInstall=spawnSync('npm',['install','--prefix',nativePrefix,'--ignore-scripts','--no-audit','--no-fund',upstreamPins.pi,upstreamPins.opencode],
 {env:{HOME:nativeHome,PATH:`${runtimeBin}:/usr/bin:/bin`,NPM_CONFIG_CACHE:join(output,'npm-cache'),NPM_CONFIG_USERCONFIG:join(nativeHome,'.npmrc'),NPM_CONFIG_GLOBALCONFIG:join(nativeHome,'npmrc-global')},encoding:'utf8',timeout:180000});
writeFileSync(join(output,'native-tooling.log'),nativeInstall.stdout+nativeInstall.stderr);
if(nativeInstall.status!==0)throw Error('Pinned native installer prerequisites failed; no historical effects executed');
writeFileSync(join(output,'native-tooling-identity.json'),JSON.stringify({pins:upstreamPins,lockSha256:createHash('sha256').update(readFileSync(join(nativePrefix,'package-lock.json'))).digest('hex'),lock:JSON.parse(readFileSync(join(nativePrefix,'package-lock.json'),'utf8'))},null,2));
}
writeFileSync(join(output,'runtime.json'),JSON.stringify({bun:Bun.version,node:spawnSync('node',['--version'],{encoding:'utf8'}).stdout.trim(),platform:process.platform,arch:process.arch},null,2));
const git=(args:string[])=>{const result=spawnSync('git',args,{cwd:repository,encoding:'utf8'});if(result.status!==0)throw Error(result.stderr.slice(0,300));return result.stdout.trim();};
// Freeze the candidate source, including file-backed runner assets, for the whole matrix.
// A relocated JS bundle loses Pi's source-relative materialization assets.
const candidateDirectory=join(output,'candidate-source'),candidateScript=join(candidateDirectory,'scripts/retirement-candidate-migrate.ts');
const candidatePaths=spawnSync('git',['ls-files','-z','--cached','--others','--exclude-standard','apps','packages','scripts','package.json','bun.lock','tsconfig.json'],{cwd:repository});
const candidateArchive=spawnSync('tar',['-cf','-','--null','-T','-'],{cwd:repository,input:candidatePaths.stdout,maxBuffer:256*1024*1024});
if(candidateArchive.status!==0)throw Error('candidate source snapshot failed');
const candidateArtifactSha256=createHash('sha256').update(candidateArchive.stdout).digest('hex');
mkdirSync(candidateDirectory,{recursive:true});
if(spawnSync('tar',['-x','-C',candidateDirectory],{input:candidateArchive.stdout}).status!==0)throw Error('candidate snapshot extraction failed');
const candidateInstall=spawnSync(process.execPath,['install','--frozen-lockfile','--ignore-scripts'],{cwd:candidateDirectory,env:{HOME:join(output,'candidate-dependency-home'),PATH:process.env.PATH,BUN_INSTALL_CACHE_DIR:join(output,'dependency-cache'),BUN_RUNTIME_TRANSPILER_CACHE_PATH:'0'},encoding:'utf8',timeout:120000});
writeFileSync(join(output,'candidate-dependencies.log'),candidateInstall.stdout+candidateInstall.stderr);
if(candidateInstall.status!==0)throw Error('candidate frozen dependency resolution failed');
writeFileSync(join(output,'candidate-artifact.json'),JSON.stringify({candidateArtifactSha256,kind:'source-archive',sourceFiles:candidatePaths.stdout.toString().split('\0').filter(Boolean)},null,2));
const results:any[]=[];
for(const row of pins.rows.filter((row:any)=>(!selectedVersions.length || selectedVersions.includes(row.version))&&(!selectedRunner || row.runner===selectedRunner))){
 const name=`${row.version}-${row.runner}`,source=join(output,'sources',row.version),home=join(output,'homes',name);
 const result:any={...row,status:'incomplete',scope:'historical installation effects and candidate migration; individual gaps recorded explicitly',candidateArtifactSha256,dependencyMode:exact?'historical-frozen-lockfile':'candidate-dependencies (development evidence only)',selectedVariants,liveSearch};
 try{
  if(git(['rev-parse',`${row.commit}^{tree}`])!==row.sourceTree)throw Error('pinned source tree mismatch');
  if(row.applicability==='unsupported-runner-version'){
   if(git(['ls-tree','-r','--name-only',row.commit,'--',`packages/adapter-${row.runner}`]))throw Error('Pinned unsupported combination contains an adapter package; inventory review required');
   Object.assign(result,{status:'unsupported',reason:row.reason});results.push(result);continue;
  }
  if(!row.installerPath){result.reason='Legacy pre-adapter installer needs explicit harness mapping; not counted as tested.';results.push(result);continue;}
  if(git(['rev-parse',`${row.commit}:${row.installerPath}`])!==row.installerBlob)throw Error('pinned installer blob mismatch');
  // Whole-row equivalence must cover transitive content/install inputs, not
  // merely the facade blob. Conservative identities deliberately keep changed
  // production source sets distinct; identical names alone never waive a row.
  const records=git(['ls-tree','-r','-z',row.commit,'--','packages','apps','bun.lock','bun.lockb','package.json','tsconfig.json']).split('\0')
   .filter(line=>Boolean(line)&&! /\.test\.|__tests__\/|__fixtures__\//.test(line)).map(line=>{const [object,path]=line.split('\t'),parts=object!.split(' ');return {path:path!,blob:parts[2]!,mode:parts[0]!};});
  result.installationSourceIdentity=installationEffectIdentity(records,{runner:row.runner,selectedVariants:String(selectedVariants),upstreamPins:JSON.stringify(upstreamPins)});
  if(!existsSync(source)){
   mkdirSync(source,{recursive:true});
   const archive=spawnSync('git',['archive',row.commit],{cwd:repository,maxBuffer:256*1024*1024});
   if(archive.status!==0)throw Error('source archive unavailable');
   const unpack=spawnSync('tar',['-x','-C',source],{input:archive.stdout});if(unpack.status!==0)throw Error('source extraction failed');
   writeFileSync(join(source,'.retirement-source-sha256'),createHash('sha256').update(archive.stdout).digest('hex'));
   if(exact){
    const install=spawnSync(process.execPath,['install','--frozen-lockfile','--ignore-scripts'],{cwd:source,env:{HOME:join(output,'dependency-home'),PATH:process.env.PATH,BUN_INSTALL_CACHE_DIR:join(output,'dependency-cache'),BUN_RUNTIME_TRANSPILER_CACHE_PATH:'0'},encoding:'utf8',timeout:120000});
    writeFileSync(join(output,`${row.version}-dependencies.log`),install.stdout+install.stderr);if(install.status!==0)throw Error('historical frozen dependency resolution failed');
   }else{
    mkdirSync(join(source,'node_modules/@deck'),{recursive:true});
    for(const dependency of readdirSync(join(repository,'node_modules')))if(dependency!=='@deck')symlinkSync(join(repository,'node_modules',dependency),join(source,'node_modules',dependency));
    for(const folder of readdirSync(join(source,'packages'))){const manifest=join(source,'packages',folder,'package.json');if(!existsSync(manifest))continue;const name=JSON.parse(readFileSync(manifest,'utf8')).name;if(name?.startsWith('@deck/'))symlinkSync(join(source,'packages',folder),join(source,'node_modules',name));}
   }
   writeFileSync(join(source,'.retirement-dependencies-ready'),exact?'historical-frozen-lockfile':'development');
  }
  if(!existsSync(join(source,'.retirement-dependencies-ready'))||readFileSync(join(source,'.retirement-dependencies-ready'),'utf8')!==(exact?'historical-frozen-lockfile':'development'))throw Error('Historical dependency setup did not complete; partial source is not valid frozen-dependency evidence');
  Object.assign(result,{sourceArchiveSha256:readFileSync(join(source,'.retirement-source-sha256'),'utf8')});
  if(git(['hash-object',join(source,row.installerPath)])!==row.installerBlob)throw Error('extracted installer identity mismatch');
  verifyPublishedSourceFiles(source,records);
  result.sourceVerification={before:true,after:false,productionInputCount:records.length};
  mkdirSync(home,{recursive:true,mode:0o700});
  writeFileSync(join(home,'.retirement-fixture'),fixtureMarker);
  // Explicit fixture inputs exercise supported fallback routes without native
  // provider/model credentials. Historical installers receive no API secret.
  // Capture their actual output with this user setting present from the start.
  if(liveSearch&&row.runner==='codex'){
   mkdirSync(join(home,'.codex'),{recursive:true});
   writeFileSync(join(home,'.codex/config.toml'),'web_search = "disabled"\n');
  }
  const temporaryRoot=fixtureRuntimeTemp();Object.assign(result,{temporaryRoot});
  const env={HOME:home,TMPDIR:temporaryRoot,PATH:`${join(home,'npm/bin')}:${join(home,'.local/bin')}:${runtimeBin}:/usr/bin:/bin`,BUN_RUNTIME_TRANSPILER_CACHE_PATH:'0',XDG_CONFIG_HOME:join(home,'.config'),XDG_DATA_HOME:join(home,'.local/share'),XDG_STATE_HOME:join(home,'.local/state'),CODEX_HOME:join(home,'.codex'),PI_CODING_AGENT_DIR:join(home,'.pi/agent'),OPENCODE_CONFIG_DIR:join(home,'.config/opencode'),NPM_CONFIG_PREFIX:join(home,'npm'),NPM_CONFIG_CACHE:join(output,'npm-cache'),NPM_CONFIG_IGNORE_SCRIPTS:'false',NPM_CONFIG_USERCONFIG:join(home,'.npmrc'),NPM_CONFIG_GLOBALCONFIG:join(home,'npmrc-global'),NRP_NATIVE_PI:join(nativePrefix,'node_modules/.bin/pi'),NRP_NATIVE_OPENCODE:join(nativePrefix,'node_modules/.bin/opencode')};
  Object.assign(env,{CBM_RUNTIME_DIR:temporaryRoot,CBM_CACHE_DIR:join(home,'codebase-cache')});
  if(liveSearch&&row.runner==='claude')Object.assign(env,{CLAUDE_CODE_USE_BEDROCK:'1'});
  result.searchFixture=liveSearch?row.runner==='codex'?'native-disabled-via-user-config':row.runner==='claude'?'bedrock-provider-without-native-search':row.runner==='pi'?'fallback-without-native-extension':'native-opencode-search':'default-native-configuration';
  if(selectedVariants&&row.runner==='codex'){
   if(process.platform!=='linux'||process.arch!=='x64'||!row.linuxArtifact?.digest)throw Error('Pinned historical Deck proxy artifact unsupported');
   const archive=join(home,'historical-deck.tar.gz'),directory=join(home,'historical-deck-proxy');
   writeFileSync(archive,await pinnedDownload({url:row.linuxArtifact.browser_download_url,sha256:row.linuxArtifact.digest.replace(/^sha256:/,''),maxBytes:256*1024*1024}));
   mkdirSync(directory,{recursive:true});
   if(spawnSync('tar',['-xzf',archive,'-C',directory,'deck']).status!==0)throw Error('Pinned historical Deck proxy extraction failed');
   // Earlier published adapters discover the proxy as `deck` on PATH rather
   // than accepting the later serenaProxyCommand option.
   mkdirSync(join(home,'.local/bin'),{recursive:true});
   symlinkSync(join(directory,'deck'),join(home,'.local/bin/deck'));
   Object.assign(env,{NRP_HISTORICAL_DECK_PROXY:join(directory,'deck')});
   result.historicalProxyArtifact=row.linuxArtifact;
  }
  const started=Date.now();
  const historical=runFixtureProcess(home,process.execPath,['run',join(candidateDirectory,'scripts/retirement-historical-install.ts'),source,row.runner,home,...(selectedVariants?['--selected-variants']:[])],{cwd:home,env,encoding:'utf8',timeout:600000});
  result.historicalRuntimeMs=Date.now()-started;
  writeFileSync(join(output,`${name}-historical.log`),historical.stdout+historical.stderr);
  verifyPublishedSourceFiles(source,records);
  result.sourceVerification.after=true;
  if(historical.status!==0){
   if(existsSync(join(home,'historical-installation.json')))Object.assign(result,{installation:JSON.parse(readFileSync(join(home,'historical-installation.json'),'utf8'))});
   if(existsSync(join(home,'historical-verification.json')))Object.assign(result,{historicalVerification:JSON.parse(readFileSync(join(home,'historical-verification.json'),'utf8'))});
   throw Error('historical package/source installer incomplete or unsupported; inspect historical log and retained content evidence');
  }
  const candidateStarted=Date.now();
  // Credentials are explicitly scoped to candidate search. Published installers
  // never inherit the operator's credentials or general runner environment.
  const candidateEnv={...env,...(liveSearch?{NRP_LIVE_SEARCH:'1',...(process.env.TAVILY_API_KEY?{TAVILY_API_KEY:process.env.TAVILY_API_KEY}:{})}:{})};
  // Serena's historical Python environment has tens of thousands of leaves.
  // Keep verification bounded without treating a busy filesystem as failure.
  const candidate=runFixtureProcess(home,process.execPath,['run',candidateScript,row.runner,home],{cwd:repository,env:candidateEnv,encoding:'utf8',timeout:1200000});
  result.migrationRuntimeMs=Date.now()-candidateStarted;
  writeFileSync(join(output,`${name}-candidate.log`),candidate.stdout+candidate.stderr);
  if(candidate.status!==0)throw Error('candidate migration exercise failed; inspect candidate log');
  Object.assign(result,{status:exact?'installation-migration-exercised':'development-installation-migration-exercised',reason:'Historical installer effects and explicit isolated replacement reviews recorded; publication depends on complete functional and historical scenario evidence.',installation:JSON.parse(readFileSync(join(home,'historical-installation.json'),'utf8')),migration:JSON.parse(readFileSync(join(home,'candidate-migration.json'),'utf8'))});
  result.publicationGaps=publicationGaps(result.installation,result.migration);
 }catch(error){result.reason=(error as Error).message;}
 results.push(result);writeFileSync(join(output,'matrix.json'),JSON.stringify({pinsSchema:pins.schema,results},null,2)+'\n');
 console.log(`${name}: ${result.status}`);
}
writeFileSync(join(output,'matrix.json'),JSON.stringify({pinsSchema:pins.schema,results},null,2)+'\n');
// Keep missing rows visible and block publication. Development reporting must be explicitly requested.
const incomplete=results.filter(row=>row.status!=='unsupported' && (row.status==='incomplete' || !exact || row.publicationGaps?.length!==0));
console.log(`${results.length} rows; ${incomplete.length} publication-incomplete; ${output}/matrix.json`);
if(incomplete.length && !process.argv.includes('--allow-incomplete'))process.exitCode=1;
