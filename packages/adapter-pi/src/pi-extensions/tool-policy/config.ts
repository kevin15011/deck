/** Static launch-independent configuration written next to the extension by the Deck installer (`config.json`). */
export type ToolPolicyConfig = Readonly<{
  version: 1;
  /** Absolute path of the Deck-owned RTK binary; `null` when RTK is not selected or not usable. */
  rtkBinary: string | null;
  /** Redirect code-structure searches toward the codebase-memory graph tools. */
  graphRedirect: boolean;
}>;

export const DEFAULT_TOOL_POLICY_CONFIG: ToolPolicyConfig = Object.freeze({ version: 1, rtkBinary: null, graphRedirect: false });

export function parseToolPolicyConfig(text: string | undefined): ToolPolicyConfig {
  if (!text) return DEFAULT_TOOL_POLICY_CONFIG;
  try {
    const value = JSON.parse(text) as { rtkBinary?: unknown; graphRedirect?: unknown };
    return {
      version: 1,
      rtkBinary: typeof value.rtkBinary === "string" && value.rtkBinary.startsWith("/") ? value.rtkBinary : null,
      graphRedirect: value.graphRedirect === true,
    };
  } catch {
    return DEFAULT_TOOL_POLICY_CONFIG;
  }
}

export function renderToolPolicyConfig(config: Omit<ToolPolicyConfig, "version">): string {
  return `${JSON.stringify({ version: 1, rtkBinary: config.rtkBinary, graphRedirect: config.graphRedirect }, null, 2)}\n`;
}
