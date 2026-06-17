import React from "react";
import { Box, Text } from "ink";

/**
 * Phase labels rendered by the upgrade progress screen.
 *
 * The order matches the spec §States and Transitions. The actual
 * orchestrator runs the steps sequentially; the TUI surfaces the
 * current phase label as the orchestrator progresses. Phases are
 * coarse-grained on purpose — the orchestrator is the source of
 * truth and may move through them faster than the UI can poll.
 */
export const UPGRADE_PHASES: readonly string[] = [
  "Downloading",
  "Staging",
  "Migrating",
  "Replacing binary",
  "Syncing content",
  "Verifying",
  "Complete",
];

export type UpgradeProgressStatus =
  | { kind: "running"; phase: string; completedCount: number }
  | { kind: "rolled_back"; backupId?: string; reason: string }
  | { kind: "partial_failure"; failedRunners: string[]; succeededRunners: string[]; backupId?: string; reason: string }
  | { kind: "completed"; version: string; backupId?: string }
  | { kind: "failed"; reason: string };

type UpgradeProgressScreenProps = {
  status: UpgradeProgressStatus;
  /** Target version the upgrade is moving to. */
  targetVersion: string;
};

/**
 * Upgrade progress / rollback UI.
 *
 * - `running` → progress bar + current phase label.
 * - `rolled_back` → rollback complete message + reason.
 * - `completed` → restart prompt + summary.
 * - `failed` → upgrade failed with reason.
 */
export function UpgradeProgressScreen({ status, targetVersion }: UpgradeProgressScreenProps) {
  return (
    <Box flexDirection="column">
      <Text bold>Update Deck → v{targetVersion}</Text>
      <Box marginTop={1} flexDirection="column">
        {status.kind === "running" ? <RunningBody status={status} /> : null}
        {status.kind === "rolled_back" ? <RolledBackBody status={status} /> : null}
        {status.kind === "partial_failure" ? <PartialFailureBody status={status} /> : null}
        {status.kind === "completed" ? <CompletedBody status={status} /> : null}
        {status.kind === "failed" ? <FailedBody status={status} /> : null}
      </Box>
    </Box>
  );
}

function RunningBody({ status }: { status: Extract<UpgradeProgressStatus, { kind: "running" }> }) {
  return (
    <>
      <Text color="cyan">{status.phase}…</Text>
      <Box marginTop={1} flexDirection="column">
        {UPGRADE_PHASES.map((label, idx) => {
          const isCurrent = label === status.phase;
          const isDone = idx < status.completedCount;
          return (
            <Text
              key={label}
              color={isCurrent ? "cyan" : isDone ? "green" : undefined}
              dimColor={!isCurrent && !isDone}
            >
              {isDone ? "✓" : isCurrent ? "❯" : " "} {label}
            </Text>
          );
        })}
      </Box>
    </>
  );
}

function RolledBackBody({ status }: { status: Extract<UpgradeProgressStatus, { kind: "rolled_back" }> }) {
  return (
    <>
      <Text color="yellow" bold>Rolled back to the previous version</Text>
      <Text dimColor>Reason: {status.reason}</Text>
      {status.backupId ? <Text dimColor>Backup used: {status.backupId}</Text> : null}
      <Box marginTop={1}>
        <Text dimColor>Press Enter to return to Home.</Text>
      </Box>
    </>
  );
}

function PartialFailureBody({ status }: { status: Extract<UpgradeProgressStatus, { kind: "partial_failure" }> }) {
  return (
    <>
      <Text color="yellow" bold>Update partially completed</Text>
      <Text>Some runners failed to sync.</Text>
      {status.succeededRunners.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>✓ Succeeded:</Text>
          {status.succeededRunners.map((runnerId) => (
            <Text key={runnerId} color="green">  • {runnerId}</Text>
          ))}
        </Box>
      )}
      {status.failedRunners.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>✗ Failed:</Text>
          {status.failedRunners.map((runnerId) => (
            <Text key={runnerId} color="red">  • {runnerId}</Text>
          ))}
        </Box>
      )}
      <Text dimColor>Reason: {status.reason}</Text>
      {status.backupId ? <Text dimColor>Backup used: {status.backupId}</Text> : null}
      <Box marginTop={1}>
        <Text dimColor>Press Enter to return to Home.</Text>
      </Box>
    </>
  );
}

function CompletedBody({ status }: { status: Extract<UpgradeProgressStatus, { kind: "completed" }> }) {
  return (
    <>
      <Text color="green" bold>Update to v{status.version} complete.</Text>
      {status.backupId ? <Text dimColor>Backup retained: {status.backupId}</Text> : null}
      <Box marginTop={1}>
        <Text dimColor>Restart Deck to load the new version.</Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>Press Enter to return to Home.</Text>
      </Box>
    </>
  );
}

function FailedBody({ status }: { status: Extract<UpgradeProgressStatus, { kind: "failed" }> }) {
  return (
    <>
      <Text color="red" bold>Update failed.</Text>
      <Text color="red">{status.reason}</Text>
      <Box marginTop={1}>
        <Text dimColor>Press Enter to return to Home.</Text>
      </Box>
    </>
  );
}
