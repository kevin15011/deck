import { resolve } from "node:path";
import type { ExtensionAPI } from "../shared/pi-api";
import { createDeckToolPolicyExtension } from "../tool-policy/extension";
import { installReviewedPiMcp } from "../tool-policy/native-mcp";
import { classifyNativeCodebase, nativeCodebaseFailureCode } from "../../pi-native-codebase-readiness";

export { createDeckToolPolicyExtension };
// Reload creates fresh modules. Process-local ownership of this marker must survive those module instances.
const initialLoadsKey = Symbol.for("deck.pi.codebase.initial-factory.v1");
type FactoryGlobals = typeof globalThis & { [initialLoadsKey]?: Set<string> };
export function createDeckToolPolicyEntry(options: Parameters<typeof installReviewedPiMcp>[2] = {}) {
  return async function deckToolPolicy(pi: ExtensionAPI, native: Parameters<typeof installReviewedPiMcp>[1]) {
    const globals = globalThis as FactoryGlobals;
    const initialLoads = globals[initialLoadsKey] ??= new Set<string>();
    const agentDir = resolve(native.getAgentDir());
    if (!initialLoads.has(agentDir)) {
      // Pi 1.0.0 awaits factories and exits startup on this failure, before binding sessions/MCP/model dispatch.
      try { classifyNativeCodebase({ agentDir, ...options }); }
      catch (error) {
        if (error instanceof Error && error.name === "AbortError") throw error;
        throw new Error(nativeCodebaseFailureCode(error));
      }
      initialLoads.add(agentDir);
    }
    const reviewed = installReviewedPiMcp(pi, native, options);
    createDeckToolPolicyExtension({
      reviewedReadiness: () => reviewed.status() === "ready", customCodebase: () => reviewed.status() === "custom",
      protectedDiagnostic: reviewed.protectedDiagnostic, codebaseToolBlock: reviewed.toolBlock,
    })(pi);
  };
}
export default createDeckToolPolicyEntry();
