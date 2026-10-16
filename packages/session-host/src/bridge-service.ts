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
        if (["deck_delegate", "deck_task_wait", "deck_task_result", "deck_task_cancel"].includes(input.tool) && grant.memberId !== "lead") return { ok: false, code: "tool-not-allowed" };
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
    const request = broker.request({
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
