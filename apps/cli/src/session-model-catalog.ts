import type { RunnerAdapter } from "@deck/core";
import type { DriverLookup } from "@deck/session-host";

/** Discover only runner-owned models; failed or stale discovery never invents choices. */
export async function discoverSessionModels(adapters: readonly RunnerAdapter[], drivers: DriverLookup, projectRoot: string) {
  const runners = await Promise.all(adapters.filter(adapter => typeof adapter.getSessionDriver === "function").map(async adapter => {
    const base = { runnerId: adapter.runnerId, label: adapter.displayName ?? adapter.runnerId };
    const unavailable = (reasonCode:string) => ({...base,available:false,reasonCode,models:[]});
    const driver = drivers.get(adapter.runnerId);
    if (!driver) return unavailable("session-driver-unavailable");
    if (!adapter.getModelInventory) return unavailable("model-discovery-unavailable");
    try {
      const probe = await driver.probe({cwd:projectRoot});
      if (probe.status === "blocked") return unavailable("runner-unavailable");
      const result = await adapter.getModelInventory({projectRoot,mode:"prefer-cache",signal:AbortSignal.timeout(15_000)});
      if (result.state !== "ready") return unavailable("model-discovery-unavailable");
      const models = Object.values(result.inventory.modelsByProvider).flat()
        .filter(model => model.visibility !== "hidden" && !(adapter.runnerId === "claude" && model.id === "inherit"))
        .map(model => ({modelId:model.id,label:model.displayName,thinkingLevels:adapter.getThinkingLevels(model.id)}));
      return {...base,available:models.length > 0,...(models.length ? {} : {reasonCode:"models-unavailable"}),models};
    } catch { return unavailable("model-discovery-failed"); }
  }));
  return {runners};
}
