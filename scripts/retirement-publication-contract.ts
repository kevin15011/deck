/** Publication evidence contracts, deliberately separate from migration authority. */
import { createHash } from 'node:crypto';
import { upstreamPins } from './retirement-historical-effects';

export const publishedManualHashes: Record<string, string> = {
  'core': '231e8e8bdcc7b0bf8379a62d2f4c487e1cad16829e9ee7ae1f50f4750bd8b47a',
  'pi/catalog': '56a9a6218186dcdccecd37e8c7f0d4256b3e66e3feed2870b4c83f213ea7f317',
  'pi/installer': '0d2a15e629ec96bf6a5ace4ef45f0c3805bd74115fc7af6922d634afccad5e9e',
  'opencode/catalog': '1688fc05d004229b221a20b64cdb0673c523705e813a47520160816a44049874',
  'opencode/installer': 'd4c851def82b6c191f6e55a6118b2735c7008d032bbbc7a8e42ee9cf5303c013',
};

const manualModel = 'manual-external-tool-fixture-v1';
const digest = (value: any) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) && !/^0+$/.test(value);
export function manualNativeCommands(serena: string, codebase: string): Record<string, string[]> {
  return { serena: [serena, 'start-mcp-server'], 'codebase-memory': [codebase] };
}
export function matchesPublishedManualOutcome(runner: string, outcome: any): boolean {
  return Array.isArray(outcome) && outcome.length === 1 && (runner === 'pi'
    ? outcome[0]?.success === true && outcome[0]?.status === 'manual' && outcome[0]?.actionKind === 'manual-external-install'
    : outcome[0]?.success === false && outcome[0]?.status === undefined && outcome[0]?.actionKind === undefined);
}
export function manualProvisioningGaps(fixture: any): string[] {
  const gaps: string[] = [];
  if (fixture?.model !== manualModel) return ['Missing manual external-tool fixture provenance'];
  if (!['pi','opencode'].includes(fixture.runner) || !['0.0.1','0.0.2'].includes(fixture.version)) gaps.push('Manual fixture epoch is unsupported');
  const probe = fixture.historicalProbe;
  const expectedInputs = ['core', `${fixture.runner}/catalog`, `${fixture.runner}/installer`].map(key => publishedManualHashes[key]);
  if (probe?.historicalDeckInstallEffect !== false || probe.commands !== 0 || probe.serenaInCatalog !== false || probe.codebaseInstallKind !== 'external' || probe.inputs?.length !== 3 || probe.inputs.some((input: any) => !input.path || !digest(input.sha256) || input.sha256 !== expectedInputs[probe.inputs.indexOf(input)]) || !matchesPublishedManualOutcome(fixture.runner, probe.outcome)) gaps.push('Original manual installer probe is unverified');
  if (fixture.configuration?.historicalDeckInstallEffect !== false || !digest(fixture.configuration.sha256) || !digest(fixture.configuration.publishedFormatSource?.sha256)) gaps.push('Manual native configuration provenance is incomplete');
  if (fixture.artifacts?.length !== 2 || Object.keys(fixture.configuration?.commands ?? {}).length !== 2) gaps.push('Manual prerequisite inventory mismatch');
  for (const capability of ['serena', 'codebase-memory']) {
    const artifacts = fixture.artifacts?.filter((artifact: any) => artifact.capability === capability) ?? [];
    const artifact = artifacts[0];
    if (artifacts.length !== 1 || artifact.historicalDeckInstallEffect !== false || artifact.method !== 'fixture-provisioned-shared-prerequisite' || artifact.probeStatus !== 0 || !digest(artifact.sha256) || !artifact.path || !artifact.pin || capability === 'serena' && (!digest(artifact.lockSha256) || artifact.uvSha256 !== upstreamPins.uvBinarySha256)) gaps.push(`Manual ${capability} provisioning is incomplete or falsely attributed`);
    if (artifact && (artifact.pin !== (capability === 'serena' ? 'serena-agent==1.3.0' : 'codebase-memory-mcp@0.11.0') || JSON.stringify(fixture.configuration?.commands?.[capability]) !== JSON.stringify(manualNativeCommands(artifact.path, artifact.path)[capability]))) gaps.push(`Manual ${capability} pin or native command mismatch`);
  }
  return gaps;
}
export function manualFixtureGaps(fixture: any, migration: any): string[] {
  const gaps = manualProvisioningGaps(fixture);
  for (const capability of ['serena', 'codebase-memory']) {
    const artifact = fixture?.artifacts?.find((item: any) => item.capability === capability);
    if (!artifact || !migration?.installedArtifactChecks?.some((check: any) => check.path === artifact.path && check.capability === capability && check.beforeHash === artifact.sha256 && check.status === 'verified' && check.notAdopted === true)) gaps.push(`Manual ${capability} migration is unverified`);
  }
  if (!['admit', 'degraded'].includes(migration?.admission?.verdict)) gaps.push('Manual fixture candidate admission is unverified');
  return gaps;
}


