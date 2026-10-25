// Hold an old production starter after it reads a dead reservation. A different
// process may replace the daemon and reserve maintenance before this one resumes.
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { systemClock } from '../../clock';
import { startDaemon } from '../../daemon';
import { resolveStatePaths } from '../../paths';
import { createNodeProbe } from '../../process-probe';

const home = process.argv[2]!;
const paths = resolveStatePaths({ env: { HOME: home }, tmpdir: home });
const probe = createNodeProbe();
let held = false;
let staleProbes = 0;
try {
  const started = await startDaemon({
    paths, version: 'old-startup', anchorCommand: [process.execPath], recoverOnStart: false,
    createService: () => ({ execute: async () => ({ ok: true }), openLog: () => undefined, hasRunningWork: () => false, hasActiveSessions: () => false }),
    clock: { ...systemClock, now: () => Date.now() - 20000 },
    probe: { ...probe, presence(pid) {
      if (pid === 2147483647 && ++staleProbes === (process.argv[3] === 'guarded' ? 2 : 1) && !held) {
        held = true;
        writeFileSync(join(home, 'paused'), 'read stale marker');
        const deadline = Date.now() + 8000;
        while (!existsSync(join(home, 'resume'))) {
          if (Date.now() > deadline) throw Error('fixture barrier timeout');
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
        }
        return 'absent';
      }
      return probe.presence(pid);
    } },
  });
  if (started.ok) await started.daemon.stop('test');
} catch {
  // Losing startup may fail at socket binding. Reservation integrity is asserted
  // by the parent through the newer daemon's real admission path.
}
