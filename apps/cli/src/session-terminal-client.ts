/**
 * Line-oriented terminal client for a cross-runner session (XR-9.1): renders normalized
 * events, sends prompts, answers approvals (y/n), `/interrupt`, `/tasks`, `/detach`.
 * Detaching or EOF never stops the session (XR-3.4). All model/tool text is sanitized before
 * it reaches the terminal (control sequences stripped, secrets redacted).
 */
import { randomUUID } from "node:crypto";
import { redactText } from "@deck/core/session/redaction";
import type { SessionEvent } from "@deck/core/session/events";
import type { AttachHandlers, CommandOutcome } from "@deck/session-host";

export type TerminalConnection = {
  closed?: Promise<void>;
  attach(sessionId: string, after: number, handlers: AttachHandlers): Promise<CommandOutcome>;
  command(command: unknown, sessionId?: string): Promise<{ outcome: CommandOutcome; duplicate?: boolean }>;
  detach(sessionId: string): Promise<void>;
};

export type TerminalReason = "detached" | "ended" | "eof" | "attach-failed" | "connection-lost";
export type TerminalOptions = {
  connection: TerminalConnection;
  sessionId: string;
  after?: number;
  /** Rebuild state from all replayed events, displaying only the recent text. */
  displayAfter?: number;
  lines: AsyncIterable<string>;
  write: (text: string) => void;
  newCommandId?: () => string;
};

const TEXT_LIMIT = 20_000;
const MAX_RESYNCS = 20;
const clean = (text: unknown, cap = TEXT_LIMIT): string => redactText(typeof text === "string" ? text : "", cap);
const firstLine = (text: string): string => text.split("\n")[0] ?? "";

const HELP = [
  "Commands: /interrupt  stop the running turn      /stop  end the session",
  "          /tasks      list tasks                 /detach  leave (the session keeps running)",
  "          /help       this help                  y / n  answer a pending approval",
  "Anything else is sent to the Lead as a prompt.",
];

const REFUSALS: Record<string, string> = {
  "turn-in-progress": "A turn is still running; wait for it, or use /interrupt.",
  "session-ended": "This session has ended.",
  "session-stopping": "This session is stopping.",
  "ownership-unsettled": "The previous turn's process ownership is not settled yet; it cannot be continued.",
  "turn-not-running": "No turn is running.",
  "task-unknown": "Nothing to interrupt yet.",
};

function toolSummary(input: unknown): string {
  if (input && typeof input === "object") {
    const o = input as Record<string, unknown>;
    const pick = o.command ?? o.file_path ?? o.path ?? o.url ?? o.pattern;
    if (typeof pick === "string") return firstLine(clean(pick, 200));
  }
  return "";
}

/** Pure rendering of one event into terminal lines (empty = nothing to show). */
export function renderEvent(event: SessionEvent): string[] {
  const d = event.data;
  switch (event.kind) {
    case "message.completed": {
      const text = clean(d.text);
      return d.role === "user" ? [`you> ${text}`] : text.split("\n");
    }
    case "tool.started": {
      const summary = toolSummary(d.input);
      return [`[tool] ${clean(d.name, 80) || "tool"}${summary ? `: ${summary}` : ""}`];
    }
    case "tool.completed": return d.isError === true ? [`[tool error] ${firstLine(clean(d.output, 400))}`] : [];
    case "turn.completed": {
      const status = String(d.status);
      return [`-- turn ${status}${status === "failed" && d.error ? `: ${clean(d.error, 300)}` : ""} --`];
    }
    case "diagnostic": return [`[diagnostic] ${clean(d.code, 120)}`];
    case "session.ended": return ["[session ended]"];
    default: return [];
  }
}

type PendingApproval = { approvalId: string; tool: string; summary: string };

