import { expect, test } from 'bun:test';
import { decideDaemonAction } from '../daemon-build-policy';
const client = {semver:'1.0.0',commit:'new',channel:'canary' as const};
// Oracle: protocol determines compatibility; build drift only requests an idle same-channel update.
test('same-version rebuilds converge without channel ping-pong or interrupting work', () => {
 const old = {...client,commit:'old'};
 expect(decideDaemonAction(client,{protocol:1,build:old,version:'1.0.0',busy:false},true)).toBe('restart');
 expect(decideDaemonAction(client,{protocol:1,build:client,version:'1.0.0',busy:false},true)).toBe('use');
 expect(decideDaemonAction(client,{protocol:1,build:old,version:'1.0.0',busy:true},true)).toBe('daemon-update-pending');
 expect(decideDaemonAction(client,{protocol:1,build:{...old,channel:'stable'},version:'1.0.0',busy:false},true)).toBe('daemon-other-build');
 expect(decideDaemonAction(client,{protocol:1,build:old,version:'1.0.0',busy:false},false)).toBe('daemon-other-build');
 expect(decideDaemonAction(client,{protocol:1,version:'1.0.0',busy:false},true)).toBe('use');
 expect(decideDaemonAction(client,{protocol:2,build:old,version:'1.0.0',busy:true},true)).toBe('daemon-incompatible-busy');
});
