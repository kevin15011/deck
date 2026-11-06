import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { appendRunnerHistory, readRunnerHistory } from './runner-history';
import { contributionId, contributionHash, type RunnerContribution } from './runner-contributions';
// Protects full installed catalogs exceeding the old 4096-slot ceiling. Exact
// per-slot hashes survive publication/retry; capacity failure preserves prior bytes.
test('complete catalogs publish bounded ownership history and retry', () => {
 const root = mkdtempSync('/private/tmp/deck-history-catalog-'), path = root + '/history.json';
 const entry = (index: number): RunnerContribution => {
  const target = { path: `${root}/skills/resource-${index}`, selector: {kind:'file' as const}, sourceItemId:'team:developer-team' };
  return {...target,id:contributionId(target),hash:contributionHash('canonical'),scope:'global',ownership:'new-write',encoding:'bytes'};
 };
 try {
  const catalog = Array.from({length:7400}, (_,i)=>entry(i));
  appendRunnerHistory(path,catalog);
  expect(Object.keys(readRunnerHistory(path))).toHaveLength(7400);
  const before=readFileSync(path,'utf8');
  appendRunnerHistory(path,catalog);
  expect(readFileSync(path,'utf8')).toBe(before);
  expect(()=>appendRunnerHistory(path,Array.from({length:16385},(_,i)=>entry(i)))).toThrow('runner-history-capacity');
  expect(readFileSync(path,'utf8')).toBe(before);
 } finally {rmSync(root,{recursive:true,force:true});}
});
