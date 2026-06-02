import React from "react";
import { describe, expect, test } from "bun:test";
import { renderToString } from "ink";

import { UpgradeProgressScreen, UPGRADE_PHASES } from "./upgrade-progress-screen";

describe("UpgradeProgressScreen (T3.5)", () => {
  test("renders the running phase label and progress steps", () => {
    const status = { kind: "running" as const, phase: "Replacing binary", completedCount: 2 };
    const output = renderToString(<UpgradeProgressScreen status={status} targetVersion="1.2.0" />);
    expect(output).toContain("Update Deck → v1.2.0");
    expect(output).toContain("Replacing binary");
    // The first two phases are marked as done.
    expect(output).toContain("✓");
    // All known phases are rendered.
    for (const phase of UPGRADE_PHASES) {
      expect(output).toContain(phase);
    }
  });

  test("renders a completion state with a restart prompt", () => {
    const status = { kind: "completed" as const, version: "1.2.0", backupId: "bk-1" };
    const output = renderToString(<UpgradeProgressScreen status={status} targetVersion="1.2.0" />);
    expect(output).toContain("Update to v1.2.0 complete");
    expect(output).toContain("Restart Deck to load the new version");
    expect(output).toContain("Press Enter to return to Home");
    expect(output).toContain("bk-1");
  });

  test("renders a rollback state with the reason and backup id", () => {
    const status = { kind: "rolled_back" as const, backupId: "bk-1", reason: "checksum mismatch" };
    const output = renderToString(<UpgradeProgressScreen status={status} targetVersion="1.2.0" />);
    expect(output).toContain("Rolled back to the previous version");
    expect(output).toContain("checksum mismatch");
    expect(output).toContain("bk-1");
    expect(output).toContain("Press Enter to return to Home");
  });

  test("renders a failed state with the failure reason", () => {
    const status = { kind: "failed" as const, reason: "no network" };
    const output = renderToString(<UpgradeProgressScreen status={status} targetVersion="1.2.0" />);
    expect(output).toContain("Update failed");
    expect(output).toContain("no network");
    expect(output).toContain("Press Enter to return to Home");
  });
});
