import { isAbsolute, basename, dirname } from "node:path";
import { CODEX_SUPERMEMORY_ENV_KEY, CODEX_SUPERMEMORY_ROOT_NAME } from "./supermemory-artifact";

/** Reviewed native stdio contract. Names only; values stay in the launch environment. */
export const CODEX_SUPERMEMORY_MCP_ENV = [CODEX_SUPERMEMORY_ENV_KEY, "SUPERMEMORY_API_URL", "SUPERMEMORY_MCP_URL"] as const;
export type CodexSupermemoryProxy = { nodeCommand: string; script: string };
export function validCodexSupermemoryProxy(proxy: CodexSupermemoryProxy): boolean {
  return isAbsolute(proxy.nodeCommand) && isAbsolute(proxy.script)
    && !/[\0\r\n]/.test(proxy.nodeCommand + proxy.script)
    && basename(proxy.script) === "mcp-proxy.js" && basename(dirname(proxy.script)) === CODEX_SUPERMEMORY_ROOT_NAME;
}

/** Guidance, never request rewriting or a namespace authorization boundary. */
export function codexSupermemoryToolContext(projectScope: string): string {
  if (!/^sm_project_v1_[a-z0-9]+_[a-z0-9]+(?:_[a-z0-9]+)*$/.test(projectScope)) throw new Error("codex-memory-project-scope-invalid");
  return `Official Supermemory tools can access spaces authorized by the selected account credential. Current project namespace: ${projectScope}. Automatic capture uses this same project identity across runners. For project-specific writes and the first project-specific consultation, supply this exact namespace using the tool's supported namespace argument. Intentionally shared writes belong in the appropriate shared space; broader useful account reads remain available. Do not change account active-space state to establish a task default. Operations without a namespace selector retain their native account behavior. Unscoped queries do not guarantee project-first ranking. These are usage instructions, not enforced routing or permission to bypass tool approvals.`;
}
