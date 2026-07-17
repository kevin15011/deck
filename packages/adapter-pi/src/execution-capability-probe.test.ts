import { expect, test } from "bun:test";
import { probeRunnerExecutionCapabilities } from "../../sdd-runtime/src/execution/telemetry";
import { getPiExecutionProbeCapabilities } from "./developer-team-install";

test("Pi packaged execution hook probe enters shadow mode", () => {
  const capabilities = getPiExecutionProbeCapabilities();
  expect(capabilities).toEqual({ invocationHook: true, freshAgentHook: true });
  expect(probeRunnerExecutionCapabilities("pi", capabilities)).toEqual({ runner: "pi", supported: true, mode: "shadow", codes: [] });
});
