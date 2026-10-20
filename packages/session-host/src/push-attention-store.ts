/** Private exact outcomes. 512 bounds the read cache, never delivery or durable identity. */
import { Database } from 'bun:sqlite';
import { randomUUID, createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync, openSync, closeSync, constants } from 'node:fs';
import { join } from 'node:path';
import { assertPrivateFile, writePrivateFile } from './paths';
import type { AttentionItem } from './push-attention';
type Receipt = { revision: number; seq: number; outcome: 'sent' | 'suppressed' | 'failed'; at: number; expires: number };
type Device = { since: number; epoch: string; viewed: Map<string, number> };
type Cached = { auth: string; id: string; receipt?: Receipt; dirty?: boolean };
const integer = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
export const attentionExpires = (a: AttentionItem) => a.ts + (['result', 'finished'].includes(a.kind) ? 30 * 60_000 : 24 * 60 * 60_000) + 1;
const UPSERT = `INSERT INTO outcomes(auth,id,revision,seq,outcome,at,expires) VALUES (?,?,?,?,?,?,?)
 ON CONFLICT(auth,id) DO UPDATE SET revision=excluded.revision,seq=excluded.seq,outcome=excluded.outcome,at=excluded.at,expires=excluded.expires WHERE excluded.revision>=outcomes.revision`;
