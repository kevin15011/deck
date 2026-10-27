import { expect, test } from 'bun:test';
import { join } from 'node:path';

for (const runner of ['opencode', 'codex', 'pi', 'claude']) for (const scenario of ['clean','drift','apply-failure',...(runner === 'opencode' ? ['receipt-drift','legacy','inventory-failure','inventory-drift','legacy-inventory'] : []),...(runner === 'claude' ? ['unrecorded-receipt','legacy-inventory'] : [])]) {
  test(`public backup rollback ${runner} composition (${scenario})`, async () => {
    const child = Bun.spawn([process.execPath, 'run', join(import.meta.dir, '__fixtures__/runner-recovery.ts'), runner, scenario], { stdout: 'pipe', stderr: 'pipe' });
    const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect({ exit, stderr, stdout }).toMatchObject({ exit: 0 });
  }, 60_000);
}
