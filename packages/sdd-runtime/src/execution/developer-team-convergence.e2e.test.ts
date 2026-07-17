import { test } from "bun:test";

import { createDeveloperTeamRunnerHostBridgeV1 } from "./developer-team-runner-host-bridge";
import { runDeveloperTeamConvergenceE2EV1 } from "../testing/developer-team-convergence-fixture";

test("EG8-E2E-01 one immutable batch crosses a runner bridge, repair, staged Verify, fresh Review, and registry commit", async () => {
  await runDeveloperTeamConvergenceE2EV1(
    "opencode",
    (options) => createDeveloperTeamRunnerHostBridgeV1({ ...options, runnerId: "opencode" }),
  );
});
