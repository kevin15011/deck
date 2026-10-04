import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { ExtensionAPI, ExtensionContext } from "../shared/pi-api";
import { resolveMemoryHandoff } from "../shared/memory-handoff";
import { discoverAgents, findAgent } from "./agents";
import { createChildRunner, type ChildRunnerOptions } from "./runner";
import { BackgroundJobs, clean } from "./jobs";
import { taskBoard } from "./task-board";
import { completionRecap, recapJobs, RECAP_ANCHOR, RECAP_BOUNDARY, RECAP_MEMBERS } from "./recap";
import { SubagentPanel, jobDetails, toolCard } from "./panel";
import { prepareChildSession } from "./storage";
import { assertExecutionSettled } from "./execution-lease";
import { installChildShell, type NativeShellAPI } from "./child-shell";
import { installChildClarifications } from "./clarification";

export const MAX_PARALLEL_TASKS = 8;
export const MAX_CONCURRENCY = 4;


export type DeckSubagentsOptions = Pick<ChildRunnerOptions, "piInvocation" | "killGraceMs" | "timeoutMs"> & {
  /** Deck package agents directory. Default: `<package>/agents` relative to this module (never user/project dirs). */
  agentsDir?: string;
  env?: Readonly<Record<string, string | undefined>>;
};

const TASK_ITEM = {
  type: "object",
  properties: {
    agent: { type: "string", description: "Name of the Deck role to invoke, e.g. deck-investigate" },
    task: { type: "string", description: "Task to delegate to the role" },
    title: { type: "string", maxLength: 80, description: "Short user-facing task title, separate from the internal assignment" },
    cwd: { type: "string", description: "Working directory for the role process" },
  },
  required: ["agent", "task"],
} as const;

const CHAIN_ITEM = {
  type: "object",
  properties: {
    agent: { type: "string", description: "Name of the Deck role to invoke" },
    task: { type: "string", description: "Task with optional {previous} placeholder for the prior step output" },
    title: { type: "string", maxLength: 80, description: "Short user-facing task title, separate from the internal assignment" },
    cwd: { type: "string", description: "Working directory for the role process" },
  },
  required: ["agent", "task"],
} as const;

const PARAMETERS = {
  type: "object",
  properties: {
    action: { type: "string", enum: ["list", "inspect", "review", "resolve", "cancel", "resume", "clarify"], description: "Session-bound execution and Lead integration control" },
    taskId: { type: "string", description: "Exact accepted task ID for controls" },
    message: { type: "string", maxLength: 4000, description: "Bounded clarification for an already-running child; supplements its existing authority only" },
    outcomeId: { type: "string", description: "Current outcome identity, required for resolve; stale attempts are rejected" },
    disposition: { type: "string", enum: ["integrated", "blocked"], description: "Lead resolution after validation, or an explicit blocker" },
    summary: { type: "string", maxLength: 2000, description: "Concrete integration/verification evidence or blocker; required for resolve" },
    agent: { type: "string", description: "Name of the Deck role to invoke (single mode)" },
    task: { type: "string", description: "Task to delegate (single mode)" },
    tasks: { type: "array", items: TASK_ITEM, description: "Array of {agent, task} for parallel execution (max 8, 4 at a time)" },
    chain: { type: "array", items: CHAIN_ITEM, description: "Array of {agent, task} for sequential execution; {previous} is replaced by the previous output" },
    title: { type: "string", maxLength: 80, description: "Short user-facing task title, separate from the internal assignment" },
    cwd: { type: "string", description: "Working directory for the role process (single mode)" },
  },
} as const;

type ToolResult = { content: { type: "text"; text: string }[]; details: Record<string, unknown>; isError?: boolean };
type TaskItem = { agent: string; task: string; title?: string; cwd?: string };
type Params = { agent?: string; task?: string; title?: string; tasks?: TaskItem[]; chain?: TaskItem[]; cwd?: string; action?: string; taskId?: string; outcomeId?: string; disposition?: string; summary?: string; message?: string };

function textResult(text: string, details: Record<string, unknown> = {}, isError = false): ToolResult {
  return { content: [{ type: "text", text }], details, ...(isError ? { isError: true } : {}) };
}

