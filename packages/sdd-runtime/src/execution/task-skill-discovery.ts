import {
  randomUUID,
} from "node:crypto";

import {
  createTaskScopedSkillDiscoveryRuntime,
  type SkillCandidateSearchResultV1,
  type SkillLoadOutcomeV1,
  type SkillNativeLoadPortV1,
  type SkillSelectionReferenceV1,
  type TaskSkillDiscoveryBindingV1,
  type TaskSkillDiscoveryHostV1,
  type TaskSkillDiscoveryPrepareResultV1,
  type TaskScopedSkillDiscoveryRuntimeInputV1,
  type TaskScopedSkillDiscoveryRuntimeV1,
} from "@deck/core";

const MAX_CONTEXTS = 32;
const MAX_PREPARED = 32;
const MAX_CALLS = 64;
const MAX_TERMINAL_CALLS = 128;
const STATE_TTL_MS = 10 * 60_000;

/**
 * SDD Runtime owns the session/task association; Core owns search, verification,
 * and loading policy. This projection intentionally carries no candidate data.
 */
export type TaskSkillDiscoverySessionInputV1 = TaskScopedSkillDiscoveryRuntimeInputV1;

export interface TaskSkillDiscoverySessionV1 {
  readonly context: {
    readonly session_id: string;
    readonly task_id: string;
    readonly active_runner_id: string;
  };
  readonly runtime: TaskScopedSkillDiscoveryRuntimeV1;
}

export function createTaskSkillDiscoverySessionV1(
  input: TaskSkillDiscoverySessionInputV1,
): TaskSkillDiscoverySessionV1 {
  if (!safeIdentity(input?.sessionId) || !safeIdentity(input.taskId) || !safeIdentity(input.activeRunnerId)) {
    throw new Error("invalid task skill-discovery session association");
  }
  return Object.freeze({
    context: Object.freeze({
      session_id: input.sessionId,
      task_id: input.taskId,
      active_runner_id: input.activeRunnerId,
    }),
    runtime: createTaskScopedSkillDiscoveryRuntime(input),
  });
}

export interface TaskSkillDiscoveryHostInputV1 extends Omit<TaskScopedSkillDiscoveryRuntimeInputV1, "sessionId" | "taskId" | "nativeLoader"> {
  readonly nativeLoader?: SkillNativeLoadPortV1;
  readonly verifyNativeLoad?: (input: { readonly name: string; readonly directory: string }) => Promise<boolean>;
}

interface HostContext {
  readonly binding: TaskSkillDiscoveryBindingV1;
  readonly session: TaskSkillDiscoverySessionV1;
  readonly names: Map<string, string>;
  readonly prepared: Map<string, PreparedSelection>;
  readonly calls: Map<string, PendingCall>;
  readonly terminalCalls: Map<string, number>;
  readonly expected: Map<string, PrivateExpected>;
  readonly rendezvous: Map<string, NativeRendezvous>;
  outcome: SkillLoadOutcomeV1;
  retired: boolean;
  generation: number;
  updatedAt: number;
}

interface PrivateExpected {
  readonly expectedName?: string;
  readonly expectedDirectory?: string;
}

interface NativeRendezvous {
  readonly armed: Promise<void>;
  readonly final: Promise<SkillLoadOutcomeV1>;
  arm(): void;
  settle(outcome: SkillLoadOutcomeV1): void;
}

interface PreparedSelection {
  readonly reference: SkillSelectionReferenceV1;
  readonly expectedName: string;
  readonly expectedDirectory?: string;
  readonly generation: number;
  readonly timestamp: number;
}

interface PendingCall {
  readonly expectedName: string;
  readonly expectedDirectory?: string;
  readonly rendezvous: NativeRendezvous;
  readonly loadPromise: Promise<SkillLoadOutcomeV1>;
  readonly generation: number;
  readonly timestamp: number;
}

