/**
 * Session daemon assembly (XR-3.1, design 6.3): lock -> recovery -> services -> control socket ->
 * discovery file -> idle policy. One daemon per OS user; clients start it on demand.
 */
import { randomUUID } from "node:crypto";
import { ApprovalBroker } from "./approval-broker";
import { BridgeService } from "./bridge-service";
import { systemClock, type Clock } from "./clock";
import { ControlServer } from "./control-server";
import { CredentialRegistry } from "./credentials";
import { pingDaemon } from "./daemon-client";
import { acquireDaemonLock, removeDaemonInfo, writeDaemonInfo, type DaemonInfo, type LockHolder } from "./daemon-lock";
import { createDaemonLogger, type DaemonLogger } from "./daemon-logger";
import { IdleMonitor } from "./idle-monitor";
import { ensureStateLayout, type StatePaths } from "./paths";
import { createNodeProbe, type ProcessProbe } from "./process-probe";
import { recoverAllSessions, type RecoverAllReport } from "./recovery";
import { UnavailableSessionService, type SessionService } from "./service";
import { Supervisor } from "./supervisor";

export type StopReason = string;

export type DaemonServices = {
  broker: ApprovalBroker;
  credentials: CredentialRegistry;
  supervisor: Supervisor;
  paths: StatePaths;
  clock: Clock;
  logger: DaemonLogger;
  probe: ProcessProbe;
};

export type DaemonOptions = {
  paths: StatePaths;
  version: string;
  /** Command prefix that starts a child anchor, e.g. [deck, "internal", "child-anchor"]. */
  anchorCommand: readonly string[];
  /** Builds the session manager. Defaults to a service that refuses every command (pre-SessionManager builds). */
  createService?: (services: DaemonServices) => SessionService;
  clock?: Clock;
  idleMs?: number;
  idlePollMs?: number;
  recoverOnStart?: boolean;
  probe?: ProcessProbe;
  logger?: DaemonLogger;
  maxQueuedEvents?: number;
  uid?: number;
  pid?: number;
  nonce?: string;
};

export type RunningDaemon = {
  info: DaemonInfo;
  services: DaemonServices;
  server: ControlServer;
  readonly clientCount: number;
  /** Graceful, idempotent stop. The first reason wins. */
  stop(reason: StopReason): Promise<void>;
  /** Resolves with the stop reason once cleanup has finished. */
  readonly stopped: Promise<StopReason>;
};

export type StartDaemonResult =
  | { ok: true; daemon: RunningDaemon; recovery: RecoverAllReport }
  | { ok: false; reason: "already-running"; holder?: LockHolder }
  | { ok: false; reason: "contended" };

