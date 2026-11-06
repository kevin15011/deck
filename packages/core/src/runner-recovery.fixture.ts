// Test-only child: terminate after real publication syscalls, never used by production.
import { spyOn } from 'bun:test';
import * as fs from 'node:fs';
import { join } from 'node:path';
import { archiveRunnerJournal } from './runner-recovery-archive';
import { writePrivateState } from './runner-history';
import { withInstallationMutation } from './installation-use';
import { readRunnerFence, recordRunnerMutationJournals, withRunnerFenceRecovery } from './runner-writer-fence';
const [root, boundary, project] = process.argv.slice(2) as [string, string, string];
const path = join(root, 'fence.json'), livePath = join(root, 'transaction.pending.json');
const die = () => { process.kill(process.pid, 'SIGKILL'); throw Error('SIGKILL did not terminate child'); };
const link = fs.linkSync, unlink = fs.unlinkSync, rename = fs.renameSync;
spyOn(fs, 'linkSync').mockImplementation((a, b) => { link(a, b); if (boundary === 'link') die(); });
spyOn(fs, 'unlinkSync').mockImplementation(p => { unlink(p); if (boundary === 'unlink' && p === livePath) die(); });
spyOn(fs, 'renameSync').mockImplementation((a, b) => {
 rename(a, b);
 if (b !== path) return;
 const pending = JSON.parse(fs.readFileSync(path, 'utf8')).pending;
 if (boundary === 'commit' && !pending) die();
 const refs = pending?.journals ?? [];
 if (boundary === 'takeover' && refs[0]?.kind === 'canonical-recovery-v1' && refs.some((r: any) => r.id === 'original')) die();
 if (boundary === 'release' && refs.length === 2) die();
 if (boundary === 'record' && refs.some((r: any) => r.id === 'child')) die();
});
await withInstallationMutation(root, () => withRunnerFenceRecovery({ path, mutationRoot: root, expected: readRunnerFence(path), journalKinds: ['fixture-journal'], self: { semver: '1.0.0', commit: 'abc', channel: 'stable' }, stateSchema: 1,
 context: project === 'global' ? { intent: 'refresh' } : { intent: 'explicit', projectRoot: project }, maximumAdapterJournals: 1,
 archive: async references => { for (const reference of references) archiveRunnerJournal({ livePath, reference, bound: references, journalKinds: ['fixture-journal'] }); },
 reconcile: async () => {
  recordRunnerMutationJournals([{ kind: 'fixture-journal', id: 'child', operationId: 'child' }]);
  writePrivateState(livePath, { forensic: 'child' }); if (boundary === 'journal') die();
  writePrivateState(join(root, 'output.json'), { canonical: true }); if (boundary === 'publication') die();
  fs.unlinkSync(livePath);
 },
 verify: async () => { if (boundary === 'verify') die(); return true; },
}));
throw Error('Boundary was not reached');
