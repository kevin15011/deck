import { describe, expect, test } from "bun:test";

import {
  ARTIFACT_KEY_TO_PUBLIC,
  KNOWN_EVENT_NAMES,
  REPAIR_INCIDENT_ARTIFACT_KIND,
  REPAIR_LIFECYCLE_EVENTS,
  VALIDATION_RULE_CODES,
  VALIDATOR_ARTIFACT_KINDS,
} from "./schema";

describe("spec-registry schema repair telemetry constants", () => {
  test("exports repair incident artifact kind", () => {
    expect(REPAIR_INCIDENT_ARTIFACT_KIND).toBe("repair_incident");
    expect(VALIDATOR_ARTIFACT_KINDS).toContain(REPAIR_INCIDENT_ARTIFACT_KIND);
    expect(ARTIFACT_KEY_TO_PUBLIC.get(REPAIR_INCIDENT_ARTIFACT_KIND)).toBe("repair-incident");
  });

  test("exports all repair lifecycle events as known auxiliary events", () => {
    const events = [
      "repair.started",
      "repair.retry_recorded",
      "repair.checkpoint_reached",
      "repair.replanned",
      "repair.escalated",
      "repair.blocked",
      "repair.resolved",
    ];

    for (const event of events) {
      expect(REPAIR_LIFECYCLE_EVENTS.has(event as never)).toBe(true);
      expect(KNOWN_EVENT_NAMES.has(event as never)).toBe(true);
    }
  });

  test("exports warning-first repair incident validation rule", () => {
    expect(VALIDATION_RULE_CODES).toContain("repair_incident.artifact.missing");
  });
});