export async function startDaemon(options: DaemonOptions): Promise<StartDaemonResult> {
  const { paths } = options;
  const clock = options.clock ?? systemClock;
  const probe = options.probe ?? createNodeProbe();
  const pid = options.pid ?? process.pid;
  ensureStateLayout(paths, { uid: options.uid });
  const logger = options.logger ?? createDaemonLogger({ dir: paths.logsDir, clock });

  const lock = await acquireDaemonLock(paths, {
    clock, pid, nonce: options.nonce,
    presence: (p) => probe.presence(p),
    ping: async (holder) => (await pingDaemon(paths.socket.path, { timeoutMs: 500 }))?.nonce === holder.nonce,
  });
  if (!lock.ok) {
    logger.info("daemon.start-refused", { reason: lock.reason });
    return lock.reason === "already-running" ? { ok: false, reason: "already-running", holder: lock.holder } : { ok: false, reason: "contended" };
  }

  let server: ControlServer | undefined;
  let service: SessionService | undefined;
  try {
    const recovery = options.recoverOnStart === false ? { sessions: [], errors: [] } : recoverAllSessions({ paths, probe });
    for (const e of recovery.errors) logger.warn("recovery.session-failed", { sessionId: e.sessionId, error: e.error });
    for (const s of recovery.sessions) logger.info("recovery.session", { sessionId: s.sessionId, interrupted: s.interrupted, unsettled: s.unsettled, approvalsDenied: s.approvalsDenied });

    const broker = new ApprovalBroker({
      clock,
      sink: { emit: (sessionId, draft) => { service?.openLog(sessionId)?.append(draft); } },
    });
    const credentials = new CredentialRegistry({ socketPath: paths.socket.path });
    const supervisor = new Supervisor({ anchorCommand: options.anchorCommand, probe });
    const services: DaemonServices = { broker, credentials, supervisor, paths, clock, logger, probe };
    service = (options.createService ?? (() => new UnavailableSessionService()))(services);
    const svc = service;

    const startedAt = clock.now();
    const nonce = lock.nonce;
    let stopRequested: ((reason: StopReason) => Promise<void>) | undefined;
    const isBusy = () => svc.hasRunningWork() || broker.pending().length > 0;

    server = new ControlServer({
      socketPath: paths.socket.path,
      service: svc,
      maxQueuedEvents: options.maxQueuedEvents,
      onDiagnostic: (d) => logger.warn(`control.${d.code}`, d.detail ? { detail: d.detail } : {}),
      bridge: new BridgeService({
        credentials, broker,
        status: (grant) => svc.taskStatus?.(grant) ?? { sessionId: grant.sessionId, taskId: grant.taskId, memberId: grant.memberId },
      }),
      daemon: {
        version: options.version, pid, nonce,
        status: () => ({
          pid, nonce, version: options.version, startedAt: new Date(startedAt).toISOString(), uptimeMs: clock.now() - startedAt,
          clients: server!.clientCount, runningWork: svc.hasRunningWork(), pendingApprovals: broker.pending().length, socketPath: paths.socket.path,
        }),
        requestRestart: () => {
          if (isBusy()) return { ok: false as const, code: "busy", message: "The daemon has running work" };
          setTimeout(() => { void stopRequested?.("restart"); }, 0);
          return { ok: true as const };
        },
      },
    });
    await server.listen();

    const info: DaemonInfo = { v: 1, pid, nonce, version: options.version, socketPath: paths.socket.path, startedAt: new Date(startedAt).toISOString() };
    writeDaemonInfo(paths, info);

    const activeServer = server;
    let stopPromise: Promise<StopReason> | undefined;
    let resolveStopped!: (reason: StopReason) => void;
    const stopped = new Promise<StopReason>((resolve) => { resolveStopped = resolve; });
    const idle = new IdleMonitor({
      clock, idleMs: options.idleMs, pollMs: options.idlePollMs, isBusy, clientCount: () => activeServer.clientCount,
      onIdle: () => { void stop("idle"); },
    });

    const stop = (reason: StopReason): Promise<void> => {
      stopPromise ??= (async () => {
        logger.info("daemon.stopping", { reason });
        idle.stop();
        broker.dispose("shutdown");
        try { await supervisor.shutdown(2000); } catch (error) { logger.warn("daemon.supervisor-shutdown-failed", { error: (error as Error).message }); }
        credentials.revokeAll();
        await activeServer.close();
        try { await svc.close?.(); } catch (error) { logger.warn("daemon.service-close-failed", { error: (error as Error).message }); }
        removeDaemonInfo(paths, nonce);
        lock.release(); // last: a new daemon may only start once children and sockets are gone
        logger.info("daemon.stopped", { reason });
        return reason;
      })().then((r) => { resolveStopped(r); return r; });
      return stopPromise.then(() => undefined);
    };
    stopRequested = stop;
    idle.start();
    logger.info("daemon.started", { pid, version: options.version, socket: paths.socket.path, socketLocation: paths.socket.location });

    return {
      ok: true, recovery,
      daemon: { info, services, server, get clientCount() { return activeServer.clientCount; }, stop, stopped },
    };
  } catch (error) {
    try { await server?.close(); } catch { /* best effort */ }
    try { await service?.close?.(); } catch { /* best effort */ }
    lock.release();
    logger.error("daemon.start-failed", { error: (error as Error).message });
    throw error;
  }
}
