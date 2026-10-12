/** Shared names and the child MCP server spec for the Deck session bridge (D-11, XR-4.7). */

export const SESSION_MCP_SERVER_ID = "deck";
export const SESSION_CREDENTIAL_ENV = "DECK_SESSION_CREDENTIAL_FILE";
export const DECK_APPROVE_TOOL = "deck_approve";
export const DECK_STATUS_TOOL = "deck_status";
/** S1a surface: approval relay and status only. Delegation/memory tools arrive in later stages. */
export const DEFAULT_ALLOWED_TOOLS = [DECK_APPROVE_TOOL, DECK_STATUS_TOOL] as const;

export type SessionMcpServerSpec = { command: string; args: string[]; env: Record<string, string> };

/**
 * How a native CLI starts the bridge. The ONLY secret-bearing value is a file path in env;
 * the token itself never appears in argv or in inline MCP config (visible in `ps`).
 */
export function sessionMcpServerSpec(input: { command: readonly string[]; credentialFile: string }): SessionMcpServerSpec {
  const [command, ...args] = input.command;
  if (!command) throw new Error("session MCP command must not be empty");
  return { command, args, env: { [SESSION_CREDENTIAL_ENV]: input.credentialFile } };
}
