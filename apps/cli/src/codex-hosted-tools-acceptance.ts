/** Opt-in real native CLI check; never part of the fast suite. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

const [directory, mode] = process.argv.slice(2);
const runner = 'codex';
assert(process.platform === 'linux' && directory && isAbsolute(directory) && ['claude','codex','opencode'].includes(runner!), 'Usage: bun apps/cli/src/codex-hosted-tools-acceptance.ts <new-absolute-evidence-directory>');
const binary = Bun.which(runner!)!, node = Bun.which('node')!;
assert(binary && node, 'The requested native CLI and Node must already be installed');
mkdirSync(directory, { mode: 0o700 });
const executables = [process.execPath, node, binary].map(path => realpathSync(path));
const args = ['unshare','-Urnm','--pid','--fork','--kill-child','sh',resolve(import.meta.dir,'__fixtures__/native-memory/isolate-lifecycle.sh'),resolve(import.meta.dir,'../../..'),directory,runner!,...executables,'/workspace/apps/cli/src/__fixtures__/native-memory/codex-hosted.ts', mode ?? ''];
const start = performance.now();
const child = Bun.spawn(args, { env: { PATH: '/usr/bin:/bin' }, stdout: 'pipe', stderr: 'pipe' });
const timer = setTimeout(() => child.kill('SIGKILL'), 55_000);
const [code, stdout, stderr] = await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]).finally(()=>clearTimeout(timer));
writeFileSync(resolve(directory,'stdout.log'),stdout,{mode:0o600});
writeFileSync(resolve(directory,'stderr.log'),stderr,{mode:0o600});
writeFileSync(resolve(directory,'execution.json'),JSON.stringify({argv:args,envNames:['PATH'],code,durationMs:performance.now()-start,executables:executables.map(path=>({path,sha256:createHash('sha256').update(readFileSync(path)).digest('hex')}))},null,2)+'\n',{mode:0o600});
assert.equal(code,0,`Isolated ${runner} canary failed; see ${directory}/stderr.log`);
console.log(JSON.stringify({runner,evidence:directory,result:'passed'}));
