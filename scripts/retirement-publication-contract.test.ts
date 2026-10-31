import { expect, test } from 'bun:test';
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