export function createDeckSubagentsExtension(options: DeckSubagentsOptions = {}) {
  return function deckSubagentsExtension(pi: ExtensionAPI, nativeShell?: NativeShellAPI): void | Promise<void> {
    const env = options.env ?? process.env;
    if (env.DECK_PI_CHILD === "1") {
      installChildClarifications(pi, env);
      return installChildShell(pi, env, nativeShell);
    }
    const agentsDir = options.agentsDir ?? fileURLToPath(new URL("../../agents/", import.meta.url));
    const packageRoot = dirname(agentsDir.replace(/[\\/]+$/, ""));
    const runner = createChildRunner({ env,
      ...(existsSync(join(packageRoot, "package.json")) ? { packageRoot } : {}),
      memory: () => resolveMemoryHandoff(env),
      ...(options.piInvocation ? { piInvocation: options.piInvocation } : {}),
      ...(options.killGraceMs !== undefined ? { killGraceMs: options.killGraceMs } : {}),
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    });
    let context: ExtensionContext | undefined;
    let parent = "";
    let parentFile = "";
    let navigationPending = false;
    let deliveryTimer: ReturnType<typeof setInterval> | undefined;
    let wake: { id: string; at: number } | undefined;
    let atSafeBoundary = false;
    let recapTurn = false;
    // Input provenance survives queued synthetic input and is bound to native user/answer entries.
    const inputs: { text: string; boundary?: string; delivery?: string }[] = [];
    let responseInput: { boundary: string; message: unknown } | undefined;
    const owns = (ctx: ExtensionContext) => !navigationPending && ctx.sessionManager.getSessionId() === parent && ctx.sessionManager.getSessionFile() === parentFile;
    const panel = new SubagentPanel(() => jobs.records, () => jobs.persistencePending);
    const jobs: BackgroundJobs = new BackgroundJobs(runner, {
      persist: snapshot => {
        if (!context || context.sessionManager.getSessionId() !== parent || context.sessionManager.getSessionFile() !== parentFile) throw new Error("Owning session unavailable for persistence");
        pi.appendEntry("deck-subagents-v1", snapshot);
      },
      notify: (content, outcomes) => {
        if (!context || navigationPending || context.sessionManager.getSessionId() !== parent || context.sessionManager.getSessionFile() !== parentFile) return false;
        // Do not queue a follow-up behind a tool loop that may already integrate this result.
        // Natural contexts get the board immediately; otherwise wake at native agent_settled.
        if (!atSafeBoundary && !context.isIdle()) return false;
        if (wake && Date.now() - wake.at < 2000) return false;
        const pending = { id: randomUUID(), at: Date.now() }; wake = pending;
        try {
          pi.sendMessage({ customType: "deck-subagent-outcome", content, display: false,
            details: { parent, parentFile, wakeId: pending.id, outcomes } }, { deliverAs: "followUp", triggerTurn: true });
        } catch (error) { if (wake === pending) wake = undefined; throw error; }
      },
      changed: () => panel.update(),
      childFile: childId => prepareChildSession(parentFile, jobs.records.find(j => j.childId === childId)!),
      validateChild: childId => {
        const job = jobs.records.find(j => j.childId === childId)!;
        const file = prepareChildSession(parentFile, job, true);
        assertExecutionSettled(file, job.parent, job.id);
      },
    });
    const openPanel = (ctx: ExtensionContext) => { try { panel.open(ctx); } catch { /* UI cannot gate outcome delivery. */ } };
    const stop = async () => {
      if (deliveryTimer) clearInterval(deliveryTimer); deliveryTimer = undefined; wake = undefined;
      try { panel.close(); } catch { /* UI teardown is independent of child settlement. */ }
      await jobs.close();
    };
    const startDelivery = () => {
      if (deliveryTimer) clearInterval(deliveryTimer);
      // Retry idle admission failures without disturbing an active response/tool batch.
      deliveryTimer = setInterval(() => { if (!navigationPending && context?.isIdle()) jobs.deliverPending(); }, 500);
      deliveryTimer.unref?.();
      jobs.deliverPending();
    };
    // Pi 1.0.0 prompt emits input with interactive/rpc provenance; sendUserMessage
    // uses extension provenance. Outcome wakes/tool results do not emit genuine input.
    pi.on("input", (event, ctx) => {
      if (!owns(ctx)) return;
      const genuine = event.source === "interactive" || event.source === "rpc";
      let boundary: string | undefined;
      if (genuine) {
        // Only selected-branch unfinished attempts can carry into the new block.
        // Already-terminal outcomes belong to its predecessor, not this question.
        const continuing = recapJobs(ctx.sessionManager.getBranch(), parent, parentFile, jobs.records).filter(j => !j.outcomeId).map(j => j.id);
        recapTurn = false;
        pi.appendEntry(RECAP_BOUNDARY, { parent, file: parentFile, membership: true, excluded: jobs.records.flatMap(j => j.outcomeId ? [j.outcomeId] : []) });
        boundary = ctx.sessionManager.getLeafId() ?? undefined;
        if (continuing.length) recordMembership(continuing);
      }
      inputs.push({ text: event.text, boundary, delivery: event.streamingBehavior });
      // Bounded pending native inputs; never retain transcript copies after consumption.
      if (inputs.length > 32) inputs.shift();
    });
    pi.on("before_agent_start", (event, ctx) => {
      if (!owns(ctx)) return;
      const input = inputs.find(i => !i.delivery);
      if (input) input.text = event.prompt;
    });
    pi.on("message_start", (event, ctx) => {
      if (!owns(ctx) || event.message.role !== "user") return;
      const text = typeof event.message.content === "string" ? event.message.content
        : event.message.content.filter(b => b.type === "text").map(b => b.text).join("\n");
      // Native steering is consumed before follow-ups. Match the actual normalized
      // prompt, not a global 'last input' flag that queued messages can overwrite.
      const candidates = inputs.map((input, index) => ({ input, index })).filter(({ input }) => text === input.text || text.startsWith(input.text + "\n\n"));
      candidates.sort((a, b) => Number(a.input.delivery === "followUp") - Number(b.input.delivery === "followUp"));
      const match = candidates[0];
      if (match) inputs.splice(match.index, 1);
      responseInput = match?.input.boundary ? { boundary: match.input.boundary, message: event.message } : undefined;
    });
    // message_end runs BEFORE native persistence. turn_end runs AFTER persistence,
    // so this is a reference to durable evidence, never a second transcript copy.
    pi.on("turn_end", (event, ctx) => {
      if (!owns(ctx) || !responseInput || event.message.role !== "assistant" || event.message.stopReason !== "stop") return;
      const branch = ctx.sessionManager.getBranch(event.messageEntryId);
      const user = [...branch].reverse().find(e => e.type === "message" && e.message.role === "user");
      const boundary = [...branch].reverse().find(e => e.type === "custom" && e.customType === RECAP_BOUNDARY);
      const selectedBoundary = [...ctx.sessionManager.getBranch()].reverse().find(e => e.type === "custom" && e.customType === RECAP_BOUNDARY);
      if (user?.type !== "message" || user.message !== responseInput.message || boundary?.id !== responseInput.boundary || selectedBoundary?.id !== boundary.id) return;
      if (branch.some(e => e.type === "custom" && e.customType === RECAP_ANCHOR && (e.data as any)?.boundaryId === boundary.id)) return;
      pi.appendEntry(RECAP_ANCHOR, { parent, file: parentFile, boundaryId: boundary.id, userEntryId: user.id, entryId: event.messageEntryId });
    });
    pi.on("agent_settled", (_event, ctx) => {
      if (owns(ctx)) { responseInput = undefined; recapTurn = false; }
      if (ctx.sessionManager.getSessionId() !== parent || ctx.sessionManager.getSessionFile() !== parentFile || navigationPending) return;
      // Pi defers messages emitted here until settlement callbacks finish, then runs them
      // before the native prompt completes. This also works in print/JSON mode.
      atSafeBoundary = true;
      try { jobs.deliverPending(); } finally { atSafeBoundary = false; }
    });
    pi.on("context", (event, ctx) => {
      if (ctx.sessionManager.getSessionId() !== parent || ctx.sessionManager.getSessionFile() !== parentFile) return;
      const messages = event.messages.filter(message => {
        if (message.role !== "custom") return true;
        if (message.customType === "deck-subagent-report" || message.customType === "deck-subagent-board" || message.customType === "deck-completion-recap") return false;
        if (message.customType !== "deck-subagent-outcome") return true;
        const d = message.details as { parent?: string; parentFile?: string; wakeId?: string } | undefined;
        if (d?.parent === parent && d.parentFile === parentFile && d.wakeId === wake?.id) wake = undefined;
        // All old/duplicate/foreign wakes are replaced by current runtime state, never replayed.
        return false;
      });
      // Activate only on an actual current outcome's first native admission. Keep
      // context through its review/resolve tool loop, never via a recap-only wake.
      if (recapJobs(ctx.sessionManager.getBranch(), parent, parentFile, jobs.records).some(j => j.outcomeId && j.integration !== "integrated" && j.integration !== "blocked")) recapTurn = true;
      if (recapTurn) {
        const recap = completionRecap(ctx.sessionManager.getBranch(), parent, parentFile, jobs.records, jobs.persistencePending);
        if (recap) messages.push({ role: "custom", customType: "deck-completion-recap", content: recap, display: false, timestamp: Date.now() });
      }
      const board = taskBoard(jobs.records, jobs.persistencePending);
      if (board) {
        messages.push({ role: "custom", customType: "deck-subagent-board", content: board, display: false, timestamp: Date.now() });
        // This actual native LLM context contains the pending identities. A void send call is not admission.
        jobs.acknowledge(jobs.records.filter(j => j.outcomeId && j.integration !== "integrated" && j.integration !== "blocked").map(j => j.outcomeId!));
      }
      return { messages };
    });
    // Native before hooks can veto/throw/abort without a corresponding start/tree event.
    // Native isIdle includes branch summarization/compaction, including the before hooks
    // and finally cleanup. A command may run during navigation; it must not reopen jobs.
    const ready = async (ctx: ExtensionContext) => {
      if (navigationPending) {
        if (!ctx.isIdle()) throw new Error("Session navigation is still in progress; delegation and continuation refused");
        navigationPending = false;
      }
      if (!context || ctx.sessionManager.getSessionId() !== parent || ctx.sessionManager.getSessionFile() !== parentFile) return;
      const reopened = await jobs.reopen(); context = ctx; if (reopened) { openPanel(ctx); startDelivery(); }
    };
    const freezeLegacyMembership = (ctx: ExtensionContext) => {
      const branch = ctx.sessionManager.getBranch();
      const boundary = [...branch].reverse().find(e => e.type === "custom" && e.customType === RECAP_BOUNDARY && (e.data as any)?.parent === parent && (e.data as any)?.file === parentFile);
      if (!boundary || boundary.type !== "custom" || (boundary.data as any)?.membership === true
        || branch.some(e => e.type === "custom" && e.customType === RECAP_MEMBERS && (e.data as any)?.boundaryId === boundary.id)) return;
      const candidates = branch.flatMap(e => e.type === "custom" && e.customType === "deck-subagents-v1" && Array.isArray((e.data as any)?.jobs) && (e.data as any).jobs.length <= 32 ? (e.data as any).jobs : []);
      const selected = recapJobs(branch, parent, parentFile, candidates);
      const tasks = [...new Map(selected.map(j => [j.id, { id: j.id, attempt: j.attempt ?? 1 }])).values()].slice(-32);
      // Freeze BEFORE the monotonic journal writes on this branch. Legacy snapshots
      // are evidence for migration, never an open-ended admission of later tasks.
      pi.appendEntry(RECAP_MEMBERS, { parent, file: parentFile, boundaryId: boundary.id, tasks });
    };
    pi.on("session_start", async (_event, ctx) => {
      await stop(); recapTurn = false; responseInput = undefined; inputs.length = 0; navigationPending = false; context = ctx; parent = ctx.sessionManager.getSessionId(); parentFile = ctx.sessionManager.getSessionFile() ?? "";
      freezeLegacyMembership(ctx);
      const snapshots = ctx.sessionManager.getEntries().filter(e => e.type === "custom" && e.customType === "deck-subagents-v1").map(e => (e as { data: unknown }).data);
      jobs.open(parent, snapshots); openPanel(ctx); startDelivery();
    });
    const beforeNavigation = async () => { navigationPending = true; recapTurn = false; responseInput = undefined; inputs.length = 0; await stop(); };
    pi.on("session_before_switch", beforeNavigation);
    pi.on("session_before_fork", beforeNavigation);
    pi.on("session_before_tree", beforeNavigation);
    pi.on("session_shutdown", async () => { await stop(); context = undefined; });
    // Native fork/replacement emits session_start; tree navigation stays in-process.
    pi.on("session_tree", async (_event, ctx) => {
      context = ctx; parent = ctx.sessionManager.getSessionId(); parentFile = ctx.sessionManager.getSessionFile() ?? "";
      freezeLegacyMembership(ctx);
      jobs.open(parent, ctx.sessionManager.getEntries().filter(e => e.type === "custom" && e.customType === "deck-subagents-v1").map(e => (e as { data: unknown }).data)); openPanel(ctx); navigationPending = false; startDelivery();
    });
    const recordMembership = (taskIds: string[]) => {
      const boundary = context?.sessionManager.getBranch().slice().reverse().find(e => e.type === "custom" && e.customType === RECAP_BOUNDARY);
      const tasks = taskIds.map(id => ({ id, attempt: jobs.get(id).attempt ?? 1 }));
      if (boundary) pi.appendEntry(RECAP_MEMBERS, { parent, file: parentFile, boundaryId: boundary.id, tasks });
    };
    const control = async (action: string, id?: string, params: Params = {}): Promise<ToolResult> => {
      if (!context || context.sessionManager.getSessionId() !== parent || context.sessionManager.getSessionFile() !== parentFile) return textResult("No active parent session", {}, true);
      await ready(context);
      if (action === "list") return textResult(jobs.records.map(j => `${j.id} | ${j.title} | ${j.agent} | attempt ${j.attempt ?? 1} | ${j.state} | ${j.integration ?? "not ready"}`).join("\n") || "No subagents in this parent session", { parent, jobs: jobs.records.map(j => ({ id: j.id, title: j.title, state: j.state, agent: j.agent, attempt: j.attempt, outcomeId: j.outcomeId, integration: j.integration })) });
      if (!id) return textResult("An exact taskId is required", {}, true);
      const job = jobs.get(id);
      if (action === "clarify") {
        const receipt = await jobs.clarify(id, params.message ?? "");
        return textResult(`Clarification accepted for native steering by ${job.title}. Active tools are not interrupted. Acceptance is not confirmation of native queueing, model consumption, or compliance.`, { parent, taskId: id, title: job.title, attempt: job.attempt, ...receipt });
      }
      if (action === "review") jobs.review(id);
      if (action === "inspect" || action === "review") return textResult(jobDetails(job), { parent, taskId: id, title: job.title, state: job.state, attempt: job.attempt, outcomeId: job.outcomeId, integration: job.integration });
      if (action === "resolve") {
        jobs.resolve(id, params.outcomeId ?? "", params.disposition ?? "", params.summary ?? "");
        return textResult(`Result ${job.integration}: ${job.title}`, { parent, taskId: id, outcomeId: job.outcomeId, integration: job.integration });
      }
      if (action === "cancel") await jobs.cancel(id);
      else if (action === "resume") {
        const agent = findAgent(discoverAgents(agentsDir), job.agent);
        if (!agent) throw new Error("Original role unavailable; continuation refused");
        jobs.resume(id, agent); recordMembership([id]);
      } else throw new Error("Unknown control action");
      return textResult(`${action} accepted: ${job.title}`, { parent, taskId: id, title: job.title, state: job.state });
    };
    pi.registerCommand("subagents", {
      description: "Background jobs: toggle | details | list | inspect/cancel/resume <exact task ID>",
      handler: async (args, ctx) => {
        try {
          await ready(ctx);
          const [action = "details", id] = args.trim().split(/\s+/).filter(Boolean);
          if (action === "toggle") { panel.toggle(); return; }
          if (action === "details") {
            const labels = jobs.records.slice(-32).map(j => `${j.id} ${j.agent} ${j.state}`);
            const selectedParent = parent;
            panel.suspended = true; panel.update();
            try {
              const selected = await ctx.ui.select("Subagents — inspect; use /subagents cancel/resume <ID> for controls", labels);
              if (!selected || context?.sessionManager.getSessionId() !== selectedParent) return;
              const selectedId = selected.split(" ")[0]!;
              await ctx.ui.editor("Subagent details (read-only report; edits are not saved)", jobDetails(jobs.get(selectedId)));
            } finally { panel.suspended = false; panel.update(); }
            return;
          }
          ctx.ui.notify((await control(action, id)).content[0]!.text, "info");
        } catch (e) { ctx.ui.notify(clean(String(e)), "error"); }
      },
    });
    pi.registerTool({
      name: "subagent", label: "Subagent",
      description: `Manage Pi background work while remaining conversational. Delegate single (agent+task), parallel (tasks; max 8), or chain ({previous}); four child slots are shared by this parent. Give each assignment a short title. Use list/inspect/review/resolve/cancel/resume/clarify with exact taskId. clarify requires message (max 4000 characters); sends Lead guidance to the existing running child at native steering boundaries, never new user authorization or expanded permissions. Native API acceptance is not confirmed queueing or model consumption; do not blindly retry unknown delivery. Completion is not integration: review untrusted reports, validate and integrate authorized work, then resolve the current outcomeId with disposition integrated or blocked and concrete summary evidence. Follow the runtime task board without waiting for user nudges or polling loops. Progress stays in the panel, not chat. Respect user pauses/no-delegation instructions. Do not edit files overlapping active delegates; cancel/settle and inspect effects before takeover or explicit same-history continuation. Never blindly retry a failed task. Available roles: ${discoverAgents(agentsDir).map(a => a.id).join(", ")}.`,
      parameters: PARAMETERS,
      renderCall(args: Params) {
        const label = args.action ? `${args.action} background task` : args.tasks ? `${args.tasks.length} parallel tasks`
          : args.chain ? `${args.chain.length} sequential tasks` : args.title ?? `${args.agent?.replace(/^deck-/, "") ?? "Background"} task`;
        return toolCard(`Subagent: ${label}`);
      },
      renderResult(result, { expanded }) {
        const details = (result.details ?? {}) as Record<string, unknown>;
        const text = result.content.filter(block => block.type === "text").map(block => block.text).join("\n");
        const summary = Array.isArray(details.taskIds) ? `Accepted ${details.taskIds.length} background task(s)`
          : Array.isArray(details.jobs) ? `Task board: ${details.jobs.length} task(s)`
          : details.title ? `${details.title}: ${details.integration ?? details.state ?? "result"}` : text.split("\n")[0] ?? "Subagent result";
        return toolCard(expanded ? text : summary, expanded);
      },
      async execute(_id, params: Params, signal, _update, ctx) {
        try {
          await ready(ctx);
          if (params.action) {
            if (params.agent || params.task || params.tasks || params.chain) return textResult("Control and delegation modes cannot be combined", {}, true);
            return await control(params.action, params.taskId, params);
          }
          if (!context || ctx.sessionManager.getSessionId() !== parent || !parentFile) return textResult("Background delegation requires an active persistent parent session", {}, true);
          if (signal?.aborted) return textResult("Delegation cancelled before acceptance", {}, true);
          const modes = [Boolean(params.agent && params.task), Boolean(params.tasks?.length), Boolean(params.chain?.length)];
          if (modes.filter(Boolean).length !== 1) return textResult("Provide exactly one mode: agent+task, tasks, or chain", {}, true);
          const mode = modes[2] ? "chain" : modes[1] ? "parallel" : "single";
          const requested = params.chain ?? params.tasks ?? [{ agent: params.agent!, task: params.task!, title: params.title, cwd: params.cwd }];
          const agents = discoverAgents(agentsDir);
          const items = requested.map(item => {
            const agent = findAgent(agents, item.agent);
            if (!agent) throw new Error(`Unknown agent: ${item.agent}`);
            if (typeof item.task !== "string" || (item.cwd !== undefined && typeof item.cwd !== "string")) throw new Error("Invalid assignment");
            return { agent, task: item.task, title: item.title, cwd: resolve(ctx.cwd, item.cwd ?? ctx.cwd) };
          });
          const taskIds = jobs.accept(mode, items); recordMembership(taskIds);
          return textResult(`Background delegation accepted (${mode}). Parent: ${parent}. Tasks: ${taskIds.join(", ")}. Continue the conversation; outcomes arrive safely. Avoid edits overlapping active delegates.`, { parent, mode, taskIds });
        } catch (e) { return textResult(clean(String(e)), {}, true); }
      },
    });
  };
}
