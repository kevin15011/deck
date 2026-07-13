import type { RunnerModelDiscoveryRequest } from "@deck/core";

export type OpenCodeDiscoveryIdentity = {
  runtime: "opencode" | "pi";
  projectRoot: string;
};

export type OpenCodeDiscoveryCoordinator<State> = {
  start(
    request: RunnerModelDiscoveryRequest & { runtime: "opencode" },
    apply: (state: State) => void,
  ): Promise<boolean>;
};

export function getOpenCodeDiscoveryAction(
  state: { kind: string },
  cursor: number,
): "wait" | "retry" | "back" {
  if (state.kind === "loading") return "wait";
  return cursor === 0 ? "retry" : "back";
}

/** Applies only the newest discovery result for the active runner/project. */
export function createOpenCodeDiscoveryCoordinator<State>({
  discover,
  getActiveIdentity,
  loadingState,
}: {
  discover: (request: RunnerModelDiscoveryRequest) => Promise<State>;
  getActiveIdentity: () => OpenCodeDiscoveryIdentity;
  loadingState: State;
}): OpenCodeDiscoveryCoordinator<State> {
  let generation = 0;

  return {
    async start(request, apply) {
      const requestGeneration = ++generation;
      apply(loadingState);
      const state = await discover(request);
      const activeIdentity = getActiveIdentity();
      if (
        requestGeneration !== generation
        || activeIdentity.runtime !== request.runtime
        || activeIdentity.projectRoot !== request.projectRoot
      ) {
        return false;
      }
      apply(state);
      return true;
    },
  };
}
