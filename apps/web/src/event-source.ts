import type { SessionEvent } from '../../../packages/core/src/session/events';

/** Lead generations keep their member identity while their native task changes. */
export function isLeadEvent(event: SessionEvent): boolean {
    return event.source.memberId !== undefined ? event.source.memberId === 'lead' : (event.source.taskId ?? 'lead') === 'lead';
}
