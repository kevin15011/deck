import { describe, expect, test } from "bun:test";

import {
  type ChangeStatus,
  type ChangePhase,
  type ArtifactKind,
  type ArtifactStatus,
  type SyncStatus,
  type SpecRegistryEntry,
  type SpecRegistryArtifact,
  type SpecRegistryEventType,
  type SpecRegistryEvent,
  VALID_CHANGE_STATUSES,
  VALID_CHANGE_PHASES,
  VALID_ARTIFACT_KINDS,
  VALID_ARTIFACT_STATUSES,
  VALID_SYNC_STATUSES,
  VALID_EVENT_TYPES,
} from "./types";

// ---------------------------------------------------------------------------
// Type-level smoke tests — verify exports exist and are the expected shapes
// ---------------------------------------------------------------------------

describe("spec-registry types", () => {
  test("ChangeStatus covers expected lifecycle states", () => {
    const statuses: ChangeStatus[] = [
      "draft",
      "proposed",
      "approved",
      "in_progress",
      "verifying",
      "reviewing",
      "completed",
      "archived",
      "abandoned",
    ];
    for (const s of statuses) {
      expect(VALID_CHANGE_STATUSES).toContain(s);
    }
    expect(VALID_CHANGE_STATUSES).toHaveLength(statuses.length);
  });

  test("ChangePhase covers SDD pipeline phases", () => {
    const phases: ChangePhase[] = [
      "explore",
      "proposal",
      "spec",
      "design",
      "tasks",
      "apply",
      "verify",
      "review",
      "archive",
    ];
    for (const p of phases) {
      expect(VALID_CHANGE_PHASES).toContain(p);
    }
    expect(VALID_CHANGE_PHASES).toHaveLength(phases.length);
  });

  test("ArtifactKind covers all SDD artifact types", () => {
    const kinds: ArtifactKind[] = [
      "exploration",
      "proposal",
      "spec",
      "design",
      "tasks",
      "apply-progress",
      "verify-report",
      "review-report",
      "archive-report",
    ];
    for (const k of kinds) {
      expect(VALID_ARTIFACT_KINDS).toContain(k);
    }
    expect(VALID_ARTIFACT_KINDS).toHaveLength(kinds.length);
  });

  test("ArtifactStatus covers artifact lifecycle", () => {
    const statuses: ArtifactStatus[] = [
      "pending",
      "draft",
      "approved",
      "rejected",
      "superseded",
    ];
    for (const s of statuses) {
      expect(VALID_ARTIFACT_STATUSES).toContain(s);
    }
    expect(VALID_ARTIFACT_STATUSES).toHaveLength(statuses.length);
  });

  test("SyncStatus covers sync states without naming specific adapters", () => {
    const statuses: SyncStatus[] = [
      "local_only",
      "syncing",
      "synced",
      "error",
    ];
    for (const s of statuses) {
      expect(VALID_SYNC_STATUSES).toContain(s);
    }
    expect(VALID_SYNC_STATUSES).toHaveLength(statuses.length);
    // Ensure no adapter-specific names leak into sync status
    for (const s of VALID_SYNC_STATUSES) {
      expect(s).not.toMatch(/engram|namedGraphTool|namedMemoryTool|pi|opencode/i);
    }
  });

  test("SpecRegistryEntry type is structurally valid", () => {
    const entry: SpecRegistryEntry = {
      changeName: "add-dark-mode",
      status: "proposed",
      currentPhase: "proposal",
      createdAt: "2026-05-16T00:00:00Z",
      updatedAt: "2026-05-16T00:00:00Z",
      title: "Add dark mode support",
    };
    expect(entry.changeName).toBe("add-dark-mode");
    expect(entry.status).toBe("proposed");
    expect(entry.currentPhase).toBe("proposal");
    expect(entry.title).toBe("Add dark mode support");
  });

  test("SpecRegistryEntry works without optional title", () => {
    const entry: SpecRegistryEntry = {
      changeName: "fix-auth-bug",
      status: "in_progress",
      currentPhase: "apply",
      createdAt: "2026-05-16T00:00:00Z",
      updatedAt: "2026-05-16T00:00:00Z",
    };
    expect(entry.title).toBeUndefined();
  });

  test("SpecRegistryArtifact includes optional sync fields", () => {
    const artifact: SpecRegistryArtifact = {
      changeName: "add-dark-mode",
      kind: "spec",
      status: "approved",
      path: "openspec/changes/add-dark-mode/spec.md",
      version: 2,
      updatedAt: "2026-05-16T00:00:00Z",
    };
    // No sync fields
    expect(artifact.syncStatus).toBeUndefined();
    expect(artifact.syncTarget).toBeUndefined();
    expect(artifact.syncedAt).toBeUndefined();

    // With sync fields
    const synced: SpecRegistryArtifact = {
      ...artifact,
      syncStatus: "synced",
      syncTarget: "graph-adapter",
      syncedAt: "2026-05-16T01:00:00Z",
    };
    expect(synced.syncStatus).toBe("synced");
    expect(synced.syncTarget).toBe("graph-adapter");
  });

  test("SpecRegistryEvent has provenance fields", () => {
    const event: SpecRegistryEvent = {
      id: "evt-001",
      changeName: "add-dark-mode",
      type: "change.created",
      timestamp: "2026-05-16T00:00:00Z",
      actor: "deck-developer-proposal",
    };
    expect(event.id).toBe("evt-001");
    expect(event.actor).toBe("deck-developer-proposal");
    expect(event.evidence).toBeUndefined();
    expect(event.metadata).toBeUndefined();
  });

  test("SpecRegistryEvent supports evidence and metadata", () => {
    const event: SpecRegistryEvent = {
      id: "evt-002",
      changeName: "add-dark-mode",
      type: "human.approved",
      timestamp: "2026-05-16T00:01:00Z",
      actor: "user",
      evidence: "Approved via CLI confirmation",
      metadata: { source: "cli" },
    };
    expect(event.evidence).toBe("Approved via CLI confirmation");
    expect(event.metadata).toEqual({ source: "cli" });
  });

  test("SpecRegistryEventType covers core and future-neutral events", () => {
    const coreTypes: SpecRegistryEventType[] = [
      "change.created",
      "change.phase_transition",
      "artifact.updated",
      "artifact.approved",
      "artifact.rejected",
      "human.approved",
      "human.rejected",
    ];
    for (const t of coreTypes) {
      expect(VALID_EVENT_TYPES).toContain(t);
    }

    // Future-neutral sync events (no adapter names)
    const syncTypes: SpecRegistryEventType[] = [
      "sync.targeted",
      "sync.completed",
      "sync.failed",
    ];
    for (const t of syncTypes) {
      expect(VALID_EVENT_TYPES).toContain(t);
    }
  });

  test("event types do not hardcode adapter names", () => {
    for (const t of VALID_EVENT_TYPES) {
      expect(t).not.toMatch(/engram|namedGraphTool|namedMemoryTool/i);
    }
  });
});
