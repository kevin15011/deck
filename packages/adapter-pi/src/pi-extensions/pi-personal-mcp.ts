import { DECK_PI_MCP_SERVER_IDS, sanitizeMcpName } from "../pi-mcp-catalog";
import { isReservedPersonalMcp } from "@deck/core/session/personal-mcp";
/** Tool declarations can be offered to every role; the existing tool_call policy still owns execution. */
export function personalPiToolNames(tools: readonly { name: string; exposure?: string }[]): string[] {
  const managed = new Set<string>(DECK_PI_MCP_SERVER_IDS.map(sanitizeMcpName));
  return tools.filter(tool => {
    const match = /^mcp__(.+?)__.+$/.exec(tool.name);
    return match && tool.exposure !== "hidden" && !managed.has(match[1]!) && !isReservedPersonalMcp(match[1]!);
  }).map(tool => tool.name);
}
