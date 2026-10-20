import { afterEach, expect, test } from 'bun:test';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import { PushAttentionStore } from '../push-attention-store';
import { writePrivateFile } from '../paths';
import { cleanupTempDirs, tempDir } from './test-helpers';
import type { AttentionItem } from '../push-attention';
afterEach(cleanupTempDirs);
const device = JSON.stringify(['d', 'https://deck.test']);
const item: AttentionItem = { sessionId: 's', kind: 'decision', key: 'decision:a', seq: 1, revision: 1, ts: 1000, summary: 'PRIVATE CONTENT' };
test('receipt migration, invalid store floors, private mode and no persisted content', () => {
    const dir = tempDir();
    let now = 1000;
    let store = new PushAttentionStore(dir, () => now);
    store.sync([device]);
    expect(store.eligible(device, { ...item, ts: 999 })).toBe(false);
    expect(store.eligible(device, item)).toBe(true);
    store.record(device, item, 'sent');
    store = new PushAttentionStore(dir, () => now);
    expect(store.eligible(device, item)).toBe(false);
    const file = join(dir, 'push-attention.json');
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readFileSync(file, 'utf8')).not.toContain('PRIVATE CONTENT');
    writePrivateFile(file, '{"v":1,"devices":[["bad",{}]]}');
    now = 2000;
    store = new PushAttentionStore(dir, () => now);
    store.sync([device]);
    expect(store.eligible(device, item)).toBe(false);
    expect(store.eligible(device, { ...item, ts: 2000 })).toBe(true);
    store.remove(device);
    store.sync([device]);
    expect(store.eligible(device, item)).toBe(false);
});
test('bounded receipts and views; older retry cannot overwrite newer revision', () => {
    const dir = tempDir(), store = new PushAttentionStore(dir, () => 1000);
    store.sync([device]);
    for (let n = 0; n < 600; n++)
        store.record(device, { ...item, key: `decision:${n}` }, 'sent');
    for (let n = 0; n < 80; n++)
        store.viewed(device, `s${n}`, n + 1);
    const raw = JSON.parse(readFileSync(join(dir, 'push-attention.json'), 'utf8'));
    expect(raw.devices[0][1].delivered).toBeUndefined();
    expect(store.cacheEntries).toBeLessThanOrEqual(512);
    const db=new Database(join(dir,'push-attention.sqlite'),{readonly:true});
    expect((db.query('SELECT COUNT(*) AS n FROM outcomes').get() as any).n).toBe(600);db.close();
    expect(raw.devices[0][1].viewed).toHaveLength(64);
    store.record(device, { ...item, key:'decision:0', revision: 2 }, 'sent');
    store.record(device, {...item,key:'decision:0'}, 'failed');
    expect(store.eligible(device, { ...item, key:'decision:0', revision: 2 })).toBe(false);
    expect(store.eligible(device, { ...item, key:'decision:0', revision: 3 })).toBe(true);
});

test('capacity preserves terminal sent and failed receipts across reload without covering pending attention',()=>{
 for(const outcome of ['sent','failed'] as const){
  const dir=tempDir();let store=new PushAttentionStore(dir,()=>1000);store.sync([device]);
  for(let n=0;n<512;n++)store.record(device,{...item,sessionId:`s${Math.floor(n/16)}`,key:`decision:${n}`},outcome);
  const first={...item,sessionId:'s0',key:'decision:0'},pending={...item,sessionId:'independent',key:'decision:pending'};
  expect(store.record(device,pending,'sent')).toBe(true);
  store=new PushAttentionStore(dir,()=>1100);expect(store.eligible(device,first)).toBe(false);expect(store.eligible(device,pending)).toBe(false);
 }
});

