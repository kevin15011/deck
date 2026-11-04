import { expect, test } from 'bun:test';
import { upstreamPins } from './retirement-historical-effects';
import { publicationGaps, installationEffectIdentity } from './retirement-publication-contract';

test('publication rejects vacuous RTK checks and routing-only search evidence', () => {
  const gaps = publicationGaps({ verified: true, gaps: [] }, {
    verified: true, remaining: 0, scenarios: [], rtk: [],
    search: { selection: { route: 'native' } },
  });
  expect(gaps).toContain('No preserved installed RTK command was exercised');
  expect(gaps).toContain('Live search functionality is unverified');
});

test('historical package failures remain publication blockers after a clean migration', () => {
  const gaps = publicationGaps({ verified: true, gaps: ['native plugin command unsupported'] }, {
    verified: true, remaining: 0,
    scenarios: [{ scenario: 'failure/retry', status: 'verified' }],
    rtk: [{ status: 0, beforeHash: 'a', afterHash: 'a' }],
    search: { functional: { status: 'verified', evidence: 'real-provider-query' } },
  });
  expect(gaps).toContain('native plugin command unsupported');
  expect(gaps).toContain('Selected Serena/Codebase Memory installation variants are unverified');
});

test('equivalence identities include paths, dependencies and original inputs, independent of ordering', () => {
  const files = [{ path: 'installer.ts', blob: 'one' }, { path: 'dependency.ts', blob: 'two' }];
  const identity = installationEffectIdentity(files, { spec: 'context-mode@1.0.169' });
  expect(installationEffectIdentity([...files].reverse(), { spec: 'context-mode@1.0.169' })).toBe(identity);
  expect(installationEffectIdentity([files[0]!, { ...files[1]!, blob: 'changed' }], { spec: 'context-mode@1.0.169' })).not.toBe(identity);
  expect(installationEffectIdentity(files, { spec: 'different' })).not.toBe(identity);
});

test('CI combines complete base and selected evidence without waiving either phase', async () => {
  const { publishedMatrixGaps } = await import('./retirement-publication-contract');
  const pin={version:'v0.13.0',runner:'pi',commit:'c',sourceTree:'t',installerBlob:'b',applicability:'source-installer'};
  const migration={verified:true,remaining:0,scenarios:[{scenario:'recovery',status:'verified'}],rtk:[{status:0,beforeHash:'hash',afterHash:'hash'}],search:{functional:{status:'verified',evidence:'real-provider-query'}},installedArtifactChecks:[{status:'verified'}]};
  const row=(selectedVariants:boolean)=>({...pin,status:'installation-migration-exercised',candidateArtifactSha256:'a'.repeat(64),dependencyMode:'historical-frozen-lockfile',sourceVerification:{before:true,after:true},selectedVariants,installation:{verified:true,gaps:[],selectedVariants:{status:selectedVariants?'verified':'incomplete'}},migration});
  expect(publishedMatrixGaps([pin],[row(false)],[row(true)],'pi')).toEqual([]);
  expect(publishedMatrixGaps([pin],[row(false)],[],'pi').join('\n')).toContain('selected: missing');
  expect(publishedMatrixGaps([pin],[row(false),row(false)],[row(true)],'pi').join('\n')).toContain('duplicate');
  expect(publishedMatrixGaps([pin],[row(false)],[{...row(true),candidateArtifactSha256:'b'.repeat(64)}],'pi').join('\n')).toContain('candidate');
  expect(publishedMatrixGaps([pin],[row(false)],[{...row(true),migration:{...migration,search:{selection:{route:'native'}}}}],'pi').join('\n')).toContain('Live search');
  expect(publishedMatrixGaps([pin],[row(false)],[{...row(true),installation:{verified:true,selectedVariants:{status:'incomplete'}}}],'pi').join('\n')).toContain('Selected Serena');
});

test('CI reports pinned unsupported combinations without counting them as exercised', async () => {
  const { publishedMatrixGaps } = await import('./retirement-publication-contract');
  const pin={version:'0.0.1',runner:'claude',commit:'c',sourceTree:'t',installerBlob:null,applicability:'unsupported-runner-version'};
  const row=(selectedVariants:boolean)=>({...pin,status:'unsupported',candidateArtifactSha256:'a'.repeat(64),dependencyMode:'historical-frozen-lockfile',selectedVariants});
  expect(publishedMatrixGaps([pin],[row(false)],[row(true)],'claude')).toEqual([]);
  expect(publishedMatrixGaps([pin],[{...row(false),status:'installation-migration-exercised'}],[row(true)],'claude').join('\n')).toContain('counted as exercised');
});

