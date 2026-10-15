import { useCallback, useState } from 'react';

/**
 * Browser-local manual ordering. Items missing from the saved order (new sessions, older pages) are
 * anchored after the nearest preceding saved item in their original order, so a new session stays on
 * top and a newly loaded older page stays below the sessions it followed.
 */
export function applyOrder<T>(items: readonly T[], saved: readonly string[], idOf: (item: T) => string): T[] {
    if (!saved.length) return [...items];
    const rank = new Map(saved.map((id, index) => [id, index] as const));
    const known = items.filter(item => rank.has(idOf(item))).sort((a, b) => rank.get(idOf(a))! - rank.get(idOf(b))!);
    const leading: T[] = [], trailing = new Map<string, T[]>();
    let anchor: string | undefined;
    for (const item of items) {
        const id = idOf(item);
        if (rank.has(id)) { anchor = id; continue; }
        if (anchor === undefined) leading.push(item);
        else trailing.set(anchor, [...(trailing.get(anchor) ?? []), item]);
    }
    return [...leading, ...known.flatMap(item => [item, ...(trailing.get(idOf(item)) ?? [])])];
}

/** Move `from` to the slot currently occupied by `to`. */
export function moveId(ids: readonly string[], from: string, to: string): string[] {
    const source = ids.indexOf(from), target = ids.indexOf(to);
    if (source < 0 || target < 0 || source === target) return [...ids];
    const next = [...ids];
    next.splice(source, 1);
    next.splice(target, 0, from);
    return next;
}

const MAX_SAVED = 2000;
function read(key: string): string[] {
    try {
        const value = JSON.parse(window.localStorage.getItem(key) ?? '[]');
        return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string').slice(0, MAX_SAVED) : [];
    } catch { return []; }
}
function write(key: string, ids: string[]): void { try { window.localStorage.setItem(key, JSON.stringify(ids.slice(0, MAX_SAVED))); } catch { /* Ordering is a preference; unavailable storage keeps the session order. */ } }

export const PROJECT_ORDER_KEY = 'deck.order.projects';
export const sessionOrderKey = (projectId: string): string => `deck.order.sessions.${projectId}`;

export type OrderStore = { read: (key: string) => string[]; write: (key: string, ids: string[]) => void };
export const browserOrderStore: OrderStore = { read: key => (typeof window === 'undefined' ? [] : read(key)), write: (key, ids) => { if (typeof window !== 'undefined') write(key, ids); } };

/** Saved order lists keyed by storage key; reads lazily and writes through on reorder. */
export function useManualOrder(store: OrderStore = browserOrderStore) {
    const [orders, setOrders] = useState<Record<string, string[]>>({});
    const saved = useCallback((key: string): string[] => orders[key] ?? store.read(key), [orders, store]);
    const reorder = useCallback((key: string, visible: readonly string[], from: string, to: string) => {
        const moved = moveId(visible, from, to);
        const previous = orders[key] ?? store.read(key);
        const next = [...moved, ...previous.filter(id => !moved.includes(id))];
        store.write(key, next);
        setOrders(current => ({ ...current, [key]: next }));
    }, [orders, store]);
    return { saved, reorder };
}