export class PushAttentionStore {
    private devices = new Map<string, Device>();
    private cache = new Map<string, Cached>();
    private db?: Database;
    private metadataDirty = false;
    private ioHealthy = true;
    private closed = false;
    private legacy?: any;
    private missingIndex = false;
    private indexId?: string;
    private expectedIndexId?: string;
    private lifecycleDirty = true;
    private compactAt = 0;
    private file: string;
    private indexFile: string;
    writeFailures = 0;
    readFailures = 0;
    get healthy() { return this.ioHealthy && !this.metadataDirty && !!this.db; }
    get cacheEntries() { return this.cache.size; }
    get nextMaintenance() { return this.compactAt; }
    constructor(dir: string, private now: () => number) {
        this.file = join(dir, 'push-attention.json');
        this.indexFile = join(dir, 'push-attention.sqlite');
        this.openIndex();
        if (!existsSync(this.file)) return;
        let legacy: any;
        try {
            assertPrivateFile(this.file);
            if (statSync(this.file).size > 16 * 1024 * 1024) throw Error();
            const s = JSON.parse(readFileSync(this.file, 'utf8'));
            if (![1, 2].includes(s.v) || !Array.isArray(s.devices) || s.devices.length > 128) throw Error();
            for (const [key, d] of s.devices) {
                const ids = JSON.parse(key);
                if (!Array.isArray(ids) || ids.length !== 2 || !ids.every(x => typeof x === 'string') || !integer(d.since) || !Array.isArray(d.viewed) || d.viewed.length > 64) throw Error();
                for (const [id, seq] of d.viewed) if (typeof id !== 'string' || id.length > 64 || !integer(seq)) throw Error();
                if (s.v === 1) {
                    if (!Array.isArray(d.delivered) || d.delivered.length > 512) throw Error();
                    for (const [id, r] of d.delivered)
                        if (typeof id !== 'string' || id.length > 1024 || !integer(r.revision) || !integer(r.seq) || !integer(r.at) || (r.expires !== undefined && !integer(r.expires)) || !['sent', 'suppressed', 'failed'].includes(r.outcome)) throw Error();
                } else if (typeof d.epoch !== 'string' || !/^[a-f0-9-]{32,64}$/.test(d.epoch)) throw Error();
                // Stable migration identity makes interrupted migration replay idempotent.
                const epoch = s.v === 2 ? d.epoch : createHash('sha256').update(JSON.stringify([key, d.since])).digest('hex');
                this.devices.set(key, { since: d.since, epoch, viewed: new Map(d.viewed) });
            }
            if (s.v === 1) legacy = s;
            else {
                if(typeof s.indexId!=='string' || !/^[a-f0-9-]{36}$/.test(s.indexId))throw Error();
                this.expectedIndexId=s.indexId;
                if(this.indexId && this.indexId!==s.indexId){this.missingIndex=true;this.fail('read');}
            }
        } catch {
            // Corrupt metadata establishes fresh floors via sync; index I/O failure never does.
            this.devices.clear(); this.saveMetadata();
        }
        if (legacy) {
            this.legacy=legacy;
            try { this.migrate(); } catch { this.fail('write'); }
        }
    }
    private migrate() {
        if(!this.legacy)return;
        if(!this.db)throw Error();
        this.db.transaction(()=>{
            for(const [key,d] of this.legacy.devices)if(this.devices.has(key))for(const [id,r] of d.delivered)
                this.put(this.auth(key),id,{...r,expires:r.expires??r.at+86400000+1});
        })();
        this.legacy=undefined;
        this.saveMetadata();
    }
    private fail(kind: 'read' | 'write') {
        if (kind === 'read') this.readFailures = Math.min(Number.MAX_SAFE_INTEGER, this.readFailures + 1);
        else this.writeFailures = Math.min(Number.MAX_SAFE_INTEGER, this.writeFailures + 1);
        this.ioHealthy = false;
    }
    private openIndex() {
        try {
            if (!existsSync(this.indexFile)) {
                try { closeSync(openSync(this.indexFile, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0), 0o600)); }
                catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
            }
            assertPrivateFile(this.indexFile);
            for(const suffix of ['-journal','-wal','-shm'])if(existsSync(this.indexFile+suffix))assertPrivateFile(this.indexFile+suffix);
            this.db = new Database(this.indexFile, { strict: true });
            this.db.exec(`PRAGMA auto_vacuum=INCREMENTAL; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA temp_store=MEMORY; PRAGMA cache_size=-512;
                CREATE TABLE IF NOT EXISTS index_identity(singleton INTEGER PRIMARY KEY CHECK(singleton=1),id TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS outcomes(auth TEXT NOT NULL,id TEXT NOT NULL,revision INTEGER NOT NULL,seq INTEGER NOT NULL,outcome TEXT NOT NULL,at INTEGER NOT NULL,expires INTEGER NOT NULL,PRIMARY KEY(auth,id));
                CREATE INDEX IF NOT EXISTS outcomes_expiry ON outcomes(expires);`);
            this.db.query('INSERT OR IGNORE INTO index_identity(singleton,id) VALUES (1,?)').run(randomUUID());
            this.indexId=(this.db.query('SELECT id FROM index_identity WHERE singleton=1').get() as {id:string}).id;
        } catch { this.db?.close(); this.db = undefined; this.fail('write'); }
    }
    private auth(key: string) { return JSON.stringify([key, this.devices.get(key)?.epoch]); }
    epoch(key: string) { return this.devices.get(key)?.epoch; }
    private itemKey(a: AttentionItem) { return JSON.stringify([a.sessionId, a.key]); }
    private cacheKey(auth: string, id: string) { return JSON.stringify([auth, id]); }
    private remember(value: Cached) {
        const key = this.cacheKey(value.auth, value.id);
        this.cache.delete(key); this.cache.set(key, value);
        while (this.cache.size > 512) {
            const evict = [...this.cache].find(([, v]) => !v.dirty);
            if (!evict) throw Error('push-receipt-volatile-cache-full');
            this.cache.delete(evict[0]);
        }
    }
    private lookup(auth: string, id: string): Receipt | undefined {
        const key = this.cacheKey(auth, id), cached = this.cache.get(key);
        if (cached) { this.cache.delete(key); this.cache.set(key, cached); return cached.receipt; }
        const r = this.db!.query('SELECT revision,seq,outcome,at,expires FROM outcomes WHERE auth=? AND id=?').get(auth, id) as Receipt | null;
        this.remember({ auth, id, receipt: r ?? undefined });
        return r ?? undefined;
    }
    private put(auth: string, id: string, r: Receipt) { this.db!.query(UPSERT).run(auth, id, r.revision, r.seq, r.outcome, r.at, r.expires); }
    /** Bounded indexed expiry batches; never interpret temporary current-set absence as retirement. */
    maintain(): boolean {
        if (this.closed || this.missingIndex) return false;
        try {
            if (!this.db) this.openIndex();
            if (!this.db) return false;
            if(this.expectedIndexId && this.indexId!==this.expectedIndexId){this.missingIndex=true;this.fail('read');return false;}
            this.migrate();
            if(!this.ioHealthy)this.db.query('SELECT 1').get();
            for (const v of this.cache.values()) if (v.dirty) { this.put(v.auth, v.id, v.receipt!); v.dirty = false; }
            if (this.metadataDirty && !this.saveMetadata()) return false;
            if(this.lifecycleDirty){
                const active=[...this.devices.keys()].map(key=>this.auth(key));
                const predicate=active.length?`auth NOT IN (${active.map(()=>'?').join(',')})`:'1';
                const removed=this.db.query(`DELETE FROM outcomes WHERE rowid IN (SELECT rowid FROM outcomes WHERE ${predicate} LIMIT 512)`).run(...active);
                this.lifecycleDirty=removed.changes===512;
            }
            if (this.now() >= this.compactAt) {
                const result = this.db.query('DELETE FROM outcomes WHERE rowid IN (SELECT rowid FROM outcomes WHERE expires<=? LIMIT 512)').run(this.now());
                this.db.exec("PRAGMA incremental_vacuum(64)");
                const free=(this.db.query('PRAGMA freelist_count').get() as {freelist_count:number}).freelist_count;
                this.compactAt = this.now() + (result.changes === 512 || free>0 ? 1000 : 60000);
                for (const [k, v] of this.cache) if (!v.dirty && v.receipt && v.receipt.expires <= this.now()) this.cache.delete(k);
            }
            this.ioHealthy = true; return true;
        } catch { this.fail('write'); return false; }
    }
    sync(keys: string[]) {
        for (const key of [...this.devices.keys()]) if (!keys.includes(key)) this.remove(key);
        for (const key of keys) if (!this.devices.has(key)) { this.devices.set(key, { since: this.now(), epoch: randomUUID(), viewed: new Map() }); this.metadataDirty = true; }
        if (this.metadataDirty) this.saveMetadata();
    }
    remove(key: string) {
        const auth = this.auth(key);
        this.devices.delete(key); this.metadataDirty = true; this.lifecycleDirty = true;
        for (const [k, v] of this.cache) if (v.auth === auth) this.cache.delete(k);
        this.saveMetadata();
        try { this.db!.query('DELETE FROM outcomes WHERE auth=?').run(auth); } catch { this.fail('write'); }
    }
    eligible(key: string, a: AttentionItem) {
        const d = this.devices.get(key);
        if (!d || !this.healthy || a.ts < d.since || this.now() >= attentionExpires(a) || !a.replyId && (d.viewed.get(a.sessionId) ?? 0) >= a.seq) return false;
        try { return (this.lookup(this.auth(key), this.itemKey(a))?.revision ?? 0) < a.revision; }
        catch { this.fail('read'); return false; }
    }
    viewed(key: string, session: string, seq: number) {
        const d = this.devices.get(key); if (!d || seq <= (d.viewed.get(session) ?? 0)) return;
        d.viewed.delete(session); d.viewed.set(session, seq);
        while (d.viewed.size > 64) d.viewed.delete(d.viewed.keys().next().value!);
        this.metadataDirty = true; this.saveMetadata();
    }
    record(key: string, a: AttentionItem, outcome: Receipt['outcome']): boolean {
        if (!this.devices.has(key)) return false;
        const auth = this.auth(key), id = this.itemKey(a);
        const receipt: Receipt = { revision: a.revision, seq: a.seq, outcome, at: this.now(), expires: attentionExpires(a) };
        try {
            const old = this.lookup(auth, id);
            if (old && old.revision > a.revision) return true;
            this.put(auth, id, receipt); this.remember({ auth, id, receipt }); return true;
        } catch {
            // Keep known transport outcomes in bounded volatile memory; suspend new effects
            // until repair flushes them. This is not a claim of durable delivery.
            const prior = this.cache.get(this.cacheKey(auth, id));
            if (!prior?.receipt || prior.receipt.revision <= a.revision) this.remember({ auth, id, receipt, dirty: true });
            this.fail('write'); return false;
        }
    }
    private saveMetadata(): boolean {
        if(this.legacy || this.missingIndex || !this.indexId){this.metadataDirty=true;return false;}
        try {
            writePrivateFile(this.file, JSON.stringify({ v: 2, indexId:this.indexId, devices: [...this.devices].map(([key, d]) => [key, { since: d.since, epoch: d.epoch, viewed: [...d.viewed] }]) }));
            this.metadataDirty = false; return true;
        } catch { this.metadataDirty = true; this.fail('write'); return false; }
    }
    close() { if (!this.closed) { this.closed = true; this.db?.close(); } }
}
