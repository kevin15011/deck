import { describe, expect, test } from "bun:test";

import {
  type SpecRegistryEvent,
  type SpecRegistryEventType,
  createEvent,
  VALID_EVENT_TYPES,
} from "./events";

// ---------------------------------------------------------------------------
// createEvent factory
// ---------------------------------------------------------------------------

describe("createEvent", () => {
  test("creates a change.created event with generated id and timestamp", () => {
    const event = createEvent({
      changeName: "add-dark-mode",
      type: "change.created",
      actor: "deck-developer-orchestrator",
    });

    expect(event.changeName).toBe("add-dark-mode");
    expect(event.type).toBe("change.created");
    expect(event.actor).toBe("deck-developer-orchestrator");
    expect(event.id).toMatch(/^evt-/);
    expect(event.timestamp).toBeTruthy();
    // Should be valid ISO 8601
    expect(new Date(event.timestamp).toISOString()).toBe(event.timestamp);
  });

  test("creates an artifact.updated event with evidence", () => {
    const event = createEvent({
      changeName: "add-dark-mode",
      type: "artifact.updated",
      actor: "deck-developer-spec",
      evidence: "Spec rewritten with new acceptance scenarios",
    });

    expect(event.evidence).toBe("Spec rewritten with new acceptance scenarios");
  });

  test("creates a human.approved event with metadata", () => {
    const event = createEvent({
      changeName: "add-dark-mode",
      type: "human.approved",
      actor: "user",
      evidence: "Approved via CLI",
      metadata: { source: "cli", phase: "proposal" },
    });

    expect(event.metadata).toEqual({ source: "cli", phase: "proposal" });
  });

  test("creates a sync.targeted event (future-neutral)", () => {
    const event = createEvent({
      changeName: "add-dark-mode",
      type: "sync.targeted",
      actor: "spec-registry",
      metadata: { target: "graph-adapter", artifactKind: "spec" },
    });

    expect(event.type).toBe("sync.targeted");
    expect(event.metadata?.target).toBe("graph-adapter");
  });

  test("creates a sync.completed event", () => {
    const event = createEvent({
      changeName: "add-dark-mode",
      type: "sync.completed",
      actor: "spec-registry",
      metadata: { target: "memory-adapter" },
    });

    expect(event.type).toBe("sync.completed");
  });

  test("creates a sync.failed event with error evidence", () => {
    const event = createEvent({
      changeName: "add-dark-mode",
      type: "sync.failed",
      actor: "spec-registry",
      evidence: "Connection refused",
      metadata: { target: "graph-adapter" },
    });

    expect(event.type).toBe("sync.failed");
    expect(event.evidence).toBe("Connection refused");
  });

  test("generates unique ids across calls", () => {
    const events = Array.from({ length: 10 }, () =>
      createEvent({
        changeName: "test",
        type: "change.created",
        actor: "test",
      }),
    );

    const ids = events.map((e) => e.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  test("generates non-decreasing timestamps", () => {
    const events = Array.from({ length: 5 }, () =>
      createEvent({
        changeName: "test",
        type: "change.created",
        actor: "test",
      }),
    );

    for (let i = 1; i < events.length; i++) {
      expect(events[i].timestamp >= events[i - 1].timestamp).toBe(true);
    }
  });

  test("event ids do not contain adapter-specific names", () => {
    for (const type of VALID_EVENT_TYPES) {
      expect(type).not.toMatch(/engram|namedGraphTool|namedMemoryTool/i);
    }
  });
});
