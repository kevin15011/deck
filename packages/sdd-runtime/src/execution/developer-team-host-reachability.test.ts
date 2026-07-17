import { expect, test } from "bun:test";
import { createHash } from "node:crypto";

test("D-REACH-07 packaged hook assets and runtime dependencies are embedded inputs", async () => {
  const openCodePackage = await Bun.file(new URL("../../../adapter-opencode/package.json", import.meta.url)).json();
  const piPackage = await Bun.file(new URL("../../../adapter-pi/package.json", import.meta.url)).json();
  const openCodeInstall = await Bun.file(new URL("../../../adapter-opencode/src/developer-team-install.ts", import.meta.url)).text();
  const piProfile = await Bun.file(new URL("../../../adapter-pi/src/pi-team-profile.ts", import.meta.url)).text();
  const openCodeAsset = await Bun.file(new URL("../../../adapter-opencode/assets/opencode/plugins/developer-team-execution.generated.js", import.meta.url)).text();
  const piAsset = await Bun.file(new URL("../../../adapter-pi/assets/pi/extensions/developer-team-execution.generated.js", import.meta.url)).text();
  const openCodeEntry = await Bun.file(new URL("../../../adapter-opencode/assets/opencode/plugins/developer-team-execution.ts", import.meta.url)).arrayBuffer();
  const piEntry = await Bun.file(new URL("../../../adapter-pi/assets/pi/extensions/developer-team-execution.ts", import.meta.url)).arrayBuffer();
  expect(openCodePackage.dependencies["@deck/sdd-runtime"]).toBe("workspace:*");
  expect(piPackage.dependencies["@deck/sdd-runtime"]).toBe("workspace:*");
  expect(openCodeInstall).toContain('developer-team-execution.generated.js" with { type: "file" }');
  expect(piProfile).toContain('developer-team-execution.generated.js" with { type: "file" }');
  expect(openCodeAsset).toContain('"tool.execute.before"');
  expect(piAsset).toContain('"tool_call"');
  expect(openCodeAsset).not.toContain("@deck/");
  expect(piAsset).not.toContain("@deck/");
  expect(openCodeAsset).toContain(`source-sha256:${createHash("sha256").update(new Uint8Array(openCodeEntry)).digest("hex")}`);
  expect(piAsset).toContain(`source-sha256:${createHash("sha256").update(new Uint8Array(piEntry)).digest("hex")}`);
});

test("D-REACH-08 non-test inbound paths reach composition and targeted effect", async () => {
  const openCodeAsset = await Bun.file(new URL("../../../adapter-opencode/assets/opencode/plugins/developer-team-execution.ts", import.meta.url)).text();
  const piAsset = await Bun.file(new URL("../../../adapter-pi/assets/pi/extensions/developer-team-execution.ts", import.meta.url)).text();
  const openCodeBridge = await Bun.file(new URL("../../../adapter-opencode/src/developer-team-execution-bridge.ts", import.meta.url)).text();
  const piBridge = await Bun.file(new URL("../../../adapter-pi/src/developer-team-execution-bridge.ts", import.meta.url)).text();
  const sharedBridge = await Bun.file(new URL("./developer-team-runner-host-bridge.ts", import.meta.url)).text();
  expect(openCodeAsset).toContain('"tool.execute.before"');
  expect(openCodeAsset).toContain("bridge.execute");
  expect(piAsset).toContain('pi.on("tool_call"');
  expect(piAsset).toContain("bridge.execute");
  expect(openCodeBridge).toContain("createDeveloperTeamRunnerHostBridgeV1");
  expect(piBridge).toContain("createDeveloperTeamRunnerHostBridgeV1");
  expect(sharedBridge).toContain("composeDeveloperTeamExecutionV1");
  expect(sharedBridge).toContain("executeTargetedRepairV1");
});
