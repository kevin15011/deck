/** Child MCP set computation (XR-4.4, XR-6.3). Pure: no I/O. */

export type ChildMcpRole = "lead" | "member";
export type ChildMcpSet = { servers: string[]; sessionTools: string[] };

export const LEAD_SESSION_TOOLS = [
  "deck_delegate", "deck_task_wait", "deck_task_result", "deck_task_cancel", "deck_task_list",
  "deck_memory_recall", "deck_memory_propose", "deck_approve",
] as const;
export const MEMBER_SESSION_TOOLS = ["deck_memory_recall", "deck_memory_propose", "deck_approve"] as const;

export type ChildMcpInput = {
  runnerPackages: readonly string[];
  memoryProviderIds: readonly string[];
  webSearch: { enabled: boolean; serverId?: string };
  sessionMcp: { id: string };
  role: ChildMcpRole;
};

/** packages configured for the runner, minus memory providers, web search only when enabled, plus the session server. */
export function computeChildMcpSet(input: ChildMcpInput): ChildMcpSet {
  const webId = input.webSearch.serverId ?? "web-search";
  const excluded = new Set<string>([...input.memoryProviderIds, input.sessionMcp.id, webId]);
  const servers: string[] = [];
  const push = (id: string) => { if (!servers.includes(id)) servers.push(id); };
  for (const id of input.runnerPackages) if (!excluded.has(id)) push(id);
  if (input.webSearch.enabled) push(webId);
  push(input.sessionMcp.id);
  return { servers, sessionTools: [...(input.role === "lead" ? LEAD_SESSION_TOOLS : MEMBER_SESSION_TOOLS)] };
}