export function installationEffectIdentity(files: readonly { path: string; blob: string }[], inputs: Record<string, string>): string {
  return createHash('sha256').update(JSON.stringify({
    files: [...files].sort((a, b) => a.path.localeCompare(b.path)),
    inputs: Object.fromEntries(Object.entries(inputs).sort(([a], [b]) => a.localeCompare(b))),
  })).digest('hex');
}

export function publicationGaps(installation: any, migration: any, options: { requireSelectedVariants?: boolean } = {}): string[] {
  const gaps: string[] = [...(installation?.gaps ?? [])];
  if (installation?.manualFixture) gaps.push(...manualFixtureGaps(installation.manualFixture, migration));
  if (installation?.verified !== true) gaps.push('Historical installation is unverified');
  if (migration?.verified !== true || migration.remaining !== 0) gaps.push('Managed migration result is incomplete');
  if (!migration?.rtk?.length) gaps.push('No preserved installed RTK command was exercised');
  else if (migration.rtk.some((probe: any) => probe.status !== 0 || !probe.beforeHash || probe.beforeHash !== probe.afterHash)) gaps.push('Preserved RTK functionality or content identity failed');
  if (migration?.search?.functional?.status !== 'verified' || migration.search.functional.evidence !== 'real-provider-query') gaps.push('Live search functionality is unverified');
  if(options.requireSelectedVariants!==false){
    if (installation?.selectedVariants?.status !== 'verified') gaps.push('Selected Serena/Codebase Memory installation variants are unverified');
    else if(!migration?.installedArtifactChecks?.length||migration.installedArtifactChecks.some((check:any)=>check.status!=='verified'))gaps.push('Historical selected Codebase Memory artifact retirement is unverified');
  }
  if (!migration?.scenarios?.length || migration.scenarios.some((scenario: any) => scenario.status !== 'verified' && !(scenario.status === 'not-applicable' && scenario.detail))) gaps.push('Preservation/recovery scenarios are incomplete');
  return [...new Set(gaps)];
}

/** CI requires both complete phases for the same pinned inventory and candidate. */
export function publishedMatrixGaps(pins: readonly any[], base: readonly any[], selected: readonly any[], runner: string): string[] {
  const expected=pins.filter(row=>row.runner===runner),gaps:string[]=[],builds=new Set<string>();
  if(!expected.length)return ['No pinned runner inventory'];
  for(const [phase,rows] of [['base',base],['selected',selected]] as const){
    const groups=new Map<string,any[]>();
    for(const row of rows){
      if(row.runner!==runner||!expected.some(pin=>pin.version===row.version))gaps.push(`${phase}: unexpected inventory row`);
      const group=groups.get(row.version)??[];group.push(row);groups.set(row.version,group);
    }
    for(const pin of expected){
      const group=groups.get(pin.version)??[],prefix=`${pin.version}/${runner} ${phase}`;
      if(group.length!==1){gaps.push(`${prefix}: ${group.length?'duplicate':'missing'} row`);continue;}
      const row=group[0];
      if(row.commit!==pin.commit||row.sourceTree!==pin.sourceTree||row.installerBlob!==pin.installerBlob)gaps.push(`${prefix}: published source identity mismatch`);
      if(typeof row.candidateArtifactSha256!=='string'||! /^[a-f0-9]{64}$/.test(row.candidateArtifactSha256)||/^0+$/.test(row.candidateArtifactSha256))gaps.push(`${prefix}: invalid candidate identity`);
      else builds.add(row.candidateArtifactSha256);
      if(row.dependencyMode!=='historical-frozen-lockfile'||row.selectedVariants!==(phase==='selected'))gaps.push(`${prefix}: incorrect execution mode`);
      if(pin.applicability==='unsupported-runner-version'){
        if(row.status!=='unsupported')gaps.push(`${prefix}: unsupported combination was counted as exercised`);
        continue;
      }
      if(row.sourceVerification?.before!==true||row.sourceVerification?.after!==true)gaps.push(`${prefix}: released source inputs were not verified before and after installer effects`);
      if(phase==='selected' && ['0.0.1','0.0.2'].includes(pin.version) && ['pi','opencode'].includes(runner)) {
        if(row.installation?.manualFixture?.version!==pin.version || row.installation?.manualFixture?.runner!==runner) gaps.push(`${prefix}: manual external-tool fixture epoch mismatch`);
        gaps.push(...manualFixtureGaps(row.installation?.manualFixture,row.migration).map(gap=>`${prefix}: ${gap}`));
      }
      if(row.status!=='installation-migration-exercised')gaps.push(`${prefix}: installation/migration incomplete`);
      gaps.push(...publicationGaps(row.installation,row.migration,{requireSelectedVariants:phase==='selected'}).map(gap=>`${prefix}: ${gap}`));
    }
  }
  if(builds.size!==1)gaps.push('Base and selected phases must verify one identical candidate artifact');
  return [...new Set(gaps)];
}
