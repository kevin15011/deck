/** TEST-ONLY in-package stand-in for the SessionManager (no drivers, no processes). */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { SessionCommand } from "@deck/core/session/commands";
import { EventLog } from "../event-log";
import type { CommandOutcome } from "../protocol";
import type { SessionService } from "../service";

export class StubSessionService implements SessionService {
  readonly logs = new Map<string, EventLog>();
  readonly executed: Array<{ sessionId?: string; command: SessionCommand; clientId: string }> = [];
  running = false;
  private counter = 0;
  /** Optional gate so tests can hold a command in flight. */
  gate: Promise<void> | undefined;

  constructor(private readonly dir: string, private readonly logOptions: Partial<Parameters<typeof EventLog.open>[0]> = {}) {}

  addSession(sessionId: string): EventLog {
    mkdirSync(join(this.dir, sessionId), { recursive: true, mode: 0o700 });
    const log = EventLog.open({ dir: join(this.dir, sessionId, "events"), sessionId, ...this.logOptions });
    this.logs.set(sessionId, log);
    return log;
  }

  async execute(input: { sessionId?: string; command: SessionCommand; clientId: string }): Promise<CommandOutcome> {
    this.executed.push(input);
    if (this.gate) await this.gate;
    const { command } = input;
    if (command.type === "session.create") {
      const sessionId = `s-${++this.counter}`;
      this.addSession(sessionId).append({ kind: "session.created", data: { projectRoot: command.projectRoot } });
      return { ok: true, data: { sessionId } };
    }
    const log = input.sessionId ? this.logs.get(input.sessionId) : undefined;
    if (!log) return { ok: false, code: "unknown-session" };
    if (command.type === "prompt.send") {
      log.appendMany([
        { kind: "turn.started", source: { taskId: "lead" } },
        { kind: "message.completed", source: { taskId: "lead" }, data: { text: `echo:${command.text}` } },
        { kind: "turn.completed", source: { taskId: "lead" }, data: { status: "completed" } },
      ]);
      return { ok: true, data: { accepted: true } };
    }
    if (command.type === "session.stop") { log.append({ kind: "session.ended" }); return { ok: true }; }
    return { ok: true };
  }

  openLog(sessionId: string): EventLog | undefined { return this.logs.get(sessionId); }
  hasRunningWork(): boolean { return this.running; }
  close(): void { for (const log of this.logs.values()) log.close(); }
}
