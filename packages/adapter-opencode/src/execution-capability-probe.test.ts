import { expect, test } from "bun:test";
import { probeRunnerExecutionCapabilities } from "../../sdd-runtime/src/execution/telemetry";
import { getOpenCodeExecutionProbeCapabilities } from "./developer-team-install";

test("OpenCode packaged execution hook probe enters shadow mode", () => {
  const capabilities = getOpenCodeExecutionProbeCapabilities();
  expect(capabilities).toEqual({ invocationHook: true, freshAgentHook: true });
  expect(probeRunnerExecutionCapabilities("opencode", capabilities)).toEqual({ runner: "opencode", supported: true, mode: "shadow", codes: [] });
});