test('v1 migration preserves floor, sent/failed receipts and views without reloading index per event',()=>{
 const dir=tempDir(),legacy={v:1,devices:[[device,{since:1000,viewed:[['viewed',7]],delivered:[
  [JSON.stringify(['s','decision:a']),{revision:1,seq:1,outcome:'sent',at:1000}],
  [JSON.stringify(['s','decision:b']),{revision:2,seq:2,outcome:'failed',at:1000,expires:86401001}],
 ]}]]};
 writePrivateFile(join(dir,'push-attention.json'),JSON.stringify(legacy));const store=new PushAttentionStore(dir,()=>1100);
 expect(store.healthy).toBe(true);expect(store.eligible(device,item)).toBe(false);expect(store.eligible(device,{...item,key:'decision:b',revision:2})).toBe(false);
 expect(store.eligible(device,{...item,key:'independent',ts:1000})).toBe(true);expect(store.eligible(device,{...item,sessionId:'viewed',seq:7})).toBe(false);
 const epoch=store.epoch(device);store.sync([device]);store.close();const reload=new PushAttentionStore(dir,()=>1200);expect(reload.epoch(device)).toBe(epoch);expect(reload.eligible(device,item)).toBe(false);
 const metadata=readFileSync(join(dir,'push-attention.json'),'utf8');expect(JSON.parse(metadata).v).toBe(2);
 for(let n=0;n<550;n++)expect(reload.record(device,{...item,key:'extra:'+n},n%2?'sent':'failed')).toBe(true);
 expect(reload.cacheEntries).toBeLessThanOrEqual(512);expect(readFileSync(join(dir,'push-attention.json'),'utf8')).toBe(metadata);
 expect(statSync(join(dir,'push-attention.sqlite')).mode&0o777).toBe(0o600);
 const db=new Database(join(dir,'push-attention.sqlite'),{readonly:true});expect((db.query('SELECT COUNT(*) AS n FROM outcomes').get() as any).n).toBe(552);db.close();reload.close();
});
test('expiry and opt-out compact exact identities without hiding independent work',()=>{
 const dir=tempDir();let now=1000;const store=new PushAttentionStore(dir,()=>now);store.sync([device]);
 store.record(device,{...item,kind:'result'},'sent');store.record(device,{...item,key:'long'},'failed');
 now+=1800001;expect(store.maintain()).toBe(true);
 expect(store.eligible(device,{...item,kind:'result'})).toBe(false);expect(store.eligible(device,{...item,key:'long'})).toBe(false);
 expect(store.eligible(device,{...item,kind:'result',key:'independent',ts:now})).toBe(true);
 const db=new Database(join(dir,'push-attention.sqlite'),{readonly:true});expect((db.query('SELECT COUNT(*) AS n FROM outcomes').get() as any).n).toBe(1);
 const epoch=store.epoch(device);store.remove(device);store.sync([device]);expect(store.epoch(device)).not.toBe(epoch);expect((db.query('SELECT COUNT(*) AS n FROM outcomes').get() as any).n).toBe(0);db.close();store.close();
});
test('failed writes retain volatile known outcomes, expose unhealthy state and recover by exact flush',()=>{
 const dir=tempDir(),store=new PushAttentionStore(dir,()=>1000);store.sync([device]);const db=(store as any).db as Database;
 db.exec('PRAGMA query_only=ON');expect(store.record(device,item,'sent')).toBe(false);expect(store.writeFailures).toBeGreaterThan(0);expect(store.healthy).toBe(false);
 expect((db.query('SELECT COUNT(*) AS n FROM outcomes').get() as any).n).toBe(0);expect(store.eligible(device,{...item,key:'unseen'})).toBe(false);expect(store.maintain()).toBe(false);
 db.exec('PRAGMA query_only=OFF');expect(store.maintain()).toBe(true);expect(store.eligible(device,item)).toBe(false);expect(store.eligible(device,{...item,key:'unseen'})).toBe(true);
 store.close();const reload=new PushAttentionStore(dir,()=>1100);expect(reload.eligible(device,item)).toBe(false);reload.close();
});

test('failed legacy migration preserves original receipts until the index can be repaired',async()=>{
 const {rmSync}=await import('node:fs');const dir=tempDir(),file=join(dir,'push-attention.json'),index=join(dir,'push-attention.sqlite');
 const legacy=JSON.stringify({v:1,devices:[[device,{since:1000,viewed:[],delivered:[[JSON.stringify(['s','decision:a']),{revision:1,seq:1,outcome:'failed',at:1000}]]}]]});
 writePrivateFile(file,legacy);writePrivateFile(index,'not a SQLite database');const broken=new PushAttentionStore(dir,()=>1100);broken.sync([device]);expect(broken.healthy).toBe(false);expect(broken.maintain()).toBe(false);expect(readFileSync(file,'utf8')).toBe(legacy);broken.close();
 rmSync(index);const repaired=new PushAttentionStore(dir,()=>1200);expect(repaired.healthy).toBe(true);expect(repaired.eligible(device,item)).toBe(false);expect(repaired.eligible(device,{...item,key:'unseen',ts:1000})).toBe(true);repaired.close();
});
test('loss of a v2 index is an explicit storage error, never an empty delivery history',async()=>{
 const {rmSync}=await import('node:fs');const dir=tempDir();const store=new PushAttentionStore(dir,()=>1000);store.sync([device]);store.record(device,item,'sent');store.close();rmSync(join(dir,'push-attention.sqlite'));
 const missing=new PushAttentionStore(dir,()=>1100);expect(missing.healthy).toBe(false);expect(missing.readFailures).toBeGreaterThan(0);expect(missing.maintain()).toBe(false);expect(missing.eligible(device,item)).toBe(false);missing.close();
 const restarted=new PushAttentionStore(dir,()=>1200);expect(restarted.healthy).toBe(false);expect(restarted.maintain()).toBe(false);expect(restarted.eligible(device,item)).toBe(false);restarted.close();
});

test('revocation deletion failures retry lifecycle compaction without crossing authorization epochs',()=>{
 const dir=tempDir(),store=new PushAttentionStore(dir,()=>1000);store.sync([device]);store.record(device,item,'sent');const epoch=store.epoch(device),db=(store as any).db as Database;
 db.exec('PRAGMA query_only=ON');store.remove(device);store.sync([device]);expect(store.epoch(device)).not.toBe(epoch);expect(store.healthy).toBe(false);
 db.exec('PRAGMA query_only=OFF');expect(store.maintain()).toBe(true);expect((db.query('SELECT COUNT(*) AS n FROM outcomes').get() as any).n).toBe(0);expect(store.eligible(device,item)).toBe(true);store.close();
});
