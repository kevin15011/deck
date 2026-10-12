/**
 * Port between the control server and the session manager (S1b implements it).
 * The server owns transport concerns (framing, idempotency, attach); the service owns sessions.
 */
import type { SessionCommand } from "@deck/core/session/commands";
import type { EventLog } from "./event-log";
import type { CommandOutcome } from "./protocol";

export interface SessionService {
  /** Execute an already validated command. `sessionId` is absent only for `session.create`. */
  execute(input: { sessionId?: string; command: SessionCommand; clientId: string }): Promise<CommandOutcome>;
  /** The event log of a known session, or undefined. */
  openLog(sessionId: string): EventLog | undefined;
  /** True while any task runs: keeps the daemon alive and blocks version-skew restarts. */
  hasRunningWork(): boolean;
}

/** Production placeholder until the SessionManager lands: every command is refused, no sessions exist. */
export class UnavailableSessionService implements SessionService {
  async execute(): Promise<CommandOutcome> {
    return { ok: false, code: "session-manager-unavailable", message: "This daemon build has no session manager yet" };
  }
  openLog(): undefined { return undefined; }
  hasRunningWork(): boolean { return false; }
}
