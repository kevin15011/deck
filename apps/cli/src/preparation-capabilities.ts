import { isCodebaseMemoryEnabled, type NormalizedDeckConfig } from "@deck/core";
import type { PreparationMember } from "@deck/core/session/preparation";

/** Intent only. Guidance selection never proves an executable, hook, or provider ready. */
export function preparationCapabilities(config: NormalizedDeckConfig, runnerId: string): PreparationMember["capabilities"] {
  return {
    "codebase-memory": { enabled: isCodebaseMemoryEnabled(config, runnerId) },
    rtk: { enabled: config.packageInstructions?.[runnerId]?.rtk === true },
    "adaptive-memory": { enabled: config.adaptiveMemory.enabled === true && config.adaptiveMemory.activeProvider !== "none", inputDigest: config.adaptiveMemory.activeProvider },
    "web-search": { enabled: config.webSearch.enabled, inputDigest: config.webSearch.provider ?? "native" },
  };
}
