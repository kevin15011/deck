import React, { createContext, useContext, useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent, type Modifier } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { duration, ease, Flip, gsap, reducedMotion } from './motion';

const useBrowserLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;
const verticalOnly: Modifier = ({ transform }) => ({ ...transform, x: 0 });

type Handle = { setActivatorNodeRef: (node: HTMLElement | null) => void; attributes: Record<string, unknown>; listeners: Record<string, unknown> | undefined; dragging: boolean };
const HandleContext = createContext<Handle | undefined>(undefined);

/** Reorderable vertical list. Each SortableList owns its own DndContext, so items never cross lists. */
export function SortableList({ ids, onReorder, className, label, children }: { ids: string[]; onReorder: (from: string, to: string) => void; className?: string; label: string; children: ReactNode }) {
    const list = useRef<HTMLUListElement>(null), pending = useRef<Flip.FlipState | null>(null);
    const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
    const order = ids.join('\0');
    useBrowserLayoutEffect(() => {
        const state = pending.current;
        pending.current = null;
        if (state && !reducedMotion()) Flip.from(state, { duration: duration.base, ease: ease.out, overwrite: 'auto' });
    }, [order]);
    function settle(event: DragEndEvent) {
        const from = String(event.active.id), to = event.over ? String(event.over.id) : undefined;
        const items = list.current ? Array.from(list.current.querySelectorAll<HTMLElement>(':scope > [data-sortable-id]')) : [];
        // Capture where each row visually is before the transforms are dropped and the DOM order changes.
        if (to && from !== to) pending.current = Flip.getState(items);
        gsap.set(items, { clearProps: 'transform,zIndex' });
        if (to && from !== to) onReorder(from, to);
    }
    return <DndContext sensors={sensors} collisionDetection={closestCenter} modifiers={[verticalOnly]} onDragEnd={settle} onDragCancel={() => { if (list.current) gsap.to(list.current.querySelectorAll(':scope > [data-sortable-id]'), { x: 0, y: 0, duration: duration.fast, ease: ease.out, clearProps: 'transform,zIndex' }); }}>
        <SortableContext items={ids} strategy={verticalListSortingStrategy}><ul ref={list} className={className} aria-label={label}>{children}</ul></SortableContext>
    </DndContext>;
}

export function SortableItem({ id, className, children, dragFromItem = false, ...rest }: { id: string; className?: string; children: ReactNode; dragFromItem?: boolean } & Record<`data-${string}`, string>) {
    const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, isDragging } = useSortable({ id, transition: null, animateLayoutChanges: () => false });
    const node = useRef<HTMLLIElement | null>(null), applied = useRef({ x: 0, y: 0 });
    const x = transform?.x ?? 0, y = transform?.y ?? 0;
    useBrowserLayoutEffect(() => {
        const element = node.current;
        if (!element) return;
        if (isDragging) { gsap.set(element, { x, y, zIndex: 5 }); applied.current = { x, y }; return; }
        if (x === applied.current.x && y === applied.current.y) return;
        applied.current = { x, y };
        gsap.to(element, { x, y, duration: duration.fast, ease: ease.out, overwrite: 'auto' });
    }, [x, y, isDragging]);
    return <li ref={element => { node.current = element; setNodeRef(element); }} className={`${className ?? ''}${isDragging ? ' dragging' : ''}`} data-sortable-id={id} {...(dragFromItem ? listeners : {})} {...rest}>
        <HandleContext.Provider value={{ setActivatorNodeRef, attributes: attributes as unknown as Record<string, unknown>, listeners: listeners as Record<string, unknown> | undefined, dragging: isDragging }}>{children}</HandleContext.Provider>
    </li>;
}

/** Row that starts a drag from anywhere (pointer); keyboard drag starts from the grip button. */
export function SortableRow({ className, children }: { className?: string; children: ReactNode }) {
    const handle = useContext(HandleContext);
    return <div className={className} {...(handle?.listeners ?? {})}>{children}</div>;
}

export function GripButton({ label }: { label: string }) {
    const handle = useContext(HandleContext);
    if (!handle) return null;
    const { role: _role, tabIndex: _tabIndex, ...attributes } = handle.attributes as Record<string, unknown>;
    return <button type="button" ref={handle.setActivatorNodeRef} className="drag-handle quiet" aria-label={label} title="Drag to reorder (Space to lift, arrows to move)" {...attributes}>
        <svg className="navigation-icon" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" focusable="false"><circle cx="6" cy="4" r="1"/><circle cx="10" cy="4" r="1"/><circle cx="6" cy="8" r="1"/><circle cx="10" cy="8" r="1"/><circle cx="6" cy="12" r="1"/><circle cx="10" cy="12" r="1"/></svg>
    </button>;
}
