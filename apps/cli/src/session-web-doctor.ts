/** Read-only web readiness. Never starts the daemon or probes exposure tooling. */
import type { CrossRunnerConfig } from "@deck/core";
import { ControlClient, resolveStatePaths } from "@deck/session-host";
import type { DoctorCategoryResult, DoctorCheckItem } from "./doctor-command/types";
export type WebStatus = {
  enabled: boolean;
  hostname: string;
  port: number;
  error?: string;
};
export async function readSessionWebStatus(): Promise<WebStatus | undefined> {
  let client: ControlClient | undefined;
  try {
    client = await ControlClient.connect(resolveStatePaths().socket.path, { timeoutMs: 500 });
    const reply = await client.request({ t: "query", name: "web.status" }, 500);
    return reply.t === 'query.result' && reply.outcome.ok ? reply.outcome.data as WebStatus : undefined;
  }
  catch {
    return undefined;
  }
  finally {
    client?.close();
  }
}
export async function checkSessionWeb(config: CrossRunnerConfig | undefined, inspect = readSessionWebStatus): Promise<DoctorCategoryResult> {
  const items: DoctorCheckItem[] = [];
  if (!config?.enabled)
    items.push({ status: 'ok', message: 'Cross-runner web is inactive; cross-runner sessions are not enabled.' });
  else {
    const status = await inspect();
    if (!status)
      items.push({ status: 'warning', message: 'Session daemon web listener is not reachable. Doctor did not start it.' });
    else if (status.hostname !== '127.0.0.1')
      items.push({ status: 'error', message: 'Session web listener is not bound exclusively to 127.0.0.1.' });
    else if (status.error)
      items.push({ status: 'error', message: `Session web listener could not bind loopback port ${config.web.port}; check for a port conflict.` });
    else
      items.push({ status: 'ok', message: status.enabled ? `Session web listener binds 127.0.0.1:${status.port}.` : 'Session web listener is disabled.' });
    if (config.web.trustedProxy || config.web.allowedOrigins.length || config.web.allowFunnel)
      items.push({ status: 'warning', message: `External web exposure is configured${config.web.allowFunnel ? ' with Funnel allowed' : ''}; device pairing remains required. Doctor did not run exposure commands.` });
  }
  return { category: 'Session Web', status: items.some(i => i.status === 'error') ? 'error' : items.some(i => i.status === 'warning') ? 'warning' : 'ok', items };
}
