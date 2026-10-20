import { redactText } from "@deck/core/session/redaction";
import { isApprovalToolKey, type ApprovalRisk } from "@deck/core/session/approval";
import { randomUUID } from "node:crypto";
import { isAbsolute } from "node:path";
import { validateQuestions, type Question } from "@deck/core/session/question";
import type { QuestionBroker } from "./question-broker";
/** Daemon side of the session MCP bridge: authenticates the task credential, enforces its tool grant, serves the tools. */
import { DECK_APPROVE_TOOL, DECK_STATUS_TOOL } from "./bridge-config";
import type { ApprovalBroker } from "./approval-broker";
import type { BridgePort } from "./control-server";
import type { CredentialGrant, CredentialRegistry } from "./credentials";
import type { CommandOutcome } from "./protocol";

export type BridgeServiceOptions = {
  credentials: CredentialRegistry;
  broker: ApprovalBroker;
  questionBroker?: QuestionBroker;
  /** Current view of the calling task for `deck_status`. */
  status: (grant: CredentialGrant) => unknown;
  callTaskTool?: (grant: CredentialGrant, name: string, args: unknown, context: { signal?: AbortSignal }) => Promise<CommandOutcome>;
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export class BridgeService implements BridgePort {
  constructor(private readonly options: BridgeServiceOptions) {}

  async call(input: { token: string; tool: string; arguments?: unknown }, context: { signal?: AbortSignal } = {}): Promise<CommandOutcome> {
    const grant = this.options.credentials.lookup(input.token);
    if (!grant) return { ok: false, code: "credential-revoked" };
    if (!grant.allowedTools.includes(input.tool)) return { ok: false, code: "tool-not-allowed", message: input.tool };
    switch (input.tool) {
      case DECK_STATUS_TOOL: return { ok: true, data: this.options.status(grant) };
      case DECK_APPROVE_TOOL: return this.approve(grant, input.arguments, context.signal);
      default:
        // Task identity changes with Lead generations; the manager validates the active owner.
        if (["deck_delegate", "deck_task_wait", "deck_task_result", "deck_task_cancel", "deck_task_list", "deck_task_integrate", "deck_decision_open", "deck_decision_list", "deck_decision_revise", "deck_decision_resolve"].includes(input.tool) && grant.memberId !== "lead") return { ok: false, code: "tool-not-allowed" };
        return this.options.callTaskTool?.(grant, input.tool, input.arguments, context) ?? { ok: false, code: "tool-unknown", message: input.tool };
    }
  }

  private async approve(grant: CredentialGrant, args: unknown, signal?: AbortSignal): Promise<CommandOutcome> {
    if (!isObj(args) || typeof args.tool_name !== "string" || args.tool_name.length === 0 || (args.input !== undefined && !isObj(args.input))) {
      return { ok: false, code: "invalid-arguments", message: "deck_approve needs {tool_name: string, input: object}" };
    }
    if (signal?.aborted) return { ok: false, code: "aborted" };
    const { broker } = this.options;
    const input = (args.input ?? {}) as Record<string, unknown>;
    const questionBroker = this.options.questionBroker;
    if (args.tool_name === "AskUserQuestion" && questionBroker) {
      const questions = Array.isArray(input.questions) ? input.questions.map((raw, index) => {
        if (!isObj(raw)) return null;
        return {
          id: `q${index + 1}`, prompt: raw.question, header: raw.header,
          options: raw.options, multiple: !!raw.multiSelect, allowOther: true, secret: false,
        };
      }) : undefined;
      if (!validateQuestions(questions)) return { ok: false, code: "invalid-arguments", message: "AskUserQuestion needs valid questions" };
      const request = questionBroker.request({
        sessionId: grant.sessionId, taskId: grant.taskId, memberId: grant.memberId, runnerId: grant.runnerId,
        questionId: randomUUID(), tool: args.tool_name, questions,
      });
      const onAbort = () => { questionBroker.cancel(request.questionId, "bridge-disconnected"); };
      signal?.addEventListener("abort", onAbort, { once: true });
      // A synchronous event sink can abort while request() publishes the question.
      if (signal?.aborted) onAbort();
      try {
        const resolution = await request.resolution;
        if (resolution.outcome !== "answered") return { ok: true, data: { behavior: "deny", message: "The user dismissed the question." } };
        return { ok: true, data: { behavior: "allow", updatedInput: claudeAnswers(input, questions, resolution.answers) } };
      } finally {
        signal?.removeEventListener("abort", onAbort);
      }
    }
    const toolKey = `claude:${args.tool_name}`;
    if (!isApprovalToolKey(toolKey)) return { ok: false, code: "invalid-arguments", message: "Invalid Claude tool name" };
    const request = broker.request({
      ...claudeApprovalAction(args.tool_name, input), toolKey,
      sessionId: grant.sessionId, taskId: grant.taskId, memberId: grant.memberId, runnerId: grant.runnerId, tool: args.tool_name, input,
    });
    // The child went away (bridge connection closed): nobody can act on the decision any more.
    const onAbort = () => { broker.cancel(request.approvalId, "bridge-disconnected"); };
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const resolution = await request.resolution;
      return resolution.decision === "allow-once"
        ? { ok: true, data: { behavior: "allow", updatedInput: input } }
        : { ok: true, data: { behavior: "deny", message: `Denied by ${resolution.by}` } };
    } finally {
      signal?.removeEventListener("abort", onAbort);
    }
  }
}