/** Bounded, plugin-facing lifecycle owner; all project and runner authority stays in its closure. */
export function createTaskSkillDiscoveryHostV1(input: TaskSkillDiscoveryHostInputV1): TaskSkillDiscoveryHostV1 {
  const contexts = new Map<string, HostContext>();
  const bySessionTask = new Map<string, string>();
  const bindingRefs = new WeakMap<TaskSkillDiscoveryBindingV1, string>();
  const hostNonce = randomUUID();
  let sequence = 0;
  let disposed = false;
  const valid = (value: unknown) => safeIdentity(value);
  const get = (binding: TaskSkillDiscoveryBindingV1) => !disposed && binding?.schema === "task-skill-discovery-binding-v1" && bindingRefs.get(binding) === binding.binding_id ? contexts.get(binding.binding_id) : undefined;
  const unavailable = (): SkillCandidateSearchResultV1 => ({ schema: "skill-candidate-search-result-v1", source_mode: "direct_discovery", completeness: "indeterminate", candidates: [], truncated: false, diagnostics: [{ code: "host_binding_unavailable", message: "The discovery binding is unavailable." }] });
  const prune = (context: HostContext, now = Date.now()) => {
    for (const [key, prepared] of context.prepared) if (now - prepared.timestamp > STATE_TTL_MS) context.prepared.delete(key);
    for (const [key, call] of context.calls) if (now - call.timestamp > STATE_TTL_MS) { call.rendezvous.settle({ outcome: "unobserved" }); context.calls.delete(key); }
    for (const [key, timestamp] of context.terminalCalls) if (now - timestamp > STATE_TTL_MS) context.terminalCalls.delete(key);
    while (context.prepared.size > MAX_PREPARED) context.prepared.delete(context.prepared.keys().next().value as string);
    while (context.calls.size > MAX_CALLS) {
      const key = context.calls.keys().next().value as string;
      context.calls.get(key)?.rendezvous.settle({ outcome: "unobserved" });
      context.calls.delete(key);
    }
    while (context.terminalCalls.size > MAX_TERMINAL_CALLS) context.terminalCalls.delete(context.terminalCalls.keys().next().value as string);
  };
  const retire = (binding: TaskSkillDiscoveryBindingV1) => {
    const context = get(binding);
    if (!context) return;
    context.retired = true;
    context.generation += 1;
    context.calls.clear();
    context.prepared.clear();
    for (const rendezvous of context.rendezvous.values()) rendezvous.settle({ outcome: "unobserved" });
    context.rendezvous.clear();
    context.expected.clear();
    contexts.delete(binding.binding_id);
    bySessionTask.delete(`${context.session.context.session_id}\0${context.session.context.task_id}`);
  };
  return {
    schema: "task-skill-discovery-host-v1",
    async open(request) {
      if (!valid(request?.session_id) || !valid(request.task_id) || disposed) throw new Error("invalid task skill-discovery host identity");
      const key = `${request.session_id}\0${request.task_id}`;
      const existing = bySessionTask.get(key);
      if (existing) return contexts.get(existing)!.binding;
      while (contexts.size >= MAX_CONTEXTS) {
        const oldest = contexts.values().next().value as HostContext | undefined;
        if (!oldest) break;
        retire(oldest.binding);
      }
      const binding = Object.freeze({ schema: "task-skill-discovery-binding-v1" as const, binding_id: `task-skill:${hostNonce}:${++sequence}` });
      bindingRefs.set(binding, binding.binding_id);
      const expected = new Map<string, PrivateExpected>();
      const rendezvous = new Map<string, NativeRendezvous>();
      const nativeLoader = input.nativeLoader ? {
        schema: "skill-native-load-port-v1" as const,
        prepare: async (request: Parameters<SkillNativeLoadPortV1["prepare"]>[0]) => {
          const result = await input.nativeLoader!.prepare(request);
          if (result.outcome === "loadable") {
            const privateResult = result as { readonly expected_name?: string; readonly expected_directory?: string };
            expected.set(request.selectionId, { ...(privateResult.expected_name ? { expectedName: privateResult.expected_name } : {}), ...(privateResult.expected_directory ? { expectedDirectory: privateResult.expected_directory } : {}) });
          } else {
            expected.delete(request.selectionId);
          }
          return result.outcome === "loadable" ? { outcome: "loadable" as const } : result;
        },
        load: async (request: Parameters<SkillNativeLoadPortV1["load"]>[0]) => {
          const pending = rendezvous.get(request.selectionId);
          if (!pending) return { outcome: "unobserved" as const };
          pending.arm();
          return pending.final;
        },
      } : undefined;
      const session = createTaskSkillDiscoverySessionV1({ ...input, sessionId: request.session_id, taskId: request.task_id, ...(nativeLoader ? { nativeLoader } : {}) });
      contexts.set(binding.binding_id, { binding, session, names: new Map(), prepared: new Map(), calls: new Map(), terminalCalls: new Map(), expected, rendezvous, outcome: { outcome: "unobserved" }, retired: false, generation: 0, updatedAt: Date.now() });
      bySessionTask.set(key, binding.binding_id);
      return binding;
    },
    async search(binding, query): Promise<SkillCandidateSearchResultV1> {
      const context = get(binding);
      if (!context || context.retired) return unavailable();
      prune(context);
      context.generation += 1;
      const generation = context.generation;
      for (const call of context.calls.values()) call.rendezvous.settle({ outcome: "unobserved" });
      for (const rendezvous of context.rendezvous.values()) rendezvous.settle({ outcome: "unobserved" });
      context.prepared.clear();
      context.calls.clear();
      context.expected.clear();
      context.rendezvous.clear();
      const result = await context.session.runtime.search(query);
      if (get(binding) !== context || context.retired || context.generation !== generation) return unavailable();
      context.names.clear();
      for (const candidate of result.candidates) context.names.set(candidate.observation_id, candidate.name);
      context.updatedAt = Date.now();
      return result;
    },
    async prepare(binding, request): Promise<TaskSkillDiscoveryPrepareResultV1> {
      const context = get(binding);
      if (!context || context.retired || !valid(request?.observation_id)) return { selection: { outcome: "missing" }, preparation: { outcome: "rejected" } };
      prune(context);
      const generation = context.generation;
      context.prepared.clear();
      context.expected.clear();
      const selection = context.session.runtime.select({ observation_id: request.observation_id });
      if (selection.outcome !== "selected") return { selection, preparation: { outcome: selection.outcome === "ambiguous" ? "ambiguous" : "missing" } };
      const preparation = await context.session.runtime.prepare(selection.reference);
      if (get(binding) !== context || context.retired || context.generation !== generation) return { selection: { outcome: "missing" }, preparation: { outcome: "rejected" } };
      const name = context.names.get(selection.reference.observation_id);
      if (preparation.outcome === "loadable" && name) {
        const expected = context.expected.get(selection.reference.selection_id);
        context.prepared.set(expected?.expectedName ?? name, { reference: selection.reference, expectedName: expected?.expectedName ?? name, ...(expected?.expectedDirectory ? { expectedDirectory: expected.expectedDirectory } : {}), generation, timestamp: Date.now() });
        prune(context);
      }
      return { selection, preparation: preparation.outcome === "loadable" ? { outcome: "loadable" } : preparation };
    },
    async beforeNativeLoad(binding, request) {
      const context = get(binding);
      if (!context || context.retired || !valid(request?.call_id) || !valid(request.name)) return { outcome: "rejected" as const };
      prune(context);
      if (context.calls.has(request.call_id) || context.terminalCalls.has(request.call_id)) return { outcome: "rejected" as const };
      const prepared = context.prepared.get(request.name);
      if (!prepared) return { outcome: "unprepared" as const };
      context.prepared.delete(request.name);
      if (prepared.generation !== context.generation) return { outcome: "rejected" as const };
      const preparation = await context.session.runtime.prepare(prepared.reference);
      if (get(binding) !== context || context.retired || context.generation !== prepared.generation || preparation.outcome !== "loadable") return { outcome: "rejected" as const };
      const revalidated = context.expected.get(prepared.reference.selection_id);
      if ((revalidated?.expectedName ?? prepared.expectedName) !== prepared.expectedName || (revalidated?.expectedDirectory ?? prepared.expectedDirectory) !== prepared.expectedDirectory) return { outcome: "rejected" as const };
      const rendezvous = createRendezvous();
      context.rendezvous.set(prepared.reference.selection_id, rendezvous);
      const loadPromise = context.session.runtime.load(prepared.reference);
      const armed = await Promise.race([
        rendezvous.armed.then(() => "armed" as const),
        loadPromise.then((outcome) => outcome.outcome === "unobserved" ? "rejected" as const : outcome.outcome),
      ]);
      if (get(binding) !== context || context.retired || context.generation !== prepared.generation || armed !== "armed") {
        rendezvous.settle({ outcome: "unobserved" });
        context.rendezvous.delete(prepared.reference.selection_id);
        return { outcome: "rejected" as const };
      }
      loadPromise.then((outcome) => {
        if (get(binding) === context && !context.retired && context.generation === prepared.generation) context.outcome = outcome;
      }).finally(() => context.rendezvous.delete(prepared.reference.selection_id));
      context.calls.set(request.call_id, { expectedName: prepared.expectedName, ...(prepared.expectedDirectory ? { expectedDirectory: prepared.expectedDirectory } : {}), rendezvous, loadPromise, generation: prepared.generation, timestamp: Date.now() });
      prune(context);
      return { outcome: "armed" as const };
    },
    async observeNativeLoad(binding, request) {
      const context = get(binding);
      if (!context || context.retired || !valid(request?.call_id)) return { outcome: "unobserved" as const };
      prune(context);
      const call = context.calls.get(request.call_id);
      if (!call) return { outcome: "unobserved" as const };
      context.calls.delete(request.call_id);
      context.terminalCalls.set(request.call_id, Date.now());
      if (call.expectedName !== request.name || call.generation !== context.generation) {
        call.rendezvous.settle({ outcome: "unobserved" });
        return context.outcome = { outcome: "unobserved" };
      }
      if (request.failed) {
        call.rendezvous.settle({ outcome: "failed" });
        return context.outcome = { outcome: "failed" };
      }
      if (!request.directory || (call.expectedDirectory && request.directory !== call.expectedDirectory)) {
        call.rendezvous.settle({ outcome: "unobserved" });
        return context.outcome = { outcome: "unobserved" };
      }
      if (input.verifyNativeLoad) {
        const verified = await input.verifyNativeLoad({ name: request.name, directory: request.directory });
        if (get(binding) !== context || context.retired || context.generation !== call.generation || !verified) {
          call.rendezvous.settle({ outcome: "unobserved" });
          return { outcome: "unobserved" };
        }
      } else if (!call.expectedDirectory) {
        call.rendezvous.settle({ outcome: "unobserved" });
        return context.outcome = { outcome: "unobserved" };
      }
      call.rendezvous.settle({ outcome: "loaded" });
      return context.outcome = { outcome: "loaded" };
    },
    getOutcome(binding) { return get(binding)?.outcome ?? { outcome: "unobserved" }; },
    retire,
    dispose() {
      for (const binding of [...contexts.values()].map((context) => context.binding)) retire(binding);
      disposed = true;
    },
  };
}

function createRendezvous(): NativeRendezvous {
  let arm!: () => void;
  let settle!: (outcome: SkillLoadOutcomeV1) => void;
  let settled = false;
  return {
    armed: new Promise<void>((resolve) => { arm = resolve; }),
    final: new Promise<SkillLoadOutcomeV1>((resolve) => { settle = resolve; }),
    arm() { arm(); },
    settle(outcome) {
      if (settled) return;
      settled = true;
      settle(outcome);
    },
  };
}

function safeIdentity(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128 && !/[\u0000-\u001F\u007F]/.test(value);
}
