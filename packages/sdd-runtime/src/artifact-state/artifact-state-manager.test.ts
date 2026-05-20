import { describe, expect, test } from "bun:test";

import {
  submitStateUpdate,
  validateAdapterCapabilities,
  type ArtifactStoreAdapter,
  type StateManagerResult,
  type ArtifactVersion,
} from "./artifact-state-manager";

describe("artifact-state-manager", () => {
  function createInMemoryStore(initial?: ArtifactVersion): ArtifactStoreAdapter {
    let current = initial ?? { version: 1, writerId: "init", content: "initial", events: [] };
    const seenKeys = new Set<string>();
    return {
      capabilities: { atomicCAS: true, idempotencyReplay: true, eventOrLockGuarantees: true },
      async readVersion(_artifact: string): Promise<ArtifactVersion> {
        return { ...current };
      },
      async commitUpdate(
        _artifact: string,
        baseVersion: number,
        update: { writerId: string; content: string; idempotencyKey: string },
      ): Promise<StateManagerResult> {
        // Idempotency: same key returns original result
        if (seenKeys.has(update.idempotencyKey)) {
          return { success: true, newVersion: current.version, idempotentReplay: true };
        }
        // Atomic CAS: reject if version changed
        if (baseVersion !== current.version) {
          return {
            success: false,
            conflict: {
              currentVersion: current.version,
              currentWriter: current.writerId,
              retryGuidance: "Refresh and retry with the current base version",
            },
          };
        }
        seenKeys.add(update.idempotencyKey);
        current = {
          version: current.version + 1,
          writerId: update.writerId,
          content: update.content,
          events: [...current.events, { type: "update", writerId: update.writerId, timestamp: new Date().toISOString() }],
        };
        return { success: true, newVersion: current.version };
      },
    };
  }

  function createWeakStore(): ArtifactStoreAdapter {
    return {
      capabilities: { atomicCAS: false, idempotencyReplay: false, eventOrLockGuarantees: false },
      async readVersion(): Promise<ArtifactVersion> {
        return { version: 1, writerId: "init", content: "initial", events: [] };
      },
      async commitUpdate(): Promise<StateManagerResult> {
        return { success: true, newVersion: 2 };
      },
    };
  }

  describe("validateAdapterCapabilities", () => {
    test("reports missing capabilities for weak adapter", () => {
      const missing = validateAdapterCapabilities(createWeakStore());
      expect(missing).toContain("atomicCAS");
      expect(missing).toContain("idempotencyReplay");
      expect(missing).toContain("eventOrLockGuarantees");
    });

    test("returns empty for fully capable adapter", () => {
      const missing = validateAdapterCapabilities(createInMemoryStore());
      expect(missing).toEqual([]);
    });
  });

  describe("submitStateUpdate", () => {
    test("commits valid update referencing current version", async () => {
      const store = createInMemoryStore();
      const result = await submitStateUpdate(store, {
        targetArtifact: "test.md",
        baseVersion: 1,
        operation: "patch",
        patch: [{ op: "replace", path: "/status", value: "done" }],
        writerId: "agent-1",
        idempotencyKey: "key-1",
        timestamp: new Date().toISOString(),
      });

      expect(result.success).toBe(true);
      expect(result.newVersion).toBe(2);
    });

    test("rejects stale update with current version and retry guidance", async () => {
      const store = createInMemoryStore();
      const result = await submitStateUpdate(store, {
        targetArtifact: "test.md",
        baseVersion: 0,
        operation: "patch",
        patch: [{ op: "replace", path: "/status", value: "done" }],
        writerId: "agent-stale",
        idempotencyKey: "key-stale",
        timestamp: new Date().toISOString(),
      });

      expect(result.success).toBe(false);
      expect(result.conflict).toBeDefined();
      expect(result.conflict!.currentVersion).toBe(1);
      expect(result.conflict!.retryGuidance).toBeTruthy();
    });

    test("refresh-retry succeeds after stale rejection", async () => {
      const store = createInMemoryStore();

      const staleResult = await submitStateUpdate(store, {
        targetArtifact: "test.md",
        baseVersion: 0,
        operation: "patch",
        patch: [{ op: "replace", path: "/status", value: "done" }],
        writerId: "agent-1",
        idempotencyKey: "key-1",
        timestamp: new Date().toISOString(),
      });

      expect(staleResult.success).toBe(false);

      const currentVersion = await store.readVersion("test.md");
      const retryResult = await submitStateUpdate(store, {
        targetArtifact: "test.md",
        baseVersion: currentVersion.version,
        operation: "patch",
        patch: [{ op: "replace", path: "/status", value: "done" }],
        writerId: "agent-1",
        idempotencyKey: "key-1-retry",
        timestamp: new Date().toISOString(),
      });

      expect(retryResult.success).toBe(true);
    });

    test("concurrent writers are controlled — only one succeeds", async () => {
      const store = createInMemoryStore();

      const [first, second] = await Promise.all([
        submitStateUpdate(store, {
          targetArtifact: "test.md",
          baseVersion: 1,
          operation: "patch",
          patch: [{ op: "replace", path: "/a", value: "1" }],
          writerId: "writer-a",
          idempotencyKey: "key-a",
          timestamp: new Date().toISOString(),
        }),
        submitStateUpdate(store, {
          targetArtifact: "test.md",
          baseVersion: 1,
          operation: "patch",
          patch: [{ op: "replace", path: "/b", value: "2" }],
          writerId: "writer-b",
          idempotencyKey: "key-b",
          timestamp: new Date().toISOString(),
        }),
      ]);

      const successes = [first, second].filter((r) => r.success);
      const failures = [first, second].filter((r) => !r.success);

      expect(successes).toHaveLength(1);
      expect(failures).toHaveLength(1);
      expect(failures[0].conflict).toBeDefined();
    });

    test("rejects update when adapter lacks required capabilities", async () => {
      const store = createWeakStore();
      const result = await submitStateUpdate(store, {
        targetArtifact: "test.md",
        baseVersion: 1,
        operation: "patch",
        patch: [{ op: "replace", path: "/status", value: "done" }],
        writerId: "agent-1",
        idempotencyKey: "key-1",
        timestamp: new Date().toISOString(),
      });

      expect(result.success).toBe(false);
      expect(result.conflict).toBeDefined();
      expect(result.conflict!.retryGuidance).toContain("atomicCAS");
    });
  });
});
