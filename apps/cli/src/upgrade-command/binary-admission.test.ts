import { expect, test } from 'bun:test';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acquireInstallationUse } from '../../../../packages/core/src/installation-use';
import { withBinaryUpgradeAdmission } from './binary-admission';
// Oracle: an active native child excludes an executable swap without stopping that child.
test('binary replacement waits for installed native leases and releases reservations', async () => {
 const root=realpathSync(mkdtempSync(join(tmpdir(),'deck-binary-admission-')));
 let swaps=0;const use=acquireInstallationUse(root);
 try {
  await expect(withBinaryUpgradeAdmission([root],async()=>{swaps++;},async effect=>effect())).rejects.toThrow('deferred');
  expect(swaps).toBe(0);
  use.release();
  await withBinaryUpgradeAdmission([root],async()=>{swaps++;},async effect=>effect());
  expect(swaps).toBe(1);
  const next=acquireInstallationUse(root);next.release();
 }finally{use.release();rmSync(root,{recursive:true,force:true});}
});
