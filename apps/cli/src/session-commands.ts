/**
 * `deck cross developer` and `deck session ...` (XR-9.1, XR-9.2, XR-11.2). Handlers take their
 * effects as dependencies so they can be exercised against a real daemon in tests without a TTY.
 */
import { randomUUID } from "node:crypto";
import type { ControlClient, StatePaths, SessionSummary } from "@deck/session-host";
import type { DeckConfigStore } from "./deck-config-store";
import type { SessionSubcommand } from "./cli-args";
import { formatSelfTest, runSessionSelfTest } from "./session-self-test";
import { runTerminalClient } from "./session-terminal-client";
import { runAckClaudeTos } from "./session-tos";

export type SessionConnection = { client: ControlClient; paths: StatePaths };

export type SessionCommandDeps = {
  write: (text: string) => void;
  writeErr: (text: string) => void;
  /** Connect to the daemon; `ensure` starts it on demand. Resolves undefined when it is not running and `ensure` is false. */
  connect: (options: { ensure: boolean }) => Promise<SessionConnection | undefined>;
  configStore: Pick<DeckConfigStore, "read" | "write">;
  projectRoot: () => string;
  stdinLines: () => AsyncIterable<string>;
  readLine: (prompt: string) => Promise<string>;
  interactive: boolean;
  openBrowser?: (url: string) => Promise<void>;
  env?: Readonly<Record<string, string | undefined>>;
};

const TAIL_EVENTS = 100;
const live = (state: string) => state !== "ended" && state !== "stopping";

async function withDaemon<T>(deps: SessionCommandDeps, ensure: boolean, body: (c: SessionConnection) => Promise<T>): Promise<T | undefined> {
  let connection: SessionConnection | undefined;
  try { connection = await deps.connect({ ensure }); } catch (error) {
    deps.writeErr(`Unable to reach the Deck session daemon: ${(error as Error).message}\n`);
    return undefined;
  }
  if (!connection) return undefined;
  try { return await body(connection); } finally { connection.client.close(); }
}

async function listSessions(client: ControlClient): Promise<SessionSummary[] | undefined> {
  const outcome = await client.query("sessions.list");
  return outcome.ok ? (outcome.data as { sessions: SessionSummary[] }).sessions : undefined;
}

export function formatSessionList(sessions: readonly SessionSummary[]): string {
  if (sessions.length === 0) return "No sessions.\n";
  const rows = sessions.map((s) => [s.sessionId, s.running ? `${s.state}*` : s.state, s.changeId ?? "-", s.lead ? `${s.lead.runnerId}/${s.lead.modelId}` : "-", s.projectRoot]);
  const head = ["ID", "STATE", "CHANGE", "LEAD", "PROJECT"];
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]!.length)));
  const line = (cells: string[]) => cells.map((c, i) => (i === cells.length - 1 ? c : c.padEnd(widths[i]!))).join("  ").trimEnd();
  return `${[line(head), ...rows.map(line)].join("\n")}\n${sessions.some((s) => s.running) ? "(* a turn is running)\n" : ""}`;
}

async function runList(deps: SessionCommandDeps, json: boolean): Promise<number> {
  const result = await withDaemon(deps, true, async ({ client }) => listSessions(client));
  if (result === undefined) return 1;
  deps.write(json ? `${JSON.stringify({ sessions: result }, null, 2)}\n` : formatSessionList(result));
  return 0;
}

async function runStop(deps: SessionCommandDeps, sessionId: string): Promise<number> {
  const outcome = await withDaemon(deps, true, async ({ client }) => (await client.command({ v: 1, commandId: randomUUID(), type: "session.stop" }, sessionId)).outcome);
  if (!outcome) return 1;
  if (!outcome.ok) { deps.writeErr(`Unable to stop ${sessionId}: ${outcome.code}\n`); return 1; }
  deps.write(`Session ${sessionId}: ${(outcome.data as { state?: string } | undefined)?.state ?? "stopped"}\n`);
  return 0;
}

export type StatusReport = {
  running: boolean;
  statePath?: string;
  daemon?: unknown;
  enabled?: boolean;
  drivers?: unknown;
  members?: unknown;
};