export async function runTerminalClient(options: TerminalOptions): Promise<{ reason: TerminalReason }> {
  const { connection, sessionId, write } = options;
  const newId = options.newCommandId ?? randomUUID;
  const println = (...lines: string[]) => { for (const l of lines) write(`${l}\n`); };

  let lastSeq = options.after ?? 0;
  let caughtUp = false;
  const pending: PendingApproval[] = [];
  const tasks = new Map<string, { state: string; attempt?: number; runner?: string; model?: string }>();
  const awaitingEcho: string[] = [];
  let resolveEnded!: () => void;
  const ended = new Promise<"ended">((resolve) => { resolveEnded = () => resolve("ended"); });
  let resyncs = 0;
  let active = true;

  const promptForApproval = (a: PendingApproval) => println(`[approval] ${a.summary || a.tool}`, "Allow? [y/N] ");
  const onEvent = (event: SessionEvent) => {
    if (!active) return;
    lastSeq = event.seq;
    const d = event.data;
    if (event.kind === "approval.requested" && typeof d.approvalId === "string") {
      const a = { approvalId: d.approvalId, tool: clean(d.tool, 80), summary: clean(d.summary, 300) };
      pending.push(a);
      if (caughtUp) promptForApproval(a);
      return;
    }
    if (event.kind === "approval.resolved") {
      const index = pending.findIndex((p) => p.approvalId === d.approvalId);
      if (index >= 0) pending.splice(index, 1);
      if (caughtUp) println(`[approval] ${String(d.decision)} (${clean(d.by, 40)})`);
      return;
    }
    if (event.kind === "task.created" && typeof d.taskId === "string") {
      tasks.set(d.taskId, { state: "created", attempt: 1, runner: String(d.runnerId ?? ""), model: String(d.modelId ?? "") });
    } else if (event.kind === "task.continued" && typeof d.taskId === "string") {
      const t = tasks.get(d.taskId); if (t) t.attempt = Number(d.attempt ?? (t.attempt ?? 1) + 1);
    } else if (event.kind === "task.state" && typeof d.taskId === "string") {
      const t = tasks.get(d.taskId); if (t) t.state = String(d.state);
    }
    if (event.kind === "message.completed" && d.role === "user") {
      const index = awaitingEcho.indexOf(String(d.text));
      if (caughtUp && index >= 0) { awaitingEcho.splice(index, 1); return; }
    }
    if (event.seq > (options.displayAfter ?? 0)) {
      if (event.kind === "task.state" && d.state === "failed") println(`[task ${clean(d.taskId, 40)} failed${d.reason ? `: ${clean(d.reason, 200)}` : ""}]`);
      for (const line of renderEvent(event)) println(line);
    }
    if (event.kind === "session.ended") { active = false; resolveEnded(); }
  };

  const attach = async (): Promise<CommandOutcome> => {
    caughtUp = false;
    return connection.attach(sessionId, lastSeq, {
      onEvent,
      onCaughtUp: () => {
        caughtUp = true;
        for (const a of pending) promptForApproval(a);
      },
      onResync: () => {
        if (++resyncs > MAX_RESYNCS) { println("[connection] too many resyncs; detaching"); resolveEnded(); return; }
        void attach().catch(() => resolveEnded());
      },
    });
  };

  const first = await attach();
  if (!first.ok) {
    println(`Unable to attach to session ${sessionId}: ${first.code}${first.message ? ` (${first.message})` : ""}`);
    return { reason: "attach-failed" };
  }

  const send = async (body: Record<string, unknown>): Promise<CommandOutcome> => {
    try { return (await connection.command({ v: 1, commandId: newId(), ...body }, sessionId)).outcome; } catch (error) {
      return { ok: false, code: "connection-lost", message: (error as Error).message };
    }
  };
  const report = (outcome: CommandOutcome) => {
    if (!outcome.ok) println(REFUSALS[outcome.code] ?? `Refused: ${outcome.code}${outcome.message ? ` (${outcome.message})` : ""}`);
  };

  const handleLine = async (raw: string): Promise<TerminalReason | undefined> => {
    const line = raw.trim();
    if (line.length === 0) return undefined;
    if (pending.length > 0 && !line.startsWith("/")) {
      const approval = pending[0]!;
      const allow = /^(y|yes)$/i.test(line);
      const outcome = await send({ type: "approval.respond", approvalId: approval.approvalId, decision: allow ? "allow-once" : "deny" });
      if (outcome.ok || outcome.code === "already-resolved" || outcome.code === "unknown-approval") {
        const index = pending.indexOf(approval);
        if (index >= 0) pending.splice(index, 1);
      }
      report(outcome);
      return undefined;
    }
    if (line.startsWith("/")) {
      switch (line.split(/\s+/)[0]) {
        case "/detach": return "detached";
        case "/interrupt": report(await send({ type: "turn.interrupt", taskId: "lead" })); return undefined;
        case "/stop": report(await send({ type: "session.stop" })); return undefined;
        case "/tasks":
          if (tasks.size === 0) println("(no tasks yet)");
          for (const [id, t] of tasks) println(`${id}  ${t.state}${t.attempt ? ` (attempt ${t.attempt})` : ""}${t.runner ? `  ${t.runner}/${t.model}` : ""}`);
          return undefined;
        case "/help": println(...HELP); return undefined;
        default: println(`Unknown command: ${line.split(/\s+/)[0]}. Try /help.`); return undefined;
      }
    }
    awaitingEcho.push(line);
    const outcome = await send({ type: "prompt.send", text: line });
    if (!outcome.ok) awaitingEcho.pop();
    report(outcome);
    return undefined;
  };

  const reader = (async (): Promise<TerminalReason> => {
    for await (const line of options.lines) {
      if (!active) return "ended";
      const done = await handleLine(line);
      if (done) return done;
    }
    return "eof";
  })();

  const disconnected = connection.closed?.then(() => {
    if (!active) return "detached" as const;
    active = false;
    println("[connection] daemon connection closed; reattach to continue");
    return "connection-lost" as const;
  });
  const reason = await Promise.race([reader, ended, ...(disconnected ? [disconnected] : [])]);
  active = false;
  try { await connection.detach(sessionId); } catch { /* the connection may already be gone */ }
  return { reason };
}
