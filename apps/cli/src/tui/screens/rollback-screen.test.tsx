import React from "react";
import { describe, expect, test } from "bun:test";
import { renderToString } from "ink";

import { RollbackScreen } from "./rollback-screen";
import type { BackupManifest } from "../../upgrade-command/backup-store";

const fixtureBackup: BackupManifest = {
  schemaVersion: 1,
  backupId: "2026-06-02T12-00-00-000Z-op-1",
  createdAt: "2026-06-02T12:00:00.000Z",
  operationId: "op-1",
  deckVersionBefore: "1.1.0",
  targetVersion: "1.2.0",
  reason: "upgrade",
  entries: [
    {
      id: "binary-deck",
      sourcePath: "/usr/local/bin/deck",
      backupPath: "/tmp/backup/deck",
      owner: "deck",
      kind: "binary",
      existed: true,
    },
    {
      id: "config",
      sourcePath: "/etc/deck/config.json",
      backupPath: "/tmp/backup/config.json",
      owner: "deck",
      kind: "config",
      existed: true,
    },
  ],
  retention: { keepLatest: 5, maxAgeDays: 30, protectIfReferencedByState: true },
};

describe("RollbackScreen (REQ-RBK-002)", () => {
  test("renders backup metadata and a Run rollback / Cancel prompt in confirm mode", () => {
    const output = renderToString(
      <RollbackScreen cursor={0} backup={fixtureBackup} mode="confirm" />,
    );
    expect(output).toContain("Roll back Deck");
    expect(output).toContain("2026-06-02T12-00-00-000Z-op-1");
    expect(output).toContain("upgrade");
    expect(output).toContain("2"); // entries.length
    expect(output).toContain("v1.1.0");
    expect(output).toContain("v1.2.0");
    expect(output).toContain("Run rollback");
    expect(output).toContain("Cancel");
  });

  test("renders a running message while the rollback is in progress", () => {
    const output = renderToString(
      <RollbackScreen cursor={0} backup={fixtureBackup} mode="running" />,
    );
    expect(output).toContain("Rolling back");
    expect(output).not.toContain("Run rollback");
    expect(output).not.toContain("Rollback complete");
  });

  test("renders a success state with restored count and backup id in completed mode", () => {
    const output = renderToString(
      <RollbackScreen
        cursor={0}
        backup={fixtureBackup}
        mode="completed"
        restoredCount={3}
      />,
    );
    expect(output).toContain("Rollback complete");
    expect(output).toContain("2026-06-02T12-00-00-000Z-op-1");
    expect(output).toContain("Restored 3 files from backup");
    expect(output).toContain("Restart Deck");
    expect(output).toContain("Press Enter to return to Home");
  });

  test("uses singular file wording when exactly one file was restored", () => {
    const output = renderToString(
      <RollbackScreen
        cursor={0}
        backup={fixtureBackup}
        mode="completed"
        restoredCount={1}
      />,
    );
    expect(output).toContain("Restored 1 file from backup");
    expect(output).not.toContain("Restored 1 files");
  });

  test("renders a failure state with the reason and CLI hint in failed mode", () => {
    const output = renderToString(
      <RollbackScreen
        cursor={0}
        backup={fixtureBackup}
        mode="failed"
        reason="backup not found"
      />,
    );
    expect(output).toContain("Rollback failed");
    expect(output).toContain("backup not found");
    expect(output).toContain("deck rollback");
    expect(output).toContain("Press Enter to return to Home");
  });

  test("renders the backup metadata even when targetVersion is absent (e.g. migration backups)", () => {
    const migrationBackup: BackupManifest = {
      ...fixtureBackup,
      backupId: "2026-06-02T13-00-00-000Z-mig-1",
      reason: "migration",
      targetVersion: undefined,
    };
    const output = renderToString(
      <RollbackScreen cursor={0} backup={migrationBackup} mode="confirm" />,
    );
    expect(output).toContain("2026-06-02T13-00-00-000Z-mig-1");
    expect(output).toContain("migration");
    expect(output).not.toContain("upgrade target");
  });
});