async function runStatus(deps: SessionCommandDeps, json: boolean): Promise<number> {
  const report = await withDaemon(deps, false, async ({ client, paths }): Promise<StatusReport> => {
    const status = await client.request({ t: "daemon.status" });
    const drivers = await client.query("drivers.status");
    return {
      running: true, statePath: paths.root, daemon: status.t === "daemon.status" ? status.status : undefined,
      ...(drivers.ok ? (drivers.data as { enabled: boolean; drivers: unknown; members: unknown }) : {}),
    };
  });
  const out: StatusReport = report ?? { running: false };
  if (json) { deps.write(`${JSON.stringify(out, null, 2)}\n`); return 0; }
  if (!out.running) { deps.write("Deck session daemon: not running\n"); return 0; }
  const d = out.daemon as { pid: number; version: string; uptimeMs: number; clients: number; runningWork: boolean; pendingApprovals: number };
  deps.write(`Deck session daemon: running (pid ${d.pid}, v${d.version}, up ${Math.round(d.uptimeMs / 1000)}s, ${d.clients} client(s), running work: ${d.runningWork ? "yes" : "no"}, pending approvals: ${d.pendingApprovals})\n`);
  deps.write(`state: ${out.statePath}\n`);
  deps.write(`cross-runner: ${out.enabled ? "enabled" : "not enabled"}\n`);
  for (const driver of (out.drivers as Array<{ runnerId: string; probe: { status: string; version?: string; reasonCode?: string; mcpIsolationVerified?: boolean } }> | undefined) ?? []) {
    const p = driver.probe;
    deps.write(`driver ${driver.runnerId}: ${p.status}${p.version ? ` ${p.version}` : ""}${p.reasonCode ? ` (${p.reasonCode})` : ""}${p.mcpIsolationVerified ? ", isolation verified" : ""}\n`);
  }
  for (const [member, m] of Object.entries((out.members as Record<string, { runnerId: string; modelId: string; thinking?: string; blocked: string | null }> | undefined) ?? {})) {
    deps.write(`member ${member}: ${m.runnerId}/${m.modelId}${m.thinking ? ` (${m.thinking})` : ""} ${m.blocked ? `blocked: ${m.blocked}` : "ready"}\n`);
  }
  return 0;
}

async function runPrune(deps: SessionCommandDeps, sub: Extract<SessionSubcommand, { action: "prune" }>): Promise<number> {
  const outcome = await withDaemon(deps, true, async ({ client }) => client.query("sessions.prune", {
    dryRun: sub.dryRun, ...(sub.maxAgeDays === undefined ? {} : { maxAgeDays: sub.maxAgeDays }), ...(sub.keep === undefined ? {} : { keep: sub.keep }),
  }));
  if (!outcome) return 1;
  if (!outcome.ok) { deps.writeErr(`Prune failed: ${outcome.code}\n`); return 1; }
  const data = outcome.data as { removed: string[]; kept: number; dryRun: boolean };
  if (sub.json) { deps.write(`${JSON.stringify(data, null, 2)}\n`); return 0; }
  deps.write(`${data.dryRun ? "Would remove" : "Removed"} ${data.removed.length} session(s); ${data.kept} kept.\n`);
  for (const id of data.removed) deps.write(`  ${id}\n`);
  return 0;
}

async function offerWeb(deps: SessionCommandDeps, client: ControlClient): Promise<void> {
  const status = await client.query("web.status");
  if (!status.ok || !(status.data as { enabled?: boolean })?.enabled) return;
  const data = status.data as { url?: string };
  if (!data.url) return;
  deps.write(`Browser: ${data.url}\n`);
  if (deps.interactive && deps.openBrowser && /^(y|yes)$/i.test((await deps.readLine("Open in your default browser? [y/N] ")).trim())) await deps.openBrowser(data.url);
}

async function runWeb(deps: SessionCommandDeps, name: string, args: unknown, json: boolean): Promise<number> {
  const result = await withDaemon(deps, true, ({client}) => client.query(name, args));
  if (!result?.ok) { deps.writeErr(`Web operation failed: ${result && !result.ok ? result.code : "daemon-unavailable"}\n`); return 1; }
  if (json) deps.write(`${JSON.stringify(result.data ?? {ok:true}, null, 2)}\n`);
  else if (name === "web.pair") { const data = result.data as {url:string;code:string;expiresAt:string}; deps.write(`Browser: ${data.url}\nPairing code: ${data.code} (expires ${data.expiresAt})\n`); }
  else if (name === "web.devices") { for (const d of (result.data as {devices:Array<{id:string;name:string;revokedAt?:string}>}).devices) deps.write(`${d.id}  ${d.name}${d.revokedAt ? " (revoked)" : ""}\n`); }
  else if (name === "web.revoke") deps.write("Device revoked.\n");
  else {const data=result.data as {enabled:boolean;url?:string;port:number;error?:string};deps.write(`Web listener: ${data.enabled ? data.url : "disabled"}${data.error ? ` (${data.error})` : ""}\n`);}
  return 0;
}

