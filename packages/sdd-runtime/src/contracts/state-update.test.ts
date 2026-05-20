import { describe, expect, test } from "bun:test";

import {
  validateStateUpdate,
  type StateUpdate,
  type StateUpdateOperation,
} from "./state-update";

describe("state-update contract", () => {
  describe("validateStateUpdate", () => {
    test("accepts a valid structured update with all required fields", () => {
      const update: StateUpdate = {
        targetArtifact: "openspec/changes/foo/tasks.md",
        baseVersion: 3,
        operation: "patch",
        patch: [{ op: "replace", path: "/tasks/0/status", value: "complete" }],
        writerId: "agent-apply-general",
        idempotencyKey: "task-1.1-complete-20260520",
        timestamp: new Date().toISOString(),
      };

      const validation = validateStateUpdate(update);

      expect(validation.valid).toBe(true);
      expect(validation.errors).toEqual([]);
    });

    test("accepts event-sourced append operation with events", () => {
      const update: StateUpdate = {
        targetArtifact: "openspec/changes/foo/events.yaml",
        baseVersion: 7,
        operation: "append-events",
        events: [{ type: "task_completed", taskId: "1.1", agent: "general" }],
        writerId: "agent-apply-general",
        idempotencyKey: "event-task1.1-20260520",
        timestamp: new Date().toISOString(),
      };

      const validation = validateStateUpdate(update);

      expect(validation.valid).toBe(true);
    });

    test("rejects missing targetArtifact", () => {
      const update = {
        targetArtifact: "",
        baseVersion: 1,
        operation: "patch" as StateUpdateOperation,
        patch: [],
        writerId: "agent-1",
        idempotencyKey: "key-1",
        timestamp: new Date().toISOString(),
      };

      const validation = validateStateUpdate(update as StateUpdate);

      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain("missing targetArtifact");
    });

    test("rejects negative baseVersion", () => {
      const update = {
        targetArtifact: "foo.md",
        baseVersion: -1,
        operation: "patch" as StateUpdateOperation,
        patch: [],
        writerId: "agent-1",
        idempotencyKey: "key-1",
        timestamp: new Date().toISOString(),
      };

      const validation = validateStateUpdate(update as StateUpdate);

      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain("baseVersion must be >= 0");
    });

    test("rejects missing writerId", () => {
      const update = {
        targetArtifact: "foo.md",
        baseVersion: 1,
        operation: "patch" as StateUpdateOperation,
        patch: [],
        writerId: "",
        idempotencyKey: "key-1",
        timestamp: new Date().toISOString(),
      };

      const validation = validateStateUpdate(update as StateUpdate);

      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain("missing writerId");
    });

    test("rejects missing idempotencyKey", () => {
      const update = {
        targetArtifact: "foo.md",
        baseVersion: 1,
        operation: "patch" as StateUpdateOperation,
        patch: [],
        writerId: "agent-1",
        idempotencyKey: "",
        timestamp: new Date().toISOString(),
      };

      const validation = validateStateUpdate(update as StateUpdate);

      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain("missing idempotencyKey");
    });

    test("rejects patch operation without patch data", () => {
      const update = {
        targetArtifact: "foo.md",
        baseVersion: 1,
        operation: "patch" as StateUpdateOperation,
        writerId: "agent-1",
        idempotencyKey: "key-1",
        timestamp: new Date().toISOString(),
      };

      const validation = validateStateUpdate(update as StateUpdate);

      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain("patch operation requires patch data");
    });

    test("rejects append-events operation without events", () => {
      const update = {
        targetArtifact: "foo.md",
        baseVersion: 1,
        operation: "append-events" as StateUpdateOperation,
        writerId: "agent-1",
        idempotencyKey: "key-1",
        timestamp: new Date().toISOString(),
      };

      const validation = validateStateUpdate(update as StateUpdate);

      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain("append-events operation requires events data");
    });
  });
});
