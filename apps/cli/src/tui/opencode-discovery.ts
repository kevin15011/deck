import type { RunnerModelDiscoveryRequest } from "@deck/core";

export type OpenCodeDiscoveryIdentity<Runtime extends "opencode" | "codex" = "opencode"> = {
  runtime: Runtime;
  projectRoot: string;
};

export type OpenCodeDiscoveryCoordinator<State, Runtime extends "opencode" | "codex" = "opencode"> = {
  start(
    request: RunnerModelDiscoveryRequest & { runtime: Runtime },
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
export function createOpenCodeDiscoveryCoordinator<State, Runtime extends "opencode" | "codex" = "opencode">({
  discover,
  getActiveIdentity,
  loadingState,
}: {
  discover: (request: RunnerModelDiscoveryRequest) => Promise<State>;
  getActiveIdentity: () => OpenCodeDiscoveryIdentity<Runtime>;
  loadingState: State;
}): OpenCodeDiscoveryCoordinator<State, Runtime> {
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
