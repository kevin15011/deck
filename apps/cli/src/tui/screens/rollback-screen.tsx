import React from "react";
import { Box, Text } from "ink";

import type { BackupManifest } from "../../upgrade-command/backup-store";
import { MenuList } from "../components/menu-list";

/**
 * TUI surface for user-initiated rollback (REQ-RBK-002).
 *
 * The screen is intentionally **presentational** — it owns no input
 * state, no `useInput` / `useApp` hooks, and no rollback execution.
 * The parent `app.tsx` provides the cursor and a `runRollback`
 * callback so this component is fully testable with `renderToString`.
 *
 * Modes:
 * - `confirm` — Apply / Cancel prompt after the user picked the
 *   "Roll back Deck" menu option.
 * - `running` — placeholder while `runRollback` resolves.
 * - `completed` — rollback succeeded; shows the backup id and the
 *   number of restored entries.
 * - `failed` — rollback threw; shows the error reason.
 */
export type RollbackScreenMode = "confirm" | "running" | "completed" | "failed";

export type RollbackScreenProps = {
  cursor: number;
  /** Backup the user is about to roll back to. Always required so the
   *  screen can render the same metadata (id, version, date, count) in
   *  every mode. */
  backup: BackupManifest;
  mode: RollbackScreenMode;
  /** Populated for `completed` mode. */
  restoredCount?: number;
  /** Populated for `failed` mode. */
  reason?: string;
};

/**
 * User-initiated rollback screen.
 *
 * Always renders a clear, single-screen view of the rollback target
 * (backup id, version, date, entry count) and the current status. The
 * "Run rollback" / "Cancel" prompt is shown only in `confirm` mode;
 * terminal modes show a short "Press Enter to return to Home" hint.
 */
export function RollbackScreen({
  cursor,
  backup,
  mode,
  restoredCount,
  reason,
}: RollbackScreenProps) {
  return (
    <Box flexDirection="column">
      <Text bold>Roll back Deck</Text>
      <Box marginTop={1} flexDirection="column">
        <Text dimColor>Backup: {backup.backupId}</Text>
        <Text dimColor>Created: {formatTimestamp(backup.createdAt)}</Text>
        <Text dimColor>Reason: {backup.reason}</Text>
        <Text dimColor>Files backed up: {backup.entries.length}</Text>
        <Text dimColor>
          Version before upgrade: v{backup.deckVersionBefore}
          {backup.targetVersion ? ` (upgrade target: v${backup.targetVersion})` : ""}
        </Text>
      </Box>
      <Box marginTop={1}>
        {mode === "confirm" ? <ConfirmBody cursor={cursor} targetVersion={backup.deckVersionBefore} /> : null}
        {mode === "running" ? <RunningBody /> : null}
        {mode === "completed" ? <CompletedBody restoredCount={restoredCount} backupId={backup.backupId} /> : null}
        {mode === "failed" ? <FailedBody reason={reason} /> : null}
      </Box>
    </Box>
  );
}

function ConfirmBody({ cursor, targetVersion }: { cursor: number; targetVersion: string }) {
  return (
    <Box flexDirection="column">
      <Text>
        This will restore Deck to v{""}<Text color="yellow">v{targetVersion}</Text>{" "}
        using the backup above. State, manifest, and runner files will be restored.
      </Text>
      <Box marginTop={1}>
        <MenuList
          cursor={cursor}
          items={[
            { id: "apply", label: "Run rollback" },
            { id: "cancel", label: "Cancel" },
          ]}
        />
      </Box>
    </Box>
  );
}

function RunningBody() {
  return (
    <Box flexDirection="column">
      <Text color="cyan">Rolling back…</Text>
    </Box>
  );
}

function CompletedBody({ restoredCount, backupId }: { restoredCount?: number; backupId: string }) {
  return (
    <Box flexDirection="column">
      <Text color="green" bold>Rollback complete.</Text>
      <Text>Restored backup: {backupId}</Text>
      {typeof restoredCount === "number" ? (
        <Text dimColor>Restored {restoredCount} file{restoredCount === 1 ? "" : "s"} from backup.</Text>
      ) : null}
      <Box marginTop={1}>
        <Text dimColor>Restart Deck to load the rolled-back version.</Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>Press Enter to return to Home.</Text>
      </Box>
    </Box>
  );
}

function FailedBody({ reason }: { reason?: string }) {
  return (
    <Box flexDirection="column">
      <Text color="red" bold>Rollback failed.</Text>
      {reason ? <Text color="red">{reason}</Text> : null}
      <Box marginTop={1}>
        <Text dimColor>You can still run `deck rollback` from the CLI for manual recovery.</Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>Press Enter to return to Home.</Text>
      </Box>
    </Box>
  );
}

function formatTimestamp(iso: string): string {
  try {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return date.toISOString();
  } catch {
    return iso;
  }
}
