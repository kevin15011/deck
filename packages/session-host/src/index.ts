/**
 * @deck/session-host: daemon mechanics for cross-runner sessions (D-1).
 * Provider-neutral and adapter-free; the CLI composes it with drivers and a SessionManager.
 */
export { systemClock, type Clock, type TimerHandle } from "./clock";
export {
  assertOutsideProject, assertPrivateFile, assertSafeSegment, ensurePrivateDir, ensureStateLayout, resolveStatePaths, sessionPaths,
  sunPathLimit, writePrivateFile, type SessionPaths, type SocketLocation, type StatePaths,
} from "./paths";
export {
  DEFAULT_FSYNC_WINDOW_MS, DEFAULT_SEGMENT_BYTES, EventLog, EventLogCorruptError, type EventDraft, type EventLogOptions, type LogDiagnostic,
} from "./event-log";
export {
  Ledger, loadLedger, saveLedgerSnapshot, TASK_STATES, TERMINAL_TASK_STATES,
  type LedgerAnomaly, type LedgerPendingApproval, type LedgerSession, type LedgerState, type LedgerTask, type LoadedLedger, type RebuildReason,
  type SessionLifecycleState, type TaskAttempt, type TaskState,
} from "./ledger";
export { ANCHOR_DRAIN_MS, ANCHOR_NONCE_ENV, parseAnchorArgv, runChildAnchor, type AnchorSignal, type AnchorToDaemon, type DaemonToAnchor } from "./anchor";
export {
  Supervisor, type SupervisedExit, type SupervisedProcess, type SupervisedSpawnOptions, type SupervisorOptions,
} from "./supervisor";
export { createNodeProbe, type Presence, type ProcessIdentity, type ProcessProbe } from "./process-probe";
export { LEASE_VERSION, LeaseInvalidError, readLease, removeLease, writeLease, type Lease } from "./lease";
export {
  continuationBlock, recoverAllSessions, recoverSession, verifyLeaseSettled,
  type ContinuationBlock, type RecoverAllReport, type RecoveryReport, type SettleVerdict, type UnsettledReason,
} from "./recovery";
export {
  APPROVAL_TIMEOUT_MS, ApprovalBroker, type ApprovalBrokerOptions, type ApprovalDecision, type ApprovalEventSink, type ApprovalRequest,
  type ApprovalResolution, type PendingApproval, type RespondResult,
} from "./approval-broker";
export { CredentialRegistry, type CredentialGrant } from "./credentials";
export { BridgeService, type BridgeServiceOptions } from "./bridge-service";
export {
  DECK_APPROVE_TOOL, DECK_STATUS_TOOL, DEFAULT_ALLOWED_TOOLS, SESSION_CREDENTIAL_ENV, SESSION_MCP_SERVER_ID, sessionMcpServerSpec,
  type SessionMcpServerSpec,
} from "./bridge-config";
export { runSessionMcpBridge, type McpBridgeOptions } from "./mcp-bridge";
export { PROTOCOL_VERSION, type ClientFrame, type CommandOutcome, type ServerFrame } from "./protocol";
export { ControlClient, type AttachHandlers } from "./control-client";
export { ControlServer, DEFAULT_MAX_QUEUED_EVENTS, type BridgePort, type ControlServerOptions, type DaemonControl } from "./control-server";
export { UnavailableSessionService, type SessionService } from "./service";
export { acquireDaemonLock, readDaemonInfo, STARTUP_GRACE_MS, type DaemonInfo, type LockHolder } from "./daemon-lock";
export { IDLE_SHUTDOWN_MS, IdleMonitor } from "./idle-monitor";
export { createDaemonLogger, type DaemonLogger } from "./daemon-logger";
export {
  startDaemon, type DaemonOptions, type DaemonServices, type RunningDaemon, type StartDaemonResult, type StopReason,
} from "./daemon";
export {
  compareVersions, DAEMON_READY_TIMEOUT_MS, DaemonStartTimeoutError, ensureDaemon, pingDaemon, spawnDetachedDaemon,
  type EnsureDaemonOptions, type EnsureDaemonResult,
} from "./daemon-client";
export { runSessionDaemon, type RunSessionDaemonOptions } from "./daemon-main";
