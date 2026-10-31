/** Publication evidence contracts, deliberately separate from migration authority. */
import { createHash } from 'node:crypto';

export function installationEffectIdentity(files: readonly { path: string; blob: string }[], inputs: Record<string, string>): string {
  return createHash('sha256').update(JSON.stringify({
    files: [...files].sort((a, b) => a.path.localeCompare(b.path)),
    inputs: Object.fromEntries(Object.entries(inputs).sort(([a], [b]) => a.localeCompare(b))),
  })).digest('hex');
}

export function publicationGaps(installation: any, migration: any, options: { requireSelectedVariants?: boolean } = {}): string[] {
  const gaps: string[] = [...(installation?.gaps ?? [])];
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
      if(row.status!=='installation-migration-exercised')gaps.push(`${prefix}: installation/migration incomplete`);
      gaps.push(...publicationGaps(row.installation,row.migration,{requireSelectedVariants:phase==='selected'}).map(gap=>`${prefix}: ${gap}`));
    }
  }
  if(builds.size!==1)gaps.push('Base and selected phases must verify one identical candidate artifact');
  return [...new Set(gaps)];
}
