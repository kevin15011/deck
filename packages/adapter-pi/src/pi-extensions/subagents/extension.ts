import { fileURLToPath } from "node:url";

import type { ExtensionAPI } from "../shared/pi-api";
import { resolveMemoryHandoff } from "../shared/memory-handoff";
import { discoverAgents, findAgent, type DeckAgent } from "./agents";
import { createChildRunner, type ChildResult, type ChildRunner, type ChildRunnerOptions } from "./runner";

export const MAX_PARALLEL_TASKS = 8;
export const MAX_CONCURRENCY = 4;
const PER_TASK_OUTPUT_CAP = 50 * 1024;

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
    cwd: { type: "string", description: "Working directory for the role process" },
  },
  required: ["agent", "task"],
} as const;

const CHAIN_ITEM = {
  type: "object",
  properties: {
    agent: { type: "string", description: "Name of the Deck role to invoke" },
    task: { type: "string", description: "Task with optional {previous} placeholder for the prior step output" },
    cwd: { type: "string", description: "Working directory for the role process" },
  },
  required: ["agent", "task"],
} as const;

const PARAMETERS = {
  type: "object",
  properties: {
    agent: { type: "string", description: "Name of the Deck role to invoke (single mode)" },
    task: { type: "string", description: "Task to delegate (single mode)" },
    tasks: { type: "array", items: TASK_ITEM, description: "Array of {agent, task} for parallel execution (max 8, 4 at a time)" },
    chain: { type: "array", items: CHAIN_ITEM, description: "Array of {agent, task} for sequential execution; {previous} is replaced by the previous output" },
    cwd: { type: "string", description: "Working directory for the role process (single mode)" },
  },
} as const;

type ToolResult = { content: { type: "text"; text: string }[]; details: Record<string, unknown>; isError?: boolean };
type TaskItem = { agent: string; task: string; cwd?: string };
type Params = { agent?: string; task?: string; tasks?: TaskItem[]; chain?: TaskItem[]; cwd?: string };

function textResult(text: string, details: Record<string, unknown> = {}, isError = false): ToolResult {
  return { content: [{ type: "text", text }], details, ...(isError ? { isError: true } : {}) };
}

function summarize(result: ChildResult): Record<string, unknown> {
  return { agent: result.agent, model: result.model, thinking: result.thinking, tools: result.tools, exitCode: result.exitCode, failed: result.failed, stopReason: result.stopReason, usage: result.usage };
}

function outputOf(result: ChildResult): string {
  return result.failed ? (result.errorMessage ?? result.stderr ?? "(no output)") : (result.text || "(no output)");
}

function capped(text: string): string {
  return text.length > PER_TASK_OUTPUT_CAP ? `${text.slice(0, PER_TASK_OUTPUT_CAP)}\n[output truncated]` : text;
}

async function mapWithConcurrency<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (true) {
      const current = next++;
      if (current >= items.length) return;
      results[current] = await fn(items[current]!, current);
    }
  });
  await Promise.all(workers);
  return results;
}

