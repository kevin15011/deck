/**
 * Artifact state manager — structured updates with optimistic version checks;
 * single-writer or event-sourced adapter; reject stale with conflict details + retry guidance.
 *
 * Adapter requirements:
 * - Atomic CAS: commitUpdate must fail if baseVersion changed between read and write
 * - Idempotency: duplicate idempotencyKey must return the original result without double-applying
 * - Event/lock guarantees: adapter must support event-sourced or lock-based writes
 */

import type { StateUpdate } from "../contracts/state-update";

// ── Store adapter boundary ──

export interface ArtifactVersion {
  version: number;
  writerId: string;
  content: string;
  events: { type: string; writerId: string; timestamp: string }[];
}

export interface ConflictDetails {
  currentVersion: number;
  currentWriter: string;
  retryGuidance: string;
}

export interface StateManagerResult {
  success: boolean;
  newVersion?: number;
  conflict?: ConflictDetails;
  /** If idempotency replay detected (same key already applied) */
  idempotentReplay?: boolean;
}

/**
 * Adapter capability flags — the manager verifies these before operations.
 * Adapters MUST implement atomic CAS, idempotency replay, and event/lock guarantees.
 */
export interface AdapterCapabilities {
  /** Adapter implements atomic compare-and-swap */
  atomicCAS: boolean;
  /** Adapter detects and replays idempotent operations */
  idempotencyReplay: boolean;
  /** Adapter provides event-sourced or lock-based write guarantees */
  eventOrLockGuarantees: boolean;
}

export interface ArtifactStoreAdapter {
  /** Adapter MUST declare its capabilities */
  capabilities: AdapterCapabilities;
  readVersion(artifact: string): Promise<ArtifactVersion>;
  commitUpdate(
    artifact: string,
    baseVersion: number,
    update: { writerId: string; content: string; idempotencyKey: string },
  ): Promise<StateManagerResult>;
}

// ── Capability check ──

export function validateAdapterCapabilities(adapter: ArtifactStoreAdapter): string[] {
  const missing: string[] = [];
  if (!adapter.capabilities.atomicCAS) {
    missing.push("atomicCAS");
  }
  if (!adapter.capabilities.idempotencyReplay) {
    missing.push("idempotencyReplay");
  }
  if (!adapter.capabilities.eventOrLockGuarantees) {
    missing.push("eventOrLockGuarantees");
  }
  return missing;
}

// ── Submit ──

export async function submitStateUpdate(
  store: ArtifactStoreAdapter,
  update: StateUpdate,
): Promise<StateManagerResult> {
  // Verify adapter capabilities before proceeding
  const missingCapabilities = validateAdapterCapabilities(store);
  if (missingCapabilities.length > 0) {
    return {
      success: false,
      conflict: {
        currentVersion: -1,
        currentWriter: "system",
        retryGuidance: `Adapter missing required capabilities: ${missingCapabilities.join(", ")}`,
      },
    };
  }

  // Read current state
  const current = await store.readVersion(update.targetArtifact);

  // Optimistic version check (atomic CAS enforced by adapter)
  if (update.baseVersion !== current.version) {
    return {
      success: false,
      conflict: {
        currentVersion: current.version,
        currentWriter: current.writerId,
        retryGuidance: "Refresh and retry with the current base version",
      },
    };
  }

  // Build patch content from update
  const patchContent = JSON.stringify({
    operation: update.operation,
    patch: update.patch,
    events: update.events,
  });

  // Commit through adapter (idempotency enforced by adapter)
  return store.commitUpdate(update.targetArtifact, update.baseVersion, {
    writerId: update.writerId,
    content: patchContent,
    idempotencyKey: update.idempotencyKey,
  });
}
