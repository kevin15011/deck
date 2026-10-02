import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { createCodexRunnerAdapter } from "@deck/adapter-codex";
import { getDefaultDeckConfig } from "@deck/core";
import { testTools } from "../../../../../../packages/adapter-codex/src/test-tools";
import { runRunnerAction, runRunnerReviewPlan } from "../action-runner";

const sha = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");
function tarball(binary: Buffer) {
  const header = Buffer.alloc(512);
  header.write("rtk");
  header.write(`${binary.length.toString(8).padStart(11, "0")}\0`, 124);
  header[156] = 48;
  return gzipSync(Buffer.concat([header, binary, Buffer.alloc((512 - binary.length % 512) % 512), Buffer.alloc(1024)]));
}

function adapterWith(overrides: Parameters<typeof testTools>[0] = {}) {
  const binary = Buffer.from("fixture rtk");
  const archive = tarball(binary);
  const calls: string[] = [];
  const tools = testTools({
    rtkReleaseOverride: { asset: "fixture", archiveSha256: sha(archive), archiveBytes: archive.length, binarySha256: sha(binary), binaryBytes: binary.length },
    rtkArtifactEffects: { fetchArchive: async () => { calls.push("rtk"); return archive; } },
    installContextMode: async () => { calls.push("context-mode"); return true; },
    resolveCommand: (name) => name === "codebase-memory-mcp" ? process.execPath : undefined,
    ...overrides,
  });
  const adapter = createCodexRunnerAdapter({
    tools,
    preflight: { probe: async () => ({ found: true, version: "0.159.3", help: "Usage: codex [OPTIONS]", execHelp: "Usage: codex exec", resumeHelp: "Usage: codex resume [SESSION_ID] --last" }), inspectTrust: async () => "trusted" },
    serenaReadinessResolver: async () => ({ state: "missing" as const, diagnostic: { code: "serena-not-ready", message: "missing" } }),
    codebaseIndexReadiness: () => true,
  });
  return { adapter, calls };
}

describe("Codex install action kinds through the dashboard action runner", () => {
  test("routes every install-codex-* kind to the Codex adapter and returns its evidence", async () => {
    const { adapter, calls } = adapterWith();
    const runnerAdapter = { runAction: (action: Parameters<typeof adapter.runAction>[0], context: unknown) => adapter.runAction(action, context as Parameters<typeof adapter.runAction>[1]) };
    const results = [];
    for (const [kind, capabilityId] of [["install-codex-rtk", "rtk"], ["install-codex-tool", "context-mode"], ["install-codex-codebase", "codebase-memory"]] as const) {
      results.push(await runRunnerAction({ id: `codex.${capabilityId}`, kind, title: kind, capabilityId, status: "ready" }, { runnerAdapter, projectRoot: "/p", runnerId: "codex", operationId: "op" }));
    }
    expect(results.map((result) => result.status)).toEqual(["executed", "executed", "executed"]);
    expect(calls).toEqual(["rtk", "context-mode"]);
    const missingAdapter = await runRunnerAction({ id: "x", kind: "install-codex-rtk", title: "x", capabilityId: "rtk", status: "ready" }, {});
    expect(missingAdapter).toMatchObject({ status: "failed", message: "Codex tool installer is unavailable." });
  });

  test("a reviewed plan runs the automatic installs before team application and reports blocked tools without installing them", async () => {
    const { adapter, calls } = adapterWith();
    const inventory = await adapter.getCapabilityInventory({ projectRoot: "/p", environmentId: "codex-development", runnerId: "codex", deckConfig: getDefaultDeckConfig() });
    const plan = adapter.buildReviewPlan({ runnerId: "codex", environmentId: "codex-development", selectedCapabilities: { rtk: true, "context-mode": true }, packageInstructions: {}, adaptiveMemory: { provider: "none" } }, inventory);
    expect(plan.groups.automaticInstalls.map((action) => action.kind)).toEqual(["install-codex-rtk", "install-codex-tool"]);
    const order: string[] = [];
    const results = await runRunnerReviewPlan(plan as never, {
      projectRoot: "/p",
      runnerId: "codex",
      operationId: "op",
      runnerAdapter: { runAction: (action: Parameters<typeof adapter.runAction>[0], context: unknown) => adapter.runAction(action, context as Parameters<typeof adapter.runAction>[1]) },
      installTeamBundle: async () => { order.push(`team-after:${calls.join(",")}`); return { results: [] }; },
      onActionResult: (result: { actionId: string; status: string }) => order.push(`${result.actionId}:${result.status}`),
    } as never);
    expect(results.filter((result) => result.actionId.startsWith("codex.tool")).map((result) => result.status)).toEqual(["executed", "executed"]);
    expect(order.find((entry) => entry.startsWith("team-after:"))).toBe("team-after:rtk,context-mode");
    expect(order.findIndex((entry) => entry.startsWith("codex.tool.rtk.install"))).toBeLessThan(order.findIndex((entry) => entry.startsWith("team-after:")));
  });
});
