// Only invoked by bounded, network-isolated tests with synthetic plans and HOME.
import { Database } from 'bun:sqlite';
import { readFileSync, writeSync } from 'node:fs';
import * as fs from 'node:fs';
import { join } from 'node:path';
import { RunAuthority, initializeRunAuthority } from '../run-authority';
const [planPath, operation, database, suffix] = process.argv.slice(2);
const m = JSON.parse(readFileSync(planPath!, 'utf8'));
if (operation === 'crash-journal') {
    const db = new Database(join(m.evalRoot, database!));
    // Keep the production DELETE journal mode. A tiny cache forces dirty pages to disk
    // while the rollback journal protects the last committed authority/reservation.
    db.exec('PRAGMA synchronous=EXTRA; PRAGMA cache_size=1; BEGIN IMMEDIATE;');
    db.exec(database === 'run-lock.sqlite' ? "UPDATE identity SET value='uncommitted'" : "UPDATE state SET value='uncommitted'");
    db.exec('CREATE TABLE crash_scratch (value BLOB)');
    for (let i = 0; i < 16; i++) db.exec('INSERT INTO crash_scratch VALUES (zeroblob(8192))');
    writeSync(1, 'journal_ready\n');
    process.kill(process.pid, 'SIGKILL');
} else {
    if (operation === 'foreign-owner') {
        // A synthetic stat result exercises the owner branch without chown privileges.
        const { spyOn } = await import('bun:test');
        const original = fs.lstatSync;
        spyOn(fs, 'lstatSync').mockImplementation(((path: any, ...rest: any[]) => {
            const value = (original as any)(path, ...rest);
            if (String(path) === join(m.evalRoot, database! + suffix!)) value.uid = process.getuid!() + 1;
            return value;
        }) as any);
    }
    try {
        if (operation === 'initialize') initializeRunAuthority(m);
        else { const a = RunAuthority.acquire(m, 'cleanup'); a.close(); }
        console.log(JSON.stringify({ accepted: true }));
    } catch (error) { console.log(JSON.stringify({ reason: error instanceof Error ? error.message : 'unknown' })); }
}