// Protects historical provenance and admission completeness. Oracle: manual
// prerequisites are independent effects, never historical automatic installs.
// Fails if fabricated/missing provisioning or a missing candidate check passes.
test('old manual epochs require separate provisioning and candidate admission evidence', async () => {
  const { publishedMatrixGaps } = await import('./retirement-publication-contract');
  const pin={version:'0.0.1',runner:'pi',commit:'c',sourceTree:'t',installerBlob:'b',applicability:'legacy-source-installer'};
  const migration={verified:true,remaining:0,scenarios:[{status:'verified'}],rtk:[{status:0,beforeHash:'h',afterHash:'h'}],search:{functional:{status:'verified',evidence:'real-provider-query'}},installedArtifactChecks:[{status:'verified'}]};
  const row=(selectedVariants:boolean)=>({...pin,status:'installation-migration-exercised',candidateArtifactSha256:'a'.repeat(64),dependencyMode:'historical-frozen-lockfile',sourceVerification:{before:true,after:true},selectedVariants,installation:{verified:true,gaps:[],selectedVariants:{status:'verified'}},migration});
  expect(publishedMatrixGaps([pin],[row(false)],[row(true)],'pi').join('\n')).toContain('manual external-tool fixture');
});

test('manual provenance accepts complete effects and rejects fabricated or partial evidence', async () => {
  const { manualFixtureGaps, publishedManualHashes } = await import('./retirement-publication-contract');
  const h='a'.repeat(64);
  const fixture={model:'manual-external-tool-fixture-v1',runner:'pi',version:'0.0.1',
    historicalProbe:{historicalDeckInstallEffect:false,commands:0,serenaInCatalog:false,codebaseInstallKind:'external',outcome:[{success:true,status:'manual',actionKind:'manual-external-install'}],inputs:['core','pi/catalog','pi/installer'].map(key=>({path:key,sha256:publishedManualHashes[key]}))},
    configuration:{historicalDeckInstallEffect:false,sha256:h,publishedFormatSource:{sha256:h},commands:{serena:['/fixture/serena','start-mcp-server'],'codebase-memory':['/fixture/codebase-memory']}},
    artifacts:['serena','codebase-memory'].map(capability=>({capability,path:`/fixture/${capability}`,sha256:h,pin:capability==='serena'?'serena-agent==1.3.0':'codebase-memory-mcp@0.11.0',lockSha256:h,uvSha256:upstreamPins.uvBinarySha256,method:'fixture-provisioned-shared-prerequisite',historicalDeckInstallEffect:false,probeStatus:0}))};
  const migration={admission:{verdict:'admit'},installedArtifactChecks:fixture.artifacts.map(artifact=>({capability:artifact.capability,path:artifact.path,beforeHash:h,status:'verified',notAdopted:true}))};
  expect(manualFixtureGaps(fixture,migration)).toEqual([]);
  for(const mutate of [
    (copy:any)=>{copy.historicalProbe.historicalDeckInstallEffect=true;},
    (copy:any)=>{copy.historicalProbe.inputs[0].sha256=h;},
    (copy:any)=>{copy.historicalProbe.commands=1;},
    (copy:any)=>{copy.artifacts[0].historicalDeckInstallEffect=true;},
    (copy:any)=>{copy.artifacts[0].lockSha256=undefined;},
    (copy:any)=>{copy.artifacts[0].probeStatus=1;},
    (copy:any)=>{copy.artifacts[1].pin='latest';},
    (copy:any)=>{copy.artifacts.pop();},
    (copy:any)=>{copy.artifacts.push(copy.artifacts[0]);},
    (copy:any)=>{copy.configuration.commands.serena=['foreign-command'];},
  ]) {const copy=structuredClone(fixture);mutate(copy);expect(manualFixtureGaps(copy,migration).length).toBeGreaterThan(0);}
  expect(manualFixtureGaps(fixture,{...migration,admission:{verdict:'blocked'}}).length).toBeGreaterThan(0);
  expect(manualFixtureGaps(fixture,{...migration,installedArtifactChecks:[]}).length).toBeGreaterThan(0);
  expect(manualFixtureGaps(fixture,{...migration,installedArtifactChecks:migration.installedArtifactChecks.map(check=>({...check,notAdopted:false}))}).length).toBeGreaterThan(0);
});

