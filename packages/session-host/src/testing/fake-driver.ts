import type { Question, DriverQuestionAnswer } from "@deck/core/session/question";
/** TEST-ONLY scriptable RunnerSessionDriver for SessionManager tests (not exported from the package). */
import { randomUUID } from "node:crypto";
import type {
  DriverEvent, DriverHostIo, DriverProbe, DriverTaskHandle, DriverTaskInput, RunnerSessionDriver, TurnOutcome,
} from "@deck/core/session/driver";

export class FakeTurn {
  readonly interrupts: number[] = [];
  closed = false;
  private resolveDone!: (o: TurnOutcome) => void;
  readonly done = new Promise<TurnOutcome>((resolve) => { this.resolveDone = resolve; });
  /** When set, `interrupt()` finishes the turn with this outcome (a cooperative runner). */
  onInterrupt: TurnOutcome | undefined = { status: "interrupted" };
  finished = false;

  constructor(readonly input: DriverTaskInput, readonly io: DriverHostIo, readonly nativeSessionId: string) {}

  emit(kind: string, data: Record<string, unknown> = {}, raw?: unknown): void { this.io.emit({ kind, data, ...(raw === undefined ? {} : { raw }) } as DriverEvent); }
  /** What a real driver emits when the native CLI confirms the session. */
  init(): void { this.emit("turn.started", { nativeSessionId: this.nativeSessionId, mcpServers: this.input.mcp.servers }, { type: "system", subtype: "init" }); }
  ask(questions: Question[], questionId: string = randomUUID()): Promise<DriverQuestionAnswer> { return this.io.question?.({ questionId, questions }) ?? Promise.resolve({ outcome: "dismissed" }); }
  say(text: string): void { this.emit("message.completed", { text }); }
  finish(outcome: TurnOutcome = { status: "completed" }): void { if (this.finished) return; this.finished = true; this.resolveDone(outcome); }
}

export class FakeDriver implements RunnerSessionDriver {
  readonly protocol = "fake-protocol";
  readonly testedVersions = { min: "1.0.0", maxTested: "1.0.0" };
  probeResult: DriverProbe = { status: "ready", version: "1.0.0", capabilities: ["caller-assigned-session-id"], mcpIsolationVerified: true };
  probes = 0;
  readonly turns: FakeTurn[] = [];
  startError: Error | undefined;
  /** Called synchronously inside startTask, before the handle is returned (lets tests observe pre-spawn state). */
  onStart: ((turn: FakeTurn) => void) | undefined;
  /** Auto-finish each turn right after it starts (init + one reply + completed). */
  autoComplete = false;
  readonly assignsIds: boolean;

  constructor(readonly runnerId = "claude", options: { assignsIds?: boolean } = {}) {
    this.assignsIds = options.assignsIds ?? true;
    if (this.assignsIds) this.newNativeSessionId = () => randomUUID();
  }

  newNativeSessionId?: () => string;

  async probe(): Promise<DriverProbe> { this.probes++; return this.probeResult; }

  async startTask(input: DriverTaskInput, io: DriverHostIo): Promise<DriverTaskHandle> {
    if (this.startError) throw this.startError;
    const nativeSessionId = input.resume?.nativeSessionId ?? input.nativeSessionId ?? `native-${randomUUID()}`;
    const turn = new FakeTurn(input, io, nativeSessionId);
    this.turns.push(turn);
    this.onStart?.(turn);
    if (this.autoComplete) queueMicrotask(() => { turn.init(); turn.say(`reply to: ${input.prompt}`); turn.emit("usage", { inputTokens: 1, outputTokens: 1 }); turn.finish(); });
    return {
      nativeSessionId: Promise.resolve(nativeSessionId),
      send: async () => { throw new Error("FakeDriver.send is not scripted"); },
      interrupt: async () => { turn.interrupts.push(Date.now()); if (turn.onInterrupt) turn.finish(turn.onInterrupt); },
      done: turn.done,
      close: async () => { turn.closed = true; turn.finish({ status: "interrupted-forced" }); },
    };
  }
}