async function attachTerminal(deps: SessionCommandDeps, connection: SessionConnection, sessionId: string, lastSeq: number): Promise<number> {
  deps.write(`Attached to ${sessionId}. Type a prompt, or /help. /detach leaves the session running.\n`);
  const { reason } = await runTerminalClient({
    connection: connection.client, sessionId, displayAfter: Math.max(0, lastSeq - TAIL_EVENTS), lines: deps.stdinLines(), write: deps.write,
  });
  return reason === "attach-failed" || reason === "connection-lost" ? 1 : 0;
}

async function runAttach(deps: SessionCommandDeps, sessionId: string): Promise<number> {
  const code = await withDaemon(deps, true, async (connection) => {
    const sessions = await listSessions(connection.client);
    const found = sessions?.find((s) => s.sessionId === sessionId);
    if (!found) { deps.writeErr(`Unknown session: ${sessionId}\n`); return 1; }
    return attachTerminal(deps, connection, sessionId, found.lastSeq);
  });
  return code ?? 1;
}

const NOT_CONFIGURED = [
  "Cross-runner sessions are not configured.",
  "Add a `crossRunner` section with `enabled: true` and a `members.lead` assignment {runnerId, modelId} to your Deck config.json.",
].join("\n");

export async function runCrossLaunch(deps: SessionCommandDeps, flags: { changeId?: string }): Promise<number> {
  let cross;
  try { cross = deps.configStore.read().crossRunner; } catch (error) {
    deps.writeErr(`Unable to read the Deck config: ${(error as Error).message}\n`);
    return 1;
  }
  if (!cross?.enabled || !cross.members.lead) { deps.writeErr(`${NOT_CONFIGURED}\n`); return 1; }
  const projectRoot = deps.projectRoot();
  const code = await withDaemon(deps, true, async (connection) => {
    const sessions = (await listSessions(connection.client)) ?? [];
    const existing = sessions.find((s) => s.projectRoot === projectRoot && live(s.state) && (flags.changeId === undefined || s.changeId === flags.changeId));
    if (existing) { await offerWeb(deps, connection.client); return attachTerminal(deps, connection, existing.sessionId, existing.lastSeq); }
    const created = await connection.client.command({ v: 1, commandId: randomUUID(), type: "session.create", projectRoot, ...(flags.changeId ? { changeId: flags.changeId } : {}) });
    if (!created.outcome.ok) {
      deps.writeErr(`Unable to create the session: ${created.outcome.code}${created.outcome.message ? ` (${created.outcome.message})` : ""}\n`);
      return 1;
    }
    const data = created.outcome.data as { sessionId: string; lastSeq: number };
    await offerWeb(deps, connection.client);
    return attachTerminal(deps, connection, data.sessionId, 0);
  });
  return code ?? 1;
}

export async function runSessionCommand(deps: SessionCommandDeps, sub: SessionSubcommand): Promise<number> {
  switch (sub.action) {
    case "web": return runWeb(deps, `web.${sub.operation}`, {}, sub.json);
    case "devices-revoke": return runWeb(deps, "web.revoke", {deviceId:sub.deviceId}, false);
    case "list": return runList(deps, sub.json);
    case "attach": return runAttach(deps, sub.sessionId);
    case "stop": return runStop(deps, sub.sessionId);
    case "status": return runStatus(deps, sub.json);
    case "prune": return runPrune(deps, sub);
    case "self-test": {
      const report = runSessionSelfTest({ env: deps.env });
      deps.write(sub.json ? `${JSON.stringify(report, null, 2)}\n` : formatSelfTest(report));
      return report.ok ? 0 : 1;
    }
    case "ack-claude-tos":
      return runAckClaudeTos({ store: deps.configStore, yes: sub.yes, interactive: deps.interactive, write: deps.write, readLine: deps.readLine });
  }
}

/** Open the global workspace without creating or attaching a project session. */
export async function runWebWorkspace(deps: SessionCommandDeps, flags: {json:boolean;noOpen:boolean}): Promise<number> {
  const outcome = await withDaemon(deps, true, ({client}) => client.query("web.enable"));
  if (!outcome?.ok) { deps.writeErr(`Unable to start the web workspace: ${outcome && !outcome.ok ? outcome.code : "daemon-unavailable"}\n`); return 1; }
  const status = outcome.data as {enabled:boolean;url?:string;error?:string};
  if (!status.enabled || !status.url) { deps.writeErr("Unable to start the web workspace: listener-unavailable\n"); return 1; }
  deps.write(flags.json ? `${JSON.stringify(status)}\n` : `Browser: ${status.url}\n`);
  if (!flags.json && !flags.noOpen && deps.openBrowser) {
    try { await deps.openBrowser(status.url); } catch { deps.writeErr("Unable to open your browser. Open the URL above manually.\n"); }
  }
  return 0;
}
