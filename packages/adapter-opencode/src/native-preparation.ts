import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { assertNoContributionSymlink } from "@deck/core";
import { loadPreparedSessionStartRecord } from "@deck/core/session/start-context";
import { parsePreparationRequest, type PreparationRequest } from "@deck/core/session/preparation";
import { NativePreparationCoordinator } from "../../sdd-runtime/src/execution/native-preparation";
import { createOpenCodeSkillDiscoveryProvider } from "./skill-discovery-provider";
import { readOpenCodeNativeRole } from "./native-role-source";

type Context = { sessionID?: unknown; messageID?: unknown; callID?: unknown; abort?: AbortSignal };
type Binding = { parent: string; message: string; taskCall?: string; child?: string; launch: string; request: PreparationRequest; live: boolean; coordinator: NativePreparationCoordinator; generation: string; source: string };
const token = (v: unknown): v is string => typeof v === "string" && /^[a-zA-Z0-9_-]{1,160}$/.test(v);
const object = (v: unknown): Record<string, any> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, any> : {};
const requestArgs = { snapshotId: z.string().min(1).max(128), components: z.array(z.string()).min(1).max(16) };

/** Native hook/context identities and SDK records are authority; tool arguments never select an executor. */
export class OpenCodeNativePreparation {
  private readonly armed = new Map<string, Binding>();
  private readonly tasks = new Map<string, Binding>();
  private readonly calls = new Map<string, { live: boolean; binding: Binding }>();
  private readonly spent = new Set<string>();
  private readonly opening = new Set<string>();
  private readonly revisions = new Map<string, number>();
  constructor(private readonly root: string, private readonly client: any, private readonly env: Readonly<Record<string, string | undefined>>) {}
  private configRoot() { return this.env.OPENCODE_CONFIG_DIR ?? join(this.env.XDG_CONFIG_HOME ?? join(this.env.HOME ?? "", ".config"), "opencode"); }
  private source() { return JSON.stringify([readOpenCodeNativeRole(this.configRoot(), "deck-lead"), readOpenCodeNativeRole(this.configRoot(), "deck-setup")]); }
  private async refresh() {
    const record = await loadPreparedSessionStartRecord(this.root, this.env);
    // Cross sessions use their existing credential bridge, never this standalone lane.
    if (!record?.refresh || !record.preparation || record.preparation.scope.members.some(m => m.runnerId !== "opencode")) throw new Error("native-preparation-scope-unavailable");
    return record;
  }
  private async identity(context: Context, role: string) {
    if (!token(context.sessionID) || !token(context.messageID) || !token(context.callID) || context.abort?.aborted) throw new Error("native-preparation-caller-unverified");
    const response = await this.client.session.message({ path: { id: context.sessionID, messageID: context.messageID }, query: { directory: this.root }, signal: AbortSignal.timeout(2000) });
    const message = object(response.data), info = object(message.info);
    if (response.error || info.id !== context.messageID || info.sessionID !== context.sessionID || info.role !== "assistant" || info.agent !== role
      || !Array.isArray(message.parts) || !message.parts.some((p: any) => p.type === "tool" && p.callID === context.callID && p.state?.status === "running")) throw new Error("native-preparation-caller-unverified");
    const agents = await this.client.app.agents({ query: { directory: this.root }, signal: AbortSignal.timeout(2000) });
    const installed = readOpenCodeNativeRole(this.configRoot(), role);
    if (agents.error || !Array.isArray(agents.data) || agents.data.find((a: any) => a.name === role)?.prompt !== installed.instructions) throw new Error("native-preparation-role-unverified");
    return { session: context.sessionID, message: context.messageID, call: context.callID };
  }
  private async coordinator(parent: string) {
    await this.refresh();
    const directory = join(this.env.XDG_STATE_HOME ?? join(this.env.HOME ?? "", ".local/state"), "deck/native-opencode-preparation");
    assertNoContributionSymlink(directory); mkdirSync(directory, { recursive: true, mode: 0o700 }); assertNoContributionSymlink(directory);
    const coordinator = new NativePreparationCoordinator(this.env, "opencode", createOpenCodeSkillDiscoveryProvider({ configDir: this.configRoot(), homeDir: this.env.HOME }));
    await coordinator.open(this.root, parent, join(directory, createHash("sha256").update(this.root + "\0" + parent).digest("hex")));
    return coordinator;
  }
  tools() {
    return {
      deck_preparation_status: { description: "Read current project readiness before delegating an exact repair to native Setup.", args: {}, execute: async (_args: unknown, context: Context = {}) => {
        const id = await this.identity(context, "deck-lead"), coordinator = await this.coordinator(id.session);
        try { return JSON.stringify(coordinator.status()); } finally { coordinator.close(); }
      } },
      deck_delegate_preparation: { description: "Arm this exact project repair for the next native task to deck-setup in this Lead session. Then call task with subagent_type deck-setup. Only one armed request per session.", args: requestArgs, execute: async (args: unknown, context: Context = {}) => {
        const revision = this.revisions.get(String(context.sessionID)) ?? 0;
        const request = parsePreparationRequest(args), id = await this.identity(context, "deck-lead"), key = `${id.session}\0${id.call}`;
        if (this.spent.has(key) || this.spent.size >= 256 || this.opening.has(id.session) || this.armed.has(id.session) || this.tasks.size >= 64) throw new Error("native-preparation-delegation-replayed");
        this.spent.add(key); this.opening.add(id.session);
        try {
        const source = this.source(), record = await this.refresh(), coordinator = await this.coordinator(id.session);
        coordinator.validate(request, this.root);
        if (context.abort?.aborted || (this.revisions.get(id.session) ?? 0) !== revision || this.source() !== source) { coordinator.close(); throw new Error("native-preparation-delegation-revoked"); }
        this.armed.set(id.session, { parent: id.session, message: id.message, request, live: true, launch: randomUUID(), coordinator, source, generation: record.generation });
        return JSON.stringify({ status: "armed", ...request });
        } finally { this.opening.delete(id.session); }
      } },
      deck_prepare_project: { description: "Execute the exact repair delegated to this native Setup invocation.", args: requestArgs, execute: async (args: unknown, context: Context = {}) => {
        const id = await this.identity(context, "deck-setup"), call = this.calls.get(`${id.session}\0${id.call}`), binding = call?.binding;
        if (!binding || !call.live || !binding.live || binding.child !== id.session) throw new Error("native-preparation-invocation-unbound");
        const parent = await this.client.session.message({ path: { id: binding.parent, messageID: binding.message }, query: { directory: this.root }, signal: AbortSignal.timeout(2000) });
        const parentMessage = object(parent.data), parentInfo = object(parentMessage.info);
        const task = Array.isArray(parentMessage.parts) ? parentMessage.parts.find((p: any) => p.type === "tool" && p.tool === "task" && p.callID === binding.taskCall) : undefined;
        const child = await this.client.session.get({ path: { id: id.session }, query: { directory: this.root }, signal: AbortSignal.timeout(2000) });
        if (parent.error || parentInfo.role !== "assistant" || parentInfo.agent !== "deck-lead" || parentInfo.sessionID !== binding.parent || parentInfo.id !== binding.message
          || task?.state?.status !== "running" || task.state.input?.subagent_type !== "deck-setup" || task.state.metadata?.sessionId !== id.session
          || child.error || child.data?.id !== id.session || child.data?.parentID !== binding.parent) { binding.live = false; throw new Error("native-preparation-child-unverified"); }
        const record = await this.refresh();
        if (record.generation !== binding.generation) { binding.live = false; throw new Error("native-preparation-generation-changed"); }
        const current = () => {
          try { if (!call.live || context.abort?.aborted || this.source() !== binding.source) binding.live = false; }
          catch { binding.live = false; }
          return binding.live;
        };
        try {
          return JSON.stringify(await binding.coordinator.repair({ parentId: binding.parent, taskId: binding.taskCall!, attempt: 1, roleId: "deck-setup", generation: binding.generation, launchId: binding.launch, nativeSessionId: id.session, current }, args));
        } finally { call.live = false; }
      } },
    };
  }
  before(input: { sessionID: string; callID?: string; tool?: string }, args: Record<string, unknown>): boolean {
    if (!token(input.callID)) return false;
    if (input.tool === "task") {
      const binding = this.armed.get(input.sessionID);
      if (!binding) return false;
      this.armed.delete(input.sessionID);
      if (!binding.live || args.subagent_type !== "deck-setup" || this.source() !== binding.source || this.tasks.has(`${input.sessionID}\0${input.callID}`)) { binding.live = false; throw new Error("native-preparation-selection-mismatch"); }
      binding.taskCall = input.callID;
      binding.coordinator.delegate(binding.request, input.callID, 1);
      this.tasks.set(`${input.sessionID}\0${input.callID}`, binding);
      return true;
    }
    if (input.tool === "deck_prepare_project") {
      const bindings = [...this.tasks.values()].filter(b => b.live && b.child === input.sessionID);
      const key = `${input.sessionID}\0${input.callID}`;
      if (bindings.length !== 1 || this.calls.has(key) || this.calls.size >= 256) throw new Error("native-preparation-invocation-unbound");
      this.calls.set(key, { live: true, binding: bindings[0]! });
    }
    return false;
  }
  select(input: { sessionID: string; agent?: string }) {
    if (!input.agent) return;
    this.event({ type: "message.updated", properties: { info: { sessionID: input.sessionID, role: "assistant", agent: input.agent } } });
  }
  after(input: { sessionID: string; callID?: string }) {
    const key = `${input.sessionID}\0${input.callID}`, binding = this.tasks.get(key), call = this.calls.get(key);
    if (binding) { binding.live = false; binding.coordinator.close(); }
    if (call) call.live = false;
  }
  event(event: Record<string, any>) {
    const props = object(event.properties), part = object(props.part), state = object(part.state), info = object(props.info);
    const changedSession = info.sessionID ?? info.id ?? props.sessionID;
    if (token(changedSession) && (["session.deleted", "session.error", "session.idle"].includes(event.type) || event.type === "message.updated" && info.role === "assistant" && info.agent !== "deck-lead")) {
      this.revisions.set(changedSession, (this.revisions.get(changedSession) ?? 0) + 1);
    }
    if (event.type === "tool.execute.error") this.after({ sessionID: event.sessionID ?? props.sessionID, callID: event.callID ?? props.callID });
    if (event.type === "message.part.updated" && part.type === "tool" && part.tool === "task") {
      const binding = this.tasks.get(`${part.sessionID}\0${part.callID}`);
      if (binding) {
        if (state.status !== "running" || state.input?.subagent_type !== "deck-setup") { binding.live = false; return; }
        const child = state.metadata?.sessionId;
        if (token(child)) {
          if (binding.child && binding.child !== child || [...this.tasks.values()].some(b => b !== binding && b.live && b.child === child)) { binding.live = false; return; }
          if (!token(part.messageID)) { binding.live = false; return; }
          binding.message = part.messageID;
          binding.child = child;
        }
      }
    }
    for (const binding of [...this.armed.values(), ...this.tasks.values()]) {
      const session = info.sessionID ?? info.id ?? props.sessionID;
      if ((event.type === "session.deleted" || event.type === "session.error" || event.type === "session.idle") && [binding.parent, binding.child].includes(session)
        || event.type === "message.updated" && info.role === "assistant" && ((info.sessionID === binding.child && info.agent !== "deck-setup") || (info.sessionID === binding.parent && info.agent !== "deck-lead"))) binding.live = false;
    }
  }
}
