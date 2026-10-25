/** Fresh-install contracts in separate, private process namespaces. No native/model session claim. */
import { mkdirSync, mkdtempSync, writeFileSync, openSync, closeSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const suites = [
  'apps/cli/src/native-package-retirement-fresh.test.ts',
  'apps/cli/src/native-package-retirement-install.test.ts',
  'packages/core/src/config/package-retirement.test.ts',
  'packages/core/src/teams/developer/package-retirement-output.test.ts',
  'apps/cli/src/native-search-preparation.test.ts',
  'apps/cli/src/session-shared-services.test.ts',
  'apps/cli/src/runner-launch-command.test.ts',
  'apps/cli/src/claude-team-launch.test.ts',
  'apps/cli/src/runner-migration-gates.test.ts',
  'apps/cli/src/upgrade-command/runner-recovery-composition.test.ts',
];
const output = process.argv[2] ? resolve(process.argv[2]) : mkdtempSync(join(tmpdir(), 'deck-fresh-evidence-'));
mkdirSync(output, { recursive: true, mode: 0o700 });
const results: { suite: string; exitCode: number; log: string }[] = [];
for (const [index, suite] of suites.entries()) {
  const home = mkdtempSync(join(tmpdir(), 'deck-fresh-contract-'));
  const dirs = Object.fromEntries(['data', 'config', 'cache', 'state', 'runtime', 'tmp', 'cbm', 'codex', 'pi'].map(name => [name, join(home, name)]));
  for (const dir of Object.values(dirs)) mkdirSync(dir!, { recursive: true, mode: 0o700 });
  const log = join(output, `${index}-${suite.split('/').pop()}.log`);
  const fd = openSync(log, 'wx', 0o600);
  const child = Bun.spawn([process.execPath, 'test', '--timeout', '120000', suite], {
    cwd: process.cwd(),
    // Do not inherit provider credentials, active Deck session identifiers or user config roots.
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin', LANG: 'C.UTF-8', HOME: home,
      XDG_DATA_HOME: dirs.data, XDG_CONFIG_HOME: dirs.config, XDG_CACHE_HOME: dirs.cache,
      XDG_STATE_HOME: dirs.state, XDG_RUNTIME_DIR: dirs.runtime, TMPDIR: dirs.tmp,
      CBM_RUNTIME_DIR: dirs.cbm, CODEX_HOME: dirs.codex, PI_CODING_AGENT_DIR: dirs.pi,
      npm_config_cache: join(dirs.cache!, 'npm'), BUN_INSTALL_CACHE_DIR: join(dirs.cache!, 'bun') },
    stdout: fd, stderr: fd,
  });
  const timeout = setTimeout(() => child.kill('SIGKILL'), 600000);
  const exitCode = await child.exited;
  clearTimeout(timeout);
  closeSync(fd);
  results.push({ suite, exitCode, log });
  writeFileSync(join(output, 'results.json'), JSON.stringify({ kind: 'isolated-source-contracts', bun: Bun.version, results }, null, 2));
  console.log(`${exitCode === 0 ? 'PASS' : 'FAIL'} ${suite} (${log})`);
}
if (results.some(result => result.exitCode !== 0)) process.exitCode = 1;
