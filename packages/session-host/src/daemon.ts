import { runnerMutationActive, acquireRunnerMutationMarker, releaseRunnerMutationMarker } from "./runner-mutation";
import {WebRestart,type RestartIdentity,type RestartLauncher} from "./web-restart";
import {createHash} from "node:crypto";
import { QuestionBroker } from "./question-broker";
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
import { WebService, type WebServiceOptions, type WebAssets, type WebConfig } from "./web-service";
import { Supervisor } from "./supervisor";
import type { CommandOutcome } from "./protocol";

export type StopReason = string;

export type DaemonServices = {
  broker: ApprovalBroker;
  questionBroker: QuestionBroker;
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
  restart?:{identity:Omit<RestartIdentity,"pid"|"nonce">;launcher:RestartLauncher};
  restartChannel?:"stable"|"canary";
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
  web?: { config: WebConfig; assets?: WebAssets; autoStart?: boolean; push?: WebServiceOptions["push"] };
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

  if (runnerMutationActive(paths, probe)) {lock.release();return {ok:false,reason:"contended"};}

  let server: ControlServer | undefined;
  let service: SessionService | undefined;
  let web: WebService | undefined;
  try {
    const recovery = options.recoverOnStart === false ? { sessions: [], errors: [] } : recoverAllSessions({ paths, probe });
    for (const e of recovery.errors) logger.warn("recovery.session-failed", { sessionId: e.sessionId, error: e.error });
    for (const s of recovery.sessions) logger.info("recovery.session", { sessionId: s.sessionId, interrupted: s.interrupted, unsettled: s.unsettled, approvalsDenied: s.approvalsDenied });

    const broker = new ApprovalBroker({
      clock,
      sink: { emit: (sessionId, draft) => { service?.openLog(sessionId)?.append(draft); } },
    });
    const defaultQuestionBroker = new QuestionBroker({ sink: { emit: (sessionId, draft) => { service?.openLog(sessionId)?.append(draft); } } });
    const credentials = new CredentialRegistry({ socketPath: paths.socket.path });
    const supervisor = new Supervisor({ anchorCommand: options.anchorCommand, probe });
    const services: DaemonServices = { broker, questionBroker: defaultQuestionBroker, credentials, supervisor, paths, clock, logger, probe };
    service = (options.createService ?? (() => new UnavailableSessionService()))(services);
    const svc = service;
    // Older CLI compositions construct the manager with only the approval broker.
    const questionBroker = svc.questionBroker ?? defaultQuestionBroker;
    services.questionBroker = questionBroker;
    let draining = false;
    let admitted = 0;
    // Fence admission synchronously with restart acceptance. All transports share the same gate,
    // including commands already admitted before the service reports a running native turn.
    const admit = async (effect: () => CommandOutcome | Promise<CommandOutcome>): Promise<CommandOutcome> => {
      if (draining) return { ok: false, code: "daemon-stopping", message: "The daemon is shutting down" };
      if (runnerMutationActive(paths, probe)) return {ok:false,code:"runner-mutation-active",message:"Runner maintenance is in progress; retry when it finishes."};
      admitted++;
      try { return await effect(); } finally { admitted--; }
    };
    const guardedService: SessionService = {
      execute: (input) => admit(() => svc.execute(input)), openLog: (id) => svc.openLog(id), hasRunningWork: () => svc.hasRunningWork(),
      query: (name, args) => admit(() => svc.query?.(name, args) ?? { ok: false, code: "query-unknown" }),
      uploadAttachment: (input) => {
        if (draining) return { ok: false, code: "daemon-stopping" };
        if (runnerMutationActive(paths, probe)) return {ok:false,code:"runner-mutation-active"};
        admitted++;
        try { return svc.uploadAttachment?.(input) ?? { ok: false, code: "attachment-unavailable" }; }
        finally { admitted--; }
      },
      subscribeEvents: svc.subscribeEvents ? listener => svc.subscribeEvents!(listener) : undefined,
      pushAttentionItems: svc.pushAttentionItems ? id => draining ? [] : svc.pushAttentionItems!(id) : undefined,
      pushAttentionSessions: svc.pushAttentionSessions ? () => draining ? [] : svc.pushAttentionSessions!() : undefined,
      isPushAttentionCurrent: attention => !draining && (svc.isPushAttentionCurrent?.(attention) ?? false),
      readAttachment: (sessionId, attachmentId) => svc.readAttachment?.(sessionId, attachmentId),
    };
    const transportService: SessionService = {
      execute: (input) => guardedService.execute(input), openLog: (id) => svc.openLog(id), hasRunningWork: () => svc.hasRunningWork(),
      query: (name, args) => name === "runner-mutation.acquire"
        ? Promise.resolve(!draining && !isBusy() && svc.hasActiveSessions?.() === false && acquireRunnerMutationMarker(paths,args) ? {ok:true} : {ok:false,code:"runner-mutation-deferred"})
        : name === "runner-mutation.release" ? Promise.resolve({ok:releaseRunnerMutationMarker(paths,args)} as CommandOutcome)
        : name.startsWith("web.") ? admit(() => web?.query(name, args) ?? { ok: false, code: "web-unavailable" }) : guardedService.query!(name, args),
    };

    const startedAt = clock.now();
    const nonce = lock.nonce;
    let stopRequested: ((reason: StopReason) => Promise<void>) | undefined;
    const isBusy = () => runnerMutationActive(paths, probe) || admitted > 0 || svc.hasRunningWork() || broker.pending().length > 0 || questionBroker.pending().length > 0;
    const bridge = new BridgeService({
      credentials, broker, questionBroker,
      status: (grant) => svc.taskStatus?.(grant) ?? { sessionId: grant.sessionId, taskId: grant.taskId, memberId: grant.memberId },
      callTaskTool: (grant, name, args, context) => svc.callTaskTool?.(grant, name, args, context) ?? Promise.resolve({ ok: false, code: "tool-unknown" }),
    });

    const restart=new WebRestart({paths,current:{...(options.restart?.identity??{version:options.version,channel:options.restartChannel??"stable",digest:"0".repeat(64)}),pid,nonce},launcher:options.restart?.launcher??{inspect:async()=>{throw Error("restart-unavailable");},prepare:async()=>{throw Error("restart-unavailable");}},
      snapshot:()=>{const work=svc.restartSnapshot?.(),approvals=broker.pending(),questions=questionBroker.pending();return{fingerprint:createHash('sha256').update(JSON.stringify([work?.fingerprint??svc.hasRunningWork(),approvals,questions,admitted,draining,web?.status().port])).digest('hex'),tasks:work?.tasks??Number(svc.hasRunningWork()),approvals:approvals.length,questions:questions.length,busy:isBusy()||draining};},
      webPort:()=>web?.status().port,
      drain:value=>{if(value&&draining)throw Error('restart-in-progress');draining=value;},stop:reason=>{void stopRequested?.(reason);},
    });
    if(options.web){web=new WebService({paths,service:guardedService,...options.web,restart});if(options.web.autoStart!==false)try{web.start();}catch{logger.warn('web.listen-failed');}}

    server = new ControlServer({
      socketPath: paths.socket.path,
      service: transportService,
      maxQueuedEvents: options.maxQueuedEvents,
      onDiagnostic: (d) => logger.warn(`control.${d.code}`, d.detail ? { detail: d.detail } : {}),
      bridge: { call: (input, context) => admit(() => bridge.call(input, context)) },
      daemon: {
        version: options.version, pid, nonce,
        status: () => ({
          pid, nonce, version: options.version, startedAt: new Date(startedAt).toISOString(), uptimeMs: clock.now() - startedAt,
          clients: server!.clientCount + (web?.clientCount ?? 0), web: web?.status(), runningWork: svc.hasRunningWork(), activeSessions: svc.hasActiveSessions?.() ?? false, pendingApprovals: broker.pending().length, pendingQuestions: questionBroker.pending().length, socketPath: paths.socket.path, stopping: draining, ...(options.restart?{executable:options.restart.identity}:{}),
        }),
        requestRestart: () => {
          if (draining) return { ok: true as const };
          if (isBusy()) return { ok: false as const, code: "busy", message: "The daemon has running work" };
          draining = true;
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
      clock, idleMs: options.idleMs, pollMs: options.idlePollMs, isBusy, clientCount: () => activeServer.clientCount + (web?.clientCount ?? 0),
      onIdle: () => { void stop("idle"); },
    });

    const stop = (reason: StopReason): Promise<void> => {
      draining = true;
      stopPromise ??= (async () => {
        logger.info("daemon.stopping", { reason });
        idle.stop();
        broker.dispose(reason.startsWith("web-restart-forced:")?reason:"shutdown");
        questionBroker.dispose(reason.startsWith("web-restart-forced:")?reason:"shutdown");
        // Let the manager abort readiness, drain native handles and release shared backend
        // leases before group containment. A stuck adapter still has a bounded grace period.
        const serviceClosing = Promise.resolve().then(() => svc.close?.(reason.startsWith("web-restart-forced:")?reason:undefined)).catch((error) => { logger.warn("daemon.service-close-failed", { error: (error as Error).message }); });
        let closeTimer: ReturnType<Clock["setTimeout"]> | undefined;
        try {
          await Promise.race([serviceClosing, new Promise<void>((resolve) => { closeTimer = clock.setTimeout(() => { logger.warn("daemon.service-close-timeout"); resolve(); }, 7500); })]);
        } finally { if (closeTimer !== undefined) clock.clearTimeout(closeTimer); }
        try { await supervisor.shutdown(2000); } catch (error) { logger.warn("daemon.supervisor-shutdown-failed", { error: (error as Error).message }); }
        credentials.revokeAll();
        await web?.close();
        await activeServer.close();
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
      daemon: { info, services, server, get clientCount() { return activeServer.clientCount + (web?.clientCount ?? 0); }, stop, stopped },
    };
  } catch (error) {
    try { await web?.close(); } catch { /* best effort */ }
    try { await server?.close(); } catch { /* best effort */ }
    try { await service?.close?.(); } catch { /* best effort */ }
    lock.release();
    logger.error("daemon.start-failed", { error: (error as Error).message });
    throw error;
  }
}
