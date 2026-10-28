/** Runs inside the host anchor's process group. Only this relay can frame IPC;
 * child stdout is always enclosed as data, so printed JSON cannot attest a launch. */
export const PI_SESSION_RELAY = String.raw`
import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';
const [command, ...args] = JSON.parse(process.env.DECK_PI_RELAY_COMMAND);
delete process.env.DECK_PI_RELAY_COMMAND;
const group = execFileSync('ps', ['-o', 'pgid=', '-p', String(process.pid)], {encoding:'utf8'}).trim();
if (!/^[1-9][0-9]*$/.test(group)) throw new Error('pi-host-group-unavailable');
const send = (channel, value) => process.stdout.write(JSON.stringify({channel,value})+'\n');
const child = spawn(command, args, {detached:false, shell:false, stdio:['ignore','pipe','pipe','ipc'],
  env:{...process.env, DECK_PI_GROUP_PID:group}});
child.on('spawn', () => send('spawned', {pid:child.pid}));
child.on('message', value => send('ipc', value));
createInterface({input:process.stdin}).on('line', line => {
  try { const value=JSON.parse(line); if(child.connected)child.send(value,()=>{}); } catch { child.kill('SIGTERM'); }
});
child.on('disconnect', () => send('revoked', null));
child.stdout.on('data', bytes => send('stdout', bytes.toString('base64')));
child.stderr.on('data', bytes => process.stderr.write(bytes));
child.on('error', () => { process.exitCode=1; });
// A native exit revokes authority immediately, even while descendants retain pipes.
child.on('exit', (code, signal) => { send('revoked', null); process.exitCode=signal ? 1 : code ?? 1; });
child.on('close', () => { process.stdin.destroy(); });
// Host cancellation owns the whole group; the relay never signals a remembered PID.
process.on('SIGINT', () => child.kill('SIGINT'));
`;
