import { constants, openSync, closeSync, fstatSync, readFileSync } from 'node:fs';
import type { Manifest } from './manifest';
import { fail, sha256 } from './security';
export type CleanupConfirmation = {
    schema: 'deck-cleanup-confirmation-v1'; run: string; bindingsHash: string; confirmedAt: string;
    consoleCostConfirmed: true; costSummary: string; userConfirmationReference: string; authorizeCleanup: true;
    namespaceCosts: { namespace: string; confirmed: true; costSummary: string }[];
};
export function validateCleanupConfirmation(m: Pick<Manifest, 'run' | 'bindings'>, value: unknown): asserts value is CleanupConfirmation {
    const v = value as CleanupConfirmation, tags = Object.values(m.bindings);
    const text = (s: unknown) => typeof s === 'string' && s.trim().length > 0 && s.length <= 2000;
    if (!v || v.schema !== 'deck-cleanup-confirmation-v1' || v.run !== m.run || v.bindingsHash !== sha256(JSON.stringify(m.bindings)) || v.consoleCostConfirmed !== true || v.authorizeCleanup !== true || !text(v.costSummary) || !text(v.userConfirmationReference) || !Number.isFinite(Date.parse(v.confirmedAt)) || !Array.isArray(v.namespaceCosts) || v.namespaceCosts.length !== tags.length || new Set(v.namespaceCosts.map(x => x?.namespace)).size !== tags.length || v.namespaceCosts.some(x => !x || !tags.includes(x.namespace) || x.confirmed !== true || !text(x.costSummary))) fail('cleanup_requires_reconciliation_authorization');
}
/** Read an explicitly supplied human confirmation; never read a console/account API. */
export function readCleanupConfirmation(path: string): unknown {
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
        const st = fstatSync(fd);
        if (!st.isFile() || st.nlink !== 1 || (st.mode & 0o777) !== 0o600 || process.getuid && st.uid !== process.getuid()) fail('cleanup_confirmation_file_unsafe');
        return JSON.parse(readFileSync(fd, 'utf8'));
    } finally { closeSync(fd); }
}
