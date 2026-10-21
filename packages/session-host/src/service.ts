/**
 * Port between the control server and the session manager (S1b implements it).
 * The server owns transport concerns (framing, idempotency, attach); the service owns sessions.
 */
import type { SessionEvent } from "@deck/core/session/events";
import type { PushAttention } from "./web-push";
import type { ImageAttachment, SessionCommand } from "@deck/core/session/commands";
import type { QuestionBroker } from "./question-broker";
import type { CredentialGrant } from "./credentials";
import type { EventLog } from "./event-log";
import type { CommandOutcome, ExecuteOutcome } from "./protocol";

export interface SessionService {
  /** Exposes the manager fallback when older compositions omit the shared broker option. */
  readonly questionBroker?: QuestionBroker;
  /** Execute a validated command. Workspace registration and session creation need no sessionId. */
  execute(input: { sessionId?: string; command: SessionCommand; clientId: string }): Promise<ExecuteOutcome>;
  /** Authenticated browser images; managed files remain private to the host. */
  uploadAttachment?(input: {sessionId: string; bytes: Uint8Array; mimeType: string; name: string}): CommandOutcome;
  readAttachment?(sessionId: string, attachmentId: string): {attachment: ImageAttachment; bytes: Uint8Array} | undefined;
  /** The event log of a known session, or undefined. */
  openLog(sessionId: string): EventLog | undefined;
  /** Live appended events only: no history replay and independent of attached clients. */
  subscribeEvents?(listener: (event: SessionEvent) => void): () => void;
  /** Derive current unresolved attention from durable evidence; reading never resolves it. */
  pushAttentionItems?(sessionId: string): import("./push-attention").AttentionItem[];
  pushAttentionSessions?(): string[];
  canNotifyReplies?(sessionId:string):boolean;
  isPushAttentionCurrent?(attention: PushAttention): boolean;
  /** True while any task runs: keeps the daemon alive and blocks version-skew restarts. */
  hasRunningWork(): boolean;
  /** Read-only/admin queries from clients (`sessions.list`, `sessions.prune`, `drivers.status`, ...). Optional. */
  query?(name: string, args: unknown): Promise<CommandOutcome> | CommandOutcome;
  /** View of a task for the bridge's `deck_status` tool. Optional: the daemon falls back to the grant itself. */
  taskStatus?(grant: CredentialGrant): unknown;
  /** Authenticated task tool effects; bridge owns credential lookup, host validates ownership. */
  callTaskTool?(grant: CredentialGrant, name: string, args: unknown, context: { signal?: AbortSignal }): Promise<CommandOutcome>;
  /** Release resources on daemon stop (logs, handles). */
  close?(reason?:string): Promise<void> | void;
  restartSnapshot?():{fingerprint:string;tasks:number};
}

/** Production placeholder until the SessionManager lands: every command is refused, no sessions exist. */
export class UnavailableSessionService implements SessionService {
  async execute(): Promise<CommandOutcome> {
    return { ok: false, code: "session-manager-unavailable", message: "This daemon build has no session manager yet" };
  }
  openLog(): undefined { return undefined; }
  hasRunningWork(): boolean { return false; }
}
