import type { Database } from 'bun:sqlite';
import type { AttentionItem } from '../push-attention';
import type { PushAttentionStore } from '../push-attention-store';

/** Historical setup only: retain real record/cache behavior with one durable commit.
 * Tested transitions must run after this bounded, synchronous transaction returns.
 */
export function seedAttentionHistory(store: PushAttentionStore, device: string, items: AttentionItem[], outcome: 'sent' | 'failed'): void {
    if (items.length > 600) throw new Error('Historical fixture exceeds bounded setup');
    const db = (store as unknown as { db: Database }).db;
    db.transaction(() => {
        for (const item of items) {
            if (!store.record(device, item, outcome)) throw new Error('Historical receipt setup failed');
        }
    })();
}
