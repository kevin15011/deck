/**
 * Event factory and types for the Spec Registry event log.
 *
 * Events track the lifecycle of changes and artifacts with full provenance.
 * Sync events use neutral keys — no adapter-specific names in event types.
 *
 * Re-exports types from ./types for convenience.
 */

export { type SpecRegistryEvent, type SpecRegistryEventType, VALID_EVENT_TYPES } from "./types";

import type { SpecRegistryEvent, SpecRegistryEventType } from "./types";

// ---------------------------------------------------------------------------
// Event factory
// ---------------------------------------------------------------------------

let eventCounter = 0;

/**
 * Creates a new SpecRegistryEvent with generated id and timestamp.
 *
 * The id is a unique, monotonic-ish identifier suitable for event ordering
 * within a single process. For distributed scenarios, the adapter layer
 * should assign its own ids.
 */
export function createEvent(params: {
  changeName: string;
  type: SpecRegistryEventType;
  actor: string;
  evidence?: string;
  metadata?: Record<string, unknown>;
}): SpecRegistryEvent {
  eventCounter++;
  const id = `evt-${Date.now().toString(36)}-${eventCounter.toString(36)}`;
  const timestamp = new Date().toISOString();

  return {
    id,
    changeName: params.changeName,
    type: params.type,
    timestamp,
    actor: params.actor,
    ...(params.evidence !== undefined && { evidence: params.evidence }),
    ...(params.metadata !== undefined && { metadata: params.metadata }),
  };
}