function claudeAnswers(input: Record<string, unknown>, questions: Question[], answers: Record<string, string[]>): Record<string, unknown> {
  const result: Record<string, string> = Object.create(null);
  const reserved = new Set(questions.map(q => q.prompt));
  const updatedQuestions = (input.questions as Record<string, unknown>[]).slice();
  for (const [index, question] of questions.entries()) {
    let key = question.prompt;
    // Claude keys answers by full text. Later duplicates get the first free numbered
    // suffix, reserving literal question texts so no answer can overwrite another.
    for (let suffix = 2; Object.hasOwn(result, key); suffix++) {
      key = `${question.prompt} (${suffix})`;
      if (reserved.has(key)) key = question.prompt;
    }
    if (key !== question.prompt) updatedQuestions[index] = { ...updatedQuestions[index], question: key };
    result[key] = answers[question.id]!.join(", ");
  }
  return { ...input, questions: updatedQuestions, answers: result };
}

const CLAUDE_READ_ONLY_TOOLS = new Set(["Read", "Glob", "Grep", "WebSearch", "TodoWrite", "TaskGet", "TaskList", "TaskOutput", "ListAgents"]);

function claudeApprovalAction(tool: string, input: Record<string, unknown>): { identity?: string; exactKey?: string; risk: ApprovalRisk } {
  const risk = CLAUDE_READ_ONLY_TOOLS.has(tool) ? "normal" : "high";
  // Full unredacted action identity is for the broker's in-memory matching only.
  // Display redaction/truncation must never collapse distinct actions into a grant.
  const canonical = JSON.stringify(sortClaudeArguments({ tool_name: tool, input }));
  const identity = claudeHasExactContext(tool, input) && Buffer.byteLength(canonical, "utf8") <= 16 * 1024 ? { identity: canonical } : {};
  if (tool.startsWith("mcp__")) {
    const json = JSON.stringify(sortClaudeArguments(input));
    return { ...identity, risk, exactKey: redactText(`${tool}(${json})`, 4096) };
  }
  let action: unknown;
  switch (tool) {
    case "Bash": action = input.command; break;
    case "Edit": case "Write": case "MultiEdit": case "NotebookEdit": case "Read":
      action = input.file_path ?? input.notebook_path; break;
    case "WebFetch": action = input.url; break;
    case "WebSearch": action = input.query; break;
  }
  return { ...identity, risk, ...(typeof action === "string" && action ? { exactKey: redactText(action, 4096) } : {}) };
}

function claudeHasExactContext(tool: string, input: Record<string, unknown>): boolean {
  if (tool.startsWith("mcp__") || tool === "WebFetch" || tool === "WebSearch") return true;
  switch (tool) {
    case "Edit": case "Write": case "MultiEdit": case "NotebookEdit": case "Read": {
      const paths = [input.file_path, input.notebook_path].filter(path => path !== undefined);
      return paths.length > 0 && paths.every(path => typeof path === "string" && isAbsolute(path));
    }
    default:
      // The credential and bridge context carry no trusted effective runner cwd.
      // Bash (even with a caller-supplied cwd), relative paths and unknown tools
      // therefore cannot supply an exact identity. Once/tool grants still work.
      return false;
  }
}

function sortClaudeArguments(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortClaudeArguments);
  if (!isObj(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, sortClaudeArguments(value[key])]));
}