export function createDeckSubagentsExtension(options: DeckSubagentsOptions = {}) {
  return function deckSubagentsExtension(pi: ExtensionAPI): void {
    const env = options.env ?? process.env;
    // Children inherit the environment and global extensions: never register the tool inside a child.
    if (env.DECK_PI_CHILD === "1") return;

    const agentsDir = options.agentsDir ?? fileURLToPath(new URL("../../agents/", import.meta.url));
    const runner: ChildRunner = createChildRunner({
      env,
      memory: () => resolveMemoryHandoff(env),
      ...(options.piInvocation ? { piInvocation: options.piInvocation } : {}),
      ...(options.killGraceMs !== undefined ? { killGraceMs: options.killGraceMs } : {}),
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    });

    const describeAgents = (agents: readonly DeckAgent[]) => agents.map((agent) => agent.id).join(", ") || "none";
    const initial = discoverAgents(agentsDir);

    pi.registerTool({
      name: "subagent",
      label: "Subagent",
      description: [
        "Delegate tasks to Deck specialist roles, each running as an isolated Pi process with its own context window, model and tool policy.",
        "Modes: single (agent + task), parallel (tasks array, max 8, 4 at a time), chain (sequential with a {previous} placeholder).",
        `Available roles: ${describeAgents(initial)}.`,
      ].join(" "),
      parameters: PARAMETERS,
      async execute(_toolCallId: string, params: Params, signal: AbortSignal | undefined, onUpdate: ((update: { content: { type: "text"; text: string }[]; details: Record<string, unknown> }) => void) | undefined, ctx: { cwd: string }): Promise<ToolResult> {
        // Re-read on every call so a Deck reinstall is picked up without restarting Pi.
        const agents = discoverAgents(agentsDir);
        const hasChain = (params.chain?.length ?? 0) > 0;
        const hasTasks = (params.tasks?.length ?? 0) > 0;
        const hasSingle = Boolean(params.agent && params.task);
        if (Number(hasChain) + Number(hasTasks) + Number(hasSingle) !== 1) {
          return textResult(`Invalid parameters. Provide exactly one mode (agent+task, tasks, or chain).\nAvailable roles: ${describeAgents(agents)}`, {}, true);
        }

        const requested = hasChain ? params.chain! : hasTasks ? params.tasks! : [{ agent: params.agent!, task: params.task!, cwd: params.cwd }];
        for (const item of requested) {
          if (!findAgent(agents, item.agent)) {
            return textResult(`Unknown agent: "${item.agent}". Available roles: ${describeAgents(agents)}.`, {}, true);
          }
        }
        const run = (item: TaskItem, task: string) => runner.run({
          agent: findAgent(agents, item.agent)!,
          task,
          cwd: item.cwd ?? ctx.cwd,
          signal,
          onUpdate: onUpdate ? (partial) => onUpdate({ content: [{ type: "text", text: partial.text || "(running...)" }], details: {} }) : undefined,
        });

        if (hasChain) {
          const results: ChildResult[] = [];
          let previous = "";
          for (let index = 0; index < params.chain!.length; index++) {
            const step = params.chain![index]!;
            const result = await run(step, step.task.replace(/\{previous\}/g, () => previous));
            results.push(result);
            if (result.failed) {
              return textResult(`Chain stopped at step ${index + 1} (${step.agent}): ${outputOf(result)}`, { mode: "chain", results: results.map(summarize) }, true);
            }
            previous = result.text;
          }
          return textResult(results[results.length - 1]!.text || "(no output)", { mode: "chain", results: results.map(summarize) });
        }

        if (hasTasks) {
          if (params.tasks!.length > MAX_PARALLEL_TASKS) {
            return textResult(`Too many parallel tasks (${params.tasks!.length}). Max is ${MAX_PARALLEL_TASKS}.`, {}, true);
          }
          const results = await mapWithConcurrency(params.tasks!, MAX_CONCURRENCY, (item) => run(item, item.task));
          const succeeded = results.filter((result) => !result.failed).length;
          const sections = results.map((result) => `### [${result.agent}] ${result.failed ? "failed" : "completed"}\n\n${capped(outputOf(result))}`);
          return textResult(`Parallel: ${succeeded}/${results.length} succeeded\n\n${sections.join("\n\n---\n\n")}`, { mode: "parallel", results: results.map(summarize) });
        }

        const result = await run(requested[0]!, params.task!);
        if (result.failed) return textResult(`Agent ${result.aborted ? "aborted" : "failed"}: ${outputOf(result)}`, { mode: "single", results: [summarize(result)] }, true);
        return textResult(result.text || "(no output)", { mode: "single", results: [summarize(result)] });
      },
    });

    // Lead abort / quit: SIGTERM every child, SIGKILL after the grace period.
    pi.on("session_shutdown", () => {
      runner.killAll();
    });
  };
}