// Protects completeness across every retained manual inventory row. A complete
// fixture must pass the same gate as other epochs, without an exclusion branch.
test('all manual epochs can qualify only with both provisioning and migration', async () => {
  const { publishedMatrixGaps, publishedManualHashes } = await import('./retirement-publication-contract');
  const h='a'.repeat(64);
  for(const runner of ['pi','opencode'])for(const version of ['0.0.1','0.0.2']){
    const pin={version,runner,commit:'c',sourceTree:'t',installerBlob:'b',applicability:'legacy-source-installer'};
    const manualFixture={model:'manual-external-tool-fixture-v1',runner,version,
      historicalProbe:{historicalDeckInstallEffect:false,commands:0,serenaInCatalog:false,codebaseInstallKind:'external',outcome:[runner==='pi'?{success:true,status:'manual',actionKind:'manual-external-install'}:{success:false}],inputs:['core',`${runner}/catalog`,`${runner}/installer`].map(key=>({path:key,sha256:publishedManualHashes[key]}))},
      configuration:{historicalDeckInstallEffect:false,sha256:h,publishedFormatSource:{sha256:h},commands:{serena:['/fixture/serena','start-mcp-server'],'codebase-memory':['/fixture/codebase-memory']}},
      artifacts:['serena','codebase-memory'].map(capability=>({capability,path:`/fixture/${capability}`,sha256:h,pin:capability==='serena'?'serena-agent==1.3.0':'codebase-memory-mcp@0.11.0',lockSha256:h,uvSha256:upstreamPins.uvBinarySha256,method:'fixture-provisioned-shared-prerequisite',historicalDeckInstallEffect:false,probeStatus:0}))};
    const migration={verified:true,remaining:0,admission:{verdict:'admit'},scenarios:[{status:'verified'}],rtk:[{status:0,beforeHash:h,afterHash:h}],search:{functional:{status:'verified',evidence:'real-provider-query'}},installedArtifactChecks:manualFixture.artifacts.map(artifact=>({path:artifact.path,capability:artifact.capability,beforeHash:h,status:'verified',notAdopted:true}))};
    const row=(selectedVariants:boolean)=>({...pin,status:'installation-migration-exercised',candidateArtifactSha256:h,dependencyMode:'historical-frozen-lockfile',sourceVerification:{before:true,after:true},selectedVariants,installation:{verified:true,gaps:[],selectedVariants:{status:'verified'},...(selectedVariants?{manualFixture}:{})},migration});
    expect(publishedMatrixGaps([pin],[row(false)],[row(true)],runner)).toEqual([]);
    // Protects the complete publication boundary. Oracle: verified UV input,
    // published manual returns and native tool invocation contracts. Fails if
    // a nonfunctional command or altered fixed provenance can qualify a row.
    const acceptedMutations: string[]=[];
    for (const [label, mutate] of Object.entries({
      wrongExecutable: (f:any)=>{f.configuration.commands.serena.unshift('/bin/false');},
      missingSubcommand: (f:any)=>{f.configuration.commands.serena.pop();},
      extraArgument: (f:any)=>{f.configuration.commands.serena.push('--foreign');},
      duplicateArgument: (f:any)=>{f.configuration.commands.serena.push('start-mcp-server');},
      swappedCapabilities: (f:any)=>{[f.configuration.commands.serena,f.configuration.commands['codebase-memory']]=[f.configuration.commands['codebase-memory'],f.configuration.commands.serena];},
      codebaseExtra: (f:any)=>{f.configuration.commands['codebase-memory'].push('--foreign');},
      alteredUv: (f:any)=>{f.artifacts[0].uvSha256=h;},
      alteredSuccess: (f:any)=>{f.historicalProbe.outcome[0].success=runner!=='pi';},
      alteredStatus: (f:any)=>{f.historicalProbe.outcome[0].status='installed';},
      alteredAction: (f:any)=>{f.historicalProbe.outcome[0].actionKind='install-pi-package';},
    })) {
      const changed=structuredClone(row(true));
      mutate(changed.installation.manualFixture);
      if (!publishedMatrixGaps([pin],[row(false)],[changed],runner).length) acceptedMutations.push(label);
    }
    expect(acceptedMutations, `${version}/${runner}`).toEqual([]);
    expect(publishedMatrixGaps([pin],[row(false)],[{...row(true),migration:{...migration,admission:undefined}}],runner).length).toBeGreaterThan(0);
  }
});
